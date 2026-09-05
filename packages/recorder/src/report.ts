/**
 * The record report (T3.3, REQ-REC-8, REQ-NFR-2, REQ-PKG-4).
 *
 * "A record report lists per step the snapshot size, decision, tokens, cost, and
 * chosen candidate."
 *
 * Two renderings of one object. `record-report.json` is committed beside the
 * bindings, so a pull request shows what a recording decided as well as what it
 * wrote — a reviewer reads why an element was chosen, not only which. The
 * terminal rendering is what a person watches while it runs.
 *
 * Both say which gateway produced the decisions. A report that does not is a
 * report whose numbers cannot be read: "95% accurate" means something different
 * when the answers came from a fixture.
 */
import { formatUsd } from "@svatah/gateway";
import type { RecordReport, RecordedStep } from "./session.js";

/** The file written beside the bindings (REQ-REC-9). */
export function reportJson(report: RecordReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** What `svatah record` prints when it finishes. */
export function renderReport(report: RecordReport): string {
  const lines: string[] = [];
  const t = report.totals;

  lines.push(
    report.complete
      ? `Recorded ${t.steps} step(s) across ${report.stories.length} story(ies).`
      : `Stopped after ${t.steps} step(s); only what a passing step proved was written.`,
  );
  lines.push("");

  for (const step of report.steps) lines.push(...stepLines(step));

  lines.push("");
  lines.push(
    `  ${t.grounded} grounded, ${t.reused} reused, ${t.failed} failed; ` +
      `${written(report)}`,
  );
  lines.push(
    `  ${t.modelCalls} model call(s), ${t.cacheHits} from cache, ` +
      `${t.tokensIn} in / ${t.tokensOut} out, ${formatUsd(t.costUsd)}`,
  );
  lines.push(
    report.gateway.real
      ? `  Gateway: ${report.gateway.name} (${report.gateway.model}).`
      : `  Gateway: ${report.gateway.name} — not a model. These decisions were supplied, ` +
        "not inferred, and nothing here measures a model's accuracy.",
  );

  if (report.stoppedBecause !== undefined) {
    lines.push("");
    lines.push(`  ${report.stoppedBecause}`);
  }

  return lines.join("\n");
}

function written(report: RecordReport): string {
  return report.written.length === 0
    ? "no bindings written"
    : `${report.written.length} binding(s) verified and written`;
}

function stepLines(step: RecordedStep): string[] {
  const mark = step.status === "passed" ? "✓" : step.status === "failed" ? "✗" : "–";
  const lines = [`  ${mark} ${step.story} · ${step.text}`];

  const decision = step.decision;
  if (decision !== undefined) {
    lines.push(
      `      ${decision.id}: ${decision.outcome}` +
        (decision.ref === undefined ? "" : ` → ${decision.ref}`) +
        (decision.confidence === undefined ? "" : ` (${decision.confidence.toFixed(2)})`) +
        ` · ${decision.snapshotTokens} snapshot tokens${decision.pruned ? ", pruned" : ""}` +
        (decision.usedVision ? ", vision" : "") +
        (decision.cached ? ", cached" : ""),
    );
    if (decision.why !== undefined && decision.outcome === "grounded") {
      lines.push(`      ${decision.why}`);
    }
    if (decision.candidates !== undefined) {
      lines.push(`      candidates: ${decision.candidates.map((c) => c.by).join(", ")}`);
    }
    if (decision.message !== undefined && decision.outcome !== "grounded") {
      lines.push(`      ${decision.message}`);
    }
  } else if (step.binding === "existing" && step.elementId !== undefined) {
    lines.push(`      ${step.elementId}: reused`);
  }

  if (step.matched !== undefined) {
    lines.push(`      matched by ${step.matched.by} (candidate ${step.matched.index})`);
  }
  if (step.failure !== undefined) {
    lines.push(`      ${step.failure.class}: ${step.failure.message.split("\n")[0]}`);
  }
  return lines;
}
