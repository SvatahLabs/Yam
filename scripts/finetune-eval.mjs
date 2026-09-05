#!/usr/bin/env node
/**
 * Base versus tuned, on the golden `tier: 2` subset (T6.5, ADR-4, REQ-COMP-9).
 *
 *   node scripts/finetune-eval.mjs [--tuned <ollama model>]
 *                                  [--report reports/eval-finetune.md]
 *
 * > **Validate:** At least 5 points improvement on `tier: 2` golden without
 * > Tier 1 regressions.
 *
 * Two runs of `svatah eval compiler --tier2`, one against the base model and
 * one against the tuned one, and the difference. Both are the *published* eval
 * (REQ-COMP-9) run twice, not a private harness: a fine-tune measured by
 * something other than the suite the project publishes would be a number nobody
 * else could check.
 *
 * ## The two gates, and why the second one exists
 *
 * 1. **Tier 2 improves by at least 5 points.** The reason for training.
 * 2. **Tier 1 does not regress.** Tier 1 is the *grammar* and no model touches
 *    it, so this cannot move — which is the point of checking it. If it does,
 *    the two runs were not comparable and the first number means nothing.
 *
 * ## What it will not do
 *
 * Report a number it did not measure. With no tuned model it says so and exits
 * 2; it does not print the base twice, and it does not estimate.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};

const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
const tunedDir = resolve(ROOT, option("tuned-dir", "evals/compiler/finetune/tuned"));
const report = resolve(ROOT, option("report", "reports/eval-finetune.md"));
/** Five points, which is T6.5's Validate. */
const THRESHOLD = Number(option("threshold", "5"));

const die = (code, message) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

if (!existsSync(CLI)) die(2, "Run `pnpm -r build` first.");

const digestPath = join(tunedDir, "digest.json");
const tuned = option("tuned", existsSync(digestPath)
  ? JSON.parse(readFileSync(digestPath, "utf8")).tunedModel
  : undefined);

if (tuned === undefined) {
  die(
    2,
    "\nNo tuned model to compare against.\n\n" +
      "  1. node packages/cli/dist/bin.js eval finetune export\n" +
      "  2. node scripts/finetune-tier2.mjs\n" +
      "  3. ollama create qwen2.5-3b-svatah -f <the Modelfile the trainer wrote>\n" +
      "  4. node scripts/finetune-eval.mjs --tuned qwen2.5-3b-svatah\n\n" +
      "Nothing was written. Printing the base model's number twice, or estimating the " +
      "improvement, would be reporting something that was not measured (ADR-4).",
  );
}

/** One run of the published compiler eval, as JSON. */
function measure(model, label) {
  const out = join(ROOT, ".svatah", `finetune-${label}.md`);
  mkdirSync(dirname(out), { recursive: true });
  const result = spawnSync(
    process.execPath,
    [CLI, "eval", "compiler", "--tier2", "--report", out, "--json"],
    {
      encoding: "utf8",
      // The only difference between the two runs. `--tier2` reads the golden
      // project's committed config (LLD §16); this overrides the model it names
      // and nothing else, so the two runs differ in one variable.
      env: { ...process.env, SVATAH_TIER2_MODEL: model, SVATAH_ALLOW_MODEL_DRIFT: "1" },
    },
  );
  if (result.status !== 0 && result.stdout.trim() === "") {
    die(1, `The eval failed for ${label} (${model}):\n${result.stdout}${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    die(1, `The eval for ${label} answered something that is not JSON:\n${result.stdout}`);
  }
}

const digest = existsSync(digestPath) ? JSON.parse(readFileSync(digestPath, "utf8")) : {};
const baseModel = option("base", digest.base);
if (baseModel === undefined) die(2, "No base model; pass --base.");

process.stderr.write(`measuring the base (${baseModel})…\n`);
const before = measure(baseModel, "base");
process.stderr.write(`measuring the tuned model (${tuned})…\n`);
const after = measure(tuned, "tuned");

const rate = (result, tier) => {
  const one = (result.tiers ?? []).find((t) => String(t.tier) === String(tier));
  return one === undefined || one.total === 0 ? null : (one.passed / one.total) * 100;
};

const tier2Before = rate(before, 2);
const tier2After = rate(after, 2);
const tier1Before = rate(before, 1);
const tier1After = rate(after, 1);

if (tier2Before === null || tier2After === null) {
  die(1, "Tier 2 was `not measured` in one of the runs; there is nothing to compare.");
}

const delta = tier2After - tier2Before;
const regressed = tier1Before !== null && tier1After !== null && tier1After < tier1Before;
const met = delta >= THRESHOLD && !regressed;

const lines = [
  "# Tier 2 fine-tune — base versus tuned",
  "",
  `Run at ${new Date().toISOString()}`,
  "",
  `| | base | tuned | delta |`,
  `|---|---|---|---|`,
  `| tier 2 | ${tier2Before.toFixed(1)} % | ${tier2After.toFixed(1)} % | ` +
    `**${delta >= 0 ? "+" : ""}${delta.toFixed(1)}** |`,
  tier1Before === null
    ? "| tier 1 | not measured | not measured | — |"
    : `| tier 1 | ${tier1Before.toFixed(1)} % | ${tier1After.toFixed(1)} % | ` +
      `${(tier1After - tier1Before).toFixed(1)} |`,
  "",
  `Base: \`${baseModel}\` · Tuned: \`${tuned}\``,
  digest.digest === undefined ? "" : `Adapter digest: \`${digest.digest}\``,
  digest.pairs === undefined ? "" : `Trained on ${digest.pairs} merged pair(s).`,
  "",
  met
    ? `**Meets T6.5.** Tier 2 improved by ${delta.toFixed(1)} points (threshold ${THRESHOLD}) ` +
      "and Tier 1 did not regress."
    : regressed
      ? "**Does not meet T6.5.** Tier 1 regressed, which no model touches — so the two runs " +
        "were not comparable and the Tier 2 number means nothing."
      : `**Does not meet T6.5.** Tier 2 improved by ${delta.toFixed(1)} points; ${THRESHOLD} ` +
        "are required.",
  "",
  "The golden set is the test set and is excluded from the training pairs " +
    "(`evals/compiler/finetune/manifest.json` reports the count). A tuned model measured on " +
    "sentences it was trained on would report an improvement that means nothing.",
];

mkdirSync(dirname(report), { recursive: true });
writeFileSync(report, `${lines.filter((line) => line !== undefined).join("\n")}\n`, "utf8");
process.stdout.write(
  `tier 2: ${tier2Before.toFixed(1)} % → ${tier2After.toFixed(1)} % ` +
    `(${delta >= 0 ? "+" : ""}${delta.toFixed(1)}) → ${report}\n`,
);

// The report is written first, then the gate fails — the same order as every
// other eval here (HLD §14: publish the number, then fail).
process.exit(met ? 0 : 1);
