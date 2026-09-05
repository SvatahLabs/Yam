# Phase 2 — progress and verification

Branch: `phase-2` (from `phase-1` at `beb8b53`) · Date: 2026-09-02 · Scope: the
Draft 2.3 spec amendments, the six Phase 1 corrections, and T2.1 … T2.12 of
[`../tasks.md`](../tasks.md). Phase 3 was not started.

## Summary

| Item | Title | Status | Commit |
|---|---|---|---|
| — | Spec 2.3: module (a) command line, Replayer plugin and healing ground truth | done | `2d11233` |
| F1 | Healing ground truth | done | `bd986c4` |
| F2 | Contract command | done | `b582652` |
| F3 | Quick start side effect and port in URL patterns | done | `7460e9a` |
| F4 | Package skeletons | done | `c793a11` |
| F5 | Residual boundary note | done | `758d061` |
| F6 | Progress file | done | `c61e18b` |
| T2.1 | Spec reader with signatures and guards | done | `8afcab9` |
| T2.2 | Synonym vocabulary and target dictionary | done | `33c5b47` |
| T2.3 | Tier 0 custom typed steps | done | `7c41be9` |
| T2.4 | Tier 1 grammar | done | `3eb04fb`, `640f0ea` |
| T2.5 | Compiler pipeline, validation, plan, lint | done | `ff9204b` |
| T2.6 | HTTP adapter | done | `4c56f18` |
| T2.7 | Executor core with policies, checkpoints, audit | done | `05bada9` |
| T2.8 | Playwright Test host | done | `bb5b147` |
| T2.9 | Migration tool | done | `742140d` |
| T2.10 | CLI for module (b) and compatibility run | done | `fda684a`, `24b4869`, `84ac7ea`, `1bf80ca` |
| T2.11 | Local service | done | `eb99dde`, `347ea54` |
| T2.12 | Module (a) command line and healer replay plugin | done | `0410918` |

The four spec documents were changed only by the Draft 2.3 amendments the
verifier authorised:

```
$ git log --format='%h %s' phase-1..HEAD -- docs/spec/requirements.md docs/spec/hld.md docs/spec/lld.md docs/spec/tasks.md
2d11233 Spec 2.3: module (a) command line, Replayer plugin and healing ground truth
```

`docs/flow-language.md` is not one of those four and was extended by T2.1 and
T2.2 with the run-block semantics, bare boolean metadata flags and the new
diagnostic codes.

## The contract

Everything below was re-run from a **clean clone of `phase-2`** into an empty
directory, not from the working tree.

```bash
pnpm install && pnpm browsers && pnpm -r build && pnpm -r test
```

Observed:

```
pnpm install --frozen-lockfile                                              exit 0
pnpm browsers                                                               exit 0
pnpm -r build                                            29 packages built  exit 0
pnpm -r test                                                                exit 0
```

| Package | Tests | Runner |
|---|---|---|
| `packages/schema` | 142 | vitest |
| `packages/surface` | 133 | vitest |
| `packages/spec` | 205 | vitest |
| `packages/steps` | 29 | vitest |
| `packages/compiler` | 219 | vitest |
| `packages/bindings` | 123 | vitest |
| `packages/healer` | 18 | vitest |
| `packages/runtime` | 37 | vitest |
| `packages/adapter-http` | 69 | vitest |
| `packages/migrate` | 32 | vitest |
| `packages/conformance` | 10 | vitest |
| `packages/bindings-cli` | 25 | vitest |
| `packages/cli` | 38 | vitest |
| `packages/service` | 21 | vitest |
| `apps/sample-web` | 203 | vitest |
| `tools/repo-checks` | 464 | vitest |
| **vitest** | **1,768** | |
| `packages/adapter-playwright` | 179 | Playwright |
| `packages/playwright-test` | 34 | Playwright |
| `packages/host-playwright` | 13 | Playwright |
| `examples/plain-playwright` | 9 | Playwright |
| **Playwright** | **235** | |
| **total** | **2,003** | |

**`pnpm browsers` replaces Phase 1's `pnpm exec playwright install chromium`**
(F2). The four commands are now the whole contract: a clean checkout that runs
them has run everything.

### Additional commands a Validate item needs

All run from the clean clone.

| Command | What it demonstrates | Observed |
|---|---|---|
| `pnpm lint` | LLD §1's import boundaries, including the new `service` rule | exit 0 |
| `pnpm -r typecheck` | strict TypeScript across every package | exit 0 |
| `pnpm check:licenses` | REQ-PKG-3 | `Licence check OK — 375 packages, 7 licences` |
| `pnpm conform:playwright` | REQ-SURF-3 | 16 passed, 0 failed, 0 skipped, 72 checks |
| `pnpm eval:healing` | REQ-HEAL-5, both populations | **92.3 %** (48/52) and 78.9 % (15/19) |
| `pnpm quick-start` | REQ-PKG-2 | 10.1 s of a ten-minute budget; `examples/` unchanged |
| `node scripts/compatibility.mjs` | T2.10's milestone | see below |
| `git diff --exit-code evals/conformance/runtime` | the fixture is what a run produces | clean |
| `node scripts/migrate-legacy.mjs --check` | T2.9's byte comparison | exit 0 |
| `node scripts/compile-fixtures.mjs --check` | the host's fixture plan is current | exit 0 |
| `cd legacy && ./gradlew --no-daemon compileJava` | the frozen Java project still builds | `BUILD SUCCESSFUL in 9s` |

Environment: Node v25.6.1, pnpm 10.30.2, Playwright 1.62.1, OpenJDK 17, macOS
(darwin 25.3.0). The project targets Node 22 LTS; see **Known gaps**.

---

# Part 1 — the Phase 1 corrections

## F1 — Healing ground truth

**Status: done.** Commit `bd986c4`.

```bash
pnpm eval:healing
#   healing eval [no-test-ids]   — relocalize-only 92.3% (48/52), threshold 60%: met
#   healing eval [with-test-ids] — relocalize-only 78.9% (15/19), threshold 60%: met
pnpm --filter @svatah/healer test          # 4 ground-truth tests, incl. the negative control
pnpm --filter @svatah/playwright-test test # relocalize.spec.ts, ground truth read by page script
```

| Validate item | How | Observed |
|---|---|---|
| `data-svatah-eval` on every interactive element, identical across variants | `apps/sample-web/test/ground-truth.test.ts` | 33 tests: every interactive element keyed on every page; keys unique per page and across the app; **no variant mints a key that did not exist at variant 0** |
| `bindings.ignoreAttributes`, honoured by synthesis, fingerprinting and `native` | `packages/bindings/test/synthesis.test.ts`, the adapter's page script | 4 tests; the ignore list wins even when the attribute is *also* named a test id |
| The eval reads the key outside the surface | `PlaywrightSurface.readRawAttribute` | a page script; not on `AgentSurface`, not in the conformance suite |
| `wrong-element` on a key mismatch | `packages/healer/test/eval-ground-truth.test.ts` | the negative control: same eval, same stub, only the proposed element's key altered → `recovered` becomes `wrong-element` |
| Both populations reported | `reports/eval-healing.md` | `## Both populations`, headline `no-test-ids` |
| README numbers updated | `README.md` | both populations, wrong-element count, and how recovery is now defined |

**The number did not move.** 92.3 % (48/52) with **zero wrong elements**, under
a rule that Phase 1's check would have let a confidently wrong repair pass. So
Phase 1's figure was not inflated — but until this correction there was no way to
show that, which was the objection.

The key is stamped on the *baseline* document, before a variant is applied, so
every transform carries it along with the element it moves. An element a variant
adds has no key, and relocalizing onto it is correctly a miss.

## F2 — Contract command

**Status: done.** Commit `b582652`.

`pnpm exec playwright install chromium`, as Phase 1 published it, **did not
work**: `playwright` was a dependency of the adapter package and of nothing else,
so `pnpm exec playwright` at the repository root resolved no binary. Phase 1's
runs did not catch it because they were made from the adapter's workspace, where
it does resolve.

| Validate item | How | Observed |
|---|---|---|
| Root `browsers` script | `package.json` | `pnpm --filter @svatah/adapter-playwright exec playwright install chromium` |
| `playwright` a root dev dependency | `package.json` | from the catalog; `pnpm exec playwright --version` → 1.62.1 at the root |
| The documented contract is the four commands | `README.md`, both example READMEs | `tools/repo-checks/test/packaging.test.ts` asserts the README states all four **in order** |

The earlier test only checked that a browser was mentioned, which the broken
instruction also satisfied.

## F3 — Quick start side effect and port in URL patterns

**Status: done.** Commit `7460e9a`.

| Validate item | How | Observed |
|---|---|---|
| `pnpm quick-start` leaves `git status --porcelain examples/` unchanged | `scripts/quick-start.mjs` | records into a temporary store via `SVATAH_BINDINGS`; asserts the status is *unchanged*, not empty |
| `urlPattern` path-based by default | `packages/bindings/src/context.ts` | `contextPattern("http://127.0.0.1:65431/login")` → `/login` |
| `bindings.matchHost` puts the origin back | config, fixture option `svatahMatchHost` | 2 tests |
| The example bindings re-recorded | `examples/plain-playwright/bindings/login/*.yaml` | `pattern: "/login"` |
| No committed binding pattern contains a port | `tools/repo-checks/test/bindings-store.test.ts` | 7 tests, over every committed store |

`patternMatches` normalises the *stored* side too, so a store written before this
change keeps resolving and nobody has to re-record.

*Unchanged*, not *empty*: comparing against empty would fail for anyone with
unrelated edits under `examples/` — including whoever is editing the example —
and a check that fires on unrelated work is a check people turn off.

## F4 — Package skeletons

**Status: done.** Commit `c793a11`.

`packages/bindings-cli` and `packages/host-playwright` created so HLD §12's
layout test passes ahead of T2.12 and T2.8. The boundary configuration follows
the amendment rather than waiting for the content: module (a) gains
`bindings-cli`, and what module (a) may not import gains `runtime`.

## F5 — Residual boundary note

**Status: done.** Commit `758d061`.

Both `eslint.config.js` and `tools/repo-checks/test/import-boundaries.test.ts`
now state that a **computed dynamic specifier** and **`createRequire`** are
outside a static linter's reach, and that the transitive-closure test over every
`package.json` is the guard that holds at run time under pnpm's strict isolation.

## F6 — Progress file

**Status: done.** Commit `c61e18b`.

`docs/spec/progress/phase-1.md` gained a **Post-verification corrections**
section, with a pointer to it from the summary table. Nothing above it was
rewritten, so the original claim and its correction are both readable. It records
the Node 22 result (the verifier's, not this session's — see K1), the root
install failure and why Phase 1's runs missed it, and the eval verification
sentence in both its old and new wording.

---

# Part 2 — Phase 2

## T2.1 — Spec reader with signatures and guards

**Status: done.** Commit `8afcab9`.

```bash
pnpm --filter @svatah/spec test   # 205 tests
```

| Validate item | How | Observed |
|---|---|---|
| Unit tests per rule | `test/reader.test.ts` | 48: blocks, comments, indentation, metadata, signatures, guards |
| `E_DUP_STORY` | `test/project.test.ts` | across two files and within one; the first definition is kept |
| `E_TEST_EMPTY` | `test/project.test.ts` | when a bare run block's own name names nothing |
| Signature type errors | `test/reader.test.ts` | unknown type, `secret` as an output, a default of the wrong type, a default on a secret, a non-literal default, a duplicate name, a signature after a step |
| `onFailure` value validation | `test/reader.test.ts` | `stop`/`continue`/`compensate:<story>`; anything else refused; `continueOnFailure` alias; both set is an error |
| The five fixtures read clean | `test/fixtures.test.ts` | 0 errors, 3 `W_SECRET_UNSET` (nothing is set in that environment) |

**Two semantics the legacy parser settled**, both recorded under Deviations:
a bare run block runs the story or composition of its own name, and a flow with
no run block runs its `scenario:` blocks in file order.

Reading the fixtures found a real defect inherited from the legacy original:
`natural_language_login.flow`'s `test : Run all login stories` names nothing that
exists — the legacy parser would have failed on it too.

## T2.2 — Synonym vocabulary and target dictionary

**Status: done.** Commit `33c5b47`.

| Validate item | How | Observed |
|---|---|---|
| Every Java synonym resolves | `test/vocabulary.test.ts` reads `ActionSynonyms.java` | 66 verbs, 200+ synonyms; each resolves to the verb it was registered under |
| Normalisation table | `test/dictionary.test.ts` | 11 phrase → id cases |
| Ambiguity yields `W_AMBIGUOUS_TARGET` | `test/dictionary.test.ts` | a warning naming both ids; the step still compiles |
| `actions.yaml` published | `packages/spec/actions.yaml` | generated, committed, drift-tested |

The port is checked against `ActionSynonyms.java` itself rather than a
transcription — a port verified against a copy of what was ported verifies the
copy. A further test asserts the port added **nothing** the Java did not have.

## T2.3 — Tier 0 custom typed steps

**Status: done.** Commit `7c41be9`.

| Validate item | How | Observed |
|---|---|---|
| An example step with a `target` placeholder compiles | `test/fixtures/steps/transfer.ts`, loaded by the loader | targets in `custom.targets`, values in `custom.params` |
| Ambiguity test | `test/loader.test.ts`, `packages/compiler/test/compile.test.ts` | two templates claiming one sentence; a template *and* a grammar pattern |
| The handler cannot reach the adapter (type test) | `test/context.test.ts` | `@ts-expect-error` on `page`, `driver`, `browser`, `context`, `adapter`, `surface.page`, and on writing `args` or `scope.data` |

The type test was verified non-vacuous by adding `page` to `StepContext` and
watching `typecheck` fail two ways, then reverting.

## T2.4 — Tier 1 grammar

**Status: done.** Commits `3eb04fb`, `640f0ea`.

```bash
pnpm --filter @svatah/compiler test   # 219 tests
```

| Validate item | How | Observed |
|---|---|---|
| 100 % on `tier: 1` golden | `test/golden.test.ts` | **148/148 exactly**, per entry and as a headline number |
| Every sigil form rejected | `test/grammar.test.ts` | 9 forms, one sentence each, each isolated so none shadows another |
| Fixtures parse with zero errors | `test/grammar.test.ts` | all five, every step, and every step lowers to a valid IR step |
| 1,000 steps under 1 s | `test/grammar.test.ts` | **35 ms** for parse + lower |

Making the golden set compile turned up three things: `status: "bound"` meant the
wrong thing (a `targets.yaml` id is not a binding); the golden set was internally
inconsistent about `sideEffect` on the same two targets; and the golden set had
no project to compile in, which `evals/compiler/project/` now is.

## T2.5 — Compiler pipeline, validation, plan, lint

**Status: done.** Commit `ff9204b`.

| Validate item | How | Observed |
|---|---|---|
| Byte-stability | `test/compile.test.ts` | two compiles, identical bytes; `--stable` fixes `generatedAt`; without it only the timestamp differs |
| Error matrix | `test/compile.test.ts` | `E_VAR_UNDEFINED` (capture, input, data path, other story), `E_VAR_REDEFINED`, `E_OUTPUT_UNCAPTURED`, `E_INPUT_REQUIRED`, `E_UNKNOWN_STORY` (invoke and compensating story), `E_UNKNOWN_API`, `E_STEP_AMBIGUOUS` |
| Fixtures compile clean | `test/compile.test.ts` | 0 errors; every story, every step; secrets marked |
| A story exposing outputs not captured fails | `test/compile.test.ts` | `E_OUTPUT_UNCAPTURED`, `ok: false` |
| Lint codes | `test/compile.test.ts` | `W_LONG_SLEEP` (over 5 s, not at 5), `W_CUSTOM`, `W_UNUSED_CAPTURE`, `W_LOW_CONFIDENCE`, `W_SIDE_EFFECT_TOOL` |

**A real fault found:** `planHash` covered `generatedAt`, so recompiling the very
same flows would have made every in-flight run unresumable (REQ-AUTO-3) — the
check firing on the one case it exists to permit.

## T2.6 — HTTP adapter

**Status: done.** Commit `4c56f18`.

| Validate item | How | Observed |
|---|---|---|
| Field matrix against a local server | `test/request.test.ts` | 7 methods, headers, query, path params (both spellings, percent-encoded), form, JSON, raw body, basic auth, cookies, multipart upload, redirects, timeouts, transport errors |
| Cookie-sharing test | `test/request.test.ts` | with and without; the adapter's own jar across requests; the request's cookie wins; the jar restores |

Against a real echo server, not a mocked `fetch`: a mock can only report what it
was called with.

## T2.7 — Executor core with policies, checkpoints, audit

**Status: done.** Commit `05bada9`.

```bash
pnpm --filter @svatah/runtime test   # 37 tests
```

| Validate item | How | Observed |
|---|---|---|
| Parallelism | `test/executor.test.ts` | four workers open two flows before either finishes; one worker opens them strictly in sequence; each flow owns its own surface |
| Skip semantics | same | the rest of the story, the rest of the flow, and a disabled story |
| Policy matrix | same | `stop`, `continue`, `compensate` — including that the compensating story **sees what the failing one captured**, and that its steps record as `aborted` |
| Guard skip without act | same | `surface.actions` is asserted **empty**; a guard that errors is class `guard` and still does not act; a scope guard never touches the surface |
| Invoke with inputs and outputs | same | outputs captured under the calling step; a failed invoke fails the caller; unknown input refused; the caller's scope is restored |
| Checkpoint files per step | same | one per step, with the scope and the session; none when checkpoints are off; run data deliberately absent |
| Audit redaction of `secret` values | same | the secret is redacted from the audit *and* from the results, wherever it ended up |
| Overhead under 5 ms per step | same | **0.005 ms** over 200 steps |
| Determinism on the sample app | `scripts/compatibility.mjs` | T2.10; the stub-level check is here |

Two faults the tests found: an invoked story's steps were missing from the
results, and `failure.policyApplied` was lost once results streamed.

## T2.8 — Playwright Test host

**Status: done.** Commit `bb5b147`.

```bash
pnpm --filter @svatah/host-playwright test   # 13 tests
```

| Validate item | How | Observed |
|---|---|---|
| Generated specs run under Playwright Test | `test/host.spec.ts` | a child Playwright process runs a generated spec end to end |
| …with two shards | same | `--shard=1/2` and `2/2` both succeed; exactly one runs the flow, which is right for a file whose stories are serial |
| …and the HTML reporter | same | `html/index.html` produced alongside |
| Svatah `results.jsonl` produced alongside | same | every step, with `matched.by`; `summary.json` with the plan hash |
| Retries disabled unless permitted | `test/generate.spec.ts` | off by default; on for `idempotent`; on for `onFailure=continue`; off for an unknown story |

The scope test is the load-bearing one: the second story reads
`{Sign in.heading}`, which reads nothing unless the fixture is worker-scoped. It
failed that way first.

Two findings: the child needs a project *inside* the package (nothing resolves
`@playwright/test` above `/tmp`), and the runner must be spawned asynchronously —
`spawnSync` blocks the event loop and the sample application is served from the
same process.

## T2.9 — Migration tool

**Status: done.** Commit `742140d`.

```bash
node scripts/migrate-legacy.mjs --check   # exit 0
pnpm --filter @svatah/migrate test        # 32 tests
```

| Validate item | How | Observed |
|---|---|---|
| `src/test/resources` migrates to flows compiling clean | `tools/repo-checks/test/migrate.test.ts` | 0 read errors, 0 compile errors, **0 unmapped steps** |
| Equal story names and step counts | same | per story, against the originals *and* against the hand-migrated fixtures |
| Candidate counts equal `&` alternatives | `packages/migrate/test/migrate.test.ts` | one candidate per alternative, in order, scored by position |
| Golden output compared byte-for-byte | `tools/repo-checks/test/migrate.test.ts` | against `evals/migrate/expected`, per file — see D6 for why not against the fixtures |

A rule I wrote and my own test deleted: removing an interior preposition would
have turned "the sign in button" into "the sign button". The phrase is left as it
stands and flagged for the reviewer.

## T2.10 — CLI for module (b) and compatibility run (milestone)

**Status: done.** Commits `fda684a`, `24b4869`, `84ac7ea`, `1bf80ca`.

```bash
node scripts/compatibility.mjs
#   plan.json is byte-stable — sha256 d81e7c7a…
#   none: two runs identical — 40 step results
#   playwright: two runs identical — 40 step results
#   both hosts: identical statuses and matches — 40 steps
#   totals: 21 passed, 4 failed, 15 skipped, 0 aborted
git diff --exit-code evals/conformance/runtime   # clean
pnpm --filter @svatah/cli test                   # 38 tests
```

| Validate item | How | Observed |
|---|---|---|
| `compile`, `lint`, `run` (both hosts), `migrate`, `init`, `doctor` | `packages/cli/test/commands.test.ts` | each command, each exit code from LLD §15 |
| Identical results across two runs (REQ-RUN-2) | `scripts/compatibility.mjs` | identical over 40 step results, under each host |
| The same plan under both hosts (REQ-BEH-5) | same | identical statuses **and** matched candidates |
| Two compiles produce identical `plan.json` (REQ-COMP-7) | same | `d81e7c7ad21e4f7a6cd3de9ba5eea3304470c79b3da882752ceca2a355827118` |
| The run directory committed as the runtime conformance fixture | `evals/conformance/runtime/` | canonical, diffable, checked in CI |
| All steps pass except documented unsupported ones | `evals/conformance/runtime/README.md`, `tools/repo-checks/test/conformance.test.ts` | **21 passed, 4 failed, 15 skipped**; the failing set is held to exactly the four documented |

The four are documented one by one with their cause. None is a defect in the
runtime, the compiler or the bindings: a `<datalist>` `<option>` a browser will
not click, and three steps encoding what the *original* application did. Each is
a faithful migration doing its job, and editing the flows to make them pass would
be editing away the evidence. The 15 skips are the `stop` policy working.

Six faults this turned up, each fixed where it belonged: a session that would not
open crashed the run; neither host navigated to the base URL; run-level `--input`
reached stories that never asked for one; `--input` and `--flow` silently kept
only the last value; the reporter subpath had no `default` export condition; and
`--out` and the plan path were joined rather than resolved.

Two more came out of writing the README's flow example, which is the first
config a new user writes rather than a complete one: `loadConfig` merged the
file over the defaults **shallowly**, so `bindings: { dir: fixtures }` dropped
`testIdAttributes` and `ignoreAttributes` and the command died on a raw
`ZodError` stack. The merge is now one level deep, and a config that fails the
schema is a message naming the path plus exit 64. Neither showed up earlier
because the fixture project and `svatah init`'s template both write every
section out in full. `packages/cli/test/commands.test.ts` now also compiles the
README's flow block, so the example cannot rot — its first draft used three
patterns the grammar does not have.

## T2.11 — Local service

**Status: done.** Commits `eb99dde`, `347ea54`.

```bash
pnpm --filter @svatah/service test   # 21 contract tests
pnpm --filter @svatah/cli test       # includes the CLI-vs-service comparison
```

| Validate item | How | Observed |
|---|---|---|
| Contract tests per endpoint | `packages/service/test/contract.test.ts` | `/project`, `/flows/*`, `/compile`, `/run`, `/runs*`, `/bindings*`, `/data`, `/api`, `/events`, `/events/sse`, `/openapi.json`, `/health` |
| An unauthenticated request is refused | same | 401 without a token and with a wrong one; `/health` and `/openapi.json` open; a different token per process; loopback only |
| A `run` streams one `step.result` per step and a final `run.summary` | `packages/cli/test/service.test.ts` | 4 results then the summary, every event carrying the run id, and the stream agrees with the file the run wrote |
| The same run via CLI and via service produces identical `results.jsonl` | same | identical, minus the run's own fields |
| OpenAPI document committed | `packages/service/openapi.json` | 16 paths; a test fails when the served and committed documents disagree |

Four attempts to keep `service ─► cli` failed and made the real problem clear:
the dependency was pointing the wrong way. The CLI now **injects** its four
functions, the service imports `@svatah/schema` alone, and the boundary rule is
tighter than the spec's parenthetical — the service has no way to reach the
compiler or the executor. Recorded as D9.

## T2.12 — Module (a) command line and healer replay plugin

**Status: done.** Commit `0410918`.

```bash
pnpm --filter @svatah/bindings-cli test   # 25 tests
node packages/bindings-cli/dist/bin.js bindings list --dir evals/fixtures/bindings
node packages/cli/dist/bin.js           bindings list --dir evals/fixtures/bindings
#   → byte-identical output
```

| Validate item | How | Observed |
|---|---|---|
| The dependency-tree test covers `bindings-cli` as module (a) | `tools/repo-checks/test/module-a-cli.test.ts`, `packaging.test.ts`, `import-boundaries.test.ts` | reaches no module (b) package through any field; its dependencies are held to exactly LLD §1's six |
| A clean install of the module (a) tarballs exposes `svatah-bindings` | `pnpm pack` × 8 into an empty `npm` project | `node_modules/@svatah/` holds exactly the eight module (a) packages; `./node_modules/.bin/svatah-bindings help` runs |
| `svatah-bindings heal --from-bind-failures` works with no module (b) installed | the same clean project | ran, reported `1 unrepaired` with the session-state replayer named, exit 0 |
| `svatah heal --run <id>` replays through the runtime | `packages/cli/src/replayer.ts`, registered in `cli.ts` | replays the story to *one step before* the failing step |
| The `Replayer` interface with a session-state default | `packages/healer/src/replayer.ts`, `test/replayer.test.ts` | 14 tests, including that a redirect to a login page is `unreachable` |

---

## Deviations

### D1 — A bare run block runs the story of its own name

**LLD §4.1, REQ-LANG-10.** The grammar gives `Header := Kind Meta? ':' Name`, and
the glossary says a run block names "which stories or compositions execute, in
order". Neither says what a `test:` block with nothing under it runs.

Every legacy flow is written that way — `test : Validate Text` — and reading
`SvatahParserV2.java` settles it: `addExecutionEntry` appends the header's name
to the file's execution order. So a run block with names under it runs those, and
one with nothing under it runs the story or composition of its own name.

### D2 — A flow with no run block runs its scenarios

**REQ-LANG-10.** `execution.flow` has seven `scenario:` blocks and no `test:`
block at all. The legacy parser's `addScenarioEntry` adds a `scenario` to the
execution order and `addStoryEntry` does not add a `story`: a story is a library
unit, a scenario runs where it is written. Without this the compatibility
milestone would have nothing to run for that file.

### D3 — `natural_language_login.flow` gained one line

**P0-F2.** The fixture's `test: Run all login stories` names nothing that exists
— a defect inherited verbatim from the legacy original, which the legacy runner
would also have failed on. The label is kept as the run block's name and the
composition it means is listed beneath it. `migrate` produces the same shape.

### D4 — The healing eval has a fifth outcome, `unverified`

**LLD §16 (Draft 2.3)** names `recovered`, `wrong-element`, `not-found` and
`ambiguous`. A proposal whose ground-truth key *matches* but which cannot be
re-synthesised into a unique candidate is none of those, and calling it
`wrong-element` would mislead in the other direction. It is `unverified`, counted
separately, and never counted as a recovery. The same outcome covers a run with
no ground truth available at all.

### D5 — The generated Tier 1 parser is not committed

**T2.4.** The JSON Schemas and `actions.yaml` are committed because they are
small and are read by people and foreign runtimes. The generated parser is 300 kB
that nobody reads and that would swamp every diff touching the grammar. `build`,
`typecheck` and `test` each regenerate it first. Its hand-written `.d.ts` *is*
committed — a clean clone could not build without it, which is how that line
reached the `.gitignore`.

### D6 — Migration is compared byte-for-byte against its own output

**T2.9.** The natural target is `evals/fixtures/flows`, the four flows Phase 0
hand-migrated. That comparison cannot hold: the hand migration turned two
literals into a typed `inputs:` signature, named an element "the schedule
heading" where the original said `~xpath://h1~`, and added `tags=smoke`. Those
are design decisions, not conversions, and a migrator that reproduced them would
be one that had memorised four files.

So migration is held to the properties it is responsible for — story names, order,
step counts and a clean compile, against the originals *and* the fixtures — and
to byte equality against `evals/migrate/expected`, which pins the converter so any
change to it is a diff a reviewer reads.

### D7 — The `svatah` fixture creates its own browser context

**LLD §9.1** says the fixture is "worker-scoped" and "creates the Playwright
adapter over the test's `context`". Those cannot both hold: Playwright's
`context` fixture is test-scoped and is torn down between stories, so a
worker-scoped session cannot borrow it. The host creates its own context from the
worker-scoped `browser`. A flow's stories then share one session, which is what
"worker-scoped" was for.

### D8 — The executor takes the resolver, the custom-step runner and the API runner as parameters

**LLD §8.2** writes `steps.invoke(step.custom, ctx)` and an `api` branch as
though the executor imported them. LLD §1 draws `runtime ─► bindings, surface,
schema`, and `steps` and `adapter-http` are neither. They are injected by the CLI,
which has both. A foreign runtime can supply its own or refuse those plans
clearly, which is a better contract than an import.

### D9 — The service is given the CLI's functions rather than importing them

**LLD §13.5** says "every handler calls the same functions the CLI calls (lint
rule: `service` may import only `cli`'s command functions and `schema`)". Read as
an import, that makes the workspace graph cyclic — the CLI mounts `svatah serve`
— and a clean clone fails to build with the service's type build running before
the CLI has types. The functions are injected through a `ServiceApi` interface;
the service imports `@svatah/schema` alone. Strictly more restrictive than the
rule as written.

### D10 — Tier 0's diagnostics have their own type

**LLD §1** draws `steps ─► schema, surface`. `@svatah/spec` owns the diagnostic
type for the language, and `steps` cannot import it. The shape is repeated,
structurally identical, and the compiler — which depends on both — passes them
through unchanged.

### D11 — `evals/fixtures` is a workspace package

The compatibility milestone runs it under Playwright Test, which has to resolve
`@playwright/test` and the host's reporter. A project outside the workspace
resolves neither. It is a real project and now has a real project's
`node_modules`.

### D12 — The compatibility milestone runs the four migrated fixtures, not all five

**T2.10** names "the migrated fixtures". `booking-compensation.flow` is not a
migration of anything — it is the REQ-AUTO-4 showcase P0-F2 split out — and needs
a "cancel booking" control `apps/sample-web` does not have. The policy matrix it
demonstrates is covered end to end in `@svatah/runtime`'s own tests.

### D13 — The golden set's `sideEffect` was corrected in two entries

**T2.4.** g-138 and g-139 click the pay and run-build buttons and carry
`sideEffect: true`; g-131 and g-132 click the same two under a guard and did not.
A guarded click on the pay button is as side-effecting as an unguarded one, so
the two entries were corrected rather than the heuristic bent to reproduce an
inconsistency.

### D14 — `status: "bound"` means a binding exists

**REQ-COMP-5, LLD §3.2.** Phase 1's dictionary called a phrase `bound` whenever
it knew an id for it, including from `targets.yaml` — which names ids and groups
phrases and says nothing about whether an element has ever been located. That
would tell the recorder there is nothing to ground. `bound` now means the
bindings store has an entry.

---

## Known gaps

### K1 — CI still cannot be shown passing on a branch

Carried from Phase 1's K1, unchanged. There is no GitHub remote, so the
three-OS matrix has never run. Both CI files now also run the compatibility
milestone and diff the conformance fixture; those have been run locally, and the
`ci.test.ts` check still asserts the GitHub and Bitbucket jobs hold the same
commands in the same order.

### K2 — Verified on Node 25, not Node 22 LTS

The available runtime was Node v25.6.1. Everything targets and declares Node 22
(`.nvmrc`, `engines`, `tsup` `target: node22`, both CI files). Phase 1's verifier
ran that phase's contract on Node 22; this session could not — the only Node on
the machine is v25.6.1 and `/opt/homebrew/opt/node@22` is an alias to it.

### K3 — Tiers 2 and 3 are interfaces with nothing behind them

REQ-COMP-3 and REQ-COMP-4 are P1 and arrive in Phase 4. `registerTier` exists,
nothing registers one, and a sentence Tier 1 does not recognise is `E_NO_MATCH`
rather than being handed on. The plan records `origin.tier` for every step, so
the golden set's tier-1 subset is genuinely a subset.

### K4 — `svatah record` does not exist

REQ-REC-1 is T3.3. The compatibility milestone therefore runs on seed bindings
whose *elements* were pointed at by hand (`scripts/seed-fixture-bindings.mjs`)
with the candidates synthesised against the live page. That is the recorder's
output shape without the recorder's grounding.

### K5 — `heal --run <id>` has a producer now, but no end-to-end test

Phase 1's K6 is half closed: T2.7 writes `runs/<id>/results.jsonl` and T2.12
gives the healer a runtime-backed `Replayer`. What has not been demonstrated is a
full cycle — break a binding, run the fixtures, `svatah heal --run <id>`, apply,
re-run green — because the four documented compatibility failures are not locator
failures a repair would fix. The `Replayer` itself is unit-tested in both
implementations.

### K6 — Firefox and WebKit are not exercised

Phase 1's K4, unchanged. Only chromium is run; `SVATAH_PW_BROWSERS=all` exists
and nothing in the suites is chromium-specific.

### K7 — Four fixture steps cannot pass against the sample application

Documented in full in `evals/conformance/runtime/README.md` and held to exactly
four by a repo check. They are faithful migrations of steps whose assumptions the
sample application does not reproduce, plus one HTML limitation.

### K8 — The compensation showcase has no element to click

`booking-compensation.flow` needs a "cancel booking" control `apps/sample-web`
does not have. Adding one would shift the healing eval's element counts and the
committed report, so the flow is excluded from the compatibility run (D12) and
the behaviour it shows is covered by the executor's own policy matrix.
