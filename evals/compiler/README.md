# Compiler eval suite

`golden.jsonl` is the compiler golden set REQ-COMP-9 requires. One JSON object per
line:

```json
{"id":"g-003","tier":1,"pattern":1,"rule":"navigate","text":"Open the {data.baseUrl} home page","step":{ … }}
```

| Field | Meaning |
|---|---|
| `id` | `g-NNN`, unique and stable so a report can cite one entry. |
| `tier` | The compiler tier expected to produce this step (REQ-COMP-2 measures 100 % exact match on the tier-1 subset). |
| `pattern` | The [`docs/flow-language.md`](../../docs/flow-language.md) pattern number; `0` when no grammar pattern applies — a Tier 0 custom step, or a Tier 2/3 paraphrase. |
| `rule` | What `origin.rule` should say: the grammar rule, the custom-step id, or — for a model tier, which has no rule — the action it produced. |
| `text` | The sentence as an author would write it. |
| `step` | The part of the compiled step the sentence determines. |

`step` deliberately omits the mechanical fields every step carries — `id`,
`storyName`, `line`, `text`, `timeoutMs` and `origin` — because the compiler fills
them in regardless of the sentence and they would be noise in a file meant to be
read. `materialise()` in
[`packages/compiler/src/eval.ts`](../../packages/compiler/src/eval.ts) adds them
before validating each entry against `ir.schema.json`. A `tier: 2` or `tier: 3`
entry also gets a stand-in provenance, because the schema requires one on any
step a model produced (REQ-STD-4) and a golden entry is what such a step *should
look like* rather than one a model produced.

## What the set covers

- All 30 sentence patterns, each with at least two entries.
- All 39 `Action` values. `custom` appears only at tier 0, because no grammar can
  produce it (LLD §5).
- Every predicate kind and every kind of value reference, including a secret.

## The project the set compiles against

`project/` holds the three things a sentence does **not** determine and a project
does: `data.yaml`'s `secrets:` list, which is why `{data.card.number}` compiles
to a secret value; `targets.yaml`, which is why "the frame button" carries
`scope: frame`; and `steps/`, the Tier 0 custom steps the `tier: 0` entries
compile against. An eval that compiled against an empty project would score the
compiler as wrong for being right.

## Thresholds

REQ-COMP-9 requires 100 % exact match on the tier-1 subset and at least 95 % end
to end; REQ-COMP-3 requires at least 80 % on the tier-2 subset. All three are
enforced by `svatah eval compiler`'s exit code.

```bash
svatah eval compiler --report reports/eval-compiler.md      # every tier
svatah eval compiler --only tier1                           # no model needed
svatah eval compiler --only tier2 --gateway fake            # the harness alone
```

The published result is [`reports/eval-compiler.md`](../../reports/eval-compiler.md),
which names the gateway that produced the model-tier numbers — a percentage
without that is not a result. See [`docs/local-model.md`](../../docs/local-model.md)
for setting up the local model Tier 2 uses.

### Corpus size

REQ-COMP-9 asks for at least 300 pairs before release. The set holds 192: 148
tier 1 (T0.6 required 120), 3 tier 0, and 41 tier 2 added by T4.3. Growing it to
300 is release work, not phase work, and is recorded as a known gap in
`docs/spec/progress/phase-4.md`.

## History

Phase 0 seeded the first 148 tier-1 entries (T0.6). T2.4 measured against them.
T4.3 added the 41-entry `tier: 2` subset and the local model that answers it;
T4.4 built `svatah eval compiler` and published the report.
