/**
 * The `svatah` command line (LLD §15).
 *
 * Phase 1 built the commands module (a) needs — `surface conform`, `bindings`,
 * `heal`, `eval healing`. Phase 2 adds module (b)'s: `compile`, `lint`, `run`
 * under both hosts, `migrate`, `init` and `doctor`. What is still missing says
 * which task builds it rather than printing a bare "unknown command", because
 * "not yet" and "never" are different answers.
 *
 * Commands are imported lazily. `svatah bindings list` should not pay for
 * loading the compiler, and `svatah --help` should not load anything at all.
 */
import {
  EXIT,
  parseArgs,
  runBindingsCommand,
  type CommandIo,
  type ExitCode,
  type ParsedArgs,
} from "@svatah/bindings-cli";
import { ConfigError } from "./config-error.js";

/** Commands LLD §15 lists that are not built yet, and what builds them. */
const LATER: Record<string, string> = {
  repl: "T4.5",
  workflow: "T5.4",
  tool: "T5.5",
  mcp: "T4.6",
};

const USAGE = `svatah — a deterministic automation runtime with a standard agent surface

Flows (module b):

  svatah init [dir] [--force]
  svatah lint [dir] [--json]
  svatah compile [dir] [--stable] [--out .svatah/plan.json] [--json]
                 [--tier2] [--tier3] [--allow-model-drift]
  svatah record [dir] [--flow <file>] [--story <name>] [--rebind] [--headed]
                [--base-url <url>] [--storage-state <path.json>]
                [--gateway anthropic|fake] [--input k=v] [--force-production] [--json]
  svatah run [dir] [--host playwright|none] [--flow <file>] [--story <name>]
             [--base-url <url>] [--storage-state <path.json>]
             [--workers <n>] [--headed] [--out runs] [--run-id <id>] [--json]
  svatah host generate [dir] [--out .svatah/specs]
  svatah migrate <src> <dest> [--keep-original] [--json]
  svatah doctor [dir] [--json]
  svatah serve [dir] [--port 0] [--token <t>]

Bindings and healing (module a):

  svatah surface conform --adapter <name> [--base-url <url>] [--headed] [--only <ids>]
                         [--report <path.md>] [--json]
  svatah bindings list [--dir <bindings>] [--json]
  svatah bindings show <id> [--dir <bindings>] [--json]
  svatah bindings verify [--adapter <name>] [--base-url <url>] [--id <id>] [--json]
  svatah bindings prune [--used-in <dirs>] [--apply] [--json]
  svatah heal --from-bind-failures | --run <id> [--project <dir>]
              [--dir <bindings>] [--out <.svatah>] [--runs <runs>]
              [--base-url <url>] [--storage-state <path.json>]
              [--apply] [--no-model] [--headed] [--json]
  svatah eval healing [--no-model] [--base-url <url>] [--report <path.md>] [--json]
  svatah eval grounding [--gateway anthropic|fake] [--base-url <url>] [--cases <path.jsonl>]
                        [--limit <n>] [--report <path.md>] [--json]
  svatah eval compiler [--tier2] [--tier3] [--gateway local|anthropic|fake]
                       [--only tier1,tier2] [--report <path.md>] [--json]

Every command that opens a session takes its base URL and storage state from
the --base-url / --storage-state flag, then SVATAH_BASE_URL /
SVATAH_STORAGE_STATE, then config.app, in that order (LLD §15).

Exit codes are the table in LLD §15.
`;

/**
 * Register the recorder as the healer's `Regrounder` (T3.3, LLD §10).
 *
 * REQ-HEAL-1's model half: "relocalization first (no model), then one model
 * re-grounding call per element if configured". The healer defines the interface
 * and module (a) ships a no-op; this is where module (b) fills it, with the same
 * `ground()` the recorder uses for a flow.
 *
 * Three ways to end up with no model, all of them fine: `--no-model`,
 * `heal.useModel: false` in the project's config, or no credential. In each the
 * heal runs as relocalization and the report says the regrounder was `none`,
 * which is an honest answer rather than a degraded one.
 */
async function registerModelRegrounder(args: ParsedArgs, io: CommandIo): Promise<void> {
  if (args.options["no-model"] !== undefined) return;

  try {
    const { credentialInEnvironment, anthropicGateway, DiskCache } = await import(
      "@svatah/gateway"
    );
    if (!credentialInEnvironment()) return;

    const { loadProject } = await import("./project.js");
    const { registerRegrounder } = await import("@svatah/healer");
    const { recorderRegrounder } = await import("@svatah/recorder");

    const root = typeof args.options["project"] === "string" ? args.options["project"] : ".";
    const loaded = await loadProject(root).catch(() => undefined);
    if (loaded === undefined || !loaded.config.heal.useModel) return;

    registerRegrounder(
      recorderRegrounder({
        gateway: anthropicGateway({
          model: loaded.config.record.model,
          cache: new DiskCache(`${loaded.root}/.svatah/model-cache`),
          onCall: (line) => io.err(`      ${line}`),
        }),
        maxSnapshotTokens: loaded.config.record.maxSnapshotTokens,
        visionFallback: loaded.config.record.visionFallback,
        testIdAttributes: loaded.config.bindings.testIdAttributes,
        ...(loaded.config.bindings.ignoreAttributes === undefined
          ? {}
          : { ignoreAttributes: loaded.config.bindings.ignoreAttributes }),
        onDecision: (line) => io.err(`  ${line}`),
      }),
    );
  } catch (error) {
    io.err(
      "Could not wire the model re-grounder in, so healing is relocalization only: " +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Prepare `svatah heal --run <id>`: the replayer, and where the flow starts.
 *
 * Two things the project knows and module (a) does not.
 *
 * **The replayer.** `heal --run` replays the story to the failing step, which
 * needs the executor; the healer cannot import it (module (a), REQ-PKG-1), so it
 * is registered as a plugin (LLD §10, Draft 2.3).
 *
 * **The flow's start.** Draft 2.4 (LLD §10) says both replayers begin from a
 * session opened at the flow's base URL with the configured storage state.
 * Where those come from is LLD §15's precedence — flag, then environment, then
 * `config.app` — and since Draft 2.5 the heal command applies it itself from
 * `--project`, so nothing has to be injected here.
 *
 * Best effort by design: a project that will not load is not a reason to refuse
 * to heal — the session-state default still works — so a failure here leaves the
 * default in place and says so.
 */
async function prepareRunHeal(args: ParsedArgs, io: CommandIo): Promise<ParsedArgs> {
  try {
    const { loadProject } = await import("./project.js");
    const { registerRuntimeReplayer } = await import("./replayer.js");
    const { BindingsStore, resolve: resolveBinding } = await import("@svatah/bindings");

    const root = typeof args.options["project"] === "string" ? args.options["project"] : ".";
    const loaded = await loadProject(root);
    const store = BindingsStore.load(`${loaded.root}/${loaded.config.bindings.dir}`);

    registerRuntimeReplayer({
      root: loaded.root,
      data: loaded.project.data.values,
      secrets: loaded.project.data.secrets,
      stepTimeoutMs: loaded.config.run.stepTimeoutMs,
      resolve: async (target, surface) => {
        const resolution = await resolveBinding(target.ref, surface, store, {
          candidateTimeoutMs: loaded.config.run.candidateTimeoutMs,
          phrase: target.phrase,
        });
        return {
          ref: resolution.ref,
          candidateIndex: resolution.candidateIndex,
          by: resolution.by,
        };
      },
      onProgress: (message) => io.err(`  ${message}`),
    });

    /*
     * The project root, so `sessionTarget` can read `config.app` as the last of
     * LLD §15's three sources. Injecting the *values* here — what Phase 3 did —
     * would make them look like flags and beat `SVATAH_BASE_URL`, which is the
     * defect F2 names.
     */
    return { ...args, options: { project: loaded.root, ...args.options } };
  } catch (error) {
    io.err(
      "Could not load the project, so healing will restore the recorded page rather than " +
        `replaying the story to it: ${error instanceof Error ? error.message : String(error)}`,
    );
    return args;
  }
}

/**
 * Register every adapter this build ships (LLD §1).
 *
 * Lazily and best-effort: `svatah lint` should not pay for loading a browser
 * protocol client, and an adapter that fails to load is a reason for
 * `--adapter <that one>` to fail, not for `svatah bindings list` to.
 */
async function registerEveryAdapter(io: CommandIo): Promise<void> {
  try {
    const { registerAllAdapters } = await import("./adapters.js");
    registerAllAdapters();
  } catch (error) {
    io.err(
      `Could not register every adapter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function main(argv: readonly string[], io: CommandIo): Promise<ExitCode> {
  const args: ParsedArgs = parseArgs(argv);
  const command = args.command[0];

  if (command === undefined || command === "help" || args.options["help"] !== undefined) {
    io.out(USAGE);
    return command === undefined ? EXIT.usage : EXIT.ok;
  }

  /*
   * Module (a)'s commands first, from `@svatah/bindings-cli` (Draft 2.3).
   *
   * One implementation behind two executables: `svatah bindings list` and
   * `svatah-bindings bindings list` are the same function, so they cannot drift
   * apart, and someone who installed module (a) alone still has a command line.
   */
  /*
   * `svatah heal --run <id>` replays the story to the failing step, which needs
   * the executor. The healer cannot import it (module (a), REQ-PKG-1), so the
   * CLI registers a runtime-backed `Replayer` first (LLD §10, Draft 2.3).
   * `svatah-bindings heal --from-bind-failures` has no runtime and keeps module
   * (a)'s session-state default, which is the right answer for a bind failure.
   */
  /*
   * `eval grounding` is module (b)'s: it needs a gateway and the recorder, so it
   * is intercepted before the module (a) command table, which correctly does not
   * have it (LLD §16).
   */
  if (command === "eval" && args.command[1] === "grounding") {
    return await (await import("./commands/eval-grounding.js")).groundingEvalCommand(args, io);
  }

  /*
   * `eval compiler` is module (b)'s too: it needs the compiler and, for the
   * model tiers, the gateway (T4.3, T4.4, REQ-COMP-9).
   */
  if (command === "eval" && args.command[1] === "compiler") {
    return await (await import("./commands/eval-compiler.js")).compilerEvalCommand(args, io);
  }

  // `heal` and `eval healing` both take the model half of REQ-HEAL-1.
  if (command === "heal" || (command === "eval" && args.command[1] === "healing")) {
    await registerModelRegrounder(args, io);
  }

  const prepared =
    command === "heal" && typeof args.options["run"] === "string"
      ? await prepareRunHeal(args, io)
      : args;

  /*
   * Every adapter, before module (a)'s commands run (LLD §1, REQ-SURF-2).
   *
   * `svatah surface conform --adapter bidi` and `svatah bindings verify
   * --adapter bidi` are module (a) commands mounted here, and module (a)'s own
   * registration knows only Playwright — it is what a plain Playwright user
   * installs, and the other adapters are not in its dependency tree. Registering
   * from here is what makes the whole adapter set reachable under `svatah` while
   * `svatah-bindings` stays module (a).
   */
  await registerEveryAdapter(io);

  const moduleA = await runBindingsCommand(command, prepared, io);
  if (moduleA !== undefined) return moduleA;

  /*
   * A config that will not load is a usage error with a message, not a stack
   * trace: every module (b) command starts by reading one, and Zod's raw
   * `ZodError` reaching the top level would print a page of JSON for a
   * misspelled key.
   */
  try {
    return await runModuleB(command, args, io);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    io.err(error.message);
    return EXIT.usage;
  }
}

async function runModuleB(command: string, args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  switch (command) {
    case "compile":
      return await (await import("./commands/compile.js")).compileCommand(args, io);
    case "lint":
      return await (await import("./commands/compile.js")).lintCommand(args, io);
    case "record":
      return await (await import("./commands/record.js")).recordCommand(args, io);
    case "run":
      return await (await import("./commands/run.js")).runCommand(args, io);
    case "migrate":
      return await (await import("./commands/migrate.js")).migrateCommand(args, io);
    case "init":
      return await (await import("./commands/init.js")).initCommand(args, io);
    case "doctor":
      return await (await import("./commands/doctor.js")).doctorCommand(args, io);
    case "host":
      return await (await import("./commands/host.js")).hostCommand(args, io);
    case "serve":
      return await (await import("./commands/serve.js")).serveCommand(args, io);
    default: {
      const task = LATER[command];
      io.err(
        task === undefined
          ? `Unknown command "${command}".\n\n${USAGE}`
          : `\`svatah ${command}\` is not built yet; it arrives with ${task} (see docs/spec/tasks.md).`,
      );
      return EXIT.usage;
    }
  }
}
