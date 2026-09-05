# Phase 6 — adversarial verification

Verifier: separate session · Date: 2026-09-04 · Subject: branch `phase-6` at `c2103af`
Method: clean detached worktree of `phase-6`; the contract with no model credential on Node 25 and on Node 22 with `CI=true`; every claim in `docs/spec/progress/phase-6.md` re-run or probed with independently constructed inputs; the ADE packaged and driven both through the macOS Accessibility bridge and through its own buttons under Playwright's Electron support. Ollama served the pinned `qwen2.5:3b`; JDK 17 built the Java runtime.

## The three results stated up front, checked

- **The Java runtime is conformant.** Confirmed: `node scripts/runtime-conformance.mjs` twice, 40 step results, zero mismatches, the report identical to the committed one below its header. It is conformant to the suite as written. Its artifacts are **not** in the published schemas (F2).
- **Neither desktop adapter ran against a live tree.** True at the time of the report. On this machine the Accessibility permission was subsequently granted to the terminal, so the live AX gate was run here for the first time. It fails 0 of 7 (F1), and the failure is a defect in the bridge, not in the permission.
- **The fine-tune was never trained or measured.** Confirmed: the export reproduces byte for byte (83 pairs, 0 golden overlap), the manifest changes only its timestamp, and no training artifact exists in the tree.

## Contract

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r test`, no credential, Node v25.6.1 | 33 packages built; 2,709 vitest + 241 Playwright Test passed, 0 failed |
| Same on Node v22.20.0 with `CI=true` | 2,709 + 241 passed, 0 failed |
| `pnpm lint` | 0 errors |
| `pnpm -r typecheck` | fails in `@svatah/workflow`; reproduces on `master` (K9 confirmed) |
| `git diff master..phase-6 -- docs/spec/{requirements,hld,lld,tasks}.md` | empty |
| `cd runtimes/java && ./gradlew --no-daemon clean fatJar test` | BUILD SUCCESSFUL |
| `node scripts/runtime-conformance.mjs`, twice | conformant, 40 step results, zero mismatches; both runs identical |
| Java runtime `results.jsonl` and `summary.json` against `stepResultSchema` and `summarySchema` | **invalid**: every result line lacks `startedAt`, `endedAt`, `durationMs`; the summary lacks `startedAt`, `endedAt` (F2) |
| Java runtime run with a secret input and secret environment values, artifacts swept | clean |
| `svatah surface doctor` from the verifier's shell | `ax/accessibility granted` |
| `electron-forge package`, then `node scripts/desktop-conformance.mjs --adapter ax` | ran; **0 passed, 7 failed**, every case `The accessibility call did not answer within 10000 ms` (F1) |
| Direct bridge timing against the ADE welcome window (35 nodes) | 9.1–10.2 s per `window()` read; `entireContents()` 121 ms; `properties()` 19 ms per element; attribute-by-attribute 650 ms per element |
| `--report ../adapter-ax.md` | written to `evals/adapter-ax.md` (F6) |
| Compensation story `I want to book and then fail` | steps of `cancel a booking` recorded `passed`; failing step carries `failure.policyApplied {compensate}`; flow `aborted`, exit 11, `totals.aborted 0` |
| A flow with two guards about other elements, one true and one false | guard carries its own `target`; the false guards' steps `skipped` with `state`, `locate`, `check` and no `act` in the audit |
| `svatah eval compiler` from the checkout | tier 1 181/181, tier 2 34/38 as published; `g-123` and `g-124` in the documented form |
| WebMCP page recorded with the fake gateway | binding: `webmcp` first, then five locators; replay `matched by webmcp`; with `?webmcp=off` and the same binding `matched testid #1`; binding file hash unchanged |
| `svatah migrate --from-ade evals/migrate/ade-db` | 14 stories, 72 steps, compiles clean; story names and step counts identical to `evals/migrate/expected` |
| `svatah compile evals/migrate/expected` on `master` versus `phase-6` | exit 64 `fingerprint.tag: String must contain at least 1 character(s)` versus 0 (the migrate defect confirmed and fixed) |
| The prototype's own `src/js/dbclient.js` and `newproject.js` (cloned) | tables `project`, `config`, `flows`, `api` and the keys `"locator identifier"`, `"locator details"`, `"variable name"`, `"variable value"` exactly as the importer reads them |
| `eval finetune export` | 83 pairs, identical `pairs.jsonl`; 0 sentences shared with the golden set |
| Service: `GET /project` | `gateway: { credential: false }`, no key-shaped string in the response |
| Service: `POST /record {gateway: fake}` → SSE | `record.decision` with provenance `fake:grounding-cases`; `POST …/decision {accept: true}` → 202, `record.step`, next decision; second `POST /record` → 409 `already-recording` |
| Service: `POST /record {gateway: anthropic}` with no credential | 202 then `record.failed` naming `ANTHROPIC_API_KEY` or `ant auth login`; no `--gateway` in the message |
| Service: `record.decisionDeadlineMs: 3000` | `record.decision.expired { afterMs: 3000 }`, then `record.finished` |
| **ADE through its own buttons** (unpackaged build under Playwright's Electron support) | Recent project → all eleven tabs → Record review → gateway select (`anthropic — no credential on this service` **disabled**, `fake — committed answers…` default) → Start recording → decision rendered with candidates, fingerprint, snapshot excerpt → Accept → second decision rendered. Screenshots taken. Phase 5's K6 is closed. |
| `Dismiss the dialog` on the sample `/widgets` page | the page recorded `confirmed`; a flow expecting `confirmed` after a dismiss passes (K7 confirmed) |

## Scores (10 parameters, 1–10)

| # | Parameter | Score | Basis |
|---|---|---|---|
| 1 | Contract reproducibility | 9 | Green on both Node versions with no credential; every published number reproduces; `typecheck` is outside the contract and red |
| 2 | Spec fidelity | 7 | The Java runtime does not write the published schemas (§14); the AX bridge cannot meet the surface deadline on the target; T6.1's healing-variant Validate item was dropped without a deviation |
| 3 | Test integrity | 8 | Every independent probe agreed with the suite where the suite reaches; the runtime suite never validates artifacts, and the desktop suite is green against recorded trees while the live run is 0 of 7 |
| 4 | Boundaries, packaging, hygiene | 9 | Lint clean; nothing stray committed; model artifacts ignored; wrapper jar exception exact |
| 5 | Phase 5 corrections | 10 | All five verified independently, the record review through the real screen included |
| 6 | Automation guarantees and secrets | 8 | Guards never act; the Java runtime leaks nothing; `Dismiss the dialog` accepts it |
| 7 | Reach | 7 | WebMCP, import, and the Java comparison hold under independent drives; the AX live gate fails; UIA and the fine-tune are unmeasured |
| 8 | ADE | 9 | Record review, gateway choice, disabled unavailable gateway, alert path, import action; all through the service and, this time, through the buttons |
| 9 | Report accuracy and candour | 9 | The three headline results are exactly right; the bridge cost is named as unmeasured; one Validate item silently missing |
| 10 | Deviation discipline | 8 | Six deviations, each with the section and the reason; the seventh, T6.1's relocalization subset, is absent |

**Overall: 8.4 / 10.** Phase 6 is accepted with corrections.

## Findings

**F1 — The macOS Accessibility live gate fails, and the cause is the bridge, not the permission (LLD §7.5, REQ-ADP-7, REQ-SURF-3).** With `surface doctor` reporting `granted`, `desktop-conformance.mjs --adapter ax` runs the suite and every case fails at "the surface opens" with the ten-second deadline. Measured against the ADE's welcome window, which has 35 nodes: the bridge's `WINDOW_SCRIPT` reads about seventeen attributes per node, each an Apple event, at roughly 650 ms per node, so the smallest window the ADE has takes ten seconds and the project screen would take minutes. The same window's `entireContents()` answers in 121 ms and `properties()` in 19 ms per element, so the osascript design D1 chose can meet the deadline by an order of magnitude; it is the per-attribute walk that cannot. Two smaller defects sit beside it: the timeout message says the delay is "what an unanswered Accessibility permission prompt looks like" even when `doctor` has just said `granted`, and the script waits a fixed eight seconds for the ADE's window when this machine took fifteen seconds twice and never showed one within twenty-five seconds once. Draft 2.8 §7.5 states the bulk-read requirement and a budget; T7.1 closes it.

**F2 — The Java runtime's artifacts are not in the published schemas (LLD §14, REQ-STD-3).** `results.jsonl` lines carry `behavior, flow, story, stepId, line, text, status, matched, runId` and nothing else; `summary.json` has no `startedAt` or `endedAt`. Both fail `stepResultSchema` and `summarySchema`. The runtime copied the *comparable projection* that `scripts/compatibility.mjs` writes into the fixture, and the conformance script compares that projection only, so a runtime that writes invalid artifacts is reported conformant. The zero-mismatch result stands for status and matched candidate; the sentence "writes results and summary in the published schemas" does not. Draft 2.8 §14: a foreign runtime's artifacts are validated against the schemas before comparison, and the fixture is documented as a projection.

**F3 — T6.1's Validate item "a healing variant subset (renamed control, moved panel) passes relocalization" was not implemented, deviated, or listed as a gap.** Nothing in either desktop adapter's tests, the desktop suite, or the progress file mentions a renamed control or a moved panel. Draft 2.8 §16 restates it as a desktop healing case list; T7.1 carries it.

**F4 — `Dismiss the dialog` accepts the dialog (K7, pre-existing, confirmed).** The grammar emits `args.action: "dismiss"`; the Playwright adapter reads `args.accept` and defaults to `true`. Reproduced end to end. Draft 2.8 §3.2 fixes the IR shape for `dialog` so both sides read the same key; T7.3.

**F5 — `pnpm -r typecheck` is red in `@svatah/workflow` (K9, pre-existing, confirmed on `master`).** Draft 2.8 adds `typecheck` to the verification contract; T7.3.

**F6 — Small defects in the desktop gate script.** `--report` is resolved against the project directory, so `--report ../adapter-ax.md` wrote `evals/adapter-ax.md` inside the repository; the ADE wait is a fixed sleep rather than a poll for the window. T7.1.

**F7 — Spec drift absorbed (Draft 2.8).** `POST /migrate` in §13.5 (D3); the desktop suite as a second case list under §14 (D4); `AXDOMIdentifier` as an `automationId` source (D2); the bridges over `osascript` and PowerShell as permitted implementations of §7.5 with a stated budget (D1); the Java runtime's feature set stated as the fixture's, with everything else failing by name (D5); `eval finetune export` and `surface doctor --adapter` in the §15 table.

**F8 — CI.** The GitHub workflow carries the desktop and Java conformance jobs; the Bitbucket pipeline, the repository's only remote, carries neither. Both have never run (K10). T7.2 makes the pipeline that exists carry the gates.

## What was confirmed beyond the report

- The compiler eval's Tier 2 number is unchanged by the `asExample` and `modelStepSchema` fixes, which is the right outcome: the fixes changed the shape shown to the model, not the answers scored.
- The fake-gateway record session's every decision carries `provenance.model: fake:grounding-cases` with zero tokens, and the ADE labels the session as such above the decision.
- The import's story names and step counts match the migrated fixture exactly, and the importer's column names match the prototype's source, cloned and grepped rather than trusted.
