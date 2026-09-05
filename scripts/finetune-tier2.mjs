#!/usr/bin/env node
/**
 * Train a LoRA on the Tier 2 base model, and publish its digest (T6.5, ADR-4,
 * REQ-COMP-3).
 *
 *   node scripts/finetune-tier2.mjs [--pairs evals/compiler/finetune/pairs.jsonl]
 *                                   [--out evals/compiler/finetune/tuned]
 *                                   [--base <ollama model>] [--epochs 4]
 *
 * ## What this does, and what it refuses to do
 *
 * It writes the training set in the prompt shape the tier actually sends
 * (`scripts/finetune-tier2.mjs` and `packages/cli/src/tiers/tier2.ts` share the
 * system block through the CLI's own export, so the two cannot drift), checks
 * that a fine-tuning stack is present, and runs it.
 *
 * When no stack is present it **stops and says what to install**, and writes
 * nothing. It does not fall back to a smaller method, and it does not report a
 * number: HLD ADR-4 puts fine-tuning in scope precisely because an *unmeasured*
 * improvement is worth nothing, and a script that produced a plausible report
 * from no training would be the worst possible outcome.
 *
 * ## Why MLX and not PyTorch
 *
 * The base model is a 3B instruct model served by Ollama on a developer's
 * machine, and the machine this project is developed on is Apple silicon.
 * `mlx-lm` trains a LoRA on it in minutes with no CUDA and no container, and it
 * is MIT (REQ-PKG-3). `--stack peft` selects the PyTorch path for a Linux
 * runner; both write the same adapter and the same digest.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};

const pairsPath = resolve(ROOT, option("pairs", "evals/compiler/finetune/pairs.jsonl"));
const out = resolve(ROOT, option("out", "evals/compiler/finetune/tuned"));
const epochs = Number(option("epochs", "4"));
/*
 * The knobs that decide whether this fits in the machine's memory (T7.5).
 *
 * `mlx_lm.lora` defaults to a batch of 4, sequences of 2048 tokens and LoRA on
 * 16 layers, which is more than a 16 GB Apple-silicon machine has to give while
 * anything else is running: the full schedule on this host died at iteration 1
 * with `[METAL] Command buffer execution failed: Insufficient Memory`. They are
 * options rather than smaller defaults because the numbers a run was trained
 * with belong in its digest, and a run that quietly shrank itself would publish
 * a number nobody could reproduce.
 */
const batchSize = Number(option("batch-size", "1"));
const maxSeqLength = Number(option("max-seq-length", "1024"));
const numLayers = Number(option("layers", "8"));
const stack = option("stack", process.platform === "darwin" ? "mlx" : "peft");
/*
 * The interpreter, so a virtual environment works without activating one.
 * `SVATAH_FINETUNE_PYTHON=/path/to/venv/bin/python` is how CI and a developer
 * both point this at a stack that is not on the system Python — which is the
 * normal case, because a system Python on macOS is externally managed and
 * `pip install` into it fails.
 */
const python = option("python", process.env["SVATAH_FINETUNE_PYTHON"] ?? "python3");

const die = (code, message) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

if (!existsSync(pairsPath)) {
  die(
    2,
    `No pairs at ${pairsPath}.\n` +
      "Run: node packages/cli/dist/bin.js eval finetune export",
  );
}

/* The base model, from the golden project's own committed config (LLD §16). */
const goldenConfig = parseYaml(
  readFileSync(join(ROOT, "evals/compiler/project/svatah.config.yaml"), "utf8"),
);
const base = option("base", goldenConfig?.compile?.tier2?.model);
if (base === undefined) {
  die(2, "No Tier 2 model is configured in evals/compiler/project/svatah.config.yaml.");
}

/**
 * The base model, as the trainer names it.
 *
 * Ollama serves `qwen2.5:3b`; MLX and PEFT both take a Hugging Face repo id, and
 * `qwen2.5:3b` is not one. The mapping is explicit rather than derived because
 * "the 3B Qwen 2.5 instruct model" has several builds and they are not
 * interchangeable — a 4-bit one trains in minutes on a laptop and a 16-bit one
 * does not.
 *
 * `--hf` overrides it. A name with no mapping stops here rather than being
 * guessed at: training the wrong weights would produce an adapter that makes
 * the served model worse, which is a failure nobody would attribute to this.
 */
const HUGGING_FACE = {
  "qwen2.5:3b": "mlx-community/Qwen2.5-3B-Instruct-4bit",
  "qwen2.5:3b-instruct": "mlx-community/Qwen2.5-3B-Instruct-4bit",
  "qwen2.5:1.5b": "mlx-community/Qwen2.5-1.5B-Instruct-4bit",
  "llama3.2:3b": "mlx-community/Llama-3.2-3B-Instruct-4bit",
};
const hf = option("hf", HUGGING_FACE[base]);
if (stack === "mlx" && hf === undefined) {
  die(
    2,
    `No Hugging Face build is mapped for the Ollama model "${base}".\n` +
      "Pass --hf <repo id>, or add it to HUGGING_FACE in this script. Guessing would risk " +
      "training the wrong weights, which produces an adapter that makes the served model " +
      "worse in a way nobody would attribute to this.",
  );
}

const pairs = readFileSync(pairsPath, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line));

/* ── 1. the host ──────────────────────────────────────────────────────────── */

const probe = (command, ...probeArgs) => {
  const result = spawnSync(command, probeArgs, { encoding: "utf8" });
  return result.status === 0;
};

const available =
  stack === "mlx"
    ? probe(python, "-c", "import mlx_lm")
    : probe(python, "-c", "import peft, torch, transformers");

if (!available) {
  die(
    2,
    `\nNo fine-tuning stack: \`${stack}\` is not importable by ${python}.\n\n` +
      `  ${pairs.length} training pair(s) are ready at ${pairsPath}.\n\n` +
      "To train, install one and run this again:\n\n" +
      "  python3 -m venv .venv\n" +
      (stack === "mlx"
        ? "  .venv/bin/pip install mlx-lm\n"
        : "  .venv/bin/pip install peft transformers torch datasets\n") +
      `  SVATAH_FINETUNE_PYTHON=.venv/bin/python node scripts/finetune-tier2.mjs --epochs ${epochs}\n` +
      "\nNothing was written. A report from a training run that did not happen would be " +
      "worse than no report (ADR-4).",
  );
}

/* ── 2. the training set, in the shape the tier prompts with ─────────────── */

mkdirSync(out, { recursive: true });

/*
 * The same instruction block the tier sends, imported rather than copied: a
 * model tuned against a *different* system prompt from the one it is served
 * with would be tuned for a job it never sees, and the two drifting apart is
 * exactly the kind of thing nobody notices for a month.
 */
const { TIER2_SYSTEM_PROMPT, TIER2_PROMPT_VERSION } = await import(
  join(ROOT, "packages/cli/dist/index.js")
);

const jsonl = pairs
  .map((pair) =>
    JSON.stringify({
      messages: [
        { role: "system", content: TIER2_SYSTEM_PROMPT },
        { role: "user", content: pair.text },
        { role: "assistant", content: JSON.stringify(pair.step) },
      ],
    }),
  )
  .join("\n");

/*
 * A held-out split, from the *training* pairs and not from the golden set. The
 * golden set is the test set and is never touched here; this is the split the
 * trainer needs to know when to stop.
 */
const cut = Math.max(1, Math.floor(pairs.length * 0.1));
const lines = jsonl.split("\n");
writeFileSync(join(out, "train.jsonl"), `${lines.slice(cut).join("\n")}\n`);
writeFileSync(join(out, "valid.jsonl"), `${lines.slice(0, cut).join("\n")}\n`);

/* ── 3. train ─────────────────────────────────────────────────────────────── */

const started = Date.now();
const training =
  stack === "mlx"
    ? spawnSync(
        python,
        [
          "-m", "mlx_lm.lora",
          "--model", hf,
          "--train",
          "--data", out,
          "--iters", String(epochs * pairs.length),
          "--batch-size", String(batchSize),
          "--max-seq-length", String(maxSeqLength),
          "--num-layers", String(numLayers),
          "--adapter-path", join(out, "adapters"),
        ],
        { stdio: "inherit" },
      )
    : spawnSync(
        python,
        [join(ROOT, "scripts", "finetune_peft.py"), "--base", hf ?? base, "--data", out, "--epochs", String(epochs)],
        { stdio: "inherit" },
      );

if (training.status !== 0) die(1, `Training failed (${stack}, exit ${training.status}).`);

/* ── 3b. fuse the adapter, and write the Modelfile that serves it ─────────── */

/*
 * Ollama serves the Tier 2 model, and it cannot load a LoRA adapter directly:
 * the adapter has to be fused into the base weights and converted to GGUF.
 * Doing it here rather than leaving it to a README is what makes the pipeline
 * one command — and the Modelfile is what makes the served model reproducible
 * from the digest.
 */
const fused = join(out, "fused");
if (stack === "mlx") {
  const fuse = spawnSync(
    python,
    [
      "-m", "mlx_lm", "fuse",
      "--model", hf,
      "--adapter-path", join(out, "adapters"),
      "--save-path", fused,
      // GGUF, because that is what Ollama loads. `--export-gguf` writes it
      // beside the fused weights.
      "--export-gguf",
    ],
    { stdio: "inherit" },
  );
  if (fuse.status !== 0) {
    process.stderr.write(
      `\nFusing failed (exit ${fuse.status}). The adapter is at ${join(out, "adapters")} and can ` +
        "be fused by hand:\n" +
        `  ${python} -m mlx_lm fuse --model ${hf} --adapter-path ${join(out, "adapters")} ` +
        `--save-path ${fused} --export-gguf\n`,
    );
  }
}

const tunedModel = option("name", `${String(base).replace(/[:.]/g, "-")}-svatah`);
writeFileSync(
  join(out, "Modelfile"),
  `# The tuned Tier 2 model (T6.5, ADR-4).\n` +
    `#\n` +
    `# Built from ${hf ?? base} plus a LoRA trained on ${pairs.length} pairs exported from\n` +
    `# merged flows. Serve it with:\n` +
    `#\n` +
    `#   ollama create ${tunedModel} -f ${join(out, "Modelfile")}\n` +
    `#   node scripts/finetune-eval.mjs --tuned ${tunedModel}\n` +
    `#\n` +
    `# The temperature and seed match what the tier sends at compile time\n` +
    `# (REQ-COMP-3: temperature 0, fixed seed), because a model tuned under one\n` +
    `# sampling regime and served under another is not the model that was measured.\n` +
    `FROM ${join(fused, "ggml-model-f16.gguf")}\n` +
    `PARAMETER temperature 0\n` +
    `PARAMETER seed 1\n`,
  "utf8",
);

/* ── 4. the digest (REQ-COMP-3) ───────────────────────────────────────────── */

/*
 * The digest is over the *adapter*, not over the name.
 *
 * `compile.tier2.digest` exists so provenance can say which build of a model
 * produced a step (LLD §16), and a tuned model whose name is `qwen2.5:3b-svatah`
 * says nothing about which training run made it. Hashing the adapter weights and
 * the training set together is what makes the answer reproducible.
 */
const adapter = join(out, "adapters");
const digest = createHash("sha256");
digest.update(readFileSync(pairsPath));
for (const file of existsSync(adapter) ? execFileSync("ls", [adapter], { encoding: "utf8" }).split("\n") : []) {
  if (file.trim() === "") continue;
  digest.update(readFileSync(join(adapter, file.trim())));
}
const hex = digest.digest("hex");

writeFileSync(
  join(out, "digest.json"),
  `${JSON.stringify(
    {
      base,
      huggingFace: hf,
      /* The name to `ollama create`, which `finetune-eval.mjs` reads. */
      tunedModel,
      stack,
      epochs,
      /*
       * The schedule, in the digest, because T7.5 allows "a documented shorter
       * schedule if the full one exceeds the host" and a number reported
       * without the schedule that produced it is not reproducible.
       */
      iterations: epochs * pairs.length,
      batchSize,
      maxSeqLength,
      loraLayers: numLayers,
      host: `${process.platform} ${process.arch}`,
      pairs: pairs.length,
      promptVersion: TIER2_PROMPT_VERSION,
      digest: hex,
      trainedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      note:
        "The digest is over the adapter weights and the training set together, so a run " +
        "can be reproduced and provenance can say which one produced a step (REQ-COMP-3).",
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(
  `trained a LoRA on ${hf ?? base} from ${pairs.length} pair(s) — digest ${hex.slice(0, 12)}…\n` +
    `  adapter: ${adapter}\n` +
    `  serve it:  ollama create ${tunedModel} -f ${join(out, "Modelfile")}\n` +
    `  measure it: node scripts/finetune-eval.mjs --tuned ${tunedModel}\n`,
);
