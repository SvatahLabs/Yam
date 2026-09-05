/**
 * Rendering a conformance report (REQ-STD-2).
 *
 * The suite is published and runnable by third parties, so a failing adapter has
 * to be told what went wrong without reading the suite's source: every failed
 * check names the case, the expectation and the observation.
 */
import type { ConformanceReport } from "./types.js";

function truncate(value: unknown, max = 160): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "undefined";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** A plain-text report for a terminal. */
export function renderReport(report: ConformanceReport): string {
  const lines: string[] = [];
  lines.push(`Surface conformance — adapter "${report.adapter}"`);
  lines.push("");

  let page = "";
  for (const one of report.cases) {
    if (one.page !== page) {
      page = one.page;
      lines.push(`  ${page}`);
    }
    const mark = one.status === "passed" ? "ok  " : one.status === "skipped" ? "skip" : "FAIL";
    lines.push(`    ${mark}  ${one.id}  (${one.checks.length} checks, ${one.durationMs} ms)`);

    if (one.status === "skipped") {
      lines.push(`          ${one.skipReason ?? "skipped"}`);
      continue;
    }
    if (one.status !== "failed") continue;

    lines.push(`          ${one.description}`);
    if (one.error !== undefined) {
      lines.push(`          the case threw: ${one.error}`);
    }
    for (const check of one.checks.filter((c) => !c.ok)) {
      lines.push(`          × ${check.description}`);
      if (check.expected !== undefined) lines.push(`              expected: ${truncate(check.expected)}`);
      if (check.actual !== undefined) lines.push(`              actual:   ${truncate(check.actual)}`);
      if (check.error !== undefined) lines.push(`              error:    ${check.error}`);
    }
  }

  lines.push("");
  lines.push(
    `  ${report.totals.passed} passed, ${report.totals.failed} failed, ${report.totals.skipped} skipped ` +
      `(${report.totals.checks} checks, ${report.totals.failedChecks} failed) in ${report.durationMs} ms`,
  );
  lines.push("");
  lines.push(
    report.conformant
      ? `  "${report.adapter}" is conformant.`
      : `  "${report.adapter}" is NOT conformant (REQ-SURF-3).`,
  );
  return lines.join("\n");
}

/** A Markdown report, for the release notes (REQ-PKG-4). */
export function renderMarkdown(report: ConformanceReport): string {
  const lines: string[] = [];
  lines.push(`# Surface conformance — \`${report.adapter}\``);
  lines.push("");
  lines.push(`Run at ${report.startedAt} · ${report.durationMs} ms`);
  lines.push("");
  lines.push(
    report.conformant
      ? `**Conformant.** ${report.totals.passed} cases passed, ${report.totals.skipped} skipped, ${report.totals.checks} checks.`
      : `**Not conformant.** ${report.totals.failed} of ${report.cases.length} cases failed (${report.totals.failedChecks} checks).`,
  );
  lines.push("");
  lines.push("| Case | Page | Status | Checks |");
  lines.push("|---|---|---|---|");
  for (const one of report.cases) {
    lines.push(
      `| \`${one.id}\` | \`${one.page}\` | ${one.status} | ${one.checks.filter((c) => c.ok).length}/${one.checks.length} |`,
    );
  }

  const failed = report.cases.filter((c) => c.status === "failed");
  if (failed.length > 0) {
    lines.push("");
    lines.push("## Failures");
    for (const one of failed) {
      lines.push("");
      lines.push(`### \`${one.id}\``);
      lines.push("");
      lines.push(one.description);
      if (one.error !== undefined) {
        lines.push("");
        lines.push(`The case threw: \`${one.error}\``);
      }
      for (const check of one.checks.filter((c) => !c.ok)) {
        lines.push("");
        lines.push(`- **${check.description}**`);
        if (check.expected !== undefined) lines.push(`  - expected: \`${truncate(check.expected)}\``);
        if (check.actual !== undefined) lines.push(`  - actual: \`${truncate(check.actual)}\``);
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}
