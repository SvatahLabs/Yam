# Fixture flows

The four sample flows from the frozen Java project, hand-migrated to v3
(T0.6). They are the compatibility baseline REQ-NFR-8 names: once the compiler
(T2.4, T2.5) and the executor (T2.7) exist, these must compile clean and run end
to end against `apps/sample-web`, and `svatah migrate` (T2.9) must reproduce them
from the originals.

| v3 fixture | Original |
|---|---|
| [`flows/simple.flow`](flows/simple.flow) | `legacy/src/test/resources/sample/simple.flow` |
| [`flows/svatah.flow`](flows/svatah.flow) | `legacy/src/test/resources/sample/svatah.flow` |
| [`flows/execution.flow`](flows/execution.flow) | `legacy/src/test/resources/sample/execution.flow` |
| [`flows/natural_language_login.flow`](flows/natural_language_login.flow) | `legacy/src/test/resources/sample/natural_language_login.flow` |
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
`legacy/src/test/resources/sample/` and requires each name to appear in the
migrated file, so renaming a scenario cannot pass by also editing the
expectation.

`data.yaml` holds the run data; the three secrets are `${ENV}` indirections, so
nothing sensitive is committed.
