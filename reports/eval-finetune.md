# Tier 2 fine-tune — base versus tuned

> **Withdrawn from 0.1.0 (T8.4, Draft 2.9).** ADR-4's Tier 2 fine-tune target is
> **not met**, the tuned adapter is **not used**, and no Yam release depends on
> one. `evals/compiler/project/yam.config.yaml` names the base model, and every
> published compiler number is the base model's. Draft 2.9 makes a Tier 2 corpus the
> precondition for another attempt: `evals/compiler/refused.jsonl`, read by
> `yam eval finetune corpus`.

Run at 2026-09-05T04:59:08.704Z

| | base | tuned | delta |
|---|---|---|---|
| tier 2 | 86.8 % | 13.2 % | **-73.7** |
| tier 1 | 100.0 % | 100.0 % | 0.0 |

Base: `qwen2.5:3b` (served as `ollama:qwen2.5:3b`) · Tuned: `qwen2-5-3b-yam-q4` (served as `ollama:qwen2-5-3b-yam-q4`)
Adapter digest: `f90d4e432be6bdc9afe7ec6af3b436107d2e3603806629b10fd880fb8539b98b`

| | |
|---|---|
| training pairs | 83 |
| iterations | 332 (4 epochs) |
| schedule | batch 1, max sequence 1536, 8 LoRA layers |
| host | darwin arm64 |
| training time | 58 min |
| stack | mlx |

**Does not meet T6.5.** Tier 2 improved by -73.7 points; 5 are required.

The golden set is the test set and is excluded from the training pairs (`evals/compiler/finetune/manifest.json` reports the count). A tuned model measured on sentences it was trained on would report an improvement that means nothing.

A measured improvement is reported only when it is measured on a held-out split that is not the training set, with early stopping (T8.4). No training run has been made against the T8.4 corpus.

## Why it got worse, and what replaces the training set (T8.4)

The regression is not a harness artefact: the harness's own two defects were fixed
before this run, Tier 1 held, and quantization was ruled out with a like-for-like
`q4_K_M` build of the base. What is left is the training set.

| | Phase 7 | T8.4 |
|---|---|---|
| Source | merged flows, via `git show <ref>:<path>` | `evals/compiler/refused.jsonl` |
| What a pair is | a sentence **Tier 1 compiled**, with the grammar's step | a sentence **Tier 1 refuses**, with a reviewed step |
| Golden set excluded | yes | yes |

Tier 2 exists for the sentences the grammar refuses. Training it on the sentences the
grammar *accepts* teaches it the one job it never has to do, and the measurement says
how much that costs.

```
yam eval finetune corpus     # the three sources and what each contributes
yam eval finetune export     # writes evals/compiler/finetune/pairs.jsonl
```
