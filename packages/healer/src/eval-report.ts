/**
 * The healing eval's published report (REQ-HEAL-5, REQ-PKG-4).
 *
 * "Results published per release with the method." The method is not an appendix
 * — a healing percentage without one is not a number, because the population it
 * was measured on decides almost everything about it. So the report leads with
 * the method, gives the per-variant table before the total, and names the
 * variants relocalization does *not* survive rather than averaging them away.
 *
 * Draft 2.3 adds two obligations to that: recovery is verified against a
 * ground-truth key rather than assumed from a score, and *both* populations —
 * with and without test-id attributes — are reported, so the reader can see how
 * much of the number is the healer and how much is the application being easy.
 */
import type { HealingEvalReport } from "./eval.js";

/**
 * @param report      the headline population (no test ids).
 * @param comparison  the same run on the other population, reported alongside
 *                    it (LLD §16, Draft 2.3). Omitted only when a caller ran one
 *                    population deliberately; the published report has both.
 */
export function renderHealingEvalMarkdown(
  report: HealingEvalReport,
  comparison?: HealingEvalReport,
): string {
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
  if (report.usedModel) {
    lines.push(
      `**With one model call: ${percent(report.withModel)}**, against REQ-HEAL-5's ` +
        `${percent(report.modelThreshold)} threshold. ` +
        (report.meetsModelThreshold ? "Met." : "**Not met.**"),
    );
    lines.push("");
    lines.push(
      "The residue relocalization declined — `not-found` and `ambiguous` — was re-grounded " +
        `by \`${report.regrounder}\`, one call per binding and never on one relocalization ` +
        "placed (REQ-HEAL-1). A re-grounded proposal is judged by the same two tests as a " +
        "relocalized one: the ground-truth key has to match, and a candidate re-synthesised " +
        "from it has to resolve uniquely. A model's confidence buys it nothing.",
    );
  } else {
    lines.push(
      "**No model was involved at any point**: relocalization only, with the no-op " +
        "`Regrounder` (LLD §10). REQ-HEAL-5's second number — 85% with one model call — is " +
        "therefore *not measured here*, and the figure below is the relocalize-only one. " +
        "Register a `Regrounder` (a credential, and `heal.useModel`) to measure it.",
    );
  }
  lines.push("");

  lines.push("## Method");
  lines.push("");
  lines.push(report.method);
  lines.push("");
  lines.push(`Headline population: \`${report.population}\`.`);
  lines.push("");

  if (comparison !== undefined) {
    lines.push("## Both populations");
    lines.push("");
    lines.push("| Population | Bindings | Degraded | Recovered | Wrong element | Rate |");
    lines.push("|---|---|---|---|---|---|");
    for (const one of [report, comparison]) {
      lines.push(
        `| \`${one.population}\`${one === report ? " **(headline)**" : ""} | ${one.bindings} | ` +
          `${one.totals.degraded} | ${one.totals.recovered} | ${one.totals.wrongElement} | ` +
          `${one.totals.degraded === 0 ? "—" : percent(one.relocalizeOnly)} |`,
      );
    }
    lines.push("");
    lines.push(
      "`no-test-ids` is the headline because it is the harder and more representative " +
        "population: an application with a `data-testid` on every control barely needs healing " +
        "at all, so a number taken on it measures the application rather than the healer. " +
        "Both are published so the gap between them is visible rather than a choice made " +
        "quietly in the eval's own configuration.",
    );
    lines.push("");
  }

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
  if (report.usedModel) {
    lines.push(`| Recovered by one model call | ${report.totals.regrounded} |`);
  }
  lines.push(`| Not found | ${report.totals.notFound} |`);
  lines.push(`| Refused as ambiguous | ${report.totals.ambiguous} |`);
  lines.push(`| **Relocalized onto the wrong element** | **${report.totals.wrongElement}** |`);
  lines.push(`| Proposed but unverifiable | ${report.totals.unverified} |`);
  lines.push("");
  lines.push(
    report.totals.wrongElement === 0
      ? "Relocalization proposed the wrong element in no case: every proposal it made carried " +
          "the ground-truth key of the element the binding was recorded on. That is the claim " +
          "Phase 1's number could not make, because it verified only that a proposal was " +
          "findable."
      : `Relocalization proposed a **different element** in ${report.totals.wrongElement} ` +
          "case(s). Those are counted as failures, not recoveries, however confident the score " +
          "was — see the list at the end.",
  );
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
  lines.push(
    report.usedModel
      ? "| # | Change | Locators broken | Degraded | Recovered | Re-grounded | Rate |"
      : "| # | Change | Locators broken | Degraded | Recovered | Rate |",
  );
  lines.push(report.usedModel ? "|---|---|---|---|---|---|---|" : "|---|---|---|---|---|---|");
  for (const variant of report.variants) {
    lines.push(
      `| ${variant.variant} | ${variant.title} | ${variant.brokenLocators}/${variant.locatorCases} | ` +
        `${variant.degraded} | ${variant.recovered} | ` +
        (report.usedModel ? `${variant.regrounded} | ` : "") +
        `${variant.rate === null ? "—" : percent(variant.rate)} |`,
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
          `${variant.ambiguous > 0 ? `, ${variant.ambiguous} refused as ambiguous` : ""}` +
          `${variant.wrongElement > 0 ? `, ${variant.wrongElement} onto the wrong element` : ""}` +
          `${variant.unverified > 0 ? `, ${variant.unverified} unverifiable` : ""}.`,
      );
    }
    lines.push("");
  }

  /*
   * Every wrong element, individually. A rate hides these and they are the most
   * interesting cases in the report: each one is a change that made a different
   * element look more like the recorded fingerprint than the real one did.
   */
  const wrong = report.cases.filter((c) => c.outcome === "wrong-element");
  if (wrong.length > 0) {
    lines.push("## Where relocalization went to the wrong element");
    lines.push("");
    lines.push("| Variant | Binding | Expected | Proposed | Score |");
    lines.push("|---|---|---|---|---|");
    for (const one of wrong) {
      lines.push(
        `| ${one.variant} | \`${one.bindingId}\` | \`${one.expectedTruth ?? "?"}\` | ` +
          `\`${one.proposedTruth ?? "?"}\` | ${one.score ?? "—"} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** The same numbers as one line, for a terminal. */
export function renderHealingEvalSummary(report: HealingEvalReport): string {
  const relocalize =
    `healing eval [${report.population}] — relocalize-only ${(report.relocalizeOnly * 100).toFixed(1)}% ` +
    `(${report.totals.recovered}/${report.totals.degraded} degraded bindings recovered), ` +
    `threshold ${(report.threshold * 100).toFixed(0)}%: ${report.meetsThreshold ? "met" : "NOT met"}`;

  return report.usedModel
    ? `${relocalize}\n` +
      `  with one model call (${report.regrounder}) ${(report.withModel * 100).toFixed(1)}% ` +
      `(+${report.totals.regrounded} re-grounded), threshold ` +
      `${(report.modelThreshold * 100).toFixed(0)}%: ${report.meetsModelThreshold ? "met" : "NOT met"}`
    : `${relocalize}\n  no model: REQ-HEAL-5's 85% number is not measured by this run`;
}
