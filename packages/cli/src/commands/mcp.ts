/**
 * `svatah mcp` — the MCP server (T4.6, REQ-AGT-2, LLD §15, §13.4).
 *
 * > MCP server exposes the CLI operations and the raw agent surface (`snapshot`,
 * > `act`, `read`, `check`) so external agents can explore through Svatah and
 * > have trajectories captured.
 *
 * Two halves, and the second is the interesting one.
 *
 * **The operation tools** — `compile`, `lint`, `run`, `record`, `heal`,
 * `bindings`, `results` — run *the same functions the CLI runs*. No logic lives
 * in this file, exactly as none lives in the local service (LLD §13.5): an agent
 * that compiled a project through MCP and a person who compiled it on a terminal
 * must get the same `plan.json`, and the only way to guarantee that is for there
 * to be one implementation.
 *
 * **The raw surface tools** — `surface_snapshot`, `surface_act`, `surface_read`,
 * `surface_check` — hand an agent the actual `AgentSurface`, with one addition:
 * every call requires an `intent`. That is what turns an exploration into a
 * *trajectory* rather than a log, and what makes REQ-BEH-4's "compile an agent's
 * exploration into a deterministic tool" possible at all. An agent that cannot
 * say what it is doing is an agent whose exploration cannot become a tool.
 *
 * ADR-16: Svatah does not own an exploration agent. It owns the surface the
 * agent explores through, and the file that comes out.
 */
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { lintPlan, renderPlan } from "@svatah/compiler";
import { TrajectoryWriter } from "@svatah/trajectory";
import { createSurface, type AgentSurface } from "@svatah/surface";
import type { ActArgs, Config, Predicate, ReadKind, Ref, SurfaceAction } from "@svatah/schema";
import { predicateSchema, surfaceActionSchema } from "@svatah/schema";
import { formatDiagnostic } from "@svatah/spec";
import {
  boolOption,
  EXIT,
  sessionTarget,
  stringOption,
  type CommandIo,
  type ExitCode,
  type ParsedArgs,
} from "@svatah/bindings-cli";
import { registerAllAdapters } from "../adapters.js";
import { compileProject, loadProject, type LoadedProject } from "../project.js";

/** What every raw-surface tool takes, on top of its own arguments (LLD §13.4). */
const INTENT = z
  .string()
  .min(1)
  .describe(
    "What you are trying to do, in the words you would use to describe the step to a person: " +
      '"sign in as the enterprise user", not "click r14". Required: it is the sentence this ' +
      "call compiles into when the trajectory becomes a flow.",
  );

export interface McpServerOptions {
  readonly root: string;
  readonly io: CommandIo;
  /** Where `trajectory.jsonl` goes. `<root>/runs/<id>/` by default. */
  readonly trajectoryPath?: string;
  /** Session id, so a test can predict the trajectory's path. */
  readonly sessionId?: string;
}

/**
 * Build the server.
 *
 * Exported so the integration test can drive it over an in-memory transport
 * rather than by spawning a process: what is under test is the tools, and a test
 * that had to parse stdio framing would be testing the SDK.
 */
export async function buildMcpServer(options: McpServerOptions): Promise<{
  server: McpServer;
  trajectory: TrajectoryWriter;
  close(): Promise<void>;
}> {
  const { io } = options;
  const root = resolve(options.root);
  const sessionId = options.sessionId ?? randomUUID();
  const trajectory = new TrajectoryWriter(
    options.trajectoryPath ?? join(root, "runs", sessionId, "trajectory.jsonl"),
  );

  registerAllAdapters();

  const server = new McpServer(
    { name: "svatah", version: "0.1.0" },
    {
      instructions:
        "Svatah is a deterministic automation runtime. The `svatah_*` tools run the same " +
        "operations the command line runs. The `surface_*` tools drive a live session " +
        "directly; each needs an `intent`, and the sequence is written to trajectory.jsonl " +
        "so the exploration can be compiled into a flow that replays without a model.",
    },
  );

  /* ── the session the surface tools drive ────────────────────────────────── */

  let surface: AgentSurface | undefined;
  let loaded: LoadedProject | undefined;

  const project = async (): Promise<LoadedProject> => {
    loaded ??= await loadProject(root);
    return loaded;
  };

  /**
   * Opened on the first surface call, not at start.
   *
   * An agent that only ever calls `svatah_compile` should not have started a
   * browser, and a server that opened one eagerly would make every operation
   * tool wait for it.
   */
  const session = async (): Promise<AgentSurface> => {
    if (surface !== undefined) return surface;
    const project0 = await project();
    const target = sessionTarget({ command: [], options: {}, rest: [] }, {
      config: project0.config.app,
    });
    const config: Config = {
      ...project0.config,
      app: { ...project0.config.app, ...target },
    };
    surface = await createSurface(config);
    await surface.open({ ...target });
    if (target.baseUrl !== undefined && surface.kind === "web") {
      await surface.act("navigate", undefined, { url: target.baseUrl });
    }
    io.err(`surface session opened on ${config.adapter}`);
    return surface;
  };

  /**
   * Run one surface call and record it (LLD §13.4).
   *
   * The recording is not optional and not a wrapper the caller can skip: every
   * path through a surface tool goes through here, including the ones that
   * throw. A trajectory records what *happened*, and an agent that drove the
   * application into a bad state has produced the most interesting trajectory
   * there is.
   */
  const captured = async <T>(
    call: "snapshot" | "act" | "read" | "check",
    intent: string,
    args: Record<string, unknown>,
    ref: Ref | undefined,
    run: (live: AgentSurface) => Promise<T>,
  ): Promise<T> => {
    const live = await session();

    /*
     * The page's structural hash and the element's description, read *now*.
     * A reference is stable within a snapshot and lost on navigation, so an
     * element described later is a different element or none at all — and
     * candidates and fingerprints are synthesised from this (LLD §13.4).
     */
    const snapshotHash = await live
      .snapshot({ interactiveOnly: true })
      .then((one) => one.hash)
      .catch(() => undefined);
    const describe = ref === undefined ? undefined : await live.describe(ref).catch(() => undefined);
    /*
     * And where the call was made (T5.5). A binding entry is keyed by a context,
     * and a context is a URL pattern plus the structural hash above — so a
     * trajectory with the hash and not the URL is one the compiler can group but
     * cannot address. Best effort: a non-web surface has no URL and says so by
     * having none.
     */
    const url = (await live.state().catch(() => undefined))?.url;

    try {
      const result = await run(live);
      trajectory.write({
        intent,
        call,
        ...(Object.keys(args).length === 0 ? {} : { args }),
        ...(snapshotHash === undefined ? {} : { snapshotHash }),
        ...(url === undefined ? {} : { url }),
        ...(ref === undefined ? {} : { ref }),
        ...(describe === undefined ? {} : { describe }),
        ...(result === undefined ? {} : { result }),
      });
      return result;
    } catch (error) {
      trajectory.write({
        intent,
        call,
        ...(Object.keys(args).length === 0 ? {} : { args }),
        ...(snapshotHash === undefined ? {} : { snapshotHash }),
        ...(url === undefined ? {} : { url }),
        ...(ref === undefined ? {} : { ref }),
        ...(describe === undefined ? {} : { describe }),
        error: error instanceof Error ? error.message.split("\n")[0]! : String(error),
      });
      throw error;
    }
  };

  const text = (value: unknown) => ({
    content: [
      { type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
    ],
  });

  /* ── the operation tools (LLD §15) ──────────────────────────────────────── */

  server.registerTool(
    "svatah_compile",
    {
      title: "Compile the project",
      description:
        "Compile every flow into a plan, reporting the diagnostics `svatah compile` reports. " +
        "The same function the command line runs, so an agent and a person get the same plan.",
      inputSchema: {
        write: z
          .boolean()
          .optional()
          .describe("Write .svatah/plan.json as well as returning it. Default false."),
      },
    },
    async ({ write }) => {
      const project0 = await project();
      const compiled = compileProject(project0, { stable: true });
      const diagnostics = [...project0.diagnostics, ...compiled.diagnostics];
      if (write === true && compiled.ok) {
        const { mkdirSync, writeFileSync } = await import("node:fs");
        mkdirSync(join(project0.root, ".svatah"), { recursive: true });
        writeFileSync(join(project0.root, ".svatah", "plan.json"), renderPlan(compiled.plan), "utf8");
      }
      return text({
        ok: compiled.ok,
        hash: compiled.plan.hash,
        stories: compiled.plan.stories.map((story) => ({
          name: story.name,
          steps: story.steps.map((step) => ({
            text: step.text,
            action: step.action,
            tier: step.origin.tier,
            confidence: step.origin.confidence,
            target: step.target === undefined ? undefined : { ref: step.target.ref, status: step.target.status },
          })),
        })),
        diagnostics: diagnostics.map(formatDiagnostic),
      });
    },
  );

  server.registerTool(
    "svatah_lint",
    {
      title: "Lint the project",
      description:
        "Everything `svatah lint` reports: ambiguous targets, model-compiled steps, low " +
        "confidence, unused captures, long sleeps, side-effecting steps exposed as tools.",
      inputSchema: {},
    },
    async () => {
      const project0 = await project();
      const compiled = compileProject(project0, { stable: true });
      return text({
        diagnostics: [
          ...project0.diagnostics,
          ...compiled.diagnostics,
          ...lintPlan(compiled.plan, {
            confidenceThreshold: project0.config.compile.confidenceThreshold,
            ...(project0.config.tool?.expose === undefined
              ? {}
              : { exposedAsTools: project0.config.tool.expose }),
          }),
        ].map(formatDiagnostic),
      });
    },
  );

  server.registerTool(
    "svatah_run",
    {
      title: "Replay the project",
      description:
        "Replay the plan against the application, deterministically and with no model in the " +
        "loop. Returns the run's summary and every step's status.",
      inputSchema: {
        flows: z.array(z.string()).optional().describe("Flow files to run; all of them by default."),
        stories: z.array(z.string()).optional().describe("Stories to run; all of them by default."),
        inputs: z.record(z.string(), z.unknown()).optional().describe("Story inputs, by name."),
      },
    },
    async ({ flows, stories, inputs }) => {
      const { runProject } = await import("./run.js");
      const outcome = await runProject(await project(), {
        ...(flows === undefined ? {} : { flows }),
        ...(stories === undefined ? {} : { stories }),
        ...(inputs === undefined ? {} : { inputs }),
        log: (message) => io.err(`  ${message}`),
      });
      return text({
        runId: outcome.runId,
        directory: outcome.directory,
        totals: outcome.summary.totals,
        exitCode: outcome.summary.exitCode,
        steps: outcome.results.map((one) => ({
          story: one.story,
          text: one.text,
          status: one.status,
          ...(one.failure === undefined ? {} : { failure: one.failure.class }),
        })),
      });
    },
  );

  server.registerTool(
    "svatah_bindings",
    {
      title: "Read the bindings store",
      description: "Every element the project has recorded, with the phrases that name it.",
      inputSchema: {
        id: z.string().optional().describe("One element id; all of them by default."),
      },
    },
    async ({ id }) => {
      const { BindingsStore } = await import("@svatah/bindings");
      const project0 = await project();
      const store = BindingsStore.load(resolve(project0.root, project0.config.bindings.dir));
      if (id !== undefined) return text(store.get(id) ?? { error: `no bindings for "${id}"` });
      return text(
        store.ids().map((one) => ({
          id: one,
          phrases: store.phrases(one),
          entries: store.entries(one).length,
        })),
      );
    },
  );

  server.registerTool(
    "svatah_results",
    {
      title: "Read a run's results",
      description: "The summary and step results of a run under `runs/`.",
      inputSchema: {
        runId: z.string().optional().describe("A run id; the most recent by default."),
      },
    },
    async ({ runId }) => {
      const { existsSync, readdirSync, readFileSync } = await import("node:fs");
      const project0 = await project();
      const runs = resolve(project0.root, project0.config.run.outputDir);
      if (!existsSync(runs)) return text({ error: `no runs under ${project0.config.run.outputDir}` });
      /*
       * Only directories that actually hold a run. A session's
       * `trajectory.jsonl` lives under `runs/<session>/` too (HLD §7's artifact
       * table), and a `svatah_results` that returned one of those would answer
       * "no steps" for a project that has plenty.
       */
      const ids = readdirSync(runs)
        .filter((name) => existsSync(join(runs, name, "summary.json")))
        .sort();
      const chosen = runId ?? ids[ids.length - 1];
      if (chosen === undefined) return text({ error: "no runs yet" });
      const dir = join(runs, chosen);
      const results = existsSync(join(dir, "results.jsonl"))
        ? readFileSync(join(dir, "results.jsonl"), "utf8")
            .split("\n")
            .filter((line) => line.trim() !== "")
            .map((line) => JSON.parse(line) as Record<string, unknown>)
        : [];
      return text({
        runId: chosen,
        summary: existsSync(join(dir, "summary.json"))
          ? (JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as unknown)
          : undefined,
        steps: results.map((one) => ({ story: one["story"], text: one["text"], status: one["status"] })),
      });
    },
  );

  /* ── the raw surface tools (LLD §15, §13.4) ─────────────────────────────── */

  server.registerTool(
    "surface_snapshot",
    {
      title: "The page, as a semantic tree",
      description:
        "A snapshot with stable references: roles, names, states, one `[ref=…]` per element. " +
        "This is what you address elements by — never a CSS selector, which the surface does " +
        "not expose.",
      inputSchema: {
        intent: INTENT,
        interactiveOnly: z
          .boolean()
          .optional()
          .describe("Only elements worth acting on. Smaller, and usually what you want."),
        maxNodes: z.number().int().positive().optional(),
      },
    },
    async ({ intent, interactiveOnly, maxNodes }) =>
      text(
        await captured("snapshot", intent, { interactiveOnly, maxNodes }, undefined, async (live) => {
          const snapshot = await live.snapshot({
            ...(interactiveOnly === undefined ? {} : { interactiveOnly }),
            ...(maxNodes === undefined ? {} : { maxNodes }),
          });
          return { hash: snapshot.hash, nodes: snapshot.nodes.length, text: snapshot.text };
        }),
      ),
  );

  server.registerTool(
    "surface_act",
    {
      title: "Act on the page",
      description:
        "Perform one action, addressed by a reference from `surface_snapshot`. Navigation and " +
        "scrolling take no reference; everything else does.",
      inputSchema: {
        intent: INTENT,
        action: surfaceActionSchema.describe("The action to perform."),
        ref: z.string().optional().describe("The `[ref=…]` from the most recent snapshot."),
        args: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
          .optional()
          .describe('Arguments: {"url": "/login"}, {"value": "hello"}, {"key": "Enter"}.'),
        ref2: z.string().optional().describe("The second element, for dragTo."),
      },
    },
    async ({ intent, action, ref, args, ref2 }) =>
      text(
        await captured("act", intent, { action, args, ref2 }, ref, (live) =>
          live.act(action as SurfaceAction, ref, (args ?? {}) as ActArgs, ref2),
        ),
      ),
  );

  server.registerTool(
    "surface_read",
    {
      title: "Read from the page",
      description: "The text, value, an attribute, the title or the URL.",
      inputSchema: {
        intent: INTENT,
        kind: z.enum(["text", "value", "attribute", "title", "url", "result"]),
        ref: z.string().optional().describe("Required for everything but title and url."),
        name: z.string().optional().describe('The attribute name, for kind "attribute".'),
      },
    },
    async ({ intent, kind, ref, name }) =>
      text(
        await captured("read", intent, { kind, name }, ref, (live) =>
          live.read(kind as ReadKind, ref, name),
        ),
      ),
  );

  server.registerTool(
    "surface_check",
    {
      title: "Check a predicate",
      description:
        "Ask whether something is true, without asserting it: visible, enabled, checked, the " +
        "text, the URL. Returns what it saw as well as whether it held.",
      inputSchema: {
        intent: INTENT,
        predicate: z
          .record(z.string(), z.unknown())
          .describe('The predicate, e.g. {"kind":"visible"} or {"kind":"textContains","value":{"kind":"literal","value":"Welcome"}}.'),
        subject: z.enum(["ref", "page", "dialog"]).default("ref"),
        ref: z.string().optional(),
      },
    },
    async ({ intent, predicate, subject, ref }) =>
      text(
        await captured("check", intent, { predicate, subject }, ref, (live) =>
          live.check(predicateSchema.parse(predicate) as Predicate, subject, ref),
        ),
      ),
  );

  server.registerTool(
    "surface_trajectory",
    {
      title: "The trajectory so far",
      description:
        "Where the trajectory of this session is being written, and how many calls it holds. " +
        "The file compiles into a story draft, a plan fragment and bindings (REQ-BEH-4).",
      inputSchema: {},
    },
    async () => text({ path: trajectory.path, calls: trajectory.count }),
  );

  return {
    server,
    trajectory,
    close: async () => {
      await surface?.close().catch(() => undefined);
      surface = undefined;
    },
  };
}

/**
 * `svatah mcp` — serve over stdio.
 *
 * Stdio because that is how an MCP client starts a server it owns, and because
 * it is the transport with no port to collide and no token to leak. The
 * server's own output therefore goes to stderr: stdout is the protocol.
 */
export async function mcpCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = args.command[1] ?? ".";
  const built = await buildMcpServer({
    root,
    io,
    ...(stringOption(args, "trajectory") === undefined
      ? {}
      : { trajectoryPath: stringOption(args, "trajectory")! }),
    ...(stringOption(args, "session") === undefined
      ? {}
      : { sessionId: stringOption(args, "session")! }),
  });

  io.err(`svatah mcp — trajectory at ${built.trajectory.path}`);
  if (boolOption(args, "json")) io.err("(--json has no meaning for a protocol server)");

  const transport = new StdioServerTransport();
  await built.server.connect(transport);

  // The server owns the process until the client disconnects; `connect` returns
  // as soon as the transport is wired, so the close is what keeps it alive.
  await new Promise<void>((done) => {
    transport.onclose = () => done();
    process.once("SIGINT", () => done());
    process.once("SIGTERM", () => done());
  });

  await built.close();
  return EXIT.ok;
}
