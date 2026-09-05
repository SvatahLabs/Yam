# The runtime conformance fixture

`results.jsonl`, `summary.json` and `plan.sha256` from one run of the four
migrated fixture flows against `apps/sample-web` (T2.10, REQ-NFR-8, REQ-STD-2).

## These files are a projection, not an artifact (Draft 2.8 §14)

They are written **canonically**: the run id, the timestamps, the durations and
the config hash are removed. Those change on every run, so a verbatim copy could
never be diffed — CI would report a change every time and nobody would read the
diff. What is left is exactly what a foreign runtime is compared on.

Which means these files are a **projection** of a run and are *not themselves
valid* against `stepResultSchema` and `summarySchema`. That distinction cost a
false result once and is stated here because of it: Phase 6's Java runtime
copied this projection instead of the schema — it wrote no `startedAt`,
`endedAt` or `durationMs` on any of its forty lines — and the conformance suite
reported it conformant, because the suite compared the projection and never
looked at the file (Phase 6 verification, F2).

So a foreign runtime must write **full** `results.jsonl` and `summary.json` in
the published schemas, and `scripts/runtime-conformance.mjs` validates both
against `stepResultSchema` and `summarySchema` *before* it compares anything.
"A runtime whose artifacts do not validate is not conformant whatever the
comparison says" (§14). To see that gate work:

```bash
node scripts/runtime-conformance.mjs --strip startedAt
```

which deletes one required field from the first line the runtime wrote and
fails with the file, the line and the schema path.

Regenerate with:

```bash
node scripts/compatibility.mjs
```

That script also *is* the compatibility milestone. It runs the four flows four
times — `--host none` twice and `--host playwright` twice — and asserts three
things before writing anything here:

| Claim | Requirement | Observed |
|---|---|---|
| Two runs of one plan give the same step outcomes | REQ-RUN-2 | identical over 40 step results, both hosts |
| The same plan under both hosts gives the same statuses and matches | REQ-BEH-5 | identical over 40 steps |
| Two compiles produce the same `plan.json` | REQ-COMP-7 | `plan.sha256` |

## What a foreign runtime is compared against

REQ-STD-3 asks a foreign runtime to execute `plan.json` and bindings and pass a
runtime conformance suite. This is the first fixture for that suite: the plan is
`svatah compile evals/fixtures --stable` (its hash is in `plan.sha256`), the
bindings are `evals/fixtures/bindings`, and a conformant runtime produces the
same **status** and the same **matched candidate** for every step. Timestamps,
durations and the run id belong to the run rather than to the plan and are not
compared.

## The four steps that do not pass, and why

T2.10 allows "all steps pass except documented unsupported ones". These are
those, and none is a defect in the runtime, the compiler or the bindings — each
is an assumption the *original* application satisfied and `apps/sample-web` does
not. `tools/repo-checks/test/conformance.test.ts` holds the list to exactly these
four, so a fifth failure fails the build rather than being absorbed into a
number.

| Flow | Step | Why |
|---|---|---|
| `execution.flow` | `Click the Indiranagar suggestion` | The suggestion is a `<datalist>` `<option>`. A browser does not let you click one — the original site rendered its suggestions as list items. The binding is correct and resolves; the *click* is what the browser refuses. |
| `natural_language_login.flow` | `The schedule heading should be visible` | The original asserted "the Schedule Build page appears" immediately after signing in. The sample application lands on `/dashboard`, and the schedule heading is on `/schedule-build`. The flow never navigates there, because the original did not have to. |
| `simple.flow` | `Type {data.user.email} into the username field` | Third story, after "validate logout". The original site returned to the login page on logout; the sample application shows a logout page with a *Sign in again* link, and the flow does not click it. |
| `svatah.flow` | `Wait for the username field to be present` | The flow goes back and then forward, expecting to land where the username field is. In the original, the "dashboard link" was `xpath://a[contains(@href, '/login')]` — it went to the login page. The sample application's dashboard link goes to the dashboard. |

Each of those is a **faithful** migration doing its job. P0-F2 required the
fixtures to keep one step per original step, in order, and these four are where
that faithfulness collides with a different application. Editing the flows to
make them pass would be editing away the evidence.

The 15 `skipped` results are the steps after each failure, which is the default
`stop` policy working (REQ-RUN-4).
