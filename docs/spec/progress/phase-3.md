# Phase 3 — progress and verification

Branch: `phase-3` (from `phase-2` at `3d285f9`) · Date: 2026-09-03 · Scope: the
Draft 2.4 spec amendments, the five Phase 2 corrections, and T3.1 … T3.7 of
[`../tasks.md`](../tasks.md). Phase 4 was not started.

## Summary

| Item | Title | Status | Commit |
|---|---|---|---|
| — | Spec 2.4: run-block semantics, replayer navigation, service inputs, ADE in-repo | done | `4f3c69a` |
| F1 | Heal from a run directory | done | `d54ae55` |
| F2 | Malformed binding file | done | `2f94939` |
| F3 | Timing test | done | `705faee` |
| F4 | Service inputs | done | `9ee5725` |
| F5 | Progress file | done | `8fb9eb3` |
| F6 | Deviations absorbed (nothing beyond the amendments) | done | `4f3c69a` |
| T3.1 | Model gateway | done | `9b845b0` |
| T3.2 | Grounding over the surface | done | `a4f3662` |
| T3.3 | Recorder session, report, `record` command, `Regrounder` | done | `738bf6a` |
| T3.4 | Grounding eval and full healing eval, published | done with deviations (**D1**, **D2**) | `0b179e7` |
| T3.5 | First real recording (milestone) | done with deviations (**D1**) | `d5f6e58` |
| T3.6 | New ADE shell (`apps/ade`) | done with deviations (**D3**, **D4**, **D5**) | `98139f5`, `39abbaf` |
| T3.7 | ADE core screens | done with deviations (**D6**) | `98139f5` |
| — | Host tests measured their own environment, not the host | done | `35bb925` |

**No credential was available to this session.** Everything that needs a model is
implemented and exercised against the fake gateway; every artefact says which
gateway produced it, and the two items that require a real model —
REQ-REC-10's grounding accuracy and REQ-HEAL-5's 85% with one model call — are
**not measured** and are recorded as such under [Known gaps](#known-gaps), with
the exact commands to run them.

The four spec documents were changed only by the Draft 2.4 amendments the
verifier authorised:

```
$ git log --format='%h %s' phase-2..HEAD -- docs/spec/requirements.md docs/spec/hld.md docs/spec/lld.md docs/spec/tasks.md
4f3c69a Spec 2.4: run-block semantics, replayer navigation, service inputs, ADE in-repo

$ git diff --stat phase-2..HEAD -- docs/spec/{requirements,hld,lld,tasks}.md
 docs/spec/hld.md          |  4 ++--
 docs/spec/lld.md          | 16 ++++++++++++----
 docs/spec/requirements.md |  3 ++-
 docs/spec/tasks.md        |  3 ++-
 4 files changed, 18 insertions(+), 8 deletions(-)
```

## The contract

Everything below was re-run from a **clean clone of `phase-3`** into an empty
directory, with `CI=true` and with `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`
unset.

```bash
pnpm install && pnpm browsers && pnpm -r build && pnpm -r test
```

| Command | Result |
|---|---|
| `pnpm install` | 32 workspace projects, 743 packages |
| `pnpm browsers` | chromium installed |
| `pnpm -r build` | 30 packages built, exit 0 |
| `pnpm -r test` | **2,197 tests passed, 0 failed** (1,958 vitest across 19 suites, 239 Playwright across 4), exit 0 |
| `pnpm lint` | clean (exit 0) |
| `pnpm -r typecheck` | clean (exit 0) |
| `pnpm check:licenses` | OK — 743 packages, 12 permissive licences |
| `node scripts/compatibility.mjs` | plan byte-stable at `d81e7c7a…`; both hosts identical over 40 steps; 21 passed, 4 failed, 15 skipped; `git diff --exit-code evals/conformance/runtime` clean |
| `pnpm eval:grounding -- --gateway fake` | 198 cases, 100.0% correct, threshold 95% met — **harness only, not a model** |
| `pnpm eval:healing` | relocalize-only 92.3% (no-test-ids) and 78.9% (with-test-ids), threshold 60% met; the model half not measured |
| `pnpm --filter @svatah/ade make` | installers built (macOS, this host) |
| `pnpm --filter @svatah/ade smoke` | `svatah-ade smoke ok project=… flows=5 stories=17 window=open`, exit 0 |

**A Phase 2 test failed under `CI=true` and was fixed** (`35bb925`).
`packages/host-playwright/test/host.spec.ts` asserted on the output of a nested
`playwright test`, and Playwright chooses `dot` over `list` when `CI` is set, so
two tests passed on a laptop and failed on a runner. Found by running this
contract the way GitHub Actions runs it. Same family as F3.

### Additional commands a Validate item needs

```bash
node scripts/record-fixtures.mjs --gateway fake   # T3.5
node scripts/grounding-cases.mjs                  # rebuild the eval's cases
node scripts/record-snapshots.mjs                 # rebuild the recorder's page fixtures
node scripts/ade-smoke.mjs                        # T3.6, launches Electron
```

---

## F1 — Heal from a run directory

**Status: done.** Commit `d54ae55`.

Reproduced first, exactly as the verification named it. On `phase-2`:

- `svatah heal --run <id>` answered `not-found — nothing on the page scored above
  the threshold`. `packages/cli/src/replayer.ts` returned `"reached"` whenever the
  failing step was a story's first, and the heal session had opened a browser
  context that never navigated, so relocalization ran against `about:blank`.
- `svatah-bindings heal --run <id>` answered `unreachable`. `results.jsonl`
  carried no session state, so module (a)'s replayer had nothing to restore.

Fixed per LLD §3.4 and §10 as amended:

| Change | Where |
|---|---|
| The executor records `failure.session` — the surface state at failure | `packages/runtime/src/step.ts` |
| `failure.session` is added to `results.schema.json` | `packages/schema/src/results.ts` |
| `readRunFailures` carries that state into the heal input | `packages/healer/src/failures.ts` |
| The heal command opens the session at the flow's base URL with the configured storage state, and no longer navigates to the failure's URL itself | `packages/bindings-cli/src/commands/heal.ts` |
| Both replayers verify they arrived — the live URL path against the recorded one — before relocalization runs | `packages/healer/src/replayer.ts`, `packages/cli/src/replayer.ts` |
| `svatah heal --run` fills `--base-url` and `--storage-state` in from the project's config | `packages/cli/src/cli.ts` |

The probe, from a clean checkout of `phase-3`:

```
run exit 1
failure.session: {"kind":"web","url":"http://127.0.0.1:54317/","windowIndex":0,"windowTitle":"Home · Svatah Sample","dialog":null}
svatah heal --run exit 0 | ok    home.sign-in-button  repaired  1.000 (runner-up 0.292)
svatah-bindings heal --run exit 0 | ok    home.sign-in-button  repaired  1.000 (runner-up 0.292)
re-run exit 0
```

| Validate item | How | Observed |
|---|---|---|
| The full cycle through `svatah heal --run` | `packages/cli/test/heal-cycle.test.ts` | break, run (exit 1), heal `--apply` (exit 0), re-run (exit 0) |
| The full cycle through `svatah-bindings heal --run` | same file | same, with `--base-url` |
| A failure at a later step, behind a navigation | same file, `app.schedule-build-link` on `/dashboard` | both command lines repair it |
| The replayers say how they reached the page | same file | `runtime` for `svatah heal`, `session-state` for `svatah-bindings heal` |

```bash
pnpm --filter @svatah/cli exec vitest run test/heal-cycle.test.ts   # 5 passed
```

## F2 — Malformed binding file

**Status: done.** Commit `2f94939`.

On `phase-2`, `BindingsStore.load`'s `DataError` reached the top level as a stack
trace — and a `runs/<id>` directory had already been opened, which afterwards
reads like a run that happened.

```
$ node packages/cli/dist/bin.js run <project> --host none
bindings/home/sign-in-button.yaml is not valid YAML: Block collections are not allowed within flow collections at line 1, column 12:
exit=64
(no runs directory)
```

| Validate item | How | Observed |
|---|---|---|
| A diagnostic naming the file | `packages/cli/src/commands/run.ts`'s `loadBindings` raises a `ConfigError` | the path relative to the project, and the reason |
| The config-error exit code | `EXIT.usage` (64), the same code a bad `svatah.config.yaml` gets | 64 |
| No partial run | the check runs before `openRunDirectory`, and before either host | `runs/` does not exist |
| A test | `packages/cli/test/commands.test.ts` | three cases: unparseable, schema-invalid, and under `--host playwright` |

The store's own message also improved: a Zod failure now names the field and a
YAML failure names the line, instead of dumping a `ZodError`.

## F3 — Timing test

**Status: done.** Commit `705faee`.

Both wall-clock assertions were sized exactly to their requirement while running
beside every other package's suite, browsers included. Per LLD §16 as amended
each now asserts three times its requirement and prints the measurement beside
the requirement, warning when it crosses the requirement but stays inside the
budget.

| Test | Requirement | Budget | Observed on an idle machine |
|---|---|---|---|
| `packages/compiler/test/grammar.test.ts` | 1,000 steps in 1,000 ms (REQ-COMP-2) | 3,000 ms | 30 ms |
| `packages/runtime/test/executor.test.ts` | 5 ms per step (REQ-NFR-4) | 15 ms | 0.006 ms |

## F4 — Service inputs

**Status: done.** Commit `9ee5725`.

`POST /run` validates the supplied inputs against the signatures of the stories
the run invokes directly, and answers 400 listing the missing names before
anything starts. "Directly" excludes a story reached through an `invoke` step,
which takes its inputs from the calling step.

`GET /project` already carried each story's signature; `openapi.json` now
describes both, and the contract tests cover the rule twice — against the fake
project, where the shapes are cheap to arrange, and against a real one in the
CLI's suite, where the run block and the signature came out of the spec reader.

```
{"error":"missing-inputs",
 "missing":[{"story":"Sign in","name":"email","type":"string"},
            {"story":"Sign in","name":"password","type":"secret"}], … }
```

| Validate item | How | Observed |
|---|---|---|
| 400 with the missing names | `packages/service/test/contract.test.ts`, `packages/cli/test/service.test.ts` | both names, with their types |
| Nothing starts | the same tests | no `run.started` event, no `runs/` directory |
| Signatures on `GET /project` | both files | `inputs.email.type === "string"` |
| `openapi.json` updated | `packages/service/src/openapi.ts` | the 400 and the `signature` field are described |

## F5 — Progress file

**Status: done.** Commit `8fb9eb3`.

`docs/spec/progress/phase-2.md` gained a **Post-verification corrections**
section with a pointer to it from the summary: the two causes of the
heal-from-run failure, the verifier's Node 22 result (v22.23.2, twice, with the
one load-sensitive timing failure that became F3), the six corrections with
their commits, and what K5, K2 and the six absorbed deviations mean now. The
sentence claiming the `Replayer` was "unit-tested in both implementations" was
removed from K5 and the removal is recorded in place; nothing else above was
rewritten.

## F6 — Deviations absorbed

**Status: done.** Commit `4f3c69a`, no other work.

D1, D2, D4, D7, D8 and D9 of `phase-2.md` are what the spec now says (Draft 2.4)
and are no longer deviations. They are left in that document as the record of how
they arose.

---

## T3.1 — Model gateway

**Status: done.** Commit `9b845b0`.

The only place in the workspace that talks to a model (LLD §10). Callers ask a
question with a Zod shape and receive an answer of that shape plus its
provenance.

```bash
pnpm --filter @svatah/gateway test        # 31 passed
```

| Validate item | How | Observed |
|---|---|---|
| Request-shape tests | `packages/gateway/test/gateway.test.ts` | the model, adaptive thinking, one cached system breakpoint, `output_config.format` generated from the answer schema, effort only when asked, an image before the question — and the same body is what reaches the SDK |
| Secret never in the captured request | same file, six cases | redacted from instructions and question, by substring; a secret that survives **stops the call** and the error does not quote it; the fake gateway runs the same guard |
| A cache hit costs zero | same file | `cached: true`, `costUsd: 0`, no call, running total unchanged; keyed on model, prompt version, system, question, schema, images and scope, and on nothing else; survives a process; a corrupt entry is a miss |
| A refusal returns `GatewayRefusal` without retry | same file | the category and explanation from `stop_details`, one call made, never cached, and never reported as a schema failure |

Backends: `anthropicGateway` (Claude Opus 5 through `@anthropic-ai/sdk`),
`localGateway` (Ollama or llama.cpp, temperature 0, fixed seed, a pinned digest
that is *refused* rather than warned about when it moves), and `fakeGateway`
(`real: false`, which travels into every report).

Credentials are never a parameter: the SDK resolves `ANTHROPIC_API_KEY`, then
`ANTHROPIC_AUTH_TOKEN`, then an `ant auth login` profile.

## T3.2 — Grounding over the surface

**Status: done.** Commit `a4f3662`.

```bash
pnpm --filter @svatah/recorder test       # 29 passed
```

The tests replay `apps/sample-web` from a recording — the snapshot, `describe()`
for every reference, and `locate()` for every candidate synthesis would try — so
they need no browser and no credential, and nothing is simulated: every answer
the surface gives came off the real page once. `recorder` may not import an
adapter (LLD §1), which is the other reason the fixture exists.

| Validate item | How | Observed |
|---|---|---|
| Recorded-snapshot tests with a fake gateway | `packages/recorder/test/ground.test.ts` | a binding entry from the chosen element, with `g-1` and the gateway in its provenance and `verified: false` |
| Pruning keeps interactive nodes | same file, five cases | every interactive element survives a 40-token budget; landmarks kept; document order kept; the floor is reported `overBudget` rather than silently truncated |
| Redaction | same file | a password typed into the page is gone from the sent body, and the gateway refuses a prompt one survived in |
| Vision only when allowed | same file, four cases | not after an answer, not when unconfigured, not when the adapter cannot screenshot; taken after a null when all three hold, and the second call carries the image |
| Refuses in `production` without `--force-production` | same file | `EnvironmentRefused` before the model or the page is touched; proceeds in `test`, `staging`, and with the override |

## T3.3 — Recorder session, report, `record` command, `Regrounder`

**Status: done.** Commit `738bf6a`.

```bash
pnpm --filter @svatah/cli exec vitest run test/record.test.ts        # 10 passed
pnpm --filter @svatah/playwright-test exec playwright test test/grounder.spec.ts   # 4 passed
pnpm --filter @svatah/cli exec vitest run test/bind-grounding.test.ts             # 4 passed
```

The session is a loop around `runStep` from `@svatah/runtime` — the same function
`svatah run` and the Playwright host call — with grounding added before each
step. What is written is what a step proved: grounded entries are staged into the
live store so the resolver can find them, and rolled back unless a passing step
confirmed them.

| Validate item | How | Observed |
|---|---|---|
| Recording `simple.flow` with a fake gateway produces verified bindings | `packages/cli/test/record.test.ts` | exit 0; `home.sign-in-button`, `login.username-field`, `app.schedule-build-link` and the rest written with `verified: true` and `promptVersion: g-1` |
| An impossible expectation stops without writing | same file | exit 5, `complete: false`, `written: []`, and the store byte-for-byte what it was |
| `bind()` in record mode uses the model when module (b) is present | `packages/playwright-test/test/grounder.spec.ts` (toggles the registration), `packages/cli/test/bind-grounding.test.ts` (installs the real one) | with a grounder: bound with no picker and `provenance.model` naming it; without: the picker, `model: "human"`; a grounder that declines *or throws* falls back |
| The report lists what REQ-REC-8 names | `packages/cli/test/record.test.ts` | snapshot tokens, decision, outcome, reference, candidates, tokens, cost, matched candidate |

`--gateway fake` has to be typed. No credential and no flag is exit 3, not a
silent downgrade: a store recorded from fixtures that a person believes came from
a model is the failure this project exists to prevent.

## T3.4 — Grounding eval and full healing eval, published

**Status: done with deviations (D1, D2).** Commit `0b179e7`.

```bash
pnpm eval:grounding                        # needs a credential
pnpm eval:grounding -- --gateway fake      # the harness check
pnpm eval:healing
node scripts/grounding-cases.mjs           # rebuild the cases
```

**198 cases** in `evals/grounding/cases.jsonl` (REQ-REC-10 asks for 150): every
unambiguous named control on the ten sample pages, two on each of the twenty
variants, 22 `absent` cases whose right answer is null, and 17 phrases read out of
the fixtures' own bindings store. `evals/grounding/README.md` says what is
deliberately *not* a case and why.

| Validate item | How | Observed |
|---|---|---|
| `eval grounding`, threshold 0.95 | `svatah eval grounding` | 198 cases, **100.0%** against the fake gateway. **This measures the harness, not grounding** — see D1 and the gap below |
| `eval healing` with model, threshold 0.85 | `svatah eval healing` | relocalize-only 92.3% and 78.9%; the model half **not measured** (no credential) and the report says so rather than reporting a number nobody took |
| Scheduled CI with the real gateway | `.github/workflows/ci.yml`'s `model-evals` | on `schedule` and `workflow_dispatch` only, skipped without a secret, writes the answer cache |
| PR CI with cache | the same file's `grounding-eval` | replays `evals/grounding/cache`, falling back to the fake gateway until a scheduled run commits one |
| Release attaches both reports | `.github/workflows/release.yml`, `scripts/eval-reports.mjs` | both suites run and both reports are attached; the grounding runner picks the real gateway when a secret is present |

The healing eval's model half is implemented and tested with a stand-in
`Regrounder` (`packages/healer/test/eval-model.test.ts`, 6 tests): one call per
binding relocalization declined and never on one it placed; a re-grounded
proposal judged by the same two tests as a relocalized one; `withModel` equal to
the relocalize-only rate when nothing is registered.

## T3.5 — First real recording (milestone)

**Status: done with deviations (D1).** Commit `d5f6e58`.

```bash
node scripts/record-fixtures.mjs --gateway fake   # what was run here
node scripts/record-fixtures.mjs                  # with a model
```

`evals/fixtures/bindings` is the recorder's output now, closing Phase 2's K4.
Every entry was grounded, performed by a step through the executor's own
`runStep`, and confirmed by that step passing. `evals/fixtures/record-report.json`
is the merged report for the four sessions.

| | |
|---|---|
| Gateway | `fake:grounding-cases` (**not a model** — see the gap below) |
| Steps | 25 across four flows |
| Grounded | 23 |
| Bindings written | 15 |
| Cost | $0.0000 (the fake gateway makes no call) |

None of the four sessions finished, by design: each fixture carries exactly one
documented step `apps/sample-web` cannot satisfy
(`evals/conformance/runtime/README.md`), so a session stops there and writes what
the steps before it proved. The conformance fixture is byte-identical afterwards
— 21 passed, 4 failed, 15 skipped, same statuses, same matched candidates.

| Validate item | How | Observed |
|---|---|---|
| Replay passes with the model endpoint blocked | `scripts/block-external-network.mjs`, used by `scripts/compatibility.mjs` and by two tests in `packages/cli/test/record.test.ts` | the milestone runs clean with every non-loopback connection refused, through all four of Node's doors; a negative control proves the blocker blocks |
| Record cost under about $1 per 20-step story | — | **not measured**: no credential. See the gap below |

## T3.6 — New ADE shell (`apps/ade`)

**Status: done with deviations (D3, D4, D5).** Commits `98139f5`, `39abbaf`.

```bash
pnpm --filter @svatah/ade test      # 83 passed (with T3.7)
pnpm --filter @svatah/ade make      # installers
pnpm --filter @svatah/ade smoke     # launches Electron
```

| Validate item | How | Observed |
|---|---|---|
| Renderer has no Node access (test) | `apps/ade/test/security.test.ts` | `contextIsolation`, no `nodeIntegration`, `sandbox`, `webSecurity`, none of them turned off anywhere; no renderer source imports `node:`, `electron`, `require`, `process`, or the main process's modules; the bridge is four functions with no generic `invoke` |
| The app opens a fixture project and shows `GET /project` data | `apps/ade/test/service-lifecycle.test.ts`, and `pnpm --filter @svatah/ade smoke` | `svatah-ade smoke ok project=…/evals/fixtures flows=5 stories=17 window=open`, exit 0 |
| Killing the app stops the service | `apps/ade/test/service-lifecycle.test.ts` | the lock is removed and the URL stops answering; a second open **adopts** rather than starting a rival; a stale lock is cleared |
| Electron security checklist passes | `apps/ade/test/security.test.ts` | plus refused navigation and window opening, a loopback-only `connect-src`, and the fuses with `RunAsNode` off |
| Installers build on three OSes | `.github/workflows/ci.yml`'s `ade-installers` | the job exists on all three; **built and verified on macOS here** — Linux and Windows are unrun (see the gap below) |

## T3.7 — ADE core screens

**Status: done with deviations (D6).** Commit `98139f5`.

Seven screens: Project, Flow editor, Plan, Run, Results, API client, Data.

| Validate item | How | Observed |
|---|---|---|
| Editing a flow in the ADE and compiling from the CLI yields the same `plan.json` | `apps/ade/test/parity.test.ts` | a real `PUT /flows/:file`, then the service's plan hash equals `.svatah/plan.json`'s |
| A run started from the ADE produces the same `runs/<id>` files as the CLI | same file | `results.jsonl` identical step for step; `summary.json` and `audit.jsonl` present from both sides; the stream matches the file |
| Lint warnings in the editor match `svatah lint --json` | same file | the same diagnostics, by code, line and message |
| A review confirms no ADE-only logic | `apps/ade/test/screen-rule.test.ts` — the static check the verification contract allows | every `client.*` call is a method on the generated client; every rendered value names a real endpoint; no screen contains `fetch`, `EventSource` or `XMLHttpRequest`; and every endpoint LLD §13.6 gives a screen is reached |

The service grew the routes the screens need, all from LLD §13.5's table:
`PUT /data`, `GET/PUT /api/:name`, `POST /api/request` (through the same HTTP
adapter a run uses), run screenshots, and `GET /plan` (D6). `PUT /data` keeps
every secret the editor never saw: a path the project declared secret always
takes the file's own `${ENV}` indirection, whatever the editor sent
(`apps/ade/test/parity.test.ts`, `packages/service/test/contract.test.ts`).

---

## Deviations

Each is the closest faithful option, with the section it departs from and why.

### D1 — Every model-produced number here came from the fake gateway

*T3.4, T3.5, and the prompt's "if no credential is available".* No credential was
available in this session — no `ANTHROPIC_API_KEY`, no `ANTHROPIC_AUTH_TOKEN`, no
`ant` on the machine.

So the grounding eval's 100.0% measures the *harness* — that every page opens,
every phrase is grounded and every answer is checked against the ground-truth key
— and nothing about a model. The report says that at the top, in bold, and
`renderGroundingEvalSummary` repeats it on the terminal. The recorded fixture
bindings carry `provenance.model: "fake:grounding-cases"`, so an artefact
recorded this way can never be read as one a model produced.

`svatah record` refuses to run without either a credential or an explicit
`--gateway fake`, so the downgrade can never happen by accident.

### D2 — Two kinds of grounding case are deliberately excluded

*T3.4, REQ-REC-10.* `evals/grounding/README.md` records both.

An element with **no ground-truth key** (the two headings the fixtures bind;
`apps/sample-web` stamps interactive elements only) could never be scored
`correct`, so including it would put a permanently unreachable case in the
threshold's denominator. Those phrases moved to
`evals/grounding/fixture-answers.jsonl`, which `svatah record --gateway fake`
reads and the eval does not.

An element the **snapshot does not contain** — `booking.indiranagar-suggestion`
is an `<option>` inside a `<datalist>`, the same limitation the conformance
fixture documents for clicking it — is a case for the vision fallback rather than
for a suite that measures grounding from the snapshot (REQ-REC-2).

### D3 — `bind()`'s model grounding is registered by the CLI, not by the host

*LLD §9.2, §13.6.* The obvious home for `installModelGrounding()` is
`@svatah/host-playwright`, since importing that package is the moment a project
has both modules. It is the wrong home: LLD §1 keeps the Playwright host
model-free — the host is what *replays* a plan, and REQ-RUN-1 says replay makes no
model calls — and the import-boundary lint says so.

LLD §10 already names the right one: "module (b) registers the recorder's
implementation at CLI start". So it lives in `@svatah/cli`, which is the package
allowed to import everything precisely so this wiring is in one place. A flow
project's Playwright config imports it from there.

### D4 — The ADE's build output is CommonJS, and `apps/ade` is not `"type": "module"`

*T3.6.* Every other package in this workspace is ESM (LLD §1). The ADE cannot be:
Electron's security checklist requires `sandbox: true`, and a **sandboxed preload
has no ES module loader**, so the preload must be CommonJS. Having the two halves
of one process disagree about their module system buys nothing, and Forge's own
Vite + TypeScript template is CommonJS for the same reason.

The *sources* are unchanged — TypeScript with ESM syntax, `moduleResolution:
Bundler` — and the renderer is a browser ES module as it should be. Only the
built main and preload bundles are CJS. This was found by the smoke check, which
is the reason the smoke check exists.

### D5 — `.npmrc` gains a hoist pattern, and `vite` is pinned to 7

*T3.6, REQ-PKG-3.* Two dependency constraints Electron brings.

Electron Forge refuses to package under pnpm unless a hoist pattern is set. Its
own suggestion, `node-linker=hoisted`, would turn off the isolation LLD §1
depends on ("with pnpm's strict isolation, the dependency-graph test is the guard
that holds at run time"). `public-hoist-pattern[]=*electron*` is the narrowest
thing Forge accepts, and nothing in this workspace but the ADE depends on
Electron.

Vite 8 makes `lightningcss` — MPL-2.0 — a hard dependency, and REQ-PKG-3 allows
MIT, Apache-2.0 and BSD only. `apps/ade` pins `vite@^7` and
`@vitejs/plugin-react@^5` (6.x requires Vite 8). Vitest keeps its own Vite 5;
a workspace-wide override was tried and broke vitest, so the pin is local to the
ADE.

### D6 — The service gained `GET /plan`

*LLD §13.5.* The table gives `POST /compile` a `PlanRef` — a hash and a count —
which is right for a caller asking whether a project compiles. T3.7's Plan screen
needs the steps: their tier, their confidence, and which targets are still
`unbound`.

That is exactly the object `svatah compile` writes to `.svatah/plan.json`, so
serving it keeps the screen rule ("nothing the CLI cannot produce") rather than
bending it. `POST /compile`'s shape is unchanged.

---

## Known gaps

### K1 — CI still cannot be shown passing on a branch

Carried from Phase 2's K1, unchanged. There is no GitHub remote, so neither the
three-OS matrix, the new `ade-installers` job, the `grounding-eval` job nor the
scheduled `model-evals` job has ever run on a runner. All four are checked by
`tools/repo-checks/test/ci.test.ts` for shape, and every command they run has been
run locally.

### K2 — REQ-REC-10's number is not measured

The grounding eval runs, checks its answers against the ground-truth key, and
meets its threshold — against the **fake gateway**, which answers from the cases
themselves. Nothing here measures a model.

```bash
export ANTHROPIC_API_KEY=…            # or `ant auth login`
pnpm eval:grounding                    # 198 cases against claude-opus-5
```

That writes `reports/eval-grounding.md` with the real gateway named at the top,
and `--cache evals/grounding/cache` commits the answers the pull-request job
replays.

### K3 — REQ-HEAL-5's 85% with one model call is not measured

The model half of the healing eval is implemented and unit-tested with a stand-in
`Regrounder`, and `svatah eval healing` registers the recorder's when a
credential and `heal.useModel` allow it. With neither, `withModel` equals the
relocalize-only rate and the report says the second number was not measured.

```bash
export ANTHROPIC_API_KEY=…
# evals/fixtures/svatah.config.yaml: heal.useModel: true
pnpm eval:healing
```

### K4 — T3.5's cost figure is not measured

"Record cost under about $1 per 20-step story" needs a real recording. The fake
gateway makes no call and reports $0.0000, which is true and not the number the
requirement asks for.

```bash
export ANTHROPIC_API_KEY=…
node scripts/record-fixtures.mjs      # re-records the four fixtures with claude-opus-5
```

The report it writes (`evals/fixtures/record-report.json`) carries
`totals.tokensIn`, `totals.tokensOut` and `totals.costUsd` per flow and in total,
so the figure is one command away.

### K5 — The installers are built on macOS only

`pnpm --filter @svatah/ade make` was run here and produced a macOS ZIP. The
Windows Squirrel and Linux Debian makers are configured and wired into CI
(`ade-installers`, three-OS matrix) but have never run — the same gap as K1.

### K6 — The prototype is not archived on a `prototype` branch

T3.6 says "archive the prototype's code on a `prototype` branch of the
repository". The prototype lives at `github.com/a-t-u-l/svatahADE`, a repository
this session has no access to, and ADR-17 as amended places the archiving at the
split — "the prototype's code is archived there on a `prototype` branch" — which
happens at the ADE's first tagged release, not now.

### K7 — Verified on Node 25, not Node 22 LTS

Carried from Phase 2's K2. The available runtime is Node v25.6.1; everything
targets and declares Node 22 (`.nvmrc`, `engines`, `tsup` `target: node22`, both
CI files). The Phase 2 verifier ran that phase's contract on Node v22.23.2; this
session could not.

### K8 — Firefox and WebKit are not exercised

Phase 1's K4, unchanged. Only chromium is run; `SVATAH_PW_BROWSERS=all` exists and
nothing in the suites is chromium-specific.

### K9 — Four fixture steps cannot pass against the sample application

Phase 2's K7, unchanged and now doubly load-bearing: they are also why none of
T3.5's four recording sessions completes. Documented in
`evals/conformance/runtime/README.md` and held to exactly four by a repo check.

### K10 — The ADE's record, bindings and heal review are not built

REQ-ADE-4, 5 and 8 are T5.7 and T5.8. The seven screens T3.7 names are built; the
record review, the bindings browser, the heal review, the surface explorer and the
tool panel are not, and the ADE's README says so.
