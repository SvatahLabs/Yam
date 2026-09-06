# Phase 8 — adversarial verification

Verifier: separate session · Date: 2026-09-05 · Subject: branch `phase-8` at `a616429`
Method: clean detached worktree of `phase-8`; the six-command contract with no model credential on Node 25 and on Node 22 with `CI=true`; every claim in `docs/spec/progress/phase-8.md` re-run or probed with independently constructed inputs; the ADE packaged from the worktree and driven by hand, through the macOS Accessibility bridge, and through the gate; the screenshot the implementer's terminal could not take, taken.

## The headline results, checked

- **The packaged ADE opens a project.** Launched by hand through LaunchServices with no environment, the Recent-list button pressed through the adapter's own `AXPress`, the project screen showed its tabs. With `PATH` emptied the smoke check printed the three-place alert and opened nothing. `pnpm ade:smoke` chose the packaged target and reported the runtime it used. The resources folder carries the staged CLI.
- **The macOS gate is green, live, against the packaged ADE.** Three runs here: the first, started while the test suite was still unwinding at load average eleven, failed both healing cases at variant 1 with `no-window`; the next two, at load average seven, passed 9 cases across the three variants, with the project screen read at 589 nodes in 0.95–1.03 s, 1.6–1.7 ms per node. The budget is met by an order of magnitude on a quiet machine (F1, F2 below).
- **The screenshot through the AX adapter exists.** This terminal has the Screen Recording grant. `bridge.screenshot()` against the packaged ADE's project screen wrote a 537 KB image of the window; it shows the fixtures project, its eleven tabs, three diagnostics, and twenty-two stories. K1 is closed.
- **The fine-tune is withdrawn and the corpus is real.** 184 pairs, 37 actions, no duplicates, none shared with the golden set; five sentences sampled across the file all compile to `E_NO_MATCH`; the export reproduces with the same three sources and counts.
- **Publishing is prepared and cannot happen by accident.** The dry run prints twenty-six commands and exits 0; every guard combination refuses with the specific reason, including the Bitbucket manual trigger without a token.

## Contract

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint`, no credential, Node v25.6.1 | all exit 0; 3,160 vitest tests passed, 0 failed |
| `pnpm -r typecheck && pnpm -r test` on Node v22.23.2 with `CI=true` | see the post-run line below |
| `git diff master..phase-8 -- docs/spec/{requirements,hld,lld,tasks}.md` | empty |
| `pnpm --filter @svatah/ade package` | `Resources/svatah/` with `dist`, `node_modules`, `README.md` |
| `pnpm ade:smoke` | `target=packaged … window=open packaged=yes runtime: /opt/homebrew/bin/node (v25.6.1, from PATH)` |
| `env -i HOME=… PATH="" SVATAH_ADE_SMOKE=… <app>` | the three-place alert, exit 1 |
| `open -n` with `SVATAH_A11Y=1` and no project; the `fixtures` Recent button pressed through the bridge | the project screen open after 20.2 s, 15 tab-like nodes, 589 nodes; the read itself took 17.5 s at 29.6 ms per node **while the test suite ran** |
| `node scripts/desktop-conformance.mjs --adapter ax`, run 1, load average 11–16 | exit 1: variant 0 all seven flow cases passed; at variant 1 both healing cases threw `no-window` |
| The same, runs 2 and 3, load average about 7 | exit 0, conformant; healing relocalized at variants 1 and 2; 589 nodes in 948 ms and 1,010 ms |
| `bridge.screenshot()` on the packaged ADE's window | 537,293 bytes, the project screen |
| `svatah lint` on click-then-dismiss | `W_DIALOG_UNARMED` on the click, `W_DIALOG_NEVER_OPENED` on the dialog step, each naming pattern 21 |
| `svatah run` on click-then-dismiss | the page says `confirmed`; audit `kind:"dialog", armed:false, answer:"accept"` |
| `svatah run` on dismiss-then-click | passes; audit `armed:true, answer:"dismiss"` |
| `refused.jsonl` against `golden.jsonl` | 184 pairs, 0 overlap, 0 duplicates, 37 actions; 5 of 5 sampled sentences refused by the grammar |
| `eval finetune corpus`, `eval finetune export` | 184 from `refused.jsonl`, 0 from the two other sources; `pairs.jsonl` identical, manifest timestamp only |
| `pnpm release:dry-run` then `node scripts/publish.mjs` | 26 tarballs; 26 `npm publish` lines; exit 0; three reasons listed |
| Guard matrix: token only; dispatch only; Bitbucket manual without token; Bitbucket token without manual | exit 1 each with the one missing condition named |
| Tree after every script | clean |

Post-run line (Node 22): `typecheck` exit 0, `pnpm -r test` exit 0, 3,160 vitest tests passed, 0 failed.

## Scores (10 parameters, 1–10)

| # | Parameter | Score | Basis |
|---|---|---|---|
| 1 | Contract reproducibility | 9 | Green on both Node versions; every published number reproduces; the gate needs a quiet machine |
| 2 | Spec fidelity | 8 | §7.5's first-choice form does not work and the second was taken, with proof; the export lost two documented flags; everything else as written |
| 3 | Test integrity | 9 | Every claim the suite reaches reproduces; the gate has a teardown race the suite cannot see |
| 4 | Boundaries, packaging, hygiene | 8 | Tarballs clean; the app grew by a full CLI deploy, as §13.6 requires; three unnamed buttons on the Project screen |
| 5 | Phase 7 corrections | 10 | All six verified live, F1 by hand and the screenshot taken |
| 6 | Automation guarantees and secrets | 9 | Dialog audit lines both ways; publish guards hold; no token anywhere |
| 7 | Reach | 8 | The macOS gate green twice; UIA unrun; the fine-tune withdrawn with a corpus that compiles |
| 8 | ADE | 9 | The packaged product does its first job; the three-OS smoke unobserved off this host |
| 9 | Report accuracy and candour | 10 | The fork bomb, the load table, and the failed §7.5 form all disclosed unprompted; nothing overclaimed |
| 10 | Deviation discipline | 9 | Seven deviations, each with the section and the reason |

**Overall: 8.9 / 10.** Phase 8 is accepted with corrections. 0.1.0 is publishable at the owner's trigger.

## Findings

**F1 — The gate can look at the wrong ADE (LLD §14, §7.5).** Between variants the gate stops the ADE with `pkill -f <app>` and launches the next with `open -n`, and the bridge addresses the process by name. When the previous instance is still shutting down, `applicationProcesses.byName("Svatah ADE")` can answer the dying one, which owns no window, so every case at the new variant throws `no-window`. One of three runs here did that, under load. Draft 2.10: the gate waits until no process of the previous launch remains before launching the next; the bridge prefers the process that owns a window when several share the name; T9.1.

**F2 — The budget is load-sensitive and the report does not say what the machine was doing (K7, LLD §7.5).** Measured here: 1.6 ms per node at load average seven, 29.6 ms per node beside the test suite. The number is honest each time and useless without the load beside it. Draft 2.10: the bridge cost line records the one-minute load average and the CPU count; the gate retries a variant once when a read exceeds the deadline and says so; the CI leg that runs the gate runs nothing else; T9.1.

**F3 — Spec drift absorbed (Draft 2.10).** The window read is a native helper in-process through JXA's Objective-C bridge and the Apple-event form is struck (D1); the cost line counts accessibility calls (D2); `onServiceOpened` is a one-way sixth preload entry (D3); the gate launches through LaunchServices on macOS (D4); `eval finetune export` takes no `--ref` or `--project` and reads the corpus (D5); `surface doctor` has an advisory severity (D6); the packaged ADE carries a full CLI deploy (D7).

**F4 — Three unnamed buttons on the Project screen.** The bridge listed three `AXButton` nodes with no title before "Open a project…". The ADE's own accessibility is thin there (LLD §16 asks for names where the tree is thin); T9.3.

**F5 — The golden set is 222 against REQ-COMP-9's 300 (K5).** Inherited and carried; T9.2.

## What was confirmed beyond the report

- The three publish guards fail independently and in the documented combinations; a branch build with a token cannot publish.
- The refused corpus's spot samples are genuinely outside the grammar, and the export's manifest names the corpus, not a git ref.
- With a project open the packaged ADE's window has 589 accessibility nodes, and the eleven tabs are addressable by their `automationId`.
