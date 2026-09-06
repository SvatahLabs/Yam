# Fixture flows

The four sample flows from the frozen Java project, hand-migrated to v3
(T0.6). They are the compatibility baseline REQ-NFR-8 names: once the compiler
(T2.4, T2.5) and the executor (T2.7) exist, these must compile clean and run end
to end against `apps/sample-web`, and `svatah migrate` (T2.9) must reproduce them
from the originals.

| v3 fixture | Original |
|---|---|
| [`flows/simple.flow`](flows/simple.flow) | `evals/migrate/source/sample/simple.flow` |
| [`flows/svatah.flow`](flows/svatah.flow) | `evals/migrate/source/sample/svatah.flow` |
| [`flows/execution.flow`](flows/execution.flow) | `evals/migrate/source/sample/execution.flow` |
| [`flows/natural_language_login.flow`](flows/natural_language_login.flow) | `evals/migrate/source/sample/natural_language_login.flow` |
| [`flows/booking-compensation.flow`](flows/booking-compensation.flow) | *(none — see below)* |

Every story and scenario name and every step is preserved in order. What changed
is what v3 removes: the `+action+`, `~locator~` and `*data*` sigils, every inline
locator, and the `#var#` / `$key` variable forms. See the migration table in
[`docs/flow-language.md`](../../docs/flow-language.md).

`execution.flow` is the one flow whose targets could not be preserved literally:
it drove a third-party booking site through inline XPaths that no longer exist
anywhere. Its seven scenario names are the original's verbatim — `start zoomcar
booking`, `perform search`, `select date and time`, `select car and login`,
`checkout the selected car`, `initiate payment`, `logout` — and it has exactly one
step per original step, in the original order. Only the targets are rewritten, as
the phrases the equivalent controls carry on `apps/sample-web`, which is what
makes it recordable and replayable at all. The step-by-step mapping is in
[`docs/spec/progress/phase-1.md`](../../docs/spec/progress/phase-1.md) under
deviation D9.

`booking-compensation.flow` is **not** a migration. It is the fixture for
`onFailure=compensate:<story>` (REQ-AUTO-4), which no legacy flow could express:
a booking flow, a paying flow, and a `cancel booking` story that runs when either
fails. The first migration of `execution.flow` folded this showcase into that
file, which cost three of the original's scenario names and introduced a scenario
the original never had; separating the two leaves `execution.flow` a faithful
migration and gives the abort policy a fixture of its own.

The name-preservation check does not read a list written here or in the test. It
parses the block headers out of the originals under
`evals/migrate/source/sample/` and requires each name to appear in the
migrated file, so renaming a scenario cannot pass by also editing the
expectation.

`data.yaml` holds the run data; the three secrets are `${ENV}` indirections, so
nothing sensitive is committed.

## The bindings, and how they got there (T3.5)

`bindings/` is the recorder's output, not a hand-seeded store. Phase 2 wrote it by
pointing at elements by hand and synthesising candidates against the live page —
the recorder's output *shape* without the recorder — and recorded that as a known
gap. T3.5 closes it:

```bash
node scripts/record-fixtures.mjs                 # with a model
node scripts/record-fixtures.mjs --gateway fake  # from the eval's committed answers
```

Every entry here was grounded, performed by a step through the executor's own
`runStep`, and confirmed by that step passing (REQ-REC-5). `provenance.model`
says which gateway decided it, so a store recorded from the grounding eval's
answers can never be read as one a model produced.

`record-report.json` is the merged report for the four sessions: every step, its
grounding decision, the snapshot size, the tokens, the cost, and the candidate the
step resolved through (REQ-REC-8).

### None of the four sessions finished, by design

Each fixture carries exactly one documented step `apps/sample-web` cannot satisfy
— see the table in [`../conformance/runtime/README.md`](../conformance/runtime/README.md).
A recording stops there and writes what the steps before it proved, so the store
is exactly the set of bindings a passing step verified, and the four documented
failures stay visible rather than being recorded around.

Two phrases the fixtures use name elements the eval cannot score — the two
headings, which are not interactive and so carry no ground-truth key. They live in
`evals/grounding/fixture-answers.jsonl` rather than in the case set, so recording
without a credential can answer them and a published accuracy figure is never
dragged by a case nobody could check.
