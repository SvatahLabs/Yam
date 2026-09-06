/**
 * `yam eval grounding` (T3.4, REQ-REC-10, REQ-PKG-4, LLD §15, §16).
 *
 * ```
 * yam eval grounding [--base-url <url>] [--cases <path.jsonl>]
 *                       [--gateway anthropic|fake] [--cache <dir>]
 *                       [--report <path.md>] [--limit <n>] [--json]
 * ```
 *
 * The other suites stay where they are: `eval healing` is module (a)'s and runs
 * from `@svatah/yam-bindings-cli`, so a plain Playwright user has it without the flow
 * language. This one needs a model gateway and the recorder, so it is module
 * (b)'s and lives here — in `eval-grounding.ts`, not `eval.ts`, because
 * `commands/eval.ts` moved to `bindings-cli` in T2.12 and a file back under that
 * name would read like it moved home again.
 *
 * Exit is the gate: non-zero below the threshold, so a release cannot quietly
 * ship a number nobody looked at. The report is written either way — a threshold
 * that is missed is when the report matters most.
 *
 * ## Two gateways, two different claims
 *
 * With a credential this measures grounding. With `--gateway fake` it measures
 * the *harness*: the answers come from the committed cases themselves, so a
 * perfect score says the eval opens every page, grounds every phrase and checks
 * every answer against the ground-truth key, and says nothing at all about a
 * model. The report leads with which one produced it, and the fake run is
 * explicitly not REQ-REC-10's number.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalJson, DEFAULT_CONFIG, DEFAULT_IGNORE_ATTRIBUTES, type Config } from "@svatah/yam-schema";
import {
  anthropicGateway,
  credentialInEnvironment,
  DiskCache,
  fakeGateway,
  type Gateway,
} from "@svatah/yam-gateway";
import {
  GROUNDING_THRESHOLD,
  renderGroundingEvalMarkdown,
  renderGroundingEvalSummary,
  runGroundingEval,
} from "@svatah/yam-recorder";
import type { AgentSurface } from "@svatah/yam-surface";
import { createSurface } from "@svatah/yam-surface";
import {
  boolOption,
  numberOption,
  stringOption,
  EXIT,
  type CommandIo,
  type ExitCode,
  sessionTarget,
  type ParsedArgs,
} from "@svatah/yam-bindings-cli";
import { registerAllAdapters } from "../adapters.js";
import { groundingAnswers, readCases } from "../grounding-answers.js";

export async function groundingEvalCommand(
  args: ParsedArgs,
  io: CommandIo,
): Promise<ExitCode> {
  // Flag, then `YAM_BASE_URL`, then `config.app`, then the sample app's
  // port (LLD §15, Draft 2.5).
  const target = sessionTarget(args, {
    root: stringOption(args, "project") ?? ".",
    fallbackBaseUrl: "http://127.0.0.1:4173",
  });
  const baseUrl = target.baseUrl!;
  const casesPath = stringOption(args, "cases");
  const limit = numberOption(args, "limit");
  const json = boolOption(args, "json");
  const reportPath = stringOption(args, "report");

  /*
   * The web cases only (T11.3).
   *
   * `readCases` reads the file it is given; the desktop set
   * (`desktop-cases.jsonl`) is keyed on a window title rather than a page and
   * is driven by launching an application, not by navigating to a URL. This
   * eval opens `apps/sample-web` at `${baseUrl}${page}`, so a case with no page
   * is a case it has nowhere to take. `yam eval self` is where the desktop
   * cases are measured (T11.5).
   */
  const all = readCases(casesPath).filter(
    (one): one is typeof one & { page: string } => typeof one.page === "string",
  );
  if (all.length === 0) {
    io.err(
      `No cases in ${casesPath ?? "evals/grounding/cases.jsonl"}. ` +
        "Run `node scripts/grounding-cases.mjs` to build them.",
    );
    return EXIT.usage;
  }
  const cases = limit === undefined ? all : all.slice(0, limit);

  const gateway = gatewayFor(args, casesPath, io);
  if (gateway === undefined) return EXIT.modelUnavailable;

  registerAllAdapters();

  const ignoreAttributes = [
    stringOption(args, "ground-truth-attribute") ?? DEFAULT_IGNORE_ATTRIBUTES[0]!,
  ];
  const config: Config = {
    ...DEFAULT_CONFIG,
    project: "grounding-eval",
    adapter: "playwright",
    app: { ...target },
    bindings: { ...DEFAULT_CONFIG.bindings, ignoreAttributes },
    run: { ...DEFAULT_CONFIG.run, headless: !boolOption(args, "headed") },
  };

  const report = await runGroundingEval({
    cases,
    gateway,
    open: async (page, variant) => {
      const surface = await createSurface(config);
      await surface.open({ ...target });
      await surface.act("navigate", undefined, {
        url: `${baseUrl}${page}${variant === 0 ? "" : `?variant=${variant}`}`,
      });
      return surface;
    },
    grounding: {
      maxSnapshotTokens: DEFAULT_CONFIG.record.maxSnapshotTokens,
      testIdAttributes: DEFAULT_CONFIG.bindings.testIdAttributes,
      ignoreAttributes,
    },
    groundTruth: groundTruthReader(ignoreAttributes[0]!),
    onProgress: (message) => {
      if (!json) io.err(`  ${message}`);
    },
  });

  if (reportPath !== undefined) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, renderGroundingEvalMarkdown(report), "utf8");
    io.err(`wrote ${reportPath}`);
  }

  io.out(json ? canonicalJson(report) : renderGroundingEvalSummary(report));
  return report.met ? EXIT.ok : EXIT.failed;
}

/**
 * Read an element's ground-truth key without going through the surface
 * (LLD §16, Draft 2.3).
 *
 * The same reader `eval healing` uses, for the same reason: the surface is blind
 * to this attribute on purpose, so the eval asks the adapter for a page script.
 * An adapter with no such affordance returns nothing and every case is
 * `unchecked` — the eval never assumes an answer it could not check.
 */
function groundTruthReader(
  attribute: string,
): (surface: AgentSurface, ref: string) => Promise<string | undefined> {
  return async (surface, ref) => {
    const raw = surface as unknown as {
      readRawAttribute?: (ref: string, attribute: string) => Promise<string | undefined>;
    };
    if (typeof raw.readRawAttribute !== "function") return undefined;
    return await raw.readRawAttribute(ref, attribute);
  };
}

function gatewayFor(
  args: ParsedArgs,
  casesPath: string | undefined,
  io: CommandIo,
): Gateway | undefined {
  const asked = stringOption(args, "gateway") ?? (credentialInEnvironment() ? "anthropic" : "");

  if (asked === "fake") {
    const answers = groundingAnswers(casesPath);
    io.err(
      "running against the fake gateway: this measures the harness, not grounding, " +
        "and the report says so.",
    );
    return fakeGateway({
      label: "grounding-cases",
      answer: (request) =>
        answers.answer(request.user) ?? {
          ref: null,
          why: "no committed case covers this phrase on this page",
          confidence: 1,
        },
    });
  }

  const cache = stringOption(args, "cache");

  /*
   * A cache is a credential-free way to re-run a real measurement.
   *
   * `--cache evals/grounding/cache` against answers a scheduled run committed
   * replays the model's own decisions at no cost, which is what makes it
   * sensible for pull-request CI to check that a change to the prompt, the
   * pruning or the sample pages did not move the number. The SDK client is
   * constructed lazily, so a run that hits on every case never needs one; a miss
   * raises `GatewayUnavailable`, which is the honest failure — a case the cache
   * does not cover has not been measured.
   */
  if (asked !== "anthropic" && cache === undefined) {
    io.err(
      "The grounding eval needs a model. Set ANTHROPIC_API_KEY (or run `ant auth login`), " +
        "pass --cache <dir> to replay answers a previous real run committed, or pass " +
        "--gateway fake to check the harness — which measures the harness and not grounding, " +
        "and the report will say so.",
    );
    return undefined;
  }

  if (asked !== "anthropic") {
    io.err(
      `replaying cached answers from ${cache!}: any case the cache does not cover will fail ` +
        "rather than be quietly skipped.",
    );
  }

  return anthropicGateway({
    model: DEFAULT_CONFIG.record.model,
    cache: new DiskCache(cache ?? ".yam/model-cache"),
    onCall: (line) => {
      if (!boolOption(args, "json")) io.err(`      ${line}`);
    },
  });
}

export { GROUNDING_THRESHOLD };
