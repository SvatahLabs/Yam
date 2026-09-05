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
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * The golden project, with one line changed: the Tier 2 model (T7.5).
 *
 * `--tier2` reads the model from the golden set's *own* committed config
 * (Draft 2.6, LLD §16), and §16 says "`--project` may override it". So the
 * override is a copy of that project with `compile.tier2.model` replaced and
 * the pinned `digest` removed — the tuned model is by definition not the pinned
 * weights, and leaving the pin in would make every run exit 3.
 *
 * It used to be two environment variables, `SVATAH_TIER2_MODEL` and
 * `SVATAH_ALLOW_MODEL_DRIFT`. **Nothing in the CLI read either of them.** So
 * both runs used the base model, the "comparison" compared a model with itself,
 * and the script that says in its own header that it "does not print the base
 * twice" did exactly that. Found by running it (T7.5); it had never been run.
 */
function goldenProjectFor(model) {
  const source = join(ROOT, "evals", "compiler", "project");
  const target = join(ROOT, ".svatah", `golden-project-${model.replace(/[^\w.-]/g, "-")}`);
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });

  const configPath = join(target, "svatah.config.yaml");
  const config = readFileSync(configPath, "utf8")
    .replace(/^(\s*)model:\s*".*"$/m, `$1model: "${model}"`)
    .replace(/^\s*digest:\s*".*"\n/m, "");
  writeFileSync(configPath, config, "utf8");
  return target;
}

/** One run of the published compiler eval, as JSON. */
function measure(model, label) {
  const out = join(ROOT, ".svatah", `finetune-${label}.md`);
  mkdirSync(dirname(out), { recursive: true });
  const result = spawnSync(
    process.execPath,
    [
      CLI,
      "eval",
      "compiler",
      "--tier2",
      "--golden-project",
      goldenProjectFor(model),
      "--report",
      out,
      "--json",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
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

/*
 * The guard that would have caught the defect this script shipped with: each
 * run reports the gateway it actually used, and if the two are the same then
 * the override did not take and the "comparison" is a model against itself.
 */
if (before.gateway === after.gateway) {
  die(
    1,
    `Both runs used ${before.gateway}. The model override did not take, so there is nothing ` +
      "to compare — and a delta of zero from two identical runs is the one number this script " +
      "must never print (ADR-4).",
  );
}
process.stderr.write(`base ran on ${before.gateway}; tuned ran on ${after.gateway}\n`);

/**
 * One tier's exact-match rate, from `svatah eval compiler --json`.
 *
 * The shape is `byTier: { tier2: { total, matched, rate } }`. This used to read
 * `result.tiers.find(t => t.tier === 2)`, which matches nothing that command has
 * ever written — so both rates were `null`, and the script reported "Tier 2 was
 * `not measured`" whatever it had just measured. The second half of the defect
 * above: a harness nobody had run.
 */
const rate = (result, tier) => {
  const one = (result.byTier ?? {})[`tier${tier}`];
  return one === undefined || one.total === 0 ? null : (one.matched / one.total) * 100;
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
  `Base: \`${baseModel}\` (served as \`${before.gateway}\`) · Tuned: \`${tuned}\` ` +
    `(served as \`${after.gateway}\`)`,
  digest.digest === undefined ? "" : `Adapter digest: \`${digest.digest}\``,
  "",
  /*
   * The schedule, in the published report (T7.5's Validate: "the measured
   * numbers … with the digest, iterations, and host"). A number without the
   * schedule that produced it is a number nobody can reproduce, and this
   * project's whole position on fine-tuning is that an unreproducible
   * improvement is worth less than none (ADR-4).
   */
  "| | |",
  "|---|---|",
  ...(digest.pairs === undefined ? [] : [`| training pairs | ${digest.pairs}, from merged flows |`]),
  ...(digest.iterations === undefined ? [] : [`| iterations | ${digest.iterations} (${digest.epochs} epochs) |`]),
  ...(digest.batchSize === undefined
    ? []
    : [`| schedule | batch ${digest.batchSize}, max sequence ${digest.maxSeqLength}, ${digest.loraLayers} LoRA layers |`]),
  ...(digest.host === undefined ? [] : [`| host | ${digest.host} |`]),
  ...(digest.durationMs === undefined
    ? []
    : [`| training time | ${(digest.durationMs / 60000).toFixed(0)} min |`]),
  ...(digest.stack === undefined ? [] : [`| stack | ${digest.stack} |`]),
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
