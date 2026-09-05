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
| `pattern` | The [`docs/flow-language.md`](../../docs/flow-language.md) pattern number; 0 for a Tier 0 custom step. |
| `rule` | The grammar rule or custom-step id expected in `origin.rule`. |
| `text` | The sentence as an author would write it. |
| `step` | The part of the compiled step the sentence determines. |

`step` deliberately omits the mechanical fields every step carries — `id`,
`storyName`, `line`, `text`, `timeoutMs` and `origin` — because the compiler fills
them in regardless of the sentence and they would be noise in a file meant to be
read. `materialise()` in
[`tools/repo-checks/src/golden.ts`](../../tools/repo-checks/src/golden.ts) adds
them before validating each entry against `ir.schema.json`.

## What the set covers

- All 30 sentence patterns, each with at least two entries.
- All 39 `Action` values. `custom` appears only at tier 0, because no grammar can
  produce it (LLD §5).
- Every predicate kind and every kind of value reference, including a secret.

## Thresholds

REQ-COMP-9 requires at least 300 pairs before release, 100 % exact match on the
tier-1 subset, and at least 95 % end to end. Phase 0 seeds the first 148 tier-1
entries (T0.6 requires 120); T2.4 measures against them, T4.3 adds the `tier: 2`
subset, and T4.4 publishes the report.

`svatah eval compiler` does not exist yet — it is built in T4.4. Until then the set
is validated by `pnpm -r test` (`tools/repo-checks/test/golden.test.ts`).
