# Phase 10 — adversarial verification

Verifier: separate session · Date: 2026-09-05 · Subject: branch `phase-10` at `3409963`
Method: clean detached worktree of `phase-10`; the six-command contract with no model credential on Node 25 and on Node 22 with `CI=true`; every claim in `docs/spec/progress/phase-10.md` re-run or probed with independently constructed inputs; the four new artboards rendered and read as designs; the packaged ADE driven through its own Playwright cases and through the live macOS gate on an unlocked display; the screenshots read against the artboards.

## The headline results, checked

- **All twelve screens render in both renderers.** The packaged ADE's 34 Playwright cases pass on Node 25 and Node 22 when nothing else touches the ADE; the cockpit's 26 pseudo-terminal cases pass in the suite. The screenshots are the artboards.
- **The four secondary artboards are in the system** and are approved for building with two changes (F4): the Explorer toolbar wraps, and the Data inspector prints a secret's character count.
- **The seven Phase 9 corrections hold under independent probes.** The fixture check passes with three unrelated runs present; axe-core and the in-house audit both report zero; the drift check matches 37 routes; the Flows state carries an instant; the 100-column capture has three panes and says its size; `ax/session` reports nine applications on this session.
- **The live macOS gate ran cases for the first time and is not conformant**, on a run at load average 24: 7 of 9 cases green, the project screen read at 1,017 nodes in 4.6 s, and three failures that the recorded-tree tests could not see (F2). Every launch after that one produced a running ADE with no window, on this unlocked session, with or without a project, after a 30 s settle, and with the GPU disabled (F1). The implementer saw the same and said so.
- **Node 22.** Typecheck green; the full suite's only failures were the two ADE cases my own gate runs interrupted; the ADE package rerun cleanly on Node 22 passes 118 + 34.

## Contract

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm lint`, Node v25.6.1 | all exit 0 |
| `pnpm -r test`, Node v25.6.1 | exit 1: `apps/ade`'s Playwright cases failed while my gate runs were killing ADE instances on the same machine; every vitest package passed. Rerun alone: 118 vitest + 34 Playwright passed |
| `pnpm -r typecheck && pnpm -r test`, Node v22.23.2, `CI=true` | typecheck 0; the same two ADE cases failed for the same reason; `pnpm --filter @svatah/ade test` alone on Node 22: 118 + 34 passed |
| `git diff master..phase-10 -- docs/spec/{requirements,hld,lld,tasks}.md` | empty; under `docs/spec/design/` four added artboards only |
| Fixture check with `ua`, `ub`, `uc` summaries in `evals/fixtures/runs` | `matches the service: 7 flow(s), 22 stories, 30 bindings, run comp exit 11` |
| `node scripts/audit-sheet.mjs --axe "$(node scripts/fetch-axe.mjs)"` | axe-core 4.10.3: 0 violations; audit: 0 violations |
| `node scripts/generate-clients.mjs --check` | 3 clients match: 37 routes, 16 event kinds |
| Live gate, run 1, load average 33, suite running | variant 0 opened the project in 4.1 s, one read retried; variant 1 no window; the gate blamed the login session because the `ax/session` probe itself timed out at 5 s (F5) |
| Live gate, run 2, load average 24 | 7 of 9 cases passed at variant 0; `ade.snapshot` 8/9, `ade.inspector` 2/3, `ade.heal.renamed-control` failed at variant 1, `ade.heal.moved-panel` relocalized at variant 2; bridge 1,017 nodes in 4,560 ms, 4.48 ms per node, 16,277 calls |
| Live gate, runs 3 and 4, load average 3 | no window within 60 s at the first launched variant |
| `open -n` of the packaged ADE, no project, 5 s and 30 s settle, `--disable-gpu` | process running, `activationPolicy` regular, `finishedLaunching` true, `AXWindows` empty, no stdout or stderr |
| `pnpm ade:shoot` | twelve renderer screenshots rewritten in the tree (F6); the AX screenshot failed with `no-window` for the reason above |
| Tree after the probes | 12 modified screenshot files, restored |

## Scores (10 parameters, 1–10)

| # | Parameter | Score | Basis |
|---|---|---|---|
| 1 | Contract reproducibility | 8 | Green on both Node versions when the ADE cases run alone; they kill and relaunch by path, so any other ADE on the machine breaks them |
| 2 | Spec fidelity | 8 | Twelve screens to the artboards; seven deviations reasoned; the id rule applied to the window's own buttons |
| 3 | Test integrity | 8 | Every probe bites; the live gate found three defects the recorded trees pass |
| 4 | Boundaries, packaging, hygiene | 9 | Caches untracked; one script rewrites committed screenshots on every run |
| 5 | Phase 9 corrections | 9 | All seven verified independently |
| 6 | Automation guarantees and secrets | 8 | No leak in code paths; the Data artboard prints a secret's length |
| 7 | Reach | 8 | Every screen driven in both renderers; the run-stop route works; the live gate not green |
| 8 | ADE and cockpit | 7 | The Record screen's toolbar fails the Draft 2.12 rule in three ways; the rest is the design |
| 9 | Report accuracy and candour | 9 | The windowless launch described precisely and left open; the flake disclosed |
| 10 | Deviation discipline | 9 | Seven deviations with sections and artboards |

**Overall: 8.3 / 10.** Phase 10 is accepted with corrections. The four artboards are approved with F4's two changes.

## Findings

**F1 — After its first launches in a login session, the packaged ADE runs without a window (REQ-ADE-6, LLD §13.6).** Reproduced independently of the gate: `open -n` with no project, after a 30 s settle, with `--disable-gpu`, each time a process that finished launching with a regular activation policy and no `AXWindows`, no output on either stream. Earlier in the same session the same build opened its window and project screen in four seconds. Playwright drives the windowless renderer over CDP successfully, which is why every renderer test is green while the gate is not. Neither the implementer nor I found the cause. Draft 2.13: the ADE logs its window lifecycle to its user-data directory when `SVATAH_ADE_DEBUG=1`; the gate stops an instance through a graceful quit route before it signals; T11.7.

**F2 — Three live failures in the one gate run that reached the cases (LLD §7.5, §13.7, §16).** `ade.snapshot` fails the id rule on the window's own close, minimise, and zoom buttons, which are named by P8-F3's subrole table and can never carry an `automationId`; the rule must exempt standard window chrome. `ade.inspector` found no `inspector-candidate-table` because the Bindings inspector is empty until a row is chosen; the screen selects the first binding by default, as the artboard shows, or the case chooses one. `ade.heal.renamed-control` reports `not-found` at variant 1 against the live tree where the recorded tree relocalizes; the live variant and the recorded fixture differ, and the fixture is the one to doubt. T11.7.

**F3 — The Record screen fails the toolbar rule three ways (Draft 2.12 §13.7).** The title truncates to two letters; the gateway select overflows its box onto two clipped lines; Accept, Re-pick, and Reject are enabled with no session open although `availableWhen` says otherwise. Draft 2.13: a toolbar title keeps at least twelve characters and the toolbar sheds secondary controls into the palette before that; a select never exceeds one line; buttons render the model's `availableWhen`. T11.7.

**F4 — The four new artboards, reviewed.** In the system, with real data, and approved for building with two changes: the Explorer toolbar wraps its title and buttons; the Data inspector says "set · 14 characters", which discloses a secret's length and must say `set` alone, and its "Read by" table overflows the inspector. Recorded so the build carries them.

**F5 — The gate misattributes a slow probe.** Under load the `ax/session` probe timed out at 5 s and the gate printed "this login session cannot show one" beside a doctor line saying nine applications own a window. A probe that did not answer is "could not tell", never a cause. T11.7.

**F6 — `pnpm ade:shoot` rewrites the twelve committed screenshots on every run.** Screenshots go outside the tree unless asked to update the committed set. T11.7.

**F7 — The suite's ADE cases assume they own the machine's ADE.** They stop leftovers by path, so any other instance, a gate run or a person's, fails them. Document it in the contract and give the packaged test build its own bundle name or out directory. T11.7.

**F8 — Spec drift absorbed (Draft 2.13).** The audit line's candidate form (D1); the Runs screen owns no action (D2); the six secondary screens in one file (D3); the Settings fixture name (D4); the collapsed inspector scrolls (D5); the fake-gateway note is not an alert (D6); crumb separators hidden from the tree (D7). K6 and K7, the read-only flow editor and the send-only API request, become T11.7's editing work, because a release cannot ship an "editor" that does not edit.

## What was confirmed beyond the report

- The fixture recorder's temporary copy works: three foreign runs in the fixtures project changed nothing in the check.
- The parity check's 38 actions match the palette fixture and the CLI; the drift check regenerates three clients identically.
- The bridge reads a 1,017-node window in 4.6 s at load average 24, inside the budget with margin.
