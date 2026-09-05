/**
 * The heal report (REQ-HEAL-2).
 *
 * "Repairs are a diff to the bindings store plus a report." The diff is what a
 * reviewer applies; the report is what tells them whether they should. So it says
 * per element what relocalization scored, what the runner-up scored, and — for
 * everything it could not repair — why, in a sentence, rather than leaving a
 * reviewer to infer it from a missing row.
 */
import type { HealReport } from "./heal.js";

/** A plain-text report for a terminal. */
export function renderHealReport(report: HealReport): string {
  const lines: string[] = [];
  lines.push(
    `Heal — ${report.inputs} locator failure${report.inputs === 1 ? "" : "s"} from ${report.bindingsDir}`,
  );
  lines.push("");

  if (report.results.length === 0) {
    lines.push("  Nothing to repair.");
    return lines.join("\n");
  }

  const width = Math.max(...report.results.map((r) => r.id.length));
  for (const result of report.results) {
    const mark =
      result.outcome === "repaired" || result.outcome === "regrounded" ? "ok  " : "----";
    const score = result.score === undefined ? "" : `  ${result.score.toFixed(3)}`;
    const runnerUp = result.runnerUpScore === undefined ? "" : ` (runner-up ${result.runnerUpScore.toFixed(3)})`;
    lines.push(`  ${mark}  ${result.id.padEnd(width)}  ${result.outcome}${score}${runnerUp}`);
    if (result.candidates !== undefined) {
      lines.push(`          now: ${result.candidates.join(", ")}`);
    }
    if (result.message !== undefined) lines.push(`          ${result.message}`);
  }

  lines.push("");
  lines.push(
    `  ${report.totals.repaired} repaired by relocalization, ` +
      `${report.totals.regrounded} re-grounded, ${report.totals.unrepaired} unrepaired.`,
  );
  if (!report.usedModel) {
    lines.push(
      "  No model was used: relocalization only, with the no-op Regrounder (LLD §10). " +
        "The unrepaired are reported, not dropped.",
    );
  }
  return lines.join("\n");
}

/** A Markdown report, for a pull request or the release notes (REQ-PKG-4). */
export function renderHealMarkdown(report: HealReport): string {
  const lines: string[] = [];
  lines.push("# Heal report");
  lines.push("");
  lines.push(`Run at ${report.at} · bindings in \`${report.bindingsDir}\``);
  lines.push("");
  lines.push(
    `**${report.totals.repaired} repaired**, ${report.totals.regrounded} re-grounded, ` +
      `${report.totals.unrepaired} unrepaired, out of ${report.inputs} locator failures.`,
  );
  lines.push("");
  lines.push(
    report.usedModel
      ? `Re-grounding used \`${report.regrounder}\`.`
      : "Relocalization only — no model was involved (LLD §10, the no-op `Regrounder`).",
  );
  lines.push("");
  lines.push("| Element | Outcome | Score | Runner-up | Candidates after |");
  lines.push("|---|---|---|---|---|");
  for (const result of report.results) {
    lines.push(
      `| \`${result.id}\` | ${result.outcome} | ${result.score?.toFixed(3) ?? "—"} | ` +
        `${result.runnerUpScore?.toFixed(3) ?? "—"} | ${result.candidates?.join(", ") ?? "—"} |`,
    );
  }

  const unrepaired = report.results.filter(
    (r) => r.outcome !== "repaired" && r.outcome !== "regrounded",
  );
  if (unrepaired.length > 0) {
    lines.push("");
    lines.push("## Not repaired");
    lines.push("");
    for (const result of unrepaired) {
      lines.push(`- \`${result.id}\` — ${result.message ?? result.outcome}`);
    }
  }

  if (report.diff !== "") {
    lines.push("");
    lines.push("## The diff");
    lines.push("");
    lines.push("Apply it with `git apply`:");
    lines.push("");
    lines.push("```diff");
    lines.push(report.diff.trimEnd());
    lines.push("```");
  }
  lines.push("");
  return lines.join("\n");
}
