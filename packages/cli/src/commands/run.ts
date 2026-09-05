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
import { canonicalJson } from "@svatah/schema";
import { BindingsStore, resolve as resolveBinding } from "@svatah/bindings";
import { HttpSurface } from "@svatah/adapter-http";
import { generateSpecs } from "@svatah/host-playwright";
import {
  newRunId,
  openRunDirectory,
  run as runPlan,
  type ApiRunner,
  type CustomStepRunner,
  type Resolver,
  type RunOptions,
} from "@svatah/runtime";
import { createSurface } from "@svatah/surface";
import { boolOption, numberOption, stringOption, stringOptions, type ParsedArgs } from "../args.js";
import { registerAllAdapters } from "../adapters.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { compileProject, loadProject } from "../project.js";
import { report } from "./compile.js";
import type { CommandIo } from "./surface.js";

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
  const { loaded, plan, args } = context;
  registerAllAdapters();

  const store = BindingsStore.load(resolve(context.root, loaded.config.bindings.dir));
  const directory = openRunDirectory(context.outputDir, context.runId);

  /*
   * `SVATAH_BASE_URL` overrides the configured one. A project's config names the
   * deployment it usually runs against; a CI job, or a test that starts the
   * application on an ephemeral port, needs to say otherwise without editing it.
   */
  const baseUrl = process.env["SVATAH_BASE_URL"] ?? loaded.config.app.baseUrl;

  const config = {
    ...loaded.config,
    app: { ...loaded.config.app, ...(baseUrl === undefined ? {} : { baseUrl }) },
    run: {
      ...loaded.config.run,
      headless: !boolOption(args, "headed"),
      workers: numberOption(args, "workers") ?? loaded.config.run.workers,
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

  /*
   * The API and custom-step runners are wired in here rather than imported by
   * the runtime, which is what keeps LLD §1's `runtime ─► bindings, surface,
   * schema` true (T2.7).
   */
  const http = new HttpSurface({
    ...(config.app.baseUrl === undefined ? {} : { baseUrl: config.app.baseUrl }),
    cwd: context.root,
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
      log: (message) => io.err(`  ${message}`),
      timeoutMs: ctx.timeoutMs,
      signal: ctx.signal,
    });
  };

  const options: RunOptions = {
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
    data: loaded.project.data.values,
    secrets: loaded.project.data.secrets,
    ...(inputsFrom(args) === undefined ? {} : { inputs: inputsFrom(args)! }),
    // Repeatable: a run is often a subset of the project's flows, and naming
    // them one at a time is how a person says which.
    ...(stringOptions(args, "flow").length === 0 ? {} : { flows: stringOptions(args, "flow") }),
    ...(stringOptions(args, "story").length === 0 ? {} : { stories: stringOptions(args, "story") }),
    onResult: (result) => {
      if (boolOption(args, "json")) return;
      const mark = { passed: "✓", failed: "✗", skipped: "–", healed: "~", aborted: "!" }[result.status];
      io.err(`  ${mark} ${result.story} · ${result.text}`);
    },
  };

  const outcome = await runPlan(options);

  if (boolOption(args, "json")) io.out(JSON.stringify(outcome.summary, null, 2));
  else {
    const { totals } = outcome.summary;
    io.err(
      `\n${outcome.runId}: ${totals.passed} passed, ${totals.failed} failed, ` +
        `${totals.skipped} skipped, ${totals.aborted} aborted → ${directory.path}`,
    );
  }
  return outcome.summary.exitCode as ExitCode;
}

/**
 * `--input k=v`, repeated (LLD §15).
 *
 * A value that starts with `{` is read from the run's data or another story's
 * captures, which is how a secret is passed without putting it on a command line
 * that a process list would show.
 */
function inputsFrom(args: ParsedArgs): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const one of stringOptions(args, "input")) {
    const at = one.indexOf("=");
    if (at <= 0) continue;
    out[one.slice(0, at).trim()] = one.slice(at + 1);
  }
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
      },
    });
    child.on("close", (code) => done(code ?? 1));
  });

  return (status === 0 ? EXIT.ok : EXIT.failed) as ExitCode;
}
