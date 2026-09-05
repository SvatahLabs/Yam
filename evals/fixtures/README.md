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

Every story and scenario name and every step is preserved in order. What changed
is what v3 removes: the `+action+`, `~locator~` and `*data*` sigils, every inline
locator, and the `#var#` / `$key` variable forms. See the migration table in
[`docs/flow-language.md`](../../docs/flow-language.md).

`execution.flow` is the one flow whose targets could not be preserved literally:
it drove a third-party booking site through inline XPaths that no longer exist
anywhere. Its scenario names, step count and step order are preserved, and its
targets are rewritten as the phrases the equivalent controls carry on
`apps/sample-web` — which is what makes it recordable and replayable at all.

`data.yaml` holds the run data; the three secrets are `${ENV}` indirections, so
nothing sensitive is committed.
