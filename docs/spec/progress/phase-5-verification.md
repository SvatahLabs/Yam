# Phase 5 — adversarial verification

Verifier: separate session · Date: 2026-09-04 · Subject: branch `phase-5` at `0a9dfe3`
Method: clean detached worktree of `phase-5`; the contract with no model credential; every claim in `docs/spec/progress/phase-5.md` re-run or probed; the contract's own probes constructed independently. Ollama served `qwen2.5:3b`; a matching chromedriver was installed for the stock-Chrome attach; Node 22 was fetched for the K1 run; the ADE was driven through Playwright's Electron support.

## The three items raised before the report was read

- **D1, the guard that names another element.** The implementer's choice is right: a compile error naming both phrases beats a guard silently asked about the wrong element. The documented form is worth expressing, so Draft 2.7 gives `Step.guard` an optional `target` that the recorder grounds and the resolver resolves before evaluation; the error remains for a `target` guard with no element anywhere.
- **The four secret leaks.** Swept independently: a `secret` input and a `${ENV}` data secret run through `simple.flow` with checkpoints and audit on, and through a workflow with a `card: secret` input. Neither value appears in `summary.json`, `results.jsonl`, `audit.jsonl`, any checkpoint, or any screenshot; `summary.inputs` holds names only.
- **K1 and K6.** Node 22 with `CI=true`: 2,743 passed, so K1 is closed. K6 is addressed below; it stays open, with more evidence than before.

## Contract

| Command | Result |
|---|---|
| `pnpm install && pnpm browsers && pnpm -r build && pnpm -r test`, no credential | 31 packages built; 2,743 tests passed, 0 failed |
| Same on Node v22.23.2 with `CI=true` | 2,743 passed |
| `git diff master..phase-5 -- docs/spec/*.md` | empty |
| Dictionary: unquoted, single-quoted four-space, flow style; empty list | all bind `home.sign-in-button`; `W_BINDING_NO_PHRASES` |
| Heal a later-step failure behind the login, inputs by `--input` and by `SVATAH_INPUT_*`, both command lines | all four repair at 1.000; without inputs the message names both inputs and the variable |
| `svatah eval compiler --tier2` from the checkout, twice; with Tier 2 removed | 34/38 (89.5 %) both times; `tier2: not measured`, threshold unaffected |
| Nine assertion aliases | three IR shapes, each identical across its canonical and alias forms |
| BiDi attach to stock Chrome 152 through chromedriver 152 | `attached to a driver-hosted session`, 16 of 16, 72 checks |
| Resume from step 5 versus a full run | identical on story, step, status, matched candidate, captured value; changed plan → exit 12; changed binding → exit 12; no run directory left |
| `svatah workflow run "Book a slot" --input location=…` | typed outputs; in `production`, non-idempotent story refused exit 10, idempotent story allowed, `--allow-side-effects` allowed; no secret in any artifact |
| Story as an MCP tool from an independent client, network blocked | `book_a_slot` with `location`, `date`; outputs and `runId`; audit run line `invoker {kind: agent, id: verifier-agent, via: mcp}`; `summary.behavior: tool` |
| Guards | two guarded steps skipped with zero surface calls attributed to them |
| Compensation | step 5 fails with `policyApplied {compensate: "cancel a booking"}`; the compensating story runs (act, check, output in the audit); the flow ends `aborted`; **its steps are recorded `aborted` although they executed and passed** (see F1) |
| Trajectory compile of a six-call login exploration | 5 of 5 steps compile at Tier 1; four `verified: false` bindings; nothing written outside `proposals/` |
| Record session through the service with `gateway: "fake"` | `record.started`, `record.candidates`, `record.decision` with snapshot excerpt and provenance; `POST …/decision {accept: true}` → 202, next decision follows |
| Record session through the service **as the ADE sends it** (no gateway, no credential) | 202, then `record.failed`: "Recording needs a model … or pass --gateway fake" (see F2) |
| ADE through the real UI (Electron, Playwright) | the project opened from the Recent list and rendered all eleven tabs once (screenshot taken); later attempts did not get past opening within 45 s, so the record review was not completed through the UI |

## Scores (10 parameters, 1–10)

| # | Parameter | Score | Basis |
|---|---|---|---|
| 1 | Contract reproducibility | 9 | Green on both Node versions with no credential; the compiler eval reproduces from the checkout |
| 2 | Spec fidelity | 8 | D1 handled the right way; D2 through D4 are shape drifts absorbed in Draft 2.7; the compensating-step statuses read against §8.3 |
| 3 | Test integrity | 9 | Every independent probe agreed with the suite; the heal cycle now covers inputs; resume, workflow, tool, guard, and secret tests exist and bite |
| 4 | Boundaries, packaging, hygiene | 9 | Module (a) closure asserted; lint clean; no stray artifacts |
| 5 | Phase 4 corrections | 10 | All five verified independently, including the stock-Chrome attach that failed last time |
| 6 | Automation guarantees and secrets | 9 | No secret found anywhere; guards never act; production refusal; typed inputs and outputs |
| 7 | Behaviors | 8 | Resume, workflow, tool, and trajectory all work under independent drives; compensation misreports its own steps |
| 8 | ADE review screens | 7 | Screens and tests exist; the service-layer review round-trips; the real app offers no gateway choice, so without a credential "Start recording" fails with a message naming a CLI flag |
| 9 | Report accuracy and candour | 9 | Leaks disclosed unprompted; ten gaps stated; the K6 admission is exact |
| 10 | Deviation discipline | 9 | Four deviations, each with the section and the reason |

**Overall: 8.7 / 10.** Phase 5 is accepted with corrections.

## Findings

**F1 — Compensating-story steps are recorded `aborted` although they ran and passed (LLD §8.3).** In `runs/comp/results.jsonl` the two steps of `cancel a booking` carry `status: "aborted"` with no failure, while the audit shows the click, the check, and the output being produced. §8.3 says the compensating story's steps are recorded "with `behavior` unchanged"; a reader of the results cannot tell whether the compensation succeeded. Fix per §8.3 as amended: the compensating story's steps keep their own statuses (`passed`, `failed`, `skipped`); the failing step carries `policyApplied`; the flow and the run are `aborted`.

**F2 — The ADE cannot choose a gateway (REQ-ADE-4, LLD §13.6).** `Record.tsx` posts `{ rebind: true }`; the service accepts `gateway` but the screen never sends it, so with no credential the session fails at once with a message that tells the user to "pass --gateway fake", a flag the UI cannot pass. Fix per LLD §13.5 and §13.6 as amended: the Record screen offers the gateway (`anthropic` when a credential is present, `fake` for the committed answers, with the fake path labelled as such in the report), and `record.failed` is rendered as an alert with the message's advice rewritten for the screen.

**F3 — Spec drift absorbed (Draft 2.7).** `Step.guard.target` (D1); `svatah trajectory compile` in the LLD §15 table (D2); the trajectory line shape with `at`, `args`, `result`, `error`, `url` (D3); a proposal's context hash is the page hash (D4); `POST /record` documents `gateway`, the 409 while a session is open (K8), and a decision deadline (K7).

**F4 — K6 stands.** The record review has been exercised at the service layer by me and by the implementer's test, and the UI opened a project and rendered its screens under automation once, but nobody, person or script, has completed a review through the buttons. Phase 6's desktop adapters will drive the ADE through UIA and AX, which is the natural place to close it; until then it is an open gap, not a defect.

**F5 — Report correction.** Add the verifier's Node 22 result, the compensation status finding, and the gateway finding.

## What was confirmed beyond the report

- The digest pin and the `not measured` reporting both hold from a clean checkout with only the committed configuration.
- The tool server's audit names the agent invoker and records non-secret inputs; a secret input never reaches it.
- The trajectory compiler produced a story a person could commit: five canonical sentences, one predicate, four unverified bindings, and nothing else on disk.
