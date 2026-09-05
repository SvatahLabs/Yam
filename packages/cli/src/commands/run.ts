/**
 * `svatah run` (REQ-RUN-9, 12, REQ-BEH-1, 5, REQ-AGT-1, LLD §15).
 *
 * ```
 * svatah run [--host playwright|none] [--flow f] [--story s] [--workers n]
 *            [--headed] [--out runs] [--json]
 * ```
 *
 * ## Two hosts, one plan
 *
 * `--host none` calls the executor directly; `--host playwright` generates the
 * specs and runs them under Playwright Test. REQ-BEH-5 says switching never
 * requires recompiling or re-recording, and the way that is kept true is that
 * both paths use the same plan, the same bindings and the same `runStory` — the
 * host decides who owns the browser and who reports, and nothing else.
 *
 * The compatibility milestone (T2.10) runs the fixtures both ways and diffs the
 * results, which is the check that keeps it true.
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { Invoker, Plan, StepResult, Summary } from "@svatah/schema";
import { canonicalJson } from "@svatah/schema";
import { BindingsStore, resolve as resolveBinding } from "@svatah/bindings";
import { HttpSurface } from "@svatah/adapter-http";
import { generateSpecs } from "@svatah/host-playwright";
import {
  expandRuns,
  newRunId,
  openRunDirectory,
  planResume,
  run as runPlan,
  ResumeMismatchError,
  ResumeUnavailableError,
  type ApiRunner,
  type CustomStepRunner,
  type Resolver,
  type RunOptions,
} from "@svatah/runtime";
import { createSurface } from "@svatah/surface";
import { runWorkflow } from "@svatah/workflow";
import {
  boolOption,
  inputOptions,
  numberOption,
  resolveSessionTarget,
  sessionTarget,
  stringOption,
  stringOptions,
  type ParsedArgs,
  type SessionTarget,
} from "@svatah/bindings-cli";
import { registerAllAdapters } from "../adapters.js";
import { EXIT, type ExitCode } from "@svatah/bindings-cli";
import { ConfigError } from "../config-error.js";
import { compileProject, loadProject } from "../project.js";
import { report } from "./compile.js";
import type { CommandIo } from "@svatah/bindings-cli";

export async function runCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = args.command[1] ?? ".";
  const loaded = await loadProject(root);
  const compiled = compileProject(loaded, { stable: true });
  const diagnostics = [...loaded.diagnostics, ...compiled.diagnostics];

  if (diagnostics.some((d) => d.severity === "error")) {
    report(diagnostics, io);
    io.err("The project does not compile, so there is nothing to run.");
    return EXIT.compileErrors;
  }

  const host = stringOption(args, "host") ?? "none";
  if (host !== "none" && host !== "playwright") {
    io.err(`--host must be "playwright" or "none", not "${host}".`);
    return EXIT.usage;
  }

  // Before either host, and before anything is written: a store that will not
  // load is a diagnostic, not a stack trace out of a Playwright worker (F2).
  loadBindings(loaded);

  // `resolve` rather than `join`, so an absolute `--out` is not appended to the
  // project root — a run directory somewhere else is a normal thing to want.
  const outputDir = resolve(root, stringOption(args, "out") ?? loaded.config.run.outputDir);
  const runId = stringOption(args, "run-id") ?? newRunId();

  /*
   * Both hosts read the same plan from the same place, which is what makes "the
   * same plan under both hosts" checkable rather than asserted. Absolute,
   * because the Playwright host runs in a child process whose working directory
   * is the project rather than wherever the CLI was invoked.
   */
  const planPath = resolve(root, ".svatah", "plan.json");
  mkdirSync(resolve(root, ".svatah"), { recursive: true });
  writeFileSync(planPath, `${canonicalJson(compiled.plan)}\n`, "utf8");

  if (host === "playwright") {
    return await runUnderPlaywright(
      { root, planPath, outputDir, runId, loaded, plan: compiled.plan, args },
      io,
    );
  }

  return await runStandalone(
    { root, outputDir, runId, loaded, plan: compiled.plan, args },
    io,
  );
}

/* ── --host none ──────────────────────────────────────────────────────────── */

interface RunContext {
  root: string;
  outputDir: string;
  runId: string;
  loaded: Awaited<ReturnType<typeof loadProject>>;
  plan: ReturnType<typeof compileProject>["plan"];
  args: ParsedArgs;
  planPath?: string;
}

async function runStandalone(context: RunContext, io: CommandIo): Promise<ExitCode> {
  const { args } = context;
  const resumeId = stringOption(args, "resume");
  const from = stringOption(args, "from");

  if (resumeId !== undefined && from === undefined) {
    io.err("--resume <runId> needs --from <stepId>: the step to pick up at.");
    return EXIT.usage;
  }
  if (from !== undefined && resumeId === undefined) {
    io.err("--from <stepId> only means something with --resume <runId>.");
    return EXIT.usage;
  }

  try {
  const outcome = await runProject(context.loaded, {
    plan: context.plan,
    runId: context.runId,
    outputDir: context.outputDir,
    headed: boolOption(args, "headed"),
    // The flag layer of LLD §15's precedence; `runProject` adds the
    // environment and `config.app` beneath it.
    session: sessionTarget(args, { config: context.loaded.config.app }),
    ...(numberOption(args, "workers") === undefined ? {} : { workers: numberOption(args, "workers")! }),
    ...(inputsFrom(args) === undefined ? {} : { inputs: inputsFrom(args)! }),
    ...(resumeId === undefined ? {} : { resume: { runId: resumeId, from: from! } }),
    ...(stringOptions(args, "flow").length === 0 ? {} : { flows: stringOptions(args, "flow") }),
    ...(stringOptions(args, "story").length === 0 ? {} : { stories: stringOptions(args, "story") }),
    onResult: (result) => {
      if (boolOption(args, "json")) return;
      const marks: Record<StepResult["status"], string> = {
        passed: "✓",
        failed: "✗",
        skipped: "–",
        healed: "~",
        aborted: "!",
      };
      const mark = marks[result.status];
      io.err(`  ${mark} ${result.story} · ${result.text}`);
    },
    log: (message) => io.err(`  ${message}`),
  });

  if (boolOption(args, "json")) io.out(JSON.stringify(outcome.summary, null, 2));
  else {
    const { totals } = outcome.summary;
    /*
     * Which flows aborted, not how many steps did (LLD §8.3, Draft 2.7).
     *
     * A compensating story's steps keep their own statuses now, so
     * `totals.aborted` is 0 for a run that compensated and stopped — and a
     * line reading "0 aborted" above exit code 11 would be a contradiction.
     * What aborted is the flow.
     */
    const abortedFlows = Object.values(outcome.summary.flows).filter(
      (flow) => flow.status === "aborted",
    ).length;
    io.err(
      `\n${outcome.runId}: ${totals.passed} passed, ${totals.failed} failed, ` +
        `${totals.skipped} skipped` +
        (abortedFlows === 0 ? "" : `, ${abortedFlows} flow(s) aborted`) +
        ` → ${outcome.directory}`,
    );
  }
  return outcome.summary.exitCode as ExitCode;
  } catch (error) {
    /*
     * A refused resume is a mistake at the command line, not a failure of the
     * application under test, and LLD §15 gives it its own exit code: 12 for a
     * hash that moved, 64 for a checkpoint that is not there. Neither is 1 —
     * a CI job that treated "your plan changed" as "your test failed" would
     * send someone to look at the wrong thing.
     */
    if (error instanceof ResumeMismatchError) {
      io.err(error.message);
      return EXIT.hashMismatch;
    }
    if (error instanceof ResumeUnavailableError) {
      io.err(error.message);
      return EXIT.usage;
    }
    throw error;
  }
}

/**
 * The bindings store, or a `ConfigError` naming the file (P2-F2).
 *
 * A binding file that will not parse is a project error in the same family as a
 * config that will not load: nothing about it is discovered by running, and a
 * stack trace out of the YAML parser tells a person nothing they can act on. As
 * a `ConfigError` it is reported as a diagnostic and exits with the config-error
 * code, the same as a bad `svatah.config.yaml`.
 *
 * Called before the run directory is opened, so a refused run leaves no
 * half-written `runs/<id>` behind for a reader to mistake for a real one.
 */
export function loadBindings(
  loaded: Awaited<ReturnType<typeof loadProject>>,
): BindingsStore {
  const dir = resolve(loaded.root, loaded.config.bindings.dir);
  try {
    return BindingsStore.load(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const named = message.includes(dir)
      ? message.split(dir).join(loaded.config.bindings.dir)
      : `${loaded.config.bindings.dir}: ${message}`;
    throw new ConfigError(named, loaded.config.bindings.dir);
  }
}

/** What `runProject` needs beyond the loaded project. */
export interface RunProjectOptions {
  /** A plan already compiled from this project; compiled here when absent. */
  readonly plan?: Plan;
  readonly runId?: string;
  readonly outputDir?: string;
  readonly headed?: boolean;
  readonly workers?: number;
  readonly inputs?: Record<string, unknown>;
  readonly flows?: readonly string[];
  readonly stories?: readonly string[];
  readonly onResult?: (result: StepResult) => void;
  readonly log?: (message: string) => void;
  /**
   * The `--base-url` / `--storage-state` flags, when the caller had any.
   *
   * The flag layer of LLD §15's precedence. The environment and `config.app`
   * are applied here, so `POST /run` gets the same answer as `svatah run` with
   * no flags — one place decides where a session opens (Draft 2.5).
   */
  readonly session?: SessionTarget;
  /** `--resume <runId> --from <stepId>` (REQ-AUTO-3, T5.1). */
  readonly resume?: { readonly runId: string; readonly from: string };
  /**
   * Which behavior this run is (REQ-BEH-5, LLD §13, T5.2).
   *
   * `test` by default. `workflow` runs the one story named in `stories` through
   * `runWorkflow`, which forces checkpoints and audit on and applies the
   * environment policy; `tool` is the same, invoked over MCP. One function for
   * all three, because "behaviors share one plan" is only true if they share the
   * code that runs it.
   */
  readonly behavior?: "test" | "workflow" | "tool";
  /** `--allow-side-effects`, for the environment policy (REQ-AUTO-7). */
  readonly allowSideEffects?: boolean;
  /** Who is running this, for the audit log (REQ-AUTO-6). */
  readonly invoker?: Invoker;
}

/**
 * Run a project with the standalone executor.
 *
 * Exported because the local service (T2.11) calls it: LLD §13.5 says every
 * service handler calls the same function the CLI calls, and this is that
 * function. A second implementation behind `POST /run` is how the ADE and the
 * CLI would start disagreeing about what a run is.
 */
export async function runProject(
  loaded: Awaited<ReturnType<typeof loadProject>>,
  options: RunProjectOptions = {},
): Promise<{
  runId: string;
  summary: Summary;
  results: readonly StepResult[];
  directory: string;
  /** A workflow's or a tool's declared outputs, un-namespaced (LLD §13.2). */
  outputs?: Record<string, unknown>;
}> {
  const plan = options.plan ?? compileProject(loaded, { stable: true }).plan;
  const runId = options.runId ?? newRunId();
  const outputDir = resolve(loaded.root, options.outputDir ?? loaded.config.run.outputDir);
  const context = { root: loaded.root, loaded, plan, runId, outputDir };

  registerAllAdapters();

  /*
   * The bindings store, before the run directory exists (P2-F1's sibling, F2).
   *
   * A binding file that will not parse is a project error, in the same family as
   * a config that will not load: nothing about it is discovered by running, and
   * a stack trace out of the YAML parser tells a person nothing they can fix. So
   * it becomes a `ConfigError` naming the file, which `svatah run` reports as a
   * diagnostic and exits with the config-error code — and because this happens
   * before `openRunDirectory`, no half-written run is left behind to be read as
   * a real one.
   */
  const store = loadBindings(loaded);

  /*
   * `--resume <runId> --from <stepId>` (REQ-AUTO-3, LLD §8.1, T5.1).
   *
   * Resolved here, before a run directory is opened: picking the checkpoint may
   * fail — no such step, no checkpoint before it — and a refused resume must not
   * leave a half-written `runs/<id>` for a reader to mistake for a real one.
   * The hashes are checked inside `run()`, which is the only place that knows
   * the plan's.
   */
  const resume =
    options.resume === undefined
      ? undefined
      : planResume({
          runDir: join(context.outputDir, options.resume.runId),
          plan,
          order: expandRuns(plan, {
            ...(options.flows === undefined ? {} : { flows: options.flows }),
            ...(options.stories === undefined ? {} : { stories: options.stories }),
          }),
          from: options.resume.from,
        });

  const directory = openRunDirectory(context.outputDir, context.runId);

  /*
   * Where the session opens: flag, then environment, then `config.app`
   * (LLD §15, Draft 2.5). A project's config names the deployment it usually
   * runs against; a CI job, or a test that starts the application on an
   * ephemeral port, needs to say otherwise without editing it, and a person at
   * a terminal needs to say so once without exporting anything.
   */
  const target = resolveSessionTarget(options.session ?? {}, { config: loaded.config.app });

  const config = {
    ...loaded.config,
    app: { ...loaded.config.app, ...target },
    run: {
      ...loaded.config.run,
      headless: options.headed !== true,
      workers: options.workers ?? loaded.config.run.workers,
      outputDir: context.outputDir,
    },
  };

  const resolver: Resolver = async (target, surface) => {
    const resolution = await resolveBinding(target.ref, surface, store, {
      candidateTimeoutMs: config.run.candidateTimeoutMs,
      phrase: target.phrase,
    });
    return { ref: resolution.ref, candidateIndex: resolution.candidateIndex, by: resolution.by };
  };

  const { api, custom } = projectRunners(loaded, {
    baseUrl: config.app.baseUrl,
    cwd: context.root,
    ...(options.log === undefined ? {} : { log: options.log }),
  });

  const runOptions: RunOptions = {
    config,
    plan,
    openSurface: async () => {
      const surface = await createSurface(config);
      await surface.open({
        ...(config.app.baseUrl === undefined ? {} : { baseUrl: config.app.baseUrl }),
        ...(config.app.storageState === undefined ? {} : { storageState: config.app.storageState }),
      });
      /*
       * Start at the base URL.
       *
       * `open()` gives a session, not a page: a browser context starts at
       * `about:blank`. Every legacy flow begins by clicking something on the
       * home page, because the old runner opened the configured URL first — and
       * a flow that has to say `Open "/"` before it can do anything is a flow
       * carrying a line about the harness rather than about the behaviour.
       */
      if (config.app.baseUrl !== undefined && surface.kind === "web") {
        await surface.act("navigate", undefined, { url: config.app.baseUrl });
      }
      return surface;
    },
    resolve: resolver,
    api,
    custom,
    directory,
    runId: context.runId,
    /*
     * The store's hash, so `summary.json` and every checkpoint say which
     * bindings a run used (REQ-AUTO-3). `--resume` refuses a checkpoint whose
     * hash does not match, and a hash of `"none"` would make that check pass
     * for every store — a resume against re-recorded bindings would continue
     * clicking whatever the new candidates find.
     */
    bindingsHash: store.hash(),
    data: loaded.project.data.values,
    secrets: loaded.project.data.secrets,
    ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
    ...(options.flows === undefined ? {} : { flows: options.flows }),
    ...(options.stories === undefined ? {} : { stories: options.stories }),
    ...(options.onResult === undefined ? {} : { onResult: options.onResult }),
    ...(resume === undefined ? {} : { resume }),
    ...(options.behavior === undefined ? {} : { behavior: options.behavior }),
    ...(options.invoker === undefined ? {} : { invoker: options.invoker }),
  };

  /*
   * The workflow behavior is `runWorkflow`, not a branch here (LLD §13.2).
   *
   * It applies the environment policy, forces checkpoints and audit on, and
   * un-namespaces the outputs — and it does that by *configuring* `run()`, so a
   * step means exactly what it means under `svatah run` (REQ-BEH-5).
   */
  if (options.behavior === "workflow" || options.behavior === "tool") {
    const storyName = options.stories?.[0];
    if (storyName === undefined) {
      throw new ConfigError("A workflow run names one story.", "stories");
    }

    // `behavior`, `stories` and `inputs` are the behavior's to set, so they are
    // taken back off the shared options rather than passed twice.
    const { behavior: _b, stories: _s, inputs: _i, ...runner } = runOptions;
    void _b;
    void _s;
    void _i;

    const outcome = await runWorkflow(storyName, {
      runner,
      behavior: options.behavior,
      ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
      ...(options.allowSideEffects === undefined
        ? {}
        : { allowSideEffects: options.allowSideEffects }),
    });
    return {
      runId: outcome.runId,
      summary: outcome.summary,
      results: outcome.results,
      directory: directory.path,
      outputs: outcome.outputs,
    };
  }

  const outcome = await runPlan(runOptions);
  return {
    runId: outcome.runId,
    summary: outcome.summary,
    results: outcome.results,
    directory: directory.path,
  };
}

/**
 * `--input k=v`, repeated, beneath `SVATAH_INPUT_<NAME>` (LLD §10, §15).
 *
 * The shared parser, so `run`, `workflow run` and `heal --run` take their inputs
 * the same way — which is what LLD §10's "exactly as `run` does" asks for, and
 * what stops the three drifting apart one flag at a time.
 *
 * The environment matters for the same reason it does everywhere else: a
 * password on a command line is a password in the process list.
 */
function inputsFrom(args: ParsedArgs): Record<string, unknown> | undefined {
  const out = inputOptions(args);
  return Object.keys(out).length === 0 ? undefined : out;
}

function literalArg(value: unknown): string | undefined {
  return typeof value === "object" && value !== null && (value as { kind?: string }).kind === "literal"
    ? (value as { value: string }).value
    : undefined;
}

/** `{data.x}` and friends, for a request's templating. */
function readReference(scope: { read: (ref: never) => unknown }, reference: string): unknown {
  try {
    if (reference.startsWith("data.")) {
      return scope.read({ kind: "data", path: reference.slice(5) } as never);
    }
    if (reference.startsWith("input.")) {
      return scope.read({ kind: "input", name: reference.slice(6) } as never);
    }
    return scope.read({ kind: "var", name: reference } as never);
  } catch {
    return undefined;
  }
}

/* ── --host playwright ────────────────────────────────────────────────────── */

/**
 * Generate the specs and hand them to Playwright Test.
 *
 * The runner is spawned rather than driven in-process: Playwright Test owns the
 * process it runs in — workers, reporters, its own config resolution — and
 * embedding it would mean reimplementing that. The CLI's job is to put the specs
 * and the plan where the config expects them.
 */
async function runUnderPlaywright(context: RunContext, io: CommandIo): Promise<ExitCode> {
  const wanted = stringOptions(context.args, "flow");
  const plan =
    wanted.length === 0
      ? context.plan
      : {
          ...context.plan,
          runs: Object.fromEntries(
            Object.entries(context.plan.runs).filter(([file]) => wanted.includes(file)),
          ),
        };

  // Written fresh each time: a stale spec for a flow this run excluded would be
  // discovered by Playwright and run anyway.
  rmSync(join(context.root, ".svatah", "specs"), { recursive: true, force: true });
  const specs = generateSpecs({
    plan,
    outDir: join(context.root, ".svatah", "specs"),
    planPath: context.planPath!,
  });

  if (specs.length === 0) {
    io.err("No flow has a run block, so there is nothing to generate.");
    return EXIT.ok;
  }
  io.err(`generated ${specs.length} spec(s) in .svatah/specs`);

  /*
   * Playwright Test is spawned rather than driven in-process: it owns the
   * process it runs in — workers, reporters, its own config resolution — and
   * embedding it would mean reimplementing that. Its CLI is resolved from this
   * package rather than through `npx`, so the version that runs is the one the
   * project installed.
   */
  // `@playwright/test`'s own `cli.js`, resolved from this package rather than
  // through `npx`, so the version that runs is the one the project installed.
  // Resolved from the package root because the file is not an export.
  const resolveFrom = createRequire(import.meta.url);
  const cli = join(dirname(resolveFrom.resolve("@playwright/test/package.json")), "cli.js");
  const args = ["test", "--config", "playwright.config.ts"];
  if (boolOption(context.args, "headed")) args.push("--headed");

  const hostSession = sessionTarget(context.args, { config: context.loaded.config.app });

  // `done`, not `resolve`: `resolve` here is `node:path`'s, used just below.
  const status = await new Promise<number>((done) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: context.root,
      stdio: "inherit",
      env: {
        ...process.env,
        SVATAH_PLAN: context.planPath!,
        SVATAH_BINDINGS: resolve(context.root, context.loaded.config.bindings.dir),
        SVATAH_RUN_ID: context.runId,
        SVATAH_OUT: context.outputDir,
        ...(inputsFrom(context.args) === undefined
          ? {}
          : { SVATAH_INPUTS: JSON.stringify(inputsFrom(context.args)) }),
        SVATAH_DATA: JSON.stringify(context.loaded.project.data.values),
        SVATAH_SECRETS: JSON.stringify([...context.loaded.project.data.secrets]),
        /*
         * The resolved session target, passed down as the environment layer of
         * LLD §15's precedence. The host reads its base URL from the config and
         * the environment, and it is a separate process, so a `--base-url` given
         * to `svatah run --host playwright` reaches it only this way. Resolving
         * first means the flag beats an inherited `SVATAH_BASE_URL`, which is
         * the order the spec gives.
         */
        ...(hostSession.baseUrl === undefined ? {} : { SVATAH_BASE_URL: hostSession.baseUrl }),
        ...(hostSession.storageState === undefined
          ? {}
          : { SVATAH_STORAGE_STATE: hostSession.storageState }),
      },
    });
    child.on("close", (code) => done(code ?? 1));
  });

  return (status === 0 ? EXIT.ok : EXIT.failed) as ExitCode;
}

/* ── the collaborators the executor is given (LLD §8, Draft 2.4) ───────────── */

export interface ProjectRunnerOptions {
  readonly baseUrl?: string;
  /** The project root, for a request body that names a file. */
  readonly cwd: string;
  readonly log?: (message: string) => void;
}

/**
 * The API and custom-step runners a project's plan needs.
 *
 * Built here rather than imported by the runtime, which is what keeps LLD §1's
 * `runtime ─► bindings, surface, schema` true: "the executor receives the
 * resolver, the custom-step runner, and the API runner as injected
 * collaborators; `runtime` imports neither `steps` nor `adapter-http`" (Draft
 * 2.4, LLD §8).
 *
 * Shared by `svatah run` and `svatah record` rather than written twice. The
 * recorder performs every step it records (REQ-REC-5), so an `api` step or a
 * Tier 0 step has to do the same thing in both — a second copy would drift, and
 * the drift would be a binding verified against behaviour a run does not repeat.
 */
export function projectRunners(
  loaded: Awaited<ReturnType<typeof loadProject>>,
  options: ProjectRunnerOptions,
): { api: ApiRunner; custom: CustomStepRunner } {
  const http = new HttpSurface({
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    cwd: options.cwd,
  });

  const api: ApiRunner = async (step, { scope }) => {
    const name = literalArg(step.args?.["request"]);
    const request = name === undefined ? undefined : loaded.project.apis.requests.get(name);
    if (request === undefined) {
      throw new Error(`No API request named "${name ?? "?"}" in ${loaded.config.api.dir}/.`);
    }
    const withSessionCookies = step.args?.["withSessionCookies"] === true;
    const response = await http.request(request, {
      withSessionCookies,
      scope: { read: (reference) => readReference(scope, reference) },
    });
    return step.capture?.jsonPath === undefined
      ? (response.json ?? response.body)
      : http.captureFromLast(step.capture.jsonPath);
  };

  const custom: CustomStepRunner = async (step, ctx) => {
    const definition = loaded.steps.all().find((one) => one.id === step.custom?.id);
    if (definition === undefined) {
      throw new Error(`No custom step ${step.custom?.id ?? "?"} in ${loaded.config.steps.dir}/.`);
    }
    const resolvedArgs: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(step.custom?.params ?? {})) {
      resolvedArgs[name] = ctx.scope.read(value);
    }
    for (const [name, target] of Object.entries(step.custom?.targets ?? {})) {
      resolvedArgs[name] = target;
    }
    await definition.handler({
      surface: ctx.surface,
      args: resolvedArgs,
      resolve: async (target) => (await ctx.resolve(target, ctx.surface)).ref,
      scope: {
        read: (reference) => ctx.scope.read(reference),
        capture: (name, value) => ctx.scope.capture(name, value),
        data: {},
        inputs: {},
      },
      expect: async () => undefined,
      audit: () => undefined,
      log: (message) => options.log?.(message),
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
  };

  return { api, custom };
}
