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

- All 33 sentence patterns, each with at least two entries.
- All 41 `Action` values. `custom` appears only at tier 0, because no grammar can
  produce it (LLD §5).
- Every predicate kind and every kind of value reference, including a secret.

## The project the set compiles against

`project/` holds the four things a sentence does **not** determine and a project
does: `data.yaml`'s `secrets:` list, which is why `{data.card.number}` compiles
to a secret value; `targets.yaml`, which is why "the frame button" carries
`scope: frame`; `steps/`, the Tier 0 custom steps the `tier: 0` entries compile
against; and `svatah.config.yaml`, whose `compile.tier2` names the local model
and pins its digest. An eval that compiled against an empty project would score
the compiler as wrong for being right.

`svatah eval compiler` reads `compile.tier2` and `compile.tier3` from **this**
config, not from the directory it was invoked in (LLD §16, Draft 2.6); `--project
<dir>` overrides it. That is what makes the published Tier 2 number reproducible
from a checkout: before Draft 2.6 the eval read the repository root, which has no
config, so a clean checkout registered no model, scored all 41 tier 2 sentences
as wrong, and printed "Below thresholds" (Phase 4 verification, F2).

A tier that is asked for and has no configuration is reported as **not measured**
and excluded from the thresholds and from the overall rate. Its entries are not
compiled at all. A configured tier whose server is unreachable is a different
thing and still fails, because that is a measurement that went wrong rather than
one that was never attempted.

## Thresholds

REQ-COMP-9 requires 100 % exact match on the tier-1 subset and at least 95 % end
to end; REQ-COMP-3 requires at least 80 % on the tier-2 subset. All three are
enforced by `svatah eval compiler`'s exit code.

```bash
svatah eval compiler --report reports/eval-compiler.md      # every tier
svatah eval compiler --tier2                                # the published number
svatah eval compiler --only tier1                           # no model needed
svatah eval compiler --only tier2 --gateway fake            # the harness alone
```

Reproducing the published Tier 2 rate needs only `ollama serve` with
`qwen2.5:3b` pulled; the model name and digest come from the committed config.

The published result is [`reports/eval-compiler.md`](../../reports/eval-compiler.md),
which names the gateway that produced the model-tier numbers — a percentage
without that is not a result. See [`docs/local-model.md`](../../docs/local-model.md)
for setting up the local model Tier 2 uses.

### Corpus size

REQ-COMP-9 asks for at least 300 pairs before release. The set holds **303**: 250
tier 1 (T0.6 required 120), 3 tier 0, and 50 tier 2 (T12.2).

The last fifty-eight came from two places and neither is an accident of
convenience. Forty-nine are tier 1 sentences the grammar had always accepted and
the set had never asked it — the third-person forms above all, which the synonym
vocabulary has listed since Draft 1 and which the set covered *zero* of. Twelve
are tier 2 paraphrases promoted out of `refused.jsonl`, each read by a person
before it moved, and each **deleted from the corpus in the same commit**: a
sentence in both files would be a test set that shares a line with its training
set, which is the mistake T8.4 was written to prevent
(`tools/repo-checks/test/refused-corpus.test.ts` fails on any overlap).

Two candidates were read and **not** promoted. "Make sure the remember me box is
ticked" and "Confirm with the submit button" both open with a verb the grammar
lists as an assertion (`AssertVerb`), so the sentence genuinely reads two ways;
an ambiguous answer in the *test* set would bake a contested reading into a
published number. They stay in the corpus, where an ambiguous sentence is a
useful thing to have.

## History

Phase 0 seeded the first 148 tier-1 entries (T0.6). T2.4 measured against them.
T4.3 added the 41-entry `tier: 2` subset and the local model that answers it;
T4.4 built `svatah eval compiler` and published the report.

P4-F4 added the 30 assertion-alias entries and moved three from tier 2 to tier 1.
`Make sure the dashboard heading is visible`, `Verify that the sign in button is
enabled` and `Ensure the booking result reads "confirmed"` were `tier: 2` cases
only because the grammar refused them; now that it accepts them (LLD §4.2,
Draft 2.6) they never reach the model, and a `tier: 2` entry the grammar answers
is not a Tier 2 measurement — it is a Tier 1 one wearing the wrong label.

## `refused.jsonl` — the Tier 2 corpus (T8.4)

`refused.jsonl` is the training corpus for Tier 2, and every line in it is a
sentence the **grammar refuses**, with the step a reviewer says it means:

```json
{"id":"r-007","rule":"click","text":"Give the sign in button a click","step":{ … },"why":"colloquial","reviewedBy":"T8.4"}
```

| Field | Meaning |
|---|---|
| `id` | `r-NNN`, unique and sequential. |
| `rule` | The action the sentence means, so the corpus can be read by family. |
| `text` | The sentence. `tools/repo-checks` compiles every one of them and fails if the grammar accepts it. |
| `step` | The same shape a `golden.jsonl` entry's `step` has. The export converts it to the shape a Tier 2 *answer* has. |
| `why` | What makes this sentence Tier 2's work rather than Tier 1's. |
| `reviewedBy` | Who accepted the pair. |

### Why it exists

Phase 7 trained the Tier 2 LoRA on pairs exported from **merged flows**: 83
sentences, every one of them a tier 1 grammar compile. The tuned model went from
86.8 % to **13.2 %** on the golden `tier: 2` subset — it had been taught to
answer the questions it is never asked (T7.5, and Phase 7 verification F7).
Draft 2.9 withdraws the fine-tune from 0.1.0 and makes this corpus the
precondition for another attempt.

`svatah eval finetune corpus` reports the three sources it draws on and what
each contributes; `svatah eval finetune export` writes the pairs from this file
and nothing else. The golden set is the test set and is never exported.

### What is not in it

Sentences whose step a Tier 2 answer cannot express. `modelStepSchema` has no
`invoke`, so `Run the "Sign in" story` — a sentence the grammar does refuse —
would export as `{"action":"invoke"}` with the story name lost, and teach the
model to answer with a step nobody can execute. Five such pairs were written and
removed; the schema is the boundary of what this corpus can hold.
