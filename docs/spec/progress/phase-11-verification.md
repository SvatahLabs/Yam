# Phase 11 — adversarial verification

Verifier: separate session · Date: 2026-09-06 · Subject: branch `phase-11` at `b44ba14`
Method: clean detached worktree of `phase-11`; the six-command contract with no model credential on Node 25 and on Node 22 with `CI=true`; the parity gate run by me from the checkout and its numbers compared with the embedded report; the self suite, the launch loop, the desktop recording, the tree agreement, the bite, and the AX screenshot re-run; the locked-display diagnosis read against the probes I had made in Phase 10.

## The headline results, checked

- **The windowless launch was the locked display, and my Phase 10 finding mis-attributed it.** I had tested "unlocked" by counting non-empty window lists, and a locked screen answers every application's list with the application element. The implementer's native probe and its two-direction measurement are the right evidence; `ax/session` reads the lock state now and my run reports it usable with eight window owners. My Phase 10 F1 is withdrawn as a defect in the ADE.
- **The parity gate is at 100 percent here too.** `svatah eval self` from my checkout: 100 percent agreement over the ten checks both sides reached, Svatah 11 of 48, external 45 of 48, no disagreement, exit 0. The numbers match the embedded report.
- **Svatah launches, drives, and quits the ADE.** Three launch-loop rounds each created, showed, and loaded a window readable through the accessibility API and quit gracefully in under half a second with no leftover; `svatah run evals/self` 31 passed, 0 failed.
- **The desktop recording works**, once two directories exist that git does not carry (F1 below): three bindings recorded with `automationId`, `controlPath`, `role`, and `text` candidates, replayed, and relocalized at variant 1 at 0.750 onto the element with the recorded id.
- **The AX screenshot exists.** My terminal has the Screen Recording grant: `pnpm ade:shoot` wrote it, 333 nodes read in 552 ms. K2 is closed for the project.
- **The one-sided list is the honest deliverable.** Thirty-six checks with one side; three external by design; one that only Svatah reaches, which is the first time Svatah reaches something its external oracle cannot. Two of the "neither side" rows are a catalogue naming defect, not a shortcoming (F2).

## Contract

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint`, no credential, Node v25.6.1 | all exit 0; 3,527 vitest tests passed, 0 failed |
| `pnpm -r typecheck && pnpm -r test` on Node v22.23.2 with `CI=true` | see the post-run line below |
| `git diff master..phase-11 -- docs/spec/{requirements,hld,lld,tasks}.md` | empty; under `docs/spec/design/` the Data artboard, the toolbar rule in `base.css`, and the macro extraction that lets the audit and the build share one expansion |
| `svatah surface doctor --adapter ax` | `ax/accessibility granted`, `ax/session 8 application(s) own a window`, `ax/screen-recording granted` |
| `node scripts/ade-launch-loop.mjs --times 3` | 3 of 3 created, showed, loaded, readable, quit in 426–438 ms, no leftovers |
| `svatah run evals/self --host none` | 31 passed, 0 failed, 0 skipped |
| `svatah eval self --report` | 100 percent over 10; Svatah 11 of 48 in 46.8 s; external 45 of 48 in 439.8 s; exit 0 |
| `pnpm self:bite` on the clean checkout | **crashes**: `ENOENT … evals/self/steps`, then `evals/self/api` (F1) |
| `pnpm self:record` on the clean checkout | the same crash (F1) |
| Both, with the two directories created | the bite reports one disagreement with both sides' evidence and exits 0; the recording writes three bindings, replays, relocalizes at 0.750 |
| `pnpm tree:agreement` | 58 identified controls agree, 58 in the DOM, 340 in the tree |
| `pnpm artboards` | 15 artboards fit their frames |
| `pnpm ade:shoot` | thirteen screenshots including the AX one, written outside the tree |
| The reporter's name for a pseudo-terminal case | `describe it` joined by a space; the catalogue writes `describe > it` (F2) |
| Tree after the gate | `reports/adapter-ax.md` and `reports/eval-healing.md` rewritten (F3) |

Post-run line (Node 22): typecheck exit 0; `pnpm -r test` exit 0; 3,527 vitest tests passed, 0 failed.

## Scores (10 parameters, 1–10)

| # | Parameter | Score | Basis |
|---|---|---|---|
| 1 | Contract reproducibility | 9 | Green on Node 25; every number in the report reproduces from the checkout; two scripts need directories git does not carry |
| 2 | Spec fidelity | 9 | §13.9 implemented as written with the gate at 100 percent; six deviations reasoned; the HTTP and SDK sides catalogued but not written |
| 3 | Test integrity | 9 | The gate bites; eight runs' failures each named; the external side made as patient as Svatah's without weakening it |
| 4 | Boundaries, packaging, hygiene | 8 | Empty directories untracked; the gate rewrites two committed reports on every run |
| 5 | Phase 10 corrections | 10 | All nine closed with evidence, and F1's diagnosis corrected the verifier |
| 6 | Automation guarantees and secrets | 9 | The Data screen says `set` alone; every recording is the fake gateway |
| 7 | Reach | 8 | Svatah reaches 11 of 48 checks; the three missing sentences are named precisely |
| 8 | ADE and cockpit | 9 | Toolbar rule enforced by measurement at seven widths; editing works; the cockpit's budget is arithmetic |
| 9 | Report accuracy and candour | 10 | The eight-run table, the hidden-window trace, and "what hid the ADE is not established" |
| 10 | Deviation discipline | 9 | Six deviations with sections and reasons |

**Overall: 9.0 / 10.** Phase 11 is accepted with corrections. The verification contract is now the gate, as the spec says, and this is the last report that re-runs what both sides already reach.

## Findings

**F1 — Two scripts fail from a clean checkout.** `pnpm self:bite` and `pnpm self:record` copy `evals/self` with `cpSync` and crash on `evals/self/steps` and `evals/self/api`, which exist in the implementer's tree and not in git, because git carries no empty directory. Track a placeholder in each, and make the copy tolerate a missing optional directory; T12.7.

**F2 — The two cockpit checks are misnamed, not unreachable.** The catalogue writes the pseudo-terminal cases as `describe > it`; vitest's JSON reporter joins `fullName` with a space, so the runner finds nothing and both rows read "neither side could look". The external side works. Match on ancestor titles plus title, and make the catalogue test assert every external name against its source's reported names; T12.7.

**F3 — The gate rewrites committed reports.** `svatah eval self` leaves `reports/adapter-ax.md` and `reports/eval-healing.md` modified on every run, so a clean checkout is dirty after the contract's own gate. Reports go outside the tree unless `--update`, the rule `ade:shoot` already follows; T12.7.

**F4 — The three sentences the language lacks, and what closes a third of the list.** The implementer's reading of the one-sided list is right and is adopted into Draft 2.15: an assertion over a set with a quantifier and a scope (pattern 32), a window size in `app.launch` and a `Resize the window to <w> by <h>` sentence (pattern 33), and a `Wait for` over a service response by JSON path (pattern 19 extended), plus a multi-line `Type`, a chord sent to the window (pattern 11 extended), and the HTTP and SDK sides of the self suite (K1). T12.7.

**F5 — The verifier's Phase 10 F1 is withdrawn.** The ADE always made its window; the accessibility API could not read any application's window on a locked display, and my check for "unlocked" was the same flawed read. Recorded here so the Phase 10 report is read with it.

**F6 — Spec drift absorbed (Draft 2.15).** `rolePathSimilarity` ignores anonymous containers with the web healing numbers unchanged (D1); two self projects, accessibility and CDP (D2); numbered self flows with the quitting flow last (D3); a seeded Recent entry (D4); the toolbar sheds the primary action when the floor demands it (D6). D5, the unwritten HTTP and SDK sides, is F4's work.

## Node 22

`pnpm -r typecheck` exit 0 and `pnpm -r test` exit 0 on v22.23.2 with `CI=true`: 3,527 passed, 0 failed, the pseudo-terminal and cockpit cases included.

## What was confirmed beyond the report

- The gate's per-source cost is dominated by the healing eval and the pseudo-terminal cases, 228 s and 88 s; the self flows themselves take under a minute.
- The variant-2 relocalization needed the role-path measure to ignore anonymous containers; I checked that the web healing report's two numbers are byte-identical before and after.
- The first check Svatah reaches and the external oracle cannot is launching and quitting the packaged ADE, because Playwright's Electron launcher cannot open a build with the run-as-node fuse off.
