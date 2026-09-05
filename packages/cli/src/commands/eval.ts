/**
 * `svatah eval <suite>` (LLD §15, §16, REQ-PKG-4).
 *
 * "`svatah eval <suite> --report <path>` writes a Markdown report that the
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
} from "@svatah/healer";
import { createSurface, listAdapters } from "@svatah/surface";
import { DEFAULT_CONFIG, type Config } from "@svatah/schema";
import { registerAllAdapters } from "../adapters.js";
import { boolOption, stringOption, type ParsedArgs } from "../args.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import type { CommandIo } from "./surface.js";

/** Suites LLD §16 names, and the task that makes each runnable. */
const LATER: Record<string, string> = {
  compiler: "T4.4",
  grounding: "T3.4",
  conformance: "T1.2 (run it with `svatah surface conform --adapter <name>`)",
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

async function healing(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const baseUrl = (stringOption(args, "base-url") ?? "http://127.0.0.1:4173").replace(/\/+$/, "");
  const adapter = stringOption(args, "adapter") ?? "playwright";
  const reportPath = stringOption(args, "report");
  const json = boolOption(args, "json");
  const withTestIds = boolOption(args, "with-test-ids");

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

  const config: Config = {
    ...DEFAULT_CONFIG,
    project: "healing-eval",
    adapter: adapter as Config["adapter"],
    app: { baseUrl },
    bindings: {
      ...DEFAULT_CONFIG.bindings,
      // The population is "an application with no test ids" — see the method in
      // `@svatah/healer`. The adapter has none either, so its CSS and XPath paths
      // are not anchored on one.
      testIdAttributes: withTestIds ? DEFAULT_CONFIG.bindings.testIdAttributes : [],
    },
    run: { ...DEFAULT_CONFIG.run, headless: !boolOption(args, "headed"), stepTimeoutMs: 5_000 },
  };

  const report = await runHealingEval({
    pages: PAGES,
    variants,
    withTestIds,
    open: async (page, variant) => {
      const surface = await createSurface(config);
      await surface.open({ baseUrl });
      await surface.act("navigate", undefined, {
        url: variant === 0 ? `${baseUrl}${page}` : `${baseUrl}${page}?variant=${variant}`,
      });
      return surface;
    },
    onProgress: (message) => io.err(`  ${message}`),
  });

  const markdown = renderHealingEvalMarkdown(report);
  if (reportPath !== undefined) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, markdown, "utf8");
    io.err(`wrote ${reportPath}`);
  }

  io.out(json ? JSON.stringify(report, null, 2) : markdown);
  io.err(`\n${renderHealingEvalSummary(report)}`);

  // The gate. The report has already been written and printed, so a number below
  // the threshold is published and *then* fails (REQ-HEAL-5, HLD §14: "publish
  // anyway; relocalization thresholds are the honest signal").
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
