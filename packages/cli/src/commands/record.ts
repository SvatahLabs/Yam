/**
 * `svatah record` (T3.3, REQ-REC-1, 5, 8, 9, REQ-AGT-1, REQ-AUTO-7, LLD §15).
 *
 * ```
 * svatah record [dir] [--flow f] [--story s] [--rebind] [--headed]
 *               [--force-production] [--gateway anthropic|fake] [--json]
 * ```
 *
 * Exit codes are LLD §15's: `0`, `4` grounding failed, `5` an expectation failed
 * while recording, `10` refused by the environment policy.
 *
 * ## The gateway is chosen here, and named in the report
 *
 * With a credential it is Claude Opus 5 through the Anthropic SDK, with a disk
 * cache so a second recording of a mostly-unchanged flow pays for the steps that
 * changed. Without one, `--gateway fake` reads answers from the grounding eval's
 * cases, which is how the whole contract stays green on a clean checkout with no
 * credential — and the report says which produced it, because "recorded with a
 * model" and "recorded from a fixture" are different claims (REQ-PKG-4).
 *
 * A recording with no credential and no `--gateway fake` is refused rather than
 * silently downgraded: a store recorded from fixtures that a person believes was
 * recorded from the application is exactly the failure this project exists to
 * prevent.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalJson } from "@svatah/schema";
import {
  anthropicGateway,
  credentialInEnvironment,
  DiskCache,
  fakeGateway,
  GatewayUnavailable,
  type Gateway,
} from "@svatah/gateway";
import { EnvironmentRefused, record, renderReport, reportJson } from "@svatah/recorder";
import { createSurface } from "@svatah/surface";
import {
  boolOption,
  stringOption,
  stringOptions,
  EXIT,
  type CommandIo,
  type ExitCode,
  type ParsedArgs,
} from "@svatah/bindings-cli";
import { registerAllAdapters } from "../adapters.js";
import { compileProject, loadProject } from "../project.js";
import { report as reportDiagnostics } from "./compile.js";
import { loadBindings, projectRunners } from "./run.js";
import { groundingAnswers } from "../grounding-answers.js";

export async function recordCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = args.command[1] ?? ".";
  const loaded = await loadProject(root);
  const compiled = compileProject(loaded, { stable: true });
  const diagnostics = [...loaded.diagnostics, ...compiled.diagnostics];

  if (diagnostics.some((d) => d.severity === "error")) {
    reportDiagnostics(diagnostics, io);
    io.err("The project does not compile, so there is nothing to record.");
    return EXIT.compileErrors;
  }

  /*
   * Refused before a browser starts (REQ-AUTO-7).
   *
   * Recording performs every step it records: it books the booking. The check is
   * `ground()`'s too, but doing it here means the refusal costs nothing and
   * reads as a decision rather than as a crash three steps in.
   */
  const forceProduction = boolOption(args, "force-production");
  if (loaded.config.environment === "production" && !forceProduction) {
    io.err(new EnvironmentRefused(loaded.config.environment).message);
    return EXIT.refused;
  }

  const store = loadBindings(loaded);

  let gateway: Gateway;
  try {
    gateway = gatewayFor(args, loaded, io);
  } catch (error) {
    if (error instanceof GatewayUnavailable) {
      io.err(error.message);
      return EXIT.modelUnavailable;
    }
    throw error;
  }

  registerAllAdapters();

  const baseUrl = process.env["SVATAH_BASE_URL"] ?? loaded.config.app.baseUrl;
  const config = {
    ...loaded.config,
    app: { ...loaded.config.app, ...(baseUrl === undefined ? {} : { baseUrl }) },
    run: { ...loaded.config.run, headless: !boolOption(args, "headed") },
  };

  const surface = await createSurface(config);
  await surface.open({
    ...(config.app.baseUrl === undefined ? {} : { baseUrl: config.app.baseUrl }),
    ...(config.app.storageState === undefined ? {} : { storageState: config.app.storageState }),
  });
  // The same flow-start navigation the executor performs (LLD §8, Draft 2.4):
  // a session is not a page, and every legacy flow begins by clicking something
  // on the home page.
  if (config.app.baseUrl !== undefined && surface.kind === "web") {
    await surface.act("navigate", undefined, { url: config.app.baseUrl });
  }

  const screenshotDir = resolve(loaded.root, ".svatah", "record");
  mkdirSync(screenshotDir, { recursive: true });
  let shot = 0;

  const { api, custom } = projectRunners(loaded, {
    ...(config.app.baseUrl === undefined ? {} : { baseUrl: config.app.baseUrl }),
    cwd: loaded.root,
    log: (message) => io.err(`  ${message}`),
  });

  try {
    const outcome = await record({
      plan: compiled.plan,
      surface,
      store,
      gateway,
      rebind: boolOption(args, "rebind"),
      ...(stringOptions(args, "flow").length === 0
        ? {}
        : { flows: stringOptions(args, "flow") }),
      ...(stringOptions(args, "story").length === 0
        ? {}
        : { stories: stringOptions(args, "story") }),
      ...(inputsFrom(args) === undefined ? {} : { inputs: inputsFrom(args)! }),
      data: loaded.project.data.values,
      secrets: loaded.project.data.secrets,
      api,
      custom,
      stepTimeoutMs: config.run.stepTimeoutMs,
      candidateTimeoutMs: config.run.candidateTimeoutMs,
      grounding: {
        maxSnapshotTokens: config.record.maxSnapshotTokens,
        visionFallback: config.record.visionFallback,
        environment: config.environment,
        forceProduction,
        testIdAttributes: config.bindings.testIdAttributes,
        ...(config.bindings.ignoreAttributes === undefined
          ? {}
          : { ignoreAttributes: config.bindings.ignoreAttributes }),
        ...(config.bindings.matchHost === undefined
          ? {}
          : { matchHost: config.bindings.matchHost }),
        screenshotPath: () => join(screenshotDir, `vision-${(shot += 1)}.png`),
        readScreenshot: async (path) => {
          const { readFile } = await import("node:fs/promises");
          return { mediaType: "image/png", base64: (await readFile(path)).toString("base64") };
        },
      },
      onStep: (step) => {
        if (boolOption(args, "json")) return;
        const mark = step.status === "passed" ? "✓" : step.status === "failed" ? "✗" : "–";
        io.err(`  ${mark} ${step.story} · ${step.text}`);
      },
      log: (message) => {
        if (!boolOption(args, "json")) io.err(`      ${message}`);
      },
    });

    const path = join(loaded.root, "record-report.json");
    writeFileSync(path, reportJson(outcome), "utf8");
    io.err(`wrote ${path}`);

    io.out(boolOption(args, "json") ? canonicalJson(outcome) : renderReport(outcome));

    if (outcome.complete) return EXIT.ok;

    /*
     * Grounding failed and an expectation failed are different answers, and CI
     * scripts branch on them (LLD §15: 4 and 5).
     *
     * Read from the step that stopped the session, by what went wrong on it: a
     * target that could not be found — whether the model declined it or an
     * existing binding stopped resolving — is `locator`, which is the grounding
     * answer. Everything else is the application not doing what the flow said it
     * would, which is the expectation answer.
     */
    const stopped = outcome.steps.at(-1);
    const groundingFailed =
      (stopped?.decision !== undefined && stopped.decision.outcome !== "grounded") ||
      stopped?.failure?.class === "locator";
    return groundingFailed ? EXIT.groundingFailed : EXIT.expectationFailed;
  } finally {
    await surface.close().catch(() => undefined);
  }
}

/**
 * Which gateway records this session.
 *
 * `--gateway fake` is offered because the contract has to be runnable with no
 * credential, and because the grounding eval's committed cases are a real,
 * reviewable set of answers for the sample application. It is never the silent
 * default: a store recorded from fixtures that a person believes came from a
 * model is the failure mode worth an extra flag.
 */
function gatewayFor(
  args: ParsedArgs,
  loaded: Awaited<ReturnType<typeof loadProject>>,
  io: CommandIo,
): Gateway {
  const asked = stringOption(args, "gateway") ?? (credentialInEnvironment() ? "anthropic" : "");

  if (asked === "fake") {
    const answers = groundingAnswers();
    io.err(
      `recording with the fake gateway: ${answers.size} answer(s) from evals/grounding/cases. ` +
        "Nothing here measures a model.",
    );
    return fakeGateway({
      label: "grounding-cases",
      secrets: valuesOf(loaded.project.data.values, loaded.project.data.secrets),
      answer: (request) =>
        answers.answer(request.user) ?? {
          ref: null,
          why: "no committed case covers this phrase on this page",
          confidence: 1,
        },
    });
  }

  if (asked !== "anthropic") {
    throw new GatewayUnavailable(
      "Recording needs a model. Set ANTHROPIC_API_KEY (or run `ant auth login`), or pass " +
        "--gateway fake to record from the grounding eval's committed answers — which is a " +
        "fixture, not a model, and the report will say so.",
    );
  }

  return anthropicGateway({
    model: loaded.config.record.model,
    cache: new DiskCache(join(loaded.root, ".svatah", "model-cache")),
    secrets: valuesOf(loaded.project.data.values, loaded.project.data.secrets),
    onCall: (line) => io.err(`      ${line}`),
  });
}

/** The *values* behind the declared secret paths (REQ-NFR-6 redacts by value). */
function valuesOf(
  data: Readonly<Record<string, unknown>>,
  secrets: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const path of secrets) {
    let cursor: unknown = data;
    for (const segment of path.split(".")) {
      if (typeof cursor !== "object" || cursor === null) {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    if (typeof cursor === "string" && cursor.length >= 4) out.add(cursor);
  }
  return out;
}

/** `--input k=v`, repeated. The same shape `svatah run` takes. */
function inputsFrom(args: ParsedArgs): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const one of stringOptions(args, "input")) {
    const at = one.indexOf("=");
    if (at <= 0) continue;
    out[one.slice(0, at).trim()] = one.slice(at + 1);
  }
  return Object.keys(out).length === 0 ? undefined : out;
}
