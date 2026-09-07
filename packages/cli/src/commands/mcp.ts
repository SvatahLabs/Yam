/**
 * `yam mcp` — the MCP server (T4.6, T11', REQ-AGT-2, LLD §15, §13.4).
 *
 * Three groups of tools:
 *
 * **The operation tools** — `yam_compile`, `yam_lint`, `yam_run`,
 * `yam_record`, `yam_heal`, `yam_bindings`, `yam_results` — require a project
 * and run the same functions the CLI runs.
 *
 * **The surface tools** — `surface_targets`, `surface_connect`, `surface_snapshot`,
 * `surface_act`, `surface_read`, `surface_check`, `surface_close`,
 * `surface_sessions`, `surface_capabilities`, `surface_describe`,
 * `surface_control`, `surface_events`, `surface_request`, `surface_screenshot` — drive a
 * live target through session IDs, with no project needed and intent optional.
 * Registered from the operation catalogue so one source of truth generates CLI,
 * MCP and service interfaces.
 *
 * **`surface_trajectory`** — where the trajectory file is and how many calls it
 * holds. Only available when a project root is provided.
 *
 * When intent is provided on a surface call and a trajectory writer exists,
 * the call is recorded. Without intent the call still works — it just doesn't
 * produce a compilable trajectory line.
 */
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { lintPlan, renderPlan } from "@svatah/yam-compiler";
import { TrajectoryWriter } from "@svatah/yam-trajectory";

import type { ElementDescription, ReadKind, Ref } from "@svatah/yam-schema";
import { SURFACE_ACTIONS } from "@svatah/yam-schema";
import { formatDiagnostic } from "@svatah/yam-spec";
import {
  boolOption,
  EXIT,
  stringOption,
  type CommandIo,
  type ExitCode,
  type ParsedArgs,
} from "@svatah/yam-bindings-cli";
import { credentialInEnvironment } from "@svatah/yam-gateway";
import {
  callBroker,
  type BrokerDescriptor,
  type BrokerOperation,
} from "@svatah/yam-surface-control";
import { registerAllAdapters } from "../adapters.js";
import { connectToBroker } from "./surface-control.js";
import { compileProject, loadProject, type LoadedProject } from "../project.js";

const OPTIONAL_INTENT = z
  .string()
  .min(1)
  .optional()
  .describe(
    "What you are trying to do, in the words you would use to describe the step to a person: " +
      '"sign in as the enterprise user", not "click r14". Optional; when provided the call is ' +
      "recorded to the trajectory and the sentence compiles into a flow step.",
  );

export interface McpServerOptions {
  readonly root?: string;
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
  trajectory: TrajectoryWriter | undefined;
  close(): Promise<void>;
}> {
  const { io } = options;
  const root = options.root !== undefined ? resolve(options.root) : undefined;
  const sessionId = options.sessionId ?? randomUUID();
  const trajectory = root !== undefined
    ? new TrajectoryWriter(
        options.trajectoryPath ?? join(root, "runs", sessionId, "trajectory.jsonl"),
      )
    : options.trajectoryPath !== undefined
      ? new TrajectoryWriter(options.trajectoryPath)
      : undefined;

  registerAllAdapters();

  const server = new McpServer(
    { name: "yam", version: "0.1.0" },
    {
      instructions:
        "Yam is a deterministic automation runtime. The `yam_*` tools compile, run, " +
        "record, heal and inspect a project. The `surface_*` tools drive a live target " +
        "directly through session IDs — call `surface_connect` first. No project needed " +
        "for surface tools. When `intent` is provided on a surface call the sequence is " +
        "written to trajectory.jsonl so the exploration can be compiled into a flow.",
    },
  );

  /* ── surface session management via surface-control ─────────────────────── */

  /*
   * A client of the broker, like the command line and the service (SF-05,
   * SF-13, T11, T16).
   *
   * The first cut gave this server a session store of its own — no
   * coordination, no references, no events, no promotion — so a session an
   * agent opened over MCP was one `yam surface sessions` could not list and
   * the desktop could not see, and the agent's `surface_control` was refused
   * as "this broker does not arbitrate control". The whole point of T16 is a
   * person and an agent sharing one target; that needs one broker.
   *
   * Discovered lazily and re-discovered after a failure, so a broker that idled
   * out between two calls is started again rather than reported dead.
   */
  let broker: Promise<BrokerDescriptor> | undefined;
  const call = async (
    operation: BrokerOperation,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    broker ??= connectToBroker(io);
    try {
      return (await callBroker(await broker, operation, args)) as Record<string, unknown>;
    } catch (first) {
      broker = connectToBroker(io);
      try {
        return (await callBroker(await broker, operation, args)) as Record<string, unknown>;
      } catch {
        broker = undefined;
        throw first;
      }
    }
  };
  /**
   * Who this agent is to the broker (SF-13): the name its client gave at
   * initialization, so the desktop reads "claude-code controls" rather than an
   * id — and so the agent's own next action is not refused by its own hold.
   */
  const holderName = (): string => server.server.getClientVersion()?.name ?? "an agent";

  let loaded: LoadedProject | undefined;

  const project = async (): Promise<LoadedProject> => {
    if (root === undefined) throw new Error("This tool requires a project. Start with: yam mcp <project-dir>");
    loaded ??= await loadProject(root);
    return loaded;
  };

  /**
   * Write to the trajectory when an intent was given (SF-12, REQ-BEH-4).
   *
   * An intent is what says this call is authoring rather than looking, so it is
   * also what decides whether evidence is worth gathering. Direct control pays
   * nothing: no intent, no line, no reads.
   *
   * What is gathered when it *is* authoring is targeted, not a page. Wave 1's
   * first cut removed the per-call `snapshot({interactiveOnly:true})`, which was
   * right — it was a full page read before every operation — but removed
   * `describe` and `url` with it, and those are what the compiler turns into a
   * step's phrase and a binding's context. A trajectory without them still
   * compiles, to a proposal with no bindings and steps that cannot name what
   * they touched. So: `describe` for the one element a call names, the URL from
   * session state, and the snapshot's own hash when the call was a snapshot and
   * already has it. All cheap, all only while authoring.
   */
  /**
   * What the element was, read *before* the call (REQ-BEH-4).
   *
   * After a click that navigates there is no element left to describe, so
   * evidence gathered afterwards is empty exactly when the step is most worth
   * recording. This is the one read that has to happen up front — one element,
   * not a page, and only when an intent says the caller is authoring.
   */
  const evidenceBefore = async (
    intent: string | undefined,
    session: string | undefined,
    ref: string | undefined,
  ): Promise<{ url?: string; describe?: ElementDescription }> => {
    if (trajectory === undefined || intent === undefined || session === undefined) return {};
    const answered = async (operation: BrokerOperation, args: Record<string, unknown>) => {
      const result = await call(operation, args).catch(() => undefined);
      return result?.["status"] === "succeeded" ? (result["result"] as Record<string, unknown>) : undefined;
    };
    const read = await answered("read", { session, kind: "url" });
    const url = typeof read?.["value"] === "string" ? read["value"] : undefined;
    const describe =
      ref === undefined
        ? undefined
        : ((await answered("describe", { session, ref })) as ElementDescription | undefined);
    return {
      ...(url === undefined ? {} : { url }),
      ...(describe === undefined ? {} : { describe }),
    };
  };

  const captureToTrajectory = async (
    call: "snapshot" | "act" | "read" | "check",
    intent: string | undefined,
    args: Record<string, unknown>,
    ref: string | undefined,
    result: Record<string, unknown>,
    before: { url?: string; describe?: ElementDescription } = {},
  ): Promise<void> => {
    if (!trajectory || !intent) return;
    const { url, describe } = before;
    const hash =
      call === "snapshot"
        ? ((result as { result?: { hash?: string } }).result?.hash ?? undefined)
        : undefined;
    /*
     * A refusal is recorded as an error too. Through the broker a reference
     * nobody snapshotted is *refused* (STALE_REFERENCE) where the in-process
     * store of the first cut let the adapter *fail* on it; either way the call
     * did not happen, and a trajectory line with neither result nor error
     * compiled as a step that "had no sentence pattern" rather than one that
     * failed (REQ-BEH-4).
     */
    const status = (result as { status?: string }).status;
    const isError = status === "failed" || status === "refused";
    const errorMsg = isError
      ? ((result as { error?: { message?: string } }).error?.message ?? "unknown error")
      : undefined;
    trajectory.write({
      intent,
      call,
      ...(Object.keys(args).length === 0 ? {} : { args }),
      ...(hash === undefined ? {} : { snapshotHash: hash }),
      ...(url === undefined ? {} : { url }),
      ...(ref === undefined ? {} : { ref: ref as Ref }),
      ...(describe === undefined ? {} : { describe }),
      ...(isError ? { error: errorMsg } : { result: (result as { result?: unknown }).result }),
    });
  };

  const text = (value: unknown) => ({
    content: [
      { type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
    ],
  });

  /* ── the operation tools (LLD §15) ──────────────────────────────────────── */

  server.registerTool(
    "yam_compile",
    {
      title: "Compile the project",
      description:
        "Compile every flow into a plan, reporting the diagnostics `yam compile` reports. " +
        "The same function the command line runs, so an agent and a person get the same plan.",
      inputSchema: {
        write: z
          .boolean()
          .optional()
          .describe("Write .yam/plan.json as well as returning it. Default false."),
      },
    },
    async ({ write }) => {
      const project0 = await project();
      const compiled = compileProject(project0, { stable: true });
      const diagnostics = [...project0.diagnostics, ...compiled.diagnostics];
      if (write === true && compiled.ok) {
        const { mkdirSync, writeFileSync } = await import("node:fs");
        mkdirSync(join(project0.root, ".yam"), { recursive: true });
        writeFileSync(join(project0.root, ".yam", "plan.json"), renderPlan(compiled.plan), "utf8");
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
    "yam_lint",
    {
      title: "Lint the project",
      description:
        "Everything `yam lint` reports: ambiguous targets, model-compiled steps, low " +
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
    "yam_run",
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
    "yam_record",
    {
      title: "Bind the targets of a flow",
      description:
        "Drive a flow that already exists against the application and bind every target that has " +
        "no binding yet, through a model gateway. Each step is performed and its expectation " +
        "verified before the binding is kept, so a binding that is written is one that worked " +
        "(REQ-REC-5).\n\n" +
        "This is `yam record --flow <file>`. It is not the other recording: `yam record` alone " +
        "means a person driving the browser while Yam writes the flow, and there is nobody at " +
        "this session to drive.\n\n" +
        "Writes to the bindings store. If a step fails the session stops and says where, and only " +
        "what a passing step proved is written.",
      inputSchema: {
        flows: z
          .array(z.string())
          .optional()
          .describe("Flow files whose targets to bind; all of them by default."),
        stories: z
          .array(z.string())
          .optional()
          .describe("Stories to record; all of them by default."),
        rebind: z
          .boolean()
          .optional()
          .describe("Record elements that already have a binding. Default false."),
        gateway: z
          .enum(["anthropic", "fake"])
          .optional()
          .describe(
            "Which gateway grounds each target: `anthropic` needs a credential in the " +
              "environment; `fake` answers from evals/grounding/cases and is a fixture, not a " +
              "model. Defaults to whichever is available.",
          ),
        inputs: z.record(z.string(), z.unknown()).optional().describe("Story inputs, by name."),
      },
    },
    async ({ flows, stories, rebind, gateway, inputs }) => {
      const { serviceRecord } = await import("../service-api.js");
      const report = (await serviceRecord(await project(), {
        ...(flows === undefined ? {} : { flows }),
        ...(stories === undefined ? {} : { stories }),
        ...(rebind === undefined ? {} : { rebind }),
        /*
         * Never `human`, whatever the host looks like.
         *
         * The schema does not offer it, and the default is named here rather
         * than left to `gatewayForRecording`, whose default reaches for a
         * person when one could be at the terminal. Under an MCP session
         * nobody is: the recorder would open a browser and wait for a click
         * that never comes. Only the credential *probe* is borrowed — which
         * gateway suits which situation stays where it was.
         */
        gateway: gateway ?? (credentialInEnvironment() ? "anthropic" : "fake"),
        ...(inputs === undefined ? {} : { inputs }),
        log: (message) => io.err(`  ${message}`),
      })) as {
        gateway: { name: string; model: string; real: boolean };
        totals: Record<string, number>;
        complete: boolean;
        stoppedBecause?: string;
        written: readonly string[];
        steps: ReadonlyArray<{ story: string; text: string; status: string }>;
      };
      return text({
        /*
         * Which gateway decided, and whether it was a model at all (REQ-PKG-4).
         * An agent reporting "recorded" from the committed fixture answers
         * would be reporting something nobody measured.
         */
        gateway: report.gateway,
        complete: report.complete,
        ...(report.stoppedBecause === undefined ? {} : { stoppedBecause: report.stoppedBecause }),
        totals: report.totals,
        written: report.written,
        steps: report.steps.map((one) => ({
          story: one.story,
          text: one.text,
          status: one.status,
        })),
      });
    },
  );

  server.registerTool(
    "yam_heal",
    {
      title: "Repair the bindings a run could not resolve",
      description:
        "Take a run that failed to find elements, relocalize each binding against its recorded " +
        "fingerprint, and report what could be repaired and how confidently. Model-free by " +
        "default: relocalization compares what the page says now with what it said when the " +
        "binding was recorded.\n\n" +
        "Proposes; it does not write. Pass `apply: true` to write the repairs to the store — and " +
        "a repair is applied only after the story it came from replayed green (REQ-HEAL-3).",
      inputSchema: {
        runId: z
          .string()
          .min(1)
          .describe("The run under runs/ to heal, as `yam_run` returned it."),
        apply: z
          .boolean()
          .optional()
          .describe("Write the repairs to the bindings store. Default false: propose only."),
        useModel: z
          .boolean()
          .optional()
          .describe(
            "Let a model re-ground what relocalization could not place. Default false, which is " +
              "the project's own default and needs no credential.",
          ),
        inputs: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Story inputs, for the replay that verifies a repair."),
      },
    },
    async ({ runId, apply, useModel, inputs }) => {
      const { serviceHeal } = await import("../service-api.js");
      const report = (await serviceHeal(await project(), {
        runId,
        ...(apply === undefined ? {} : { apply }),
        ...(useModel === undefined ? {} : { useModel }),
        ...(inputs === undefined ? {} : { inputs }),
      })) as {
        totals: Record<string, number>;
        applied: boolean;
        usedModel: boolean;
        diff: string;
        results: ReadonlyArray<{ id: string; phrase?: string; outcome: string; score?: number }>;
      };
      return text({
        applied: report.applied,
        usedModel: report.usedModel,
        totals: report.totals,
        results: report.results.map((one) => ({
          id: one.id,
          ...(one.phrase === undefined ? {} : { phrase: one.phrase }),
          outcome: one.outcome,
          ...(one.score === undefined ? {} : { score: one.score }),
        })),
        // The artifact a person applies by hand; an agent that proposed a
        // repair should be able to show it rather than describe it.
        diff: report.diff,
      });
    },
  );

  server.registerTool(
    "yam_bindings",
    {
      title: "Read the bindings store",
      description: "Every element the project has recorded, with the phrases that name it.",
      inputSchema: {
        id: z.string().optional().describe("One element id; all of them by default."),
      },
    },
    async ({ id }) => {
      const { BindingsStore } = await import("@svatah/yam-bindings");
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
    "yam_results",
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
       * table), and a `yam_results` that returned one of those would answer
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

  /* ── the surface tools, driven from the operation catalogue ──────────── */



  server.registerTool(
    "surface_targets",
    {
      title: "Discover available targets",
      description:
        "Discover what this machine can drive: available adapters, their readiness, and targets " +
        "they can connect to. Call this before surface_connect to know what is possible.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        url: z.string().optional().describe("Filter targets by URL"),
        adapter: z.string().optional().describe("Filter by adapter name"),
      },
    },
    async ({ url, adapter }) =>
      text(await call("targets", { url, adapter })),
  );

  server.registerTool(
    "surface_connect",
    {
      title: "Connect to a surface",
      description:
        "Open a new surface session against a target. Returns a session ID for subsequent calls. " +
        "No project needed.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        url: z.string().optional().describe("URL to connect to"),
        adapter: z.string().optional().describe("Adapter to use (playwright, bidi, appium, uia, ax, http)"),
        headed: z.boolean().optional().describe("Run in headed mode"),
        intent: OPTIONAL_INTENT,
      },
    },
    // `intent` is accepted and unused here: connect starts a session, and a
    // sentence describes a step. Taking it keeps one shape across the tools.
    async ({ url, adapter, headed }) => {
      const result = await call("connect", { url, adapter, headed });
      io.err(`surface session opened: ${(result as { result?: { sessionId?: string } }).result?.sessionId}`);
      return text(result);
    },
  );

  server.registerTool(
    "surface_snapshot",
    {
      title: "Take a surface snapshot",
      description:
        "A snapshot with stable references: roles, names, states, one `[ref=…]` per element.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        session: z.string().min(1).describe("Session ID from surface_connect"),
        interactiveOnly: z
          .boolean()
          .optional()
          .describe("Only elements worth acting on. Smaller, and usually what you want."),
        maxNodes: z.number().int().positive().optional(),
        root: z.string().optional().describe("Subtree root ref"),
        intent: OPTIONAL_INTENT,
      },
    },
    async ({ session, interactiveOnly, maxNodes, root, intent }) => {
      const before = await evidenceBefore(intent, session, undefined);
      const result = await call("snapshot", { session, interactiveOnly, maxNodes, root });
      await captureToTrajectory("snapshot", intent, { interactiveOnly, maxNodes }, undefined, result, before);
      return text(result);
    },
  );

  server.registerTool(
    "surface_act",
    {
      title: "Perform a surface action",
      description:
        "Perform one action, addressed by a reference from `surface_snapshot`. Navigation and " +
        "scrolling take no reference; everything else does.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        session: z.string().min(1).describe("Session ID from surface_connect"),
        action: z.enum(SURFACE_ACTIONS as unknown as [string, ...string[]]).describe("The action to perform."),
        ref: z.string().optional().describe("The `[ref=…]` from the most recent snapshot."),
        args: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
          .optional()
          .describe('Arguments: {"url": "/login"}, {"value": "hello"}, {"key": "Enter"}.'),
        ref2: z.string().optional().describe("The second element, for dragTo."),
        holder: z.string().optional().describe("Who you are; defaults to this client's name."),
        intent: OPTIONAL_INTENT,
      },
    },
    async ({ session, action, ref, args, ref2, holder, intent }) => {
      const before = await evidenceBefore(intent, session, ref);
      const result = await call("act", {
        session, action, ref, args, ref2, holder: holder ?? holderName(),
      });
      await captureToTrajectory("act", intent, { action, args, ref2 }, ref, result, before);
      return text(result);
    },
  );

  server.registerTool(
    "surface_read",
    {
      title: "Read a surface value",
      description: "The text, value, an attribute, the title or the URL.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        session: z.string().min(1).describe("Session ID from surface_connect"),
        kind: z.enum(["text", "value", "attribute", "title", "url", "result"]),
        ref: z.string().optional().describe("Required for everything but title and url."),
        name: z.string().optional().describe('The attribute name, for kind "attribute".'),
        intent: OPTIONAL_INTENT,
      },
    },
    async ({ session, kind, ref, name, intent }) => {
      const before = await evidenceBefore(intent, session, ref);
      const result = await call("read", {
        session, kind: kind as ReadKind, ref, name,
      });
      await captureToTrajectory("read", intent, { kind, name }, ref, result, before);
      return text(result);
    },
  );

  server.registerTool(
    "surface_check",
    {
      title: "Check a surface predicate",
      description:
        "Ask whether something is true, without asserting it: visible, enabled, checked, the " +
        "text, the URL. Returns what it saw as well as whether it held.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        session: z.string().min(1).describe("Session ID from surface_connect"),
        predicate: z
          .record(z.string(), z.unknown())
          .describe('The predicate, e.g. {"kind":"visible"} or {"kind":"textContains","value":"Welcome"}.'),
        subject: z.enum(["ref", "page", "dialog"]).default("ref"),
        ref: z.string().optional(),
        intent: OPTIONAL_INTENT,
      },
    },
    async ({ session, predicate, subject, ref, intent }) => {
      const before = await evidenceBefore(intent, session, ref);
      const result = await call("check", {
        session,
        predicate: predicate as { kind: string; value?: string; name?: string; negate?: boolean },
        subject,
        ref,
      });
      await captureToTrajectory("check", intent, { predicate, subject }, ref, result, before);
      return text(result);
    },
  );

  server.registerTool(
    "surface_close",
    {
      title: "Close a surface session",
      description: "Close a session and release its resources.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        session: z.string().min(1).describe("Session ID"),
        intent: OPTIONAL_INTENT,
      },
    },
    async ({ session }) => text(await call("close", { session })),
  );

  server.registerTool(
    "surface_sessions",
    {
      title: "List surface sessions",
      description: "List all active surface sessions.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {},
    },
    async () => text(await call("sessions", {})),
  );

  server.registerTool(
    "surface_capabilities",
    {
      title: "Get adapter capabilities",
      description: "Get the capabilities of a session's adapter.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        session: z.string().min(1).describe("Session ID"),
      },
    },
    async ({ session }) => text(await call("capabilities", { session })),
  );

  server.registerTool(
    "surface_describe",
    {
      title: "Describe a surface element",
      description: "Describe a specific element on the surface by reference.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        session: z.string().min(1).describe("Session ID"),
        ref: z.string().min(1).describe("Element reference"),
        snapshot: z.string().optional().describe("The snapshot the reference came from; refused if the surface has changed since."),
        intent: OPTIONAL_INTENT,
      },
    },
    async ({ session, ref, snapshot }) => text(await call("describe", { session, ref, snapshot })),
  );

  server.registerTool(
    "surface_events",
    {
      title: "What this session did",
      description:
        "The session's redacted events, and the steps a proposal compiles from. Promoting an " +
        "exploration into an automation reads this rather than replaying what a client believes " +
        "it asked for.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: { session: z.string().min(1).describe("Session ID") },
    },
    async ({ session }) => text(await call("events", { session })),
  );

  server.registerTool(
    "surface_control",
    {
      title: "Take or release control",
      description:
        "Take a target, give it up, or ask who holds it. A person and an agent can drive the same " +
        "session; while a target is held, an action from anyone else is refused and told who has it.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        session: z.string().min(1).describe("Session ID"),
        action: z.enum(["take", "release", "status"]).optional().describe("Defaults to status"),
        holder: z.string().optional().describe("Who you are"),
        force: z.boolean().optional().describe("Take a target its holder has not given up"),
        intent: OPTIONAL_INTENT,
      },
    },
    async ({ session, action, holder, force }) =>
      text(
        await call("control", {
          session,
          ...(action === undefined ? {} : { action }),
          holder: holder ?? holderName(),
          ...(force === undefined ? {} : { force }),
        }),
      ),
  );

  server.registerTool(
    "surface_request",
    {
      title: "Send an HTTP request",
      description:
        "Send an HTTP request on an HTTP surface and return the response. An HTTP target has no " +
        "elements to click — its tree is empty and `surface_act` refuses — so this is how one is " +
        "driven. The request is the published ApiRequest shape.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        session: z.string().min(1).describe("Session ID"),
        request: z
          .object({
            name: z.string().min(1).optional().describe("A name for the request"),
            method: z
              .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
              .describe("HTTP method"),
            url: z.string().min(1).describe("URL, or a path joined to the session's base URL"),
            headers: z.record(z.string(), z.string()).optional(),
            query: z.record(z.string(), z.string()).optional(),
            json: z.unknown().optional().describe("A JSON body"),
            body: z.string().optional().describe("A raw body"),
          })
          .describe("The request to send"),
        withSessionCookies: z.boolean().optional(),
        holder: z.string().optional().describe("Who you are; defaults to this client's name."),
        intent: OPTIONAL_INTENT,
      },
    },
    async ({ session, request, withSessionCookies, holder }) =>
      text(
        await call("request", {
          session,
          request: { name: "request", ...request } as Record<string, unknown>,
          ...(withSessionCookies === undefined ? {} : { withSessionCookies }),
          holder: holder ?? holderName(),
        }),
      ),
  );

  server.registerTool(
    "surface_screenshot",
    {
      title: "Take a screenshot",
      description: "Take a screenshot of the current surface.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        session: z.string().min(1).describe("Session ID"),
        path: z.string().optional().describe("Output file path"),
        intent: OPTIONAL_INTENT,
      },
    },
    async ({ session, path }) => text(await call("screenshot", { session, path })),
  );

  if (trajectory) {
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
  }

  return {
    server,
    trajectory,
    close: async () => {
      // Sessions are the broker's, not this process's (SF-05): an agent that
      // disconnects leaves what it opened for the person to see and close.
    },
  };
}

/**
 * `yam mcp` — serve over stdio.
 *
 * Stdio because that is how an MCP client starts a server it owns, and because
 * it is the transport with no port to collide and no token to leak. The
 * server's own output therefore goes to stderr: stdout is the protocol.
 */
export async function mcpCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = args.command[1];
  const built = await buildMcpServer({
    ...(root === undefined ? {} : { root }),
    io,
    ...(stringOption(args, "trajectory") === undefined
      ? {}
      : { trajectoryPath: stringOption(args, "trajectory")! }),
    ...(stringOption(args, "session") === undefined
      ? {}
      : { sessionId: stringOption(args, "session")! }),
  });

  if (built.trajectory) {
    io.err(`yam mcp — trajectory at ${built.trajectory.path}`);
  } else {
    io.err("yam mcp — surface tools ready (no project, no trajectory)");
  }
  if (boolOption(args, "json")) io.err("(--json has no meaning for a protocol server)");

  const transport = new StdioServerTransport();
  await built.server.connect(transport);

  await new Promise<void>((done) => {
    transport.onclose = () => done();
    process.once("SIGINT", () => done());
    process.once("SIGTERM", () => done());
  });

  await built.close();
  return EXIT.ok;
}
