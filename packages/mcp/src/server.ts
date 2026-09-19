/**
 * `yam mcp` — the MCP server (T4.6, T11', REQ-AGT-2, LLD §15, §13.4).
 *
 * Three groups of tools:
 *
 * **The operation tools** — `yam_compile`, `yam_lint`, `yam_run`,
 * `yam_record`, `yam_heal`, `yam_bindings`, `yam_results` — are offered only
 * when the server is given a project, and run the same functions the CLI runs.
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
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { isIP } from "node:net";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  addSecretLiteral,
  createRedactionPolicy,
  redactObject,
  removeClient,
  targetIdFor,
  withholdFieldValues,
  withholdSecrets,
  writeClient,
} from "@svatah/yam-surface-control";
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
  stringOptions,
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
import { registerAllAdapters } from "@svatah/yam";
import { connectToBroker } from "@svatah/yam";
import { compileProject, loadProject, type LoadedProject } from "@svatah/yam";

const OPTIONAL_INTENT = z
  .string()
  .min(1)
  .optional()
  .describe(
    "What you are trying to do, in the words you would use to describe the step to a person: " +
      '"sign in as the enterprise user", not "click r14". Optional; when provided the call is ' +
      "recorded to the trajectory and the sentence compiles into a flow step.",
  );

/**
 * What marks a holder as an agent over MCP (SF-13).
 *
 * The holder is the name the client gave at initialization, and that name is
 * the client's to choose. Refusing the names a person's own clients use — the
 * desktop's "Yam desktop", the terminal's "yam cli" — was not enough: a name
 * with a zero-width space in it, or a Cyrillic letter, compares unequal and
 * reads the same in the desktop's "… controls". So every agent's holder says
 * where it came from, and no person's client name ends that way.
 */
export const AGENT_HOLDER_SUFFIX = " (MCP)";

/** The holder an MCP client acts under: the name it gave, visibly an agent's. */
export function agentHolder(clientName: string | undefined): string {
  const name = (clientName ?? "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${name === "" ? "an agent" : name}${AGENT_HOLDER_SUFFIX}`;
}

/**
 * What a person lets an agent start and open through this server (SF-15).
 *
 * `surface_connect` would start any program with any arguments — a terminal on
 * `sh -c "…"`, an application by bundle — as the user, and open any URL,
 * `file:` included. An MCP host asks a person before its own shell tool runs a
 * command; a tool that starts programs without asking went around that, for an
 * agent a web page could talk into it. So the person who configures the server
 * names what may be started and driven, and nothing is by default:
 *
 * - a program — a terminal's, or an application launched by bundle or path —
 *   only when `--allow-program` names it, or `--allow-program '*'`;
 * - an application that is already running only when `--allow-app` names it,
 *   or `--allow-app '*'`: an agent typing into a running Terminal starts
 *   whatever it likes, whatever `--allow-program` says;
 * - a page only over `http`, `https` or `about:`, and `file:` with
 *   `--allow-file-urls`;
 * - a file from this machine into a page's upload field only with
 *   `--allow-upload`, since a page can ask for `~/.ssh/id_rsa` as easily as a
 *   photo;
 * - a running browser (`attach`) only on this machine's loopback.
 *
 * A program that is allowed still runs as the user: an allowed shell can read
 * whatever the user can. The lists are the boundary, and they say so.
 */
export interface LaunchPolicy {
  readonly allowPrograms?: readonly string[];
  readonly allowApps?: readonly string[];
  readonly allowFileUrls?: boolean;
  readonly allowUpload?: boolean;
}

/** Why an agent may not open this page, or `undefined` when it may. */
export function urlRefusal(url: string, policy: LaunchPolicy): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // A path, resolved against the session's base URL by the adapter.
    return undefined;
  }
  if (["http:", "https:", "about:"].includes(parsed.protocol)) return undefined;
  if (parsed.protocol === "file:") {
    return policy.allowFileUrls === true
      ? undefined
      : `An agent may not open file: pages through this server; start it with --allow-file-urls to allow them.`;
  }
  return `An agent may open http, https and about: pages; a ${parsed.protocol} URL is refused.`;
}

/**
 * Every spelling of a URL argument an adapter might open.
 *
 * The tool's schema lets an argument be a list, and the web adapters join a
 * list into one string before they navigate — so `url: ["file:///…"]` was a
 * `file:` page the string check never saw. Each element, and the joined whole.
 */
export function urlsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    const parts = value.map((one) => String(one));
    return [...parts, parts.join(",")];
  }
  return [];
}

/** Whether `host` is this machine's loopback, parsed rather than prefix-matched. */
function isLoopback(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "localhost") return true;
  if (isIP(bare) === 4) return bare.split(".")[0] === "127";
  if (isIP(bare) !== 6) return false;
  if (bare === "::1" || bare === "0:0:0:0:0:0:0:1") return true;
  /*
   * An IPv4-mapped address, as a URL serialises it: `[::ffff:127.0.0.1]`
   * becomes `[::ffff:7f00:1]`, so the dotted form is not the one seen here.
   */
  const mapped = /^::ffff:(?:(\d+)\.\d+\.\d+\.\d+|([0-9a-f]{1,4}):[0-9a-f]{1,4})$/.exec(bare);
  if (mapped === null) return false;
  return mapped[1] !== undefined ? mapped[1] === "127" : parseInt(mapped[2]!, 16) >> 8 === 127;
}

/**
 * Whether a list a person wrote names this program (SF-15).
 *
 * An entry with a path names that path. A bare name names the program a shell
 * would find by that name — the bare name itself, or that name in one of the
 * `PATH` directories — and not any file that happens to be called it: allowing
 * `sh` did not mean allowing `/tmp/x/sh`.
 */
export function programAllowed(program: string, allowed: readonly string[]): boolean {
  if (allowed.includes("*")) return true;
  const onPath = (process.env["PATH"] ?? "").split(delimiter).filter((one) => one !== "");
  return allowed.some((entry) => {
    if (entry.includes("/") || entry.includes("\\")) return samePath(entry, program);
    if (program === entry) return true;
    return basename(program) === entry && onPath.some((dir) => samePath(dir, dirname(program)));
  });
}

/**
 * Whether two paths name the same place.
 *
 * Case matters on Linux and not on Windows, where `PATH` holds
 * `C:\Windows\system32` and a caller writes `C:\Windows\System32\cmd.exe`.
 * Compared exactly, those were two directories, so an allowed program on the
 * `PATH` was refused — measured on the Windows runner, where every bare-name
 * allowance failed.
 */
function samePath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Why an agent may not open this session, or `undefined` when it may. */
export function launchRefusal(
  input: {
    url?: string;
    app?: string;
    attach?: string;
    adapter?: string;
    launch?: { bundle?: string; path?: string };
  },
  policy: LaunchPolicy,
): string | undefined {
  if (input.url !== undefined) {
    const refused = urlRefusal(input.url, policy);
    if (refused !== undefined) return refused;
  }
  if (input.attach !== undefined) {
    let host: string | undefined;
    try {
      host = new URL(input.attach).hostname;
    } catch {
      host = undefined;
    }
    if (host === undefined || !isLoopback(host)) {
      return `An agent may join a browser on this machine's loopback only; "${input.attach}" is not one.`;
    }
  }
  /*
   * Every program the adapter might start, not the one this reads first. A
   * terminal starts its `app` (or `launch.path`); a desktop adapter starts
   * `launch.bundle` on macOS and `launch.path` elsewhere — so checking one of
   * the two let `bundle: "notepad"` stand beside `path: "cmd.exe"`.
   */
  const programs =
    input.adapter === "process"
      ? [input.app ?? input.launch?.path]
      : [input.launch?.bundle, input.launch?.path];
  for (const program of programs) {
    if (program === undefined) continue;
    if (!programAllowed(program, policy.allowPrograms ?? [])) {
      return (
        `An agent may not start "${program}" through this server. The person who configures it ` +
        "allows programs with --allow-program <name or path>, or any with --allow-program '*'; " +
        "none are allowed by default."
      );
    }
  }
  if (input.app !== undefined && input.adapter !== "process") {
    const allowed = (policy.allowApps ?? []).map((one) => one.toLowerCase());
    if (!allowed.includes("*") && !allowed.includes(input.app.trim().toLowerCase())) {
      return (
        `An agent may not drive "${input.app}" through this server. The person who configures it ` +
        "allows applications with --allow-app <name>, or any with --allow-app '*'; none are allowed " +
        "by default, because typing into a running application — a terminal — runs anything."
      );
    }
  }
  return undefined;
}

/** A refusal, in the envelope every surface tool answers with. */
function refusal(code: string, message: string, session?: string): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    status: "refused",
    ...(session === undefined ? {} : { sessionId: session }),
    error: { code, message, retryable: false },
  };
}

/** A screenshot larger than this is kept on disk and named, not returned inline. */
const INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

export interface McpServerOptions extends LaunchPolicy {
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
    { name: "yam", version: "0.2.0" },
    {
      instructions:
        (root === undefined
          ? "Yam is a deterministic automation runtime. The `surface_*` tools drive a live target " +
            "directly through session IDs — call `surface_connect` first. The `yam_*` project tools " +
            "are offered when the server is started with a project directory."
          : "Yam is a deterministic automation runtime. The `yam_*` tools compile, run, " +
            "record, heal and inspect a project. The `surface_*` tools drive a live target " +
            "directly through session IDs — call `surface_connect` first.") +
        " When `intent` is provided on a surface call the sequence is written to " +
        "trajectory.jsonl so the exploration can be compiled into a flow. Pass the values " +
        "that must not be recorded, such as passwords, in `secrets`.",
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
   *
   * Never an argument. The tools offered a `holder` and a `force`, so an agent
   * — one a page had talked into it, say — could act as "Yam desktop" through a
   * hold the person had taken, or take the target from them outright. Both are
   * a person's to do, from the desktop or the terminal.
   */
  const holderName = (): string => agentHolder(server.server.getClientVersion()?.name);

  let loaded: LoadedProject | undefined;

  const project = async (): Promise<LoadedProject> => {
    if (root === undefined) {
    /* The command that starts this server, which is no longer `yam mcp` (PK-05). */
    throw new Error(
      "This tool requires a project. Start the server with a directory: " +
        "npx -y @svatah/yam-mcp <project-dir>",
    );
  }
    /*
     * `CI` does not trust a project here (SF-15): this process's environment is
     * an agent host's, and agent hosts set `CI=1` to keep tools from prompting.
     */
    loaded ??= await loadProject(root, { honourCi: false });
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
    const { url } = before;
    /*
     * A password field's own value, withheld wherever it rides (SF-15): in its
     * description, in a read or a check's answer, in a predicate's expected
     * value. The arguments a secret was typed with are withheld by the caller.
     */
    const describe = withholdFieldValues(before.describe, before.describe);
    const keptArgs = withholdFieldValues(args, before.describe);
    const keptResult = withholdFieldValues(result, before.describe);
    const hash =
      call === "snapshot"
        ? ((keptResult as { result?: { hash?: string } }).result?.hash ?? undefined)
        : undefined;
    /*
     * A refusal is recorded as an error too. Through the broker a reference
     * nobody snapshotted is *refused* (STALE_REFERENCE) where the in-process
     * store of the first cut let the adapter *fail* on it; either way the call
     * did not happen, and a trajectory line with neither result nor error
     * compiled as a step that "had no sentence pattern" rather than one that
     * failed (REQ-BEH-4).
     */
    const status = (keptResult as { status?: string }).status;
    const isError = status === "failed" || status === "refused";
    const errorMsg = isError
      ? ((keptResult as { error?: { message?: string } }).error?.message ?? "unknown error")
      : undefined;
    trajectory.write({
      intent,
      call,
      ...(Object.keys(keptArgs).length === 0 ? {} : { args: keptArgs }),
      ...(hash === undefined ? {} : { snapshotHash: hash }),
      ...(url === undefined ? {} : { url }),
      ...(ref === undefined ? {} : { ref: ref as Ref }),
      ...(describe === undefined ? {} : { describe }),
      ...(isError ? { error: errorMsg } : { result: (keptResult as { result?: unknown }).result }),
    });
  };

  /**
   * An envelope, as an MCP tool result — and a failed one as a tool *error*
   * (T21, SF-07, design.md "One public contract").
   *
   * > MCP maps the envelope into `structuredContent` and compatible text;
   * > failed/refused tool executions carry `isError: true`.
   *
   * The second half of that sentence was not kept. Every surface tool answered
   * `isError: undefined` whatever the envelope said, so a client's own
   * error handling — which is what `isError` exists for — never fired: a
   * `CHECK_FAILED`, a `STALE_REFERENCE` and a `CONTROL_BUSY` all arrived as
   * successful tool calls whose text happened to describe a refusal. An agent
   * that trusted the protocol rather than parsing the body was told every call
   * worked.
   *
   * Derived from the envelope's own `status`, so it cannot drift from the
   * outcome vocabulary, and only for envelopes: a tool that answers something
   * else is unaffected.
   */
  const text = (value: unknown) => {
    const status = (value as { status?: unknown } | null)?.status;
    const failed = status === "failed" || status === "refused";
    return {
      content: [
        {
          type: "text" as const,
          text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
        },
      ],
      ...(failed ? { isError: true as const } : {}),
    };
  };

  /* ── the operation tools (LLD §15) ──────────────────────────────────────── */

  /*
   * Offered only with a project to run them on (REQ-AGT-2).
   *
   * Without one they were listed anyway, and each answered "This tool requires
   * a project" — seven tools an agent paid context for and could not call, on
   * the server `npx -y @svatah/yam-mcp` starts by default.
   */
  if (root !== undefined) {
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
        const { runProject } = await import("@svatah/yam");
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
        const { serviceRecord } = await import("@svatah/yam");
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
        const { serviceHeal } = await import("@svatah/yam");
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
  }

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
        "No project needed. A terminal program, or an application launched by bundle or path, " +
        "starts only when the server allows it (--allow-program); pages open over http and https.",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      inputSchema: {
        url: z.string().optional().describe("URL to connect to; launches a browser"),
        app: z
          .string()
          .optional()
          .describe("Drive an application that is already running, by process name"),
        attach: z
          .string()
          .optional()
          .describe("Join a browser that is already running, by its DevTools endpoint"),
        adapter: z
          .string()
          .optional()
          .describe("Adapter to use (playwright, bidi, appium, uia, ax, http, process)"),
        headed: z.boolean().optional().describe("Run in headed mode"),
        /*
         * How to start the target, as the design's typed nested object (T22).
         * Each adapter reads the fields that mean something to it: a bundle to a
         * desktop adapter, arguments and a readable root to a terminal.
         */
        launch: z
          .object({
            bundle: z.string().min(1).optional(),
            path: z
              .string()
              .min(1)
              .optional()
              .describe("Where it runs; for a terminal, the only directory that session may read"),
            args: z.array(z.string()).optional().describe("The program's arguments"),
            env: z.record(z.string().min(1), z.string()).optional(),
            timeoutMs: z.number().int().positive().optional(),
            size: z
              .tuple([z.number().int().positive(), z.number().int().positive()])
              .optional()
              .describe("Window size, or a terminal's columns and rows"),
          })
          .optional()
          .describe("How to start the target"),
        intent: OPTIONAL_INTENT,
      },
    },
    // `intent` is accepted and unused here: connect starts a session, and a
    // sentence describes a step. Taking it keeps one shape across the tools.
    async ({ url, app, attach, adapter, headed, launch }) => {
      const refused = launchRefusal({ url, app, attach, adapter, launch }, options);
      if (refused !== undefined) return text(refusal("PERMISSION_REQUIRED", refused));
      /*
       * Not a second way onto a target somebody holds (SF-13). A hold is kept
       * per session, so a fresh session on the same running application or
       * browser was an unheld one — around the person who had taken it back.
       */
      const target = targetIdFor({ adapter, app, attach });
      if (target !== undefined) {
        const listed = await call("sessions", {});
        const rows = ((listed as { result?: { sessions?: unknown[] } }).result?.sessions ?? []) as Array<{
          targetId?: string;
          controller?: string;
        }>;
        const held = rows.find(
          (row) => row.targetId === target && row.controller !== undefined && row.controller !== holderName(),
        );
        if (held !== undefined) {
          return text(
            refusal("CONTROL_BUSY", `"${held.controller}" holds a session on this target; ask them to hand it over.`),
          );
        }
      }
      /*
       * A program an agent starts gets a shell's environment, not the broker's
       * (SF-15): the broker may have been started by a client whose environment
       * holds a model credential or a service token.
       */
      const started = adapter === "process" ? { ...(launch ?? {}), inheritEnv: false } : launch;
      const result = await call("connect", { url, app, attach, adapter, headed, launch: started });
      const opened = (result as { result?: { sessionId?: string } }).result?.sessionId;
      if (opened !== undefined) io.err(`surface session opened: ${opened}`);
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
        "Perform one action, addressed by a reference from `surface_snapshot`. Navigation, " +
        "scrolling and a `waitFor` on the page (`text`, `url` or `title`) take no reference; " +
        "everything else does.",
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      inputSchema: {
        session: z.string().min(1).describe("Session ID from surface_connect"),
        action: z.enum(SURFACE_ACTIONS as unknown as [string, ...string[]]).describe("The action to perform."),
        ref: z.string().optional().describe("The `[ref=…]` from the most recent snapshot."),
        args: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
          .optional()
          .describe('Arguments: {"url": "/login"}, {"value": "hello"}, {"key": "Enter"}.'),
        ref2: z.string().optional().describe("The second element, for dragTo."),
        secrets: z
          .array(z.string().min(1))
          .optional()
          .describe(
            "Values that must never be echoed or recorded, such as a password in `args`. A value " +
              "typed into a password field is withheld whether or not it is listed.",
          ),
        intent: OPTIONAL_INTENT,
      },
    },
    async ({ session, action, ref, args, ref2, secrets, intent }) => {
      /*
       * `screenshot` has its own tool, which decides where the file goes. As an
       * action it wrote to whatever `args.path` said — a browser's PNG or a
       * terminal's text over any file this user can write.
       */
      if (action === "screenshot") {
        return text(
          refusal("INVALID_ARGUMENT", "Take a screenshot with `surface_screenshot`, which returns the image.", session),
        );
      }
      if (action === "navigate") {
        for (const url of urlsIn(args?.["url"])) {
          const refused = urlRefusal(url, options);
          if (refused !== undefined) return text(refusal("PERMISSION_REQUIRED", refused, session));
        }
      }
      if (action === "upload" && options.allowUpload !== true) {
        return text(
          refusal(
            "PERMISSION_REQUIRED",
            "An agent may not put a file from this machine into a page through this server; start it " +
              "with --allow-upload to allow it.",
            session,
          ),
        );
      }
      const before = await evidenceBefore(intent, session, ref);
      const result = await call("act", {
        session, action, ref, args, ref2, holder: holderName(),
        ...(secrets === undefined ? {} : { secrets }),
      });
      /*
       * What the trajectory keeps is what a proposal is compiled from, and a
       * proposal is a file a person commits (SF-15). A secret is withheld from
       * the arguments, and from anything the result echoed.
       */
      const kept = withholdSecrets(args as Record<string, unknown> | undefined, {
        ...(secrets === undefined ? {} : { secrets }),
        describe: before.describe,
        // A `type` whose field could not be described is not known not to be a password.
        failClosed: action === "type",
      });
      const policy = createRedactionPolicy();
      for (const secret of secrets ?? []) addSecretLiteral(policy, secret);
      await captureToTrajectory(
        "act",
        intent,
        { action, args: kept, ref2 },
        ref,
        redactObject(policy, result) as Record<string, unknown>,
        before,
      );
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
    /*
     * Not a session somebody else holds (SF-13). `close` takes no holder at the
     * broker, so an agent could close the target a person had taken back from
     * it; the person closes their own.
     */
    async ({ session }) => {
      const control = await call("control", { session, action: "status", holder: holderName() });
      const held = (control as { result?: { holder?: string; heldByYou?: boolean } }).result;
      if (control["status"] === "succeeded" && held?.holder !== undefined && held.heldByYou !== true) {
        return text(refusal("CONTROL_BUSY", `"${held.holder}" holds this session, so it is theirs to close.`, session));
      }
      return text(await call("close", { session }));
    },
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
        intent: OPTIONAL_INTENT,
      },
    },
    /*
     * Under this client's own name, and never forced (SF-13): a target somebody
     * else holds is refused, and they hand it over. Taking it anyway is what a
     * person does from the desktop or the terminal.
     */
    async ({ session, action }) =>
      text(
        await call("control", {
          session,
          ...(action === undefined ? {} : { action }),
          holder: holderName(),
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
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
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
        intent: OPTIONAL_INTENT,
      },
    },
    async ({ session, request, withSessionCookies }) =>
      text(
        await call("request", {
          session,
          request: { name: "request", ...request } as Record<string, unknown>,
          ...(withSessionCookies === undefined ? {} : { withSessionCookies }),
          holder: holderName(),
        }),
      ),
  );

  /*
   * Where this server keeps its screenshots: beside the trajectory when there
   * is one, and in a directory of its own under the system's temporary one
   * when there is not.
   */
  const screenshotDir = trajectory !== undefined
    ? join(dirname(trajectory.path), "screenshots")
    : join(tmpdir(), "yam-mcp", sessionId, "screenshots");
  let screenshots = 0;

  server.registerTool(
    "surface_screenshot",
    {
      title: "Take a screenshot",
      description:
        "Take a screenshot of the current surface and return it as an image. A terminal's " +
        "screenshot is its text. The file is kept in this server's own directory, and its path " +
        "is in the result.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        session: z.string().min(1).describe("Session ID"),
        intent: OPTIONAL_INTENT,
      },
    },
    /*
     * A picture the agent can see, written where nothing else lives (SF-11).
     *
     * The tool took any `path` and handed back only that path. So the one tool
     * whose answer is a picture answered with a file name an agent over HTTP
     * cannot open — and, being annotated read-only, it wrote wherever it was
     * told: a terminal session's screenshot is its text, so `path: "~/.zshrc"`
     * replaced a file with text the agent had typed, under a client that
     * approves read-only tools without asking.
     */
    async ({ session }) => {
      mkdirSync(screenshotDir, { recursive: true });
      screenshots += 1;
      const png = join(screenshotDir, `${Date.now()}-${screenshots}.png`);
      const result = await call("screenshot", { session, path: png });
      if (result["status"] !== "succeeded") return text(result);
      if (!existsSync(png)) {
        // An adapter that said it succeeded and wrote nothing (the UIA bridge
        // swallowed a capture failure) has not taken a screenshot.
        return text({
          ...result,
          status: "failed",
          error: {
            code: "OUTCOME_UNKNOWN",
            message: `The adapter reported a screenshot and wrote no file at ${png}.`,
            retryable: false,
          },
        });
      }

      const bytes = readFileSync(png);
      const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const kept = isPng ? png : png.replace(/\.png$/, ".txt");
      if (!isPng) renameSync(png, kept);
      const answered = text({ ...result, result: { path: kept } });
      if (!isPng) {
        return { ...answered, content: [...answered.content, { type: "text" as const, text: bytes.toString("utf8") }] };
      }
      if (bytes.length > INLINE_IMAGE_BYTES) {
        return {
          ...answered,
          content: [
            ...answered.content,
            { type: "text" as const, text: `The screenshot is larger than 5 MB, so it is not returned inline. It is at ${png}.` },
          ],
        };
      }
      return {
        ...answered,
        content: [...answered.content, { type: "image" as const, data: bytes.toString("base64"), mimeType: "image/png" }],
      };
    },
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
  /*
   * The first positional is the project, not the second (PK-05).
   *
   * This read `args.command[1]`, which was right while the command was
   * `yam mcp <project-dir>`: `command[0]` was the word "mcp". As its own
   * executable there is no such word, so `yam-mcp <project-dir>` put the
   * directory in `command[0]` and this read past it — the server started with
   * no project and said so, and the only way to get one was to pass a bogus
   * first argument.
   *
   * Nothing caught it because nothing drove this path: the in-process tests
   * call `buildMcpServer` directly and the stdio corpus spawns the binary with
   * no project at all.
   */
  const root = args.command[0];
  const built = await buildMcpServer({
    ...(root === undefined ? {} : { root }),
    io,
    ...policyFrom(args),
    ...(stringOption(args, "trajectory") === undefined
      ? {}
      : { trajectoryPath: stringOption(args, "trajectory")! }),
    ...(stringOption(args, "session") === undefined
      ? {}
      : { sessionId: stringOption(args, "session")! }),
  });

  /*
   * The server names itself, and its name is not `yam mcp` (PK-05).
   *
   * That subcommand was removed when this package took the server over, and the
   * banner it prints on every start still said it — so the first line an agent
   * host's log shows names a command that answers "it has moved". The repository
   * check for stale names covers screen names in the two renderers; a
   * *command* name in a server's own greeting was outside it.
   */
  if (built.trajectory) {
    io.err(`@svatah/yam-mcp — trajectory at ${built.trajectory.path}`);
  } else {
    io.err("@svatah/yam-mcp — surface tools ready (no project, no trajectory)");
  }
  if (boolOption(args, "json")) io.err("(--json has no meaning for a protocol server)");

  const transport = new StdioServerTransport();
  await built.server.connect(transport);

  /*
   * Say that somebody is connected (TV-M05, SF-13).
   *
   * This process is not the service, and the service is what the cockpit and the
   * app ask — so the connection is recorded in the user's state directory and
   * read from there. The heartbeat is what makes a record that outlived its
   * process fall out of the list rather than showing an agent nobody can take a
   * target back from.
   */
  const id = `stdio-${process.pid}`;
  const record = (): void => {
    writeClient({
      id,
      name: stringOption(args, "client") ?? "an MCP client",
      transport: "stdio",
      profile: stringOption(args, "profile") ?? "surface",
      since: new Date().toISOString(),
    });
  };
  record();
  const heartbeat = setInterval(record, 10_000);
  heartbeat.unref();

  await new Promise<void>((done) => {
    transport.onclose = () => done();
    process.once("SIGINT", () => done());
    process.once("SIGTERM", () => done());
  });

  clearInterval(heartbeat);
  removeClient(id);
  await built.close();
  return EXIT.ok;
}

/** `--allow-program` (repeatable) and `--allow-file-urls`, as a launch policy (SF-15). */
export function policyFrom(args: ParsedArgs): LaunchPolicy {
  const list = (name: string): string[] =>
    stringOptions(args, name)
      .flatMap((one) => one.split(","))
      .map((one) => one.trim())
      .filter((one) => one !== "");
  const programs = list("allow-program");
  const apps = list("allow-app");
  return {
    ...(programs.length === 0 ? {} : { allowPrograms: programs }),
    ...(apps.length === 0 ? {} : { allowApps: apps }),
    ...(boolOption(args, "allow-file-urls") ? { allowFileUrls: true } : {}),
    ...(boolOption(args, "allow-upload") ? { allowUpload: true } : {}),
  };
}
