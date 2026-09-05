/**
 * The healing eval's published report (REQ-HEAL-5, REQ-PKG-4).
 *
 * "Results published per release with the method." The method is not an appendix
 * — a healing percentage without one is not a number, because the population it
 * was measured on decides almost everything about it. So the report leads with
 * the method, gives the per-variant table before the total, and names the
 * variants relocalization does *not* survive rather than averaging them away.
 */
import type { HealingEvalReport } from "./eval.js";

export function renderHealingEvalMarkdown(report: HealingEvalReport): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const lines: string[] = [];

  lines.push("# Svatah eval report — healing");
  lines.push("");
  lines.push(`Generated: ${report.at}`);
  lines.push("");
  lines.push(
    report.meetsThreshold
      ? `**Relocalize-only recovery: ${percent(report.relocalizeOnly)}**, against REQ-HEAL-5's ` +
          `${percent(report.threshold)} threshold. Met.`
      : `**Relocalize-only recovery: ${percent(report.relocalizeOnly)}**, against REQ-HEAL-5's ` +
          `${percent(report.threshold)} threshold. **Not met.**`,
  );
  lines.push("");
  lines.push(
    report.usedModel
      ? "A model was used for the residue relocalization could not place."
      : "No model was involved at any point: relocalization only, with the no-op `Regrounder` " +
          "(LLD §10). The model half of REQ-HEAL-5 arrives in Phase 3.",
  );
  lines.push("");

  lines.push("## Method");
  lines.push("");
  lines.push(report.method);
  lines.push("");
  lines.push(`Population: \`${report.population}\`.`);
  lines.push("");

  lines.push("## What was measured");
  lines.push("");
  lines.push("| | Count |");
  lines.push("|---|---|");
  lines.push(`| Bindings recorded at variant 0 | ${report.bindings} |`);
  lines.push(`| Locator cases examined (candidate × variant) | ${report.totals.locatorCases} |`);
  lines.push(`| Locators broken | ${report.totals.brokenLocators} |`);
  lines.push(`| Bindings that stopped resolving entirely | ${report.totals.unresolvable} |`);
  lines.push(`| **Bindings degraded — the cases below** | **${report.totals.degraded}** |`);
  lines.push(`| Recovered by relocalization | ${report.totals.recovered} |`);
  lines.push(`| Not found | ${report.totals.notFound} |`);
  lines.push(`| Refused as ambiguous | ${report.totals.ambiguous} |`);
  lines.push(`| Proposed but unverifiable | ${report.totals.wrongElement} |`);
  lines.push("");

  if (report.totals.unresolvable === 0 && report.totals.brokenLocators > 0) {
    lines.push(
      "> No binding stopped resolving on any variant. A synthesised bundle carries five to " +
        "eight independent candidates and a single-property change rarely takes them all, so " +
        "the recovery rate above is measured over bindings that *degraded* — lost a candidate " +
        "and with it their redundancy — rather than over bindings that failed outright. That " +
        "distinction is the honest one; see the method.",
    );
    lines.push("");
  }

  lines.push("## By variant");
  lines.push("");
  lines.push("| # | Change | Locators broken | Degraded | Recovered | Rate |");
  lines.push("|---|---|---|---|---|---|");
  for (const variant of report.variants) {
    lines.push(
      `| ${variant.variant} | ${variant.title} | ${variant.brokenLocators}/${variant.locatorCases} | ` +
        `${variant.degraded} | ${variant.recovered} | ${variant.rate === null ? "—" : percent(variant.rate)} |`,
    );
  }
  lines.push("");
  lines.push("A rate of `—` means the variant degraded no binding: every candidate it could have");
  lines.push("invalidated still identified its element.");
  lines.push("");

  const kinds = Object.entries(report.brokenByKind);
  if (kinds.length > 0) {
    lines.push("## Which candidate kinds broke");
    lines.push("");
    lines.push("| Kind | Times broken |");
    lines.push("|---|---|");
    for (const [kind, count] of kinds) lines.push(`| \`${kind}\` | ${count} |`);
    lines.push("");
    lines.push("This is the ranking in T1.4 being justified or not: a kind near the top of the");
    lines.push("bundle that breaks often is ranked too high.");
    lines.push("");
  }

  const failing = report.variants.filter((v) => v.rate !== null && v.rate < 1);
  if (failing.length > 0) {
    lines.push("## What relocalization does not survive");
    lines.push("");
    for (const variant of failing) {
      lines.push(
        `- **Variant ${variant.variant} — ${variant.title}**: ${variant.recovered} of ` +
          `${variant.degraded} recovered` +
          `${variant.notFound > 0 ? `, ${variant.notFound} not found` : ""}` +
          `${variant.ambiguous > 0 ? `, ${variant.ambiguous} refused as ambiguous` : ""}.`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** The same numbers as one line, for a terminal. */
export function renderHealingEvalSummary(report: HealingEvalReport): string {
  return (
    `healing eval — relocalize-only ${(report.relocalizeOnly * 100).toFixed(1)}% ` +
    `(${report.totals.recovered}/${report.totals.degraded} degraded bindings recovered), ` +
    `threshold ${(report.threshold * 100).toFixed(0)}%: ${report.meetsThreshold ? "met" : "NOT met"}`
  );
}
