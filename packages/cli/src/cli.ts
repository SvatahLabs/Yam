/**
 * The `yam` command line (LLD §15).
 *
 * Phase 1 built the commands module (a) needs — `surface conform`, `bindings`,
 * `heal`, `eval healing`. Phase 2 adds module (b)'s: `compile`, `lint`, `run`
 * under both hosts, `migrate`, `init` and `doctor`. What is still missing says
 * which task builds it rather than printing a bare "unknown command", because
 * "not yet" and "never" are different answers.
 *
 * Commands are imported lazily. `yam bindings list` should not pay for
 * loading the compiler, and `yam --help` should not load anything at all.
 */
import {
  EXIT,
  inputOptions,
  parseArgs,
  runBindingsCommand,
  type CommandIo,
  type ExitCode,
  type ParsedArgs,
} from "@svatah/yam-bindings-cli";
import { ConfigError } from "./config-error.js";

/** Commands LLD §15 lists that are not built yet, and what builds them. */
const LATER: Record<string, string> = {};


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
      "@svatah/yam-gateway"
    );
    if (!credentialInEnvironment()) return;

    const { loadProject } = await import("./project.js");
    const { registerRegrounder } = await import("@svatah/yam-healer");
    const { recorderRegrounder } = await import("@svatah/yam-recorder");

    const root = typeof args.options["project"] === "string" ? args.options["project"] : ".";
    const loaded = await loadProject(root).catch(() => undefined);
    if (loaded === undefined || !loaded.config.heal.useModel) return;

    registerRegrounder(
      recorderRegrounder({
        gateway: anthropicGateway({
          model: loaded.config.record.model,
          cache: new DiskCache(`${loaded.root}/.yam/model-cache`),
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
 * Prepare `yam heal --run <id>`: the replayer, and where the flow starts.
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
    const { BindingsStore, resolve: resolveBinding } = await import("@svatah/yam-bindings");

    const root = typeof args.options["project"] === "string" ? args.options["project"] : ".";
    const loaded = await loadProject(root);
    const store = BindingsStore.load(`${loaded.root}/${loaded.config.bindings.dir}`);

    /*
     * The failing stories' inputs (Draft 2.6, LLD §10).
     *
     * `--input k=v` and `YAM_INPUT_<NAME>`, read by the same function `run`
     * reads them with. Replaying the prefix of a story that types
     * `{input.password}` needs the password, and the run recorded only its name
     * — a secret never reaches a run directory (REQ-NFR-6), so the caller
     * supplies it again. Registered here as well as passed per call so a heal
     * has them whichever route reaches the replayer.
     */
    const inputs = inputOptions(args);

    registerRuntimeReplayer({
      root: loaded.root,
      data: loaded.project.data.values,
      secrets: loaded.project.data.secrets,
      stepTimeoutMs: loaded.config.run.stepTimeoutMs,
      ...(Object.keys(inputs).length === 0 ? {} : { inputs }),
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
     * would make them look like flags and beat `YAM_BASE_URL`, which is the
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
 * Lazily and best-effort: `yam lint` should not pay for loading a browser
 * protocol client, and an adapter that fails to load is a reason for
 * `--adapter <that one>` to fail, not for `yam bindings list` to.
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

  /*
   * The front door (T14.1, REQ-CLI-1): `yam` alone says where you are and what
   * to do next, and exits 0. Usage is what `yam help` and `--help` print.
   */
  if (args.options["help"] !== undefined) {
    const { TOP_LEVEL, helpFor } = await import("./help.js");
    io.out(helpFor(args.command) ?? TOP_LEVEL);
    return EXIT.ok;
  }
  if (command === undefined || command === "status") {
    return await (await import("./front-door.js")).statusCommand(args, io);
  }
  /*
   * Help (T14.3): one screen for `yam help`, one topic for `yam help <topic>`,
   * one command for `yam <command> --help`, and a noun's verbs for `yam <noun>`.
   */
  if (command === "help") {
    const { TOP_LEVEL, topic } = await import("./help.js");
    const name = args.command[1];
    if (name === undefined) {
      io.out(TOP_LEVEL);
      return EXIT.ok;
    }
    const page = topic(name);
    if (page === undefined) {
      io.err(`No help topic "${name}". The topics: flows · bindings · exit-codes · session · adapters · agents`);
      return EXIT.usage;
    }
    io.out(page);
    return EXIT.ok;
  }
  if (args.command.length === 1 && (await import("./help.js")).NOUNS.some(([noun]) => noun === command)) {
    io.err((await import("./help.js")).helpFor([command]) ?? "");
    return EXIT.usage;
  }

  /*
   * Module (a)'s commands first, from `@svatah/yam-bindings-cli` (Draft 2.3).
   *
   * One implementation behind two executables: `yam bindings list` and
   * `yam-bindings bindings list` are the same function, so they cannot drift
   * apart, and someone who installed module (a) alone still has a command line.
   */
  /*
   * `yam heal --run <id>` replays the story to the failing step, which needs
   * the executor. The healer cannot import it (module (a), REQ-PKG-1), so the
   * CLI registers a runtime-backed `Replayer` first (LLD §10, Draft 2.3).
   * `yam-bindings heal --from-bind-failures` has no runtime and keeps module
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

  /*
   * `eval self` is the parity gate (T11.5, REQ-SELF-2, LLD §13.9, §15).
   *
   * Module (b)'s, and not because of a dependency: it *spawns* every other
   * source — `yam run`, a Playwright suite, a vitest file, a script — and
   * compares their verdicts. It needs nothing from an adapter, which is why it
   * sits above them all.
   */
  if (command === "eval" && args.command[1] === "self") {
    return await (await import("./commands/eval-self.js")).evalSelfCommand(args, io);
  }

  /*
   * `eval finetune` is module (b)'s: it reads the Tier 2 corpus — sentences the
   * grammar refuses, each with a reviewed step — and exports the pairs a
   * fine-tune would train on (T8.4, T6.5, ADR-4). Phase 7's version exported
   * from merged flows and the tuned model got worse.
   */
  if (command === "eval" && args.command[1] === "finetune") {
    return await (await import("./commands/finetune.js")).finetuneCommand(args, io);
  }

  // `heal` and `eval healing` both take the model half of REQ-HEAL-1.
  if (command === "heal" || (command === "eval" && args.command[1] === "healing")) {
    await registerModelRegrounder(args, io);
  }

  /*
   * `yam heal` with nothing else heals the last run of this project (T14.2,
   * REQ-CLI-6): `run` wrote `.yam/last-run`, and asking a newcomer for an id
   * they have to find in a directory listing is the kind of thing the front
   * door exists to stop.
   */
  let healArgs = args;
  if (command === "heal" && args.options["run"] === undefined && args.options["from-bind-failures"] === undefined) {
    const { findProjectRoot, readLastRun } = await import("./front-door.js");
    const root = findProjectRoot(typeof args.options["project"] === "string" ? args.options["project"] : ".");
    const last = root === undefined ? undefined : readLastRun(root);
    if (root === undefined || last === undefined) {
      io.err("There is no run to heal yet. Run `yam run` first; `yam heal` then heals that run.");
      return EXIT.usage;
    }
    io.err(`healing the last run, ${last.runId}`);
    healArgs = { ...args, options: { project: root, ...args.options, run: last.runId } };
  }
  const prepared =
    command === "heal" && typeof healArgs.options["run"] === "string"
      ? await prepareRunHeal(healArgs, io)
      : healArgs;

  /*
   * Every adapter, before module (a)'s commands run (LLD §1, REQ-SURF-2).
   *
   * `yam surface conform --adapter bidi` and `yam bindings verify
   * --adapter bidi` are module (a) commands mounted here, and module (a)'s own
   * registration knows only Playwright — it is what a plain Playwright user
   * installs, and the other adapters are not in its dependency tree. Registering
   * from here is what makes the whole adapter set reachable under `yam` while
   * `yam-bindings` stays module (a).
   */
  await registerEveryAdapter(io);

  /*
   * `surface doctor` before module (a) sees `surface` (T6.1, T6.2, LLD §7.5).
   *
   * The rest of `surface` is module (a)'s, and module (a) has neither desktop
   * adapter in its dependency tree — so the one subcommand that has to reach
   * them is answered here, and `yam-bindings surface doctor` correctly says
   * it does not know it.
   */
  if (command === "surface" && args.command[1] === "doctor") {
    return await (await import("./commands/surface-doctor.js")).surfaceDoctorCommand(args, io);
  }

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
    case "check":
      return await (await import("./commands/compile.js")).checkCommand(args, io);
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
    case "ui":
      return await (await import("./commands/ui.js")).uiCommand(args, io);
    case "repl":
      return await (await import("./commands/repl.js")).replCommand(args, io);
    case "mcp":
      return await (await import("./commands/mcp.js")).mcpCommand(args, io);
    case "workflow":
      return await (await import("./commands/workflow.js")).workflowCommand(args, io);
    case "tool":
      return await (await import("./commands/tool.js")).toolCommand(args, io);
    case "trajectory":
      return await (await import("./commands/trajectory.js")).trajectoryCommand(args, io);
    default: {
      const task = LATER[command];
      io.err(
        task === undefined
          ? `Unknown command "${command}".\n\n${(await import("./help.js")).TOP_LEVEL}`
          : `\`yam ${command}\` is not built yet; it arrives with ${task}.`,
      );
      return EXIT.usage;
    }
  }
}
