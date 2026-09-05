# Tier 2 fine-tune — base versus tuned

Run at 2026-09-04T22:16:20.309Z

| | base | tuned | delta |
|---|---|---|---|
| tier 2 | 86.8 % | 13.2 % | **-73.7** |
| tier 1 | 100.0 % | 100.0 % | 0.0 |

Base: `qwen2.5:3b` (served as `ollama:qwen2.5:3b`) · Tuned: `qwen2-5-3b-svatah-q4` (served as `ollama:qwen2-5-3b-svatah-q4`)
Adapter digest: `f90d4e432be6bdc9afe7ec6af3b436107d2e3603806629b10fd880fb8539b98b`

| | |
|---|---|
| training pairs | 83, from merged flows |
| iterations | 332 (4 epochs) |
| schedule | batch 1, max sequence 1536, 8 LoRA layers |
| host | darwin arm64 |
| training time | 58 min |
| stack | mlx |

**Does not meet T6.5.** Tier 2 improved by -73.7 points; 5 are required.

The golden set is the test set and is excluded from the training pairs (`evals/compiler/finetune/manifest.json` reports the count). A tuned model measured on sentences it was trained on would report an improvement that means nothing.
