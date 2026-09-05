# Fine-tuning Tier 2

> **ADR-4 Four compiler tiers at authoring time.** Custom typed steps, grammar,
> local model with pinned digest, frontier model. Rejected: training from
> scratch.
>
> **Non-goal:** Training a transformer from scratch. Fine-tuning a small
> pretrained model on accepted pairs is in scope (P2).

Tier 2 is a 1.7B–4B instruct model that compiles the sentences the grammar
cannot parse. It is small, so it gets two things wrong more than anything else:
the *shape* of the IR, and the *vocabulary* of actions. Both are things a few
hundred examples fix, and the project already has the examples — every sentence
in every merged flow, with the step the grammar compiled it to.

## The three commands

```bash
# 1. Export the pairs from merged flows.
node packages/cli/dist/bin.js eval finetune export

# 2. Train a LoRA on the Tier 2 base model.
python3 -m venv .venv && .venv/bin/pip install mlx-lm     # or peft on Linux
SVATAH_FINETUNE_PYTHON=.venv/bin/python node scripts/finetune-tier2.mjs

# 3. Serve it, and measure it against the base.
ollama create qwen2-5-3b-svatah -f evals/compiler/finetune/tuned/Modelfile
node scripts/finetune-eval.mjs --tuned qwen2-5-3b-svatah
```

## The schedule, and the machine it has to fit in (T7.5)

`mlx_lm.lora`'s defaults — a batch of 4, sequences of 2048 tokens, LoRA on 16
layers — are more than a 16 GB Apple-silicon machine has to give while anything
else is running. The first attempt at the full schedule on such a machine died
at iteration 1:

```
RuntimeError: [METAL] Command buffer execution failed: Insufficient Memory
```

So the four knobs that decide whether a run fits are options, and every one of
them is written into `digest.json`:

| Option | Default here | Why it is not `mlx_lm`'s default |
|---|---|---|
| `--epochs` | 4 | iterations are `epochs × pairs` |
| `--batch-size` | 1 | the largest single term in peak memory |
| `--max-seq-length` | 1024 | a truncated sequence loses the *end* of the answer, so raise it until the warnings stop rather than leaving it low |
| `--layers` | 8 | fewer adapted layers, less optimiser state |

They are options rather than smaller defaults because the numbers a run was
trained with belong in its digest: a script that quietly shrank itself would
publish a number nobody could reproduce, which is the one outcome ADR-4 exists
to prevent.

`mlx_lm` warns when a sequence is longer than `--max-seq-length` and truncates
it. Those warnings matter more than they look: the assistant's answer is at the
*end* of a pair, so a truncated pair trains the model on a prompt with no
answer. Raise `--max-seq-length` until they stop, or accept — and record — that
the longest pairs were not fully trained on.

## What "accepted pairs" means, and why it is the whole design

A pair is a sentence and the step it means. The step has to be **right**, and
the only evidence this project has that a step is right is that a person
reviewed the flow it came from and merged it (ADR-1: every model decision is a
committed, diffable file).

So the export reads flows **as they are on the merge ref**, through
`git show <ref>:<path>`. A draft in someone's editor is not evidence of
anything, and a pipeline that trained on the working tree would learn whatever
was half-written when it ran. `--ref` names the ref; `master` is the default.

Every pair is a **grammar** compile. That is not a limitation — it is the
teacher. Tier 2 exists for the sentences Tier 1 cannot parse, and what it gets
wrong on those is the IR's shape and the action vocabulary, which Tier 1's
output demonstrates perfectly. A pair whose step a *model* produced would be the
model's own guess fed back to it.

## The golden set is the test set

Every sentence in `evals/compiler/golden.jsonl` is excluded from the export, and
the count is in `evals/compiler/finetune/manifest.json`. A tuned model measured
on sentences it was trained on reports an improvement that means nothing, and
REQ-COMP-9's published number stops being a number.

This is the property most likely to be lost quietly — nothing about a
contaminated training set looks wrong — so it is a test
(`packages/cli/test/finetune.test.ts`) rather than a rule in a document.

## The shape a pair is in

**Not the IR.** A Tier 2 answer is constrained to `modelStepSchema`
(`packages/compiler/src/raw-schema.ts`): an action, a target *phrase*, literal
args as plain strings, references under `argRefs`. The finished `Step` carries
an element id, a secret flag, a timeout and a positional id — every one a fact
about the project that a model has no basis for.

Training on the finished shape would teach the model to emit something the
tier's own parser rejects. It would score *worse*, and every pair would look
right in the file.

Requiring every exported pair to parse against `modelStepSchema` found three
real defects that had nothing to do with training:

| | |
|---|---|
| `asExample` left a predicate's `value` in the IR's shape | So `g-098` — one of the few-shot examples in **every Tier 2 prompt** — was demonstrating a shape the parser rejects |
| `modelStepSchema` had `promptText` and not `text` for a dialog | The grammar emits `text` and the adapter reads it, so a Tier 2 answer could never carry a prompt's reply |
| `modelStepSchema` had no `withSessionCookies` | So `Call the "x" API with the session cookies` would compile to a request that quietly sent none |

## Serving it: why the Modelfile points at a directory (T7.5)

`mlx_lm fuse --export-gguf` was the obvious way to get from a LoRA to something
Ollama loads, and it does not work for this model:

```
ValueError: Model type qwen2 not supported for GGUF conversion.
```

`mlx_lm`'s GGUF writer covers a short list of architectures and Qwen 2 is not on
it. `--dequantize` fuses the adapter into fp16 weights in the ordinary Hugging
Face layout instead, and Ollama imports that layout directly — so the
`Modelfile`'s `FROM` is the fused **directory**, not a `.gguf` file. The fused
copy is about 5.8 GB, which is why everything under
`evals/compiler/finetune/tuned/` is git-ignored apart from `digest.json`.

Dequantizing does not undo the quantization the model was trained under: the
LoRA was trained against the 4-bit weights and is fused into their dequantized
values, which is the same model.

One more failure worth knowing, because it happens *after* an hour of training:

```
huggingface_hub.errors.IncompleteSnapshotError: The cached snapshot for
'mlx-community/Qwen2.5-3B-Instruct-4bit' is incomplete: 2 file(s) are missing
```

The trainer runs offline once the weights are cached, and a partially cached
snapshot fails only at the fuse. Complete it and re-run the fuse by hand — the
adapter is already on disk:

```bash
.venv/bin/python -c "from huggingface_hub import snapshot_download; \
  snapshot_download('mlx-community/Qwen2.5-3B-Instruct-4bit')"
```

## The digest

`compile.tier2.digest` exists so provenance can say *which build* of a model
produced a step (REQ-COMP-3, LLD §16). A tuned model called
`qwen2.5-3b-svatah` says nothing about which training run made it, so the digest
is over the **adapter weights and the training set together** — which is what
makes a run reproducible and an answer attributable.

## The two gates

`scripts/finetune-eval.mjs` runs the *published* compiler eval twice, once
against each model, and requires:

1. **Tier 2 improves by at least 5 points.** T6.5's Validate; the reason for
   training.
2. **Tier 1 does not regress.** Tier 1 is the grammar and no model touches it,
   so this cannot move. If it does, the two runs were not comparable and the
   first number means nothing.

With no tuned model it says so and exits 2. It does not print the base twice and
it does not estimate: an unmeasured improvement is worth less than no number,
because someone will quote it.
