# Phase 9 — adversarial verification

Verifier: separate session · Date: 2026-09-05 · Subject: branch `phase-9` at `64028c9`
Method: clean detached worktree of `phase-9`; the six-command contract with no model credential on Node 25 and on Node 22 with `CI=true`; every claim in `docs/spec/progress/phase-9.md` re-run or probed with independently constructed inputs; the packaged ADE driven through its own Playwright cases; the terminal cockpit captured in a pseudo-terminal; the component sheet audited with a real axe-core; the fixture recording re-taken; the parity and drift checks made to fail.

## The headline results, checked

- **The screen model is a recording.** The fixture check matches the service on a clean fixtures project. It fails whenever that project holds any run besides `comp`, which it did twice here without anyone editing anything (F1).
- **Both renderers run on the two screens.** The packaged ADE's eight Playwright cases pass on this host; the screenshots match the approved mockups closely, with three polish defects (F5). The cockpit draws in a pseudo-terminal and its `--json` equals the model's state, except that the state carries a relative time as text, which made the equality fail once on Node 22 (F4).
- **Three clients from one description.** Python 3.14.3 and Java 17.0.12 both 3 of 3 against a live service; the drift check exits 1 on a hand edit; the report names a script that does not exist (F6).
- **The Phase 8 corrections.** The gate's teardown wait and window-owning process choice are demonstrated by tests; the load figures are on the cost line; the snapshot case fails on unnamed controls. The live gate could not run for either of us: the display was locked here as well, and the gate reported a launch failure with exit 2 both times, exactly as designed.
- **The accessibility run.** The in-house audit reports zero violations. axe-core 4.10.3, run through the `--axe` hook, reports one rule the audit lacks: eleven landmarks share a role and name (F3).

## Contract

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint`, no credential, Node v25.6.1 | all exit 0; 3,344 vitest tests passed, 0 failed |
| `pnpm -r typecheck && pnpm -r test` on Node v22.23.2 with `CI=true` | typecheck 0; tests 3,343 passed, **1 failed**: `tui-pty.test.ts › prints the Flows screen the same way`, expected `"run 20 s ago"`, received `"run 19 s ago"`; passes alone |
| `git diff master..phase-9 -- docs/spec/{requirements,hld,lld,tasks}.md docs/spec/design` | empty |
| `node scripts/record-screen-fixtures.mjs --check` during the suite, and again after the client smoke | fails both times; passes once `evals/fixtures/runs` holds only `comp` |
| `node scripts/smoke-clients.mjs` | python 3 of 3, java 3 of 3, PASS both; `pnpm clients:smoke` does not exist |
| `pnpm sheet && pnpm sheet:audit` | 0 violations, 28 interactive elements named and id'd, 30 contrast pairs |
| `pnpm sheet:audit --axe axe.min.js` (axe-core 4.10.3, fetched for this run only) | **1 violation**: `landmark-unique`, 11 nodes |
| `pnpm --filter @svatah/screens build` after renaming `heal.run`'s label, then the parity test | 4 assertions fail; the same edit without a rebuild passes, because the check reads the built package |
| `node scripts/generate-clients.mjs --check` after editing a generated Python method | exit 1, names the file |
| `pnpm --filter @svatah/ade package && pnpm --filter @svatah/ade exec playwright test` | 8 passed against the packaged application |
| `pnpm ui:capture` | both screens captured; the inspector pane is clipped at the captured width (F4) |
| `node scripts/desktop-conformance.mjs --adapter ax` | exit 2, launch failure: no window within 60 s; the only process owning a window on this host was `loginwindow` |
| `git ls-files | grep __pycache__` | two compiled Python files tracked (F2) |
| Tree after every script | clean |

## Scores (10 parameters, 1–10)

| # | Parameter | Score | Basis |
|---|---|---|---|
| 1 | Contract reproducibility | 8 | Green on Node 25; one wall-clock race on Node 22 |
| 2 | Spec fidelity | 8 | §13.7 and §13.8 implemented as written, nine deviations reasoned; the sheet is not axe-clean |
| 3 | Test integrity | 8 | Parity and drift checks bite; the fixture check depends on a directory it does not own; one equality on a relative time |
| 4 | Boundaries, packaging, hygiene | 7 | Compiled caches tracked; the recorder writes runs into the fixtures project; boundaries otherwise clean |
| 5 | Phase 8 corrections | 8 | All four in and tested; the live measurement still unowned by anyone with an unlocked display |
| 6 | Automation guarantees and secrets | 9 | No leak; the SDK never sees a model credential |
| 7 | Reach | 9 | Two renderers, three clients, one description; all real here |
| 8 | ADE and cockpit | 9 | The screens are the mockups; toolbar wrapping, a doubled heading, and a thin audit line remain |
| 9 | Report accuracy and candour | 8 | The host analysis is right and the flake disclosed; one wrong command name; the parity claim is true of the built package only |
| 10 | Deviation discipline | 9 | Nine deviations with sections and reasons |

**Overall: 8.4 / 10.** Phase 9 is accepted with corrections.

## Findings

**F1 — The fixture recorder uses the real fixtures project (LLD §13.7).** `record-screen-fixtures.mjs` runs `comp` inside `evals/fixtures` and records `GET /runs`, so any other run in that directory changes the answer. The suite, the client smoke, and any person running a flow all leave one. Draft 2.12: the recorder and its check work on a copy of the fixtures project in a temporary directory; T10.4.

**F2 — Compiled Python caches are tracked.** `clients/python/svatah_sdk/__pycache__/*.pyc` are in git and change on every smoke run. Ignore and untrack; T10.4.

**F3 — The sheet fails axe-core's `landmark-unique` (T9.2's Validate).** Eleven landmarks with the same role and name. The in-house audit lacks the rule. Draft 2.12: the audit implements every axe rule the sheet has ever failed, and CI fetches axe-core at test time, outside the dependency tree, to run it beside the audit; T10.4.

**F4 — Two cockpit defects.** The model's Flows state carries `"run 20 s ago"` as text, so two loads a second apart are unequal and the `--json` equality flaked once on Node 22; the state should carry the timestamp and the renderers format it. The capture shows the inspector pane clipped at the captured width; panes must size to the terminal and the inspector collapse below a width; T10.4.

**F5 — Three polish defects on the Run screen.** Toolbar buttons wrap onto two lines when the run title is long; the "Candidates tried" heading is rendered twice; the audit pane shows only the kind and outcome where the model carries the call detail the mockup shows; T10.1.

**F6 — Report corrections.** `pnpm clients:smoke` is `node scripts/smoke-clients.mjs`; the parity check compares the built package, so a renamed label fails it after a build, not before.

**F7 — The live macOS gate needs an unlocked display and nobody had one.** Exit 2 with the launch-failure message on both hosts. Draft 2.12 adds an `ax/session` check to `surface doctor` that says when no process in the login session owns a window, so a locked screen is named as such; T10.4.

**F8 — Spec drift absorbed (Draft 2.12).** The in-house accessibility audit with an axe run beside it (D1); the client generator in the repository (D2); the light theme's `--dim` darkened for contrast (D3); a `--scrim` token (D4); HLD §12 lists the five new packages (D5); `heal.run` belongs to the Run screen (D6); rail items for unbuilt screens open Legacy until Phase 10 (D7); `svatah ui --capture` (D8); no Stop action until `POST /runs/:id/stop` exists (D9, K3): Phase 10 adds the route and the action.

## What was confirmed beyond the report

- The packaged ADE's Flows and Run screens, read as screenshots, match the approved artboards in structure, content, and tone; the real run's numbers are on them.
- The Java client's HTTP/1.1 choice is load-bearing: the service refuses an HTTP/2 upgrade header, so a default `HttpClient` would fail every call.
- The parity check reads three independent sources and the built registry, which is the right place for it, since the contract builds before it tests.
