/**
 * `yam eval <suite>` (LLD §15, §16, REQ-PKG-4).
 *
 * "`yam eval <suite> --report <path>` writes a Markdown report that the
 * release workflow attaches to release notes."
 *
 * Phase 1 makes one suite runnable: `healing`, relocalize-only (T1.8). The
 * others name the task that builds them rather than pretending to be empty.
 *
 * The exit code is the gate: non-zero when the suite is below its threshold, so
 * a release cannot quietly ship a number nobody looked at. The report is written
 * either way — a threshold that is missed is the case where the report matters
 * most (REQ-HEAL-5: "publish anyway", HLD §14).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  renderHealingEvalMarkdown,
  renderHealingEvalSummary,
  runHealingEval,
  clearRegrounder,
} from "@svatah/yam-healer";
import type { AgentSurface } from "@svatah/yam-surface";
import { createSurface, listAdapters } from "@svatah/yam-surface";
import { DEFAULT_CONFIG, DEFAULT_IGNORE_ATTRIBUTES, type Config } from "@svatah/yam-schema";
import { registerAllAdapters } from "../adapters.js";
import { boolOption, stringOption, type ParsedArgs } from "../args.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { sessionTarget } from "../session.js";
import type { CommandIo } from "./surface.js";

/** Suites LLD §16 names, and the task that makes each runnable. */
const LATER: Record<string, string> = {
  compiler: "T4.4",
  grounding: "T3.4",
  conformance: "T1.2 (run it with `yam surface conform --adapter <name>`)",
};

/** The sample pages the eval records on. */
const PAGES = [
  "/",
  "/login",
  "/dashboard",
  "/schedule-build",
  "/booking",
  "/checkout",
  "/widgets",
  "/logout",
];

export async function evalCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const suite = args.command[1];
  if (suite === undefined) {
    io.err("`eval` needs a suite: healing, grounding, compiler or conformance.");
    return EXIT.usage;
  }
  if (suite !== "healing") {
    const task = LATER[suite];
    io.err(
      task === undefined
        ? `Unknown eval suite "${suite}". Phase 1 makes "healing" runnable.`
        : `The "${suite}" suite is not runnable yet; it arrives with ${task}.`,
    );
    return EXIT.usage;
  }
  return await healing(args, io);
}

/**
 * Read an element's ground-truth key without going through the surface
 * (LLD §16, Draft 2.3).
 *
 * `bindings.ignoreAttributes` makes the surface blind to this attribute on
 * purpose, so the eval asks the adapter for a page script instead. An adapter
 * that has no such affordance returns nothing and every case is reported as
 * `unverified` — the eval never assumes an answer it could not check.
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

async function healing(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  // Flag, then `YAM_BASE_URL`, then `config.app`, then the sample app's
  // port (LLD §15, Draft 2.5).
  const target = sessionTarget(args, {
    root: stringOption(args, "project") ?? ".",
    fallbackBaseUrl: "http://127.0.0.1:4173",
  });
  const baseUrl = target.baseUrl!;
  const adapter = stringOption(args, "adapter") ?? "playwright";
  const reportPath = stringOption(args, "report");
  const json = boolOption(args, "json");
  /**
   * REQ-HEAL-5 as amended asks for both populations. `--population` runs one on
   * its own, which is what a verifier reproducing a single number wants; the
   * default runs both and publishes them side by side.
   */
  const only = stringOption(args, "population");
  const groundTruthAttribute =
    stringOption(args, "ground-truth-attribute") ?? DEFAULT_IGNORE_ATTRIBUTES[0]!;

  // `--no-model` is the only mode Phase 1 has, and passing it is how a caller
  // says so out loud. Module (a) ships the no-op `Regrounder`; clearing it makes
  // the run relocalization-only even if something registered one.
  if (boolOption(args, "no-model", true)) clearRegrounder();

  registerAllAdapters();
  if (!listAdapters().includes(adapter)) {
    io.err(`No adapter registered under "${adapter}". Registered: ${listAdapters().join(", ")}.`);
    return EXIT.usage;
  }

  const variants = await loadVariants(baseUrl, io);
  if (variants === null) return EXIT.failed;

  const headless = !boolOption(args, "headed");
  const groundTruth = groundTruthReader(groundTruthAttribute);

  const runPopulation = async (withTestIds: boolean) => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      project: "healing-eval",
      adapter: adapter as Config["adapter"],
      app: { ...target },
      bindings: {
        ...DEFAULT_CONFIG.bindings,
        // The headline population is "an application with no test ids" — see the
        // method in `@svatah/yam-healer`. The adapter has none either, so its CSS and
        // XPath paths are not anchored on one.
        testIdAttributes: withTestIds ? DEFAULT_CONFIG.bindings.testIdAttributes : [],
        // Never negotiable, in either population: the ground-truth label must
        // stay invisible to everything that could bind to it (LLD §16).
        ignoreAttributes: [groundTruthAttribute],
      },
      run: { ...DEFAULT_CONFIG.run, headless, stepTimeoutMs: 5_000 },
    };

    io.err(`population ${withTestIds ? "with-test-ids" : "no-test-ids"}`);
    return await runHealingEval({
      pages: PAGES,
      variants,
      withTestIds,
      groundTruth,
      open: async (page, variant) => {
        const surface = await createSurface(config);
        await surface.open({ ...target });
        await surface.act("navigate", undefined, {
          url: variant === 0 ? `${baseUrl}${page}` : `${baseUrl}${page}?variant=${variant}`,
        });
        return surface;
      },
      onProgress: (message) => io.err(`  ${message}`),
    });
  };

  /*
   * The headline number is always the no-test-ids population (REQ-HEAL-5 as
   * amended: "both populations are reported"). `--population with-test-ids`
   * makes that one the headline instead, which is how a verifier reproduces the
   * second row on its own; `--population no-test-ids` skips the comparison run.
   */
  const headlineWithTestIds = only === "with-test-ids";
  const report = await runPopulation(headlineWithTestIds);
  const comparison = only === undefined ? await runPopulation(!headlineWithTestIds) : undefined;

  const markdown = renderHealingEvalMarkdown(report, comparison);
  if (reportPath !== undefined) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, markdown, "utf8");
    io.err(`wrote ${reportPath}`);
  }

  io.out(json ? JSON.stringify({ report, comparison }, null, 2) : markdown);
  io.err(`\n${renderHealingEvalSummary(report)}`);
  if (comparison !== undefined) io.err(renderHealingEvalSummary(comparison));

  // The gate. The report has already been written and printed, so a number below
  // the threshold is published and *then* fails (REQ-HEAL-5, HLD §14: "publish
  // anyway; relocalization thresholds are the honest signal"). Only the headline
  // population gates: the easier one is context, not a second bar to clear.
  return report.meetsThreshold ? EXIT.ok : EXIT.failed;
}

/**
 * The variants, read from the sample application itself.
 *
 * `GET /api/variants` is what the application publishes about its own deliberate
 * changes, so the eval and `VARIANTS.md` cannot drift apart, and the suite runs
 * against any deployment of it rather than only against this checkout.
 */
async function loadVariants(
  baseUrl: string,
  io: CommandIo,
): Promise<Array<{ id: number; title: string; pages: string[] }> | null> {
  try {
    const response = await fetch(`${baseUrl}/api/variants`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as Array<{ id: number; title: string; pages: string[] }>;
  } catch (error) {
    io.err(
      `Could not read ${baseUrl}/api/variants: ${error instanceof Error ? error.message : String(error)}\n` +
        "Start the sample application first (`pnpm --filter sample-web start`), or point " +
        "--base-url at a deployment of it.",
    );
    return null;
  }
}
