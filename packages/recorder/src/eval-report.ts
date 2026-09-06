/**
 * The grounding eval's published report (REQ-REC-10, REQ-PKG-4, LLD §16).
 *
 * A number without its method is not a number. So the report leads with which
 * gateway produced it — a run against the fake gateway measures the harness and
 * nothing else, and saying so is not a footnote — then the method, then the
 * outcome table, then every case that was not correct, by name.
 *
 * The failures are listed in full rather than counted. A grounding eval whose
 * report says "96%" and nothing else is a report nobody can act on; one that
 * names the four phrases that went to the wrong element is a list of bugs.
 */
import { formatUsd } from "@svatah/yam-gateway";
import type { GroundingEvalReport, GroundingEvalResult } from "./eval.js";

const METHOD = `Each case is a phrase, a page, and the element the phrase means. The eval opens the
page — variant 0 unless the case names one — takes one snapshot, and runs the same
\`ground()\` the recorder runs, with the same prompt (\`g-1\`) and the same token budget.

The answer is checked against a ground-truth key. \`apps/sample-web\` stamps every
interactive element with \`data-yam-eval\`, identical across all twenty variants, and
\`bindings.ignoreAttributes\` makes the surface blind to it: the eval reads it with a page
script, around the surface rather than through it (LLD §16). "It resolved" is not the
question; "is it the element the phrase meant" is.

**present** cases name an element on the page. Correct means the key matches; a different
key is \`wrong-element\`; a null is \`missed\`.

**absent** cases use a phrase that is real on another page and names nothing here. Correct
means null. A reference is a \`false-positive\` — the failure that costs the most in
production, because an automation that binds the closest-looking control does so
confidently and every night.

Only a null counts as correct on an absent case. A refusal by the recorder's own
confidence floor is the recorder saving the day, not the grounding being right, and folding
the two together would hide a model that guesses.`;

export function renderGroundingEvalMarkdown(report: GroundingEvalReport): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const lines: string[] = [];

  lines.push("# Yam eval report — grounding");
  lines.push("");
  lines.push(`Generated: ${report.at}`);
  lines.push("");

  if (!report.gateway.real) {
    lines.push(
      `> **This run used \`${report.gateway.name}\`, which is not a model.** The answers came ` +
        "from the committed cases themselves, so the accuracy below measures the eval " +
        "harness — that it opens every page, grounds every phrase and checks every answer " +
        "against the ground-truth key — and measures nothing about grounding. It is not " +
        "REQ-REC-10's number and must not be quoted as one.",
    );
    lines.push("");
  }

  lines.push(
    `**Accuracy: ${percent(report.accuracy)}** over ${report.cases} case(s), against ` +
      `REQ-REC-10's ${percent(report.threshold)} threshold. ` +
      (report.met ? "Met." : "**Not met.**"),
  );
  lines.push("");
  lines.push(
    `Gateway: \`${report.gateway.name}\`, model \`${report.gateway.model}\`` +
      (report.gateway.real ? "." : " — **not a real model**."),
  );
  lines.push("");

  lines.push("## Method");
  lines.push("");
  lines.push(METHOD);
  lines.push("");

  lines.push("## Outcomes");
  lines.push("");
  lines.push("| Outcome | Cases | What it means |");
  lines.push("|---|---:|---|");
  for (const [outcome, meaning] of MEANINGS) {
    lines.push(`| \`${outcome}\` | ${report.totals[outcome]} | ${meaning} |`);
  }
  lines.push("");

  lines.push("## By page");
  lines.push("");
  lines.push("| Page | Cases | Correct | Rate |");
  lines.push("|---|---:|---:|---:|");
  for (const [page, results] of byPage(report.results)) {
    const correct = results.filter((r) => r.outcome === "correct").length;
    lines.push(
      `| \`${page}\` | ${results.length} | ${correct} | ${percent(correct / results.length)} |`,
    );
  }
  lines.push("");

  const wrong = report.results.filter((r) => r.outcome !== "correct");
  lines.push(`## Every case that was not correct (${wrong.length})`);
  lines.push("");
  if (wrong.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Case | Page | Phrase | Expected | Outcome | Chose | Why |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const result of wrong) {
      lines.push(
        `| ${result.id} | \`${result.page}${result.variant === undefined ? "" : `?variant=${result.variant}`}\` ` +
          `| ${result.phrase} | ${result.expected ?? "(nothing)"} | \`${result.outcome}\` ` +
          `| ${result.chose ?? "—"} | ${(result.why ?? result.message ?? "").split("\n")[0]} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Cost");
  lines.push("");
  lines.push(
    `${report.usage.calls} model call(s), ${report.usage.cacheHits} answered from cache, ` +
      `${report.usage.tokensIn} tokens in, ${report.usage.tokensOut} out, ` +
      `${formatUsd(report.usage.costUsd)}.`,
  );
  lines.push("");

  return `${lines.join("\n")}\n`;
}

/** What `yam eval grounding` prints. */
export function renderGroundingEvalSummary(report: GroundingEvalReport): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const lines: string[] = [];

  lines.push(
    `Grounding — ${report.cases} case(s), ${percent(report.accuracy)} correct ` +
      `(threshold ${percent(report.threshold)}${report.met ? ", met" : ", NOT met"})`,
  );
  lines.push("");
  for (const [outcome] of MEANINGS) {
    const count = report.totals[outcome];
    if (count > 0) lines.push(`  ${String(count).padStart(4)}  ${outcome}`);
  }
  lines.push("");
  lines.push(
    report.gateway.real
      ? `  Gateway: ${report.gateway.name} (${report.gateway.model}), ` +
        `${report.usage.calls} call(s), ${formatUsd(report.usage.costUsd)}.`
      : `  Gateway: ${report.gateway.name} — not a model. This measures the harness, ` +
        "not grounding, and is not REQ-REC-10's number.",
  );
  return lines.join("\n");
}

const MEANINGS: ReadonlyArray<[GroundingEvalReport["results"][number]["outcome"], string]> = [
  ["correct", "the element the phrase meant, or a null where nothing matched"],
  ["wrong-element", "grounded to a different element — the failure that matters most"],
  ["missed", "a phrase that named something on the page came back null"],
  ["false-positive", "a phrase that named nothing came back with a reference"],
  ["unchecked", "grounded, and the ground-truth key could not be read, so nothing was verified"],
  ["unverified", "the chosen element could not be synthesised into a unique candidate"],
  ["low-confidence", "the model said it was guessing, and the recorder refused it"],
  ["refused", "the model declined the request"],
];

function byPage(
  results: readonly GroundingEvalResult[],
): Array<[string, GroundingEvalResult[]]> {
  const out = new Map<string, GroundingEvalResult[]>();
  for (const result of results) {
    out.set(result.page, [...(out.get(result.page) ?? []), result]);
  }
  return [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
