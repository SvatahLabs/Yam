# Phase 11 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root. `master` already carries Phase 10, its verification, and Draft 2.14 of the spec. It applies the Phase 10 corrections from `docs/spec/progress/phase-10-verification.md`, then implements Phase 11: the pieces Svatah lacks to drive its own verification, the self-verification suite, and the two-sided parity gate.

---

## Prompt

```
You are continuing the Svatah implementation. Phases 0 through 10 are merged on master; Phase 10 was verified at 8.3/10 with corrections required. The spec on master is Draft 2.14; do not edit the four spec documents, and edit the artboards under docs/spec/design/ only as F4 of the Phase 10 verification directs. You will apply the corrections, then implement Phase 11.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md (REQ-SELF-1..3 are new)
- docs/spec/hld.md
- docs/spec/lld.md (§13.9 is the heart of this phase; also §13.7's Draft 2.13 rules, §7.1, §7.5, §4.2)
- docs/spec/tasks.md (Phase 11, T11.1 through T11.6)
- docs/spec/design/README.md and the artboards
- docs/spec/progress/phase-10.md and docs/spec/progress/phase-10-verification.md

Branching: create branch phase-11 from master. Commit after each item with "P10-F<n>: <title>" or "T11.<n>: <task title>".

PHASE 10 CORRECTIONS (T11.1, before anything else), from docs/spec/progress/phase-10-verification.md:
F1 The packaged ADE runs without a window after its first launches in a session. Reproduce first: `open -n` the packaged ADE a few times on an unlocked display; the process finishes launching with a regular activation policy and no AXWindows, no output on either stream, and Playwright still drives its renderer over CDP. Add the window-lifecycle debug log (`SVATAH_ADE_DEBUG=1` → `<userData>/ade-debug.log`) and the graceful quit route of Draft 2.13, then diagnose with them before changing anything else. Nothing desktop in this phase can pass until this is understood; if you cannot find the cause, say exactly what the log shows and stop at that task.
F2 The live gate: exempt standard window chrome (close, minimise, zoom and their subroles) from the id rule; a screen with a list selects its first row by default so the Bindings inspector shows its candidate table; re-record the variant-1 fixture from the live app and make `rail-flows` relocalize live.
F3 The Record screen: the toolbar keeps at least twelve characters of its title and sheds secondary controls into the palette; the gateway select is one line; Accept, Re-pick and Reject render `availableWhen`.
F4 The artboards: the Explorer toolbar must not wrap; the Data inspector says `set` alone, never a secret's length, and its Read-by table fits the inspector. Apply both to the artboards, then to the screens.
F5 The gate: a session probe that did not answer in time is "could not tell", never a cause.
F6 `pnpm ade:shoot` writes outside the tree unless `--update`.
F7 The packaged test build carries its own bundle name so the suite's ADE cases never collide with a person's instance.
F9 The cockpit draws a 104-character line on a 100-column terminal when content is long enough (`tui-pty.test.ts › at 100 columns` is red on master): apply the width budget to every cell; `cockpit.test.tsx › runs renders` polls for the loaded state instead of waiting a fixed time.
Also T11.1's editing work: the flow editor edits and saves through PUT /flows/:file with lint on save, and the API screen edits a saved request through PUT /api/:name. Add a "Post-verification corrections" section to docs/spec/progress/phase-10.md.

PHASE 11 SCOPE: tasks T11.1 through T11.6 in docs/spec/tasks.md, in order. Nothing from Phase 12.

Environment and fallbacks (state which applied in the progress file):
- This host is macOS with the Accessibility permission granted to the terminal that runs Svatah. Screen Recording depends on the terminal; `svatah surface doctor --adapter ax` says. The display must be unlocked for every desktop task; `ax/session` says when it is not. A screenshot or a live result you cannot take is recorded as `unreachable` with the doctor line, never fabricated.
- The Windows side of every desktop check is `unreachable` here and is published as such by the gate; do not stub it.
- The external side of a check reuses what exists: the ADE's Playwright cases over CDP, the generated clients' smoke, the pseudo-terminal capture, osascript probes. Do not weaken an external implementation to make it agree with a flow; a disagreement is a finding to resolve by finding which side is wrong.
- Model credential and local model server: same rules as before. Every recording uses `--gateway fake`, including the new desktop cases.

Decisions already made (do not re-open):
- Launch and quit are configuration (`app.launch`, `app.quit`); the language gains only `Quit the app`.
- Both sides of every check stay. The Playwright shell cases are not deleted; they become the external side. The gate scores agreement and publishes coverage and one-sided checks; it passes only at 100 percent agreement.
- Three oracles stay external by design: the healing eval's ground-truth keys, axe-core on the sheet, and the renderer-versus-adapter tree agreement.
- From this phase on, the verification contract is `svatah eval self` green plus its one-sided list.

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. If the spec cannot be followed as written, implement the closest faithful option and record it under Deviations in docs/spec/progress/phase-11.md with the section reference and reason. Do not edit the spec.
3. Model calls only through the gateway and only where earlier phases allow them; the replay path stays model-free; the import-boundary lint must still pass.
4. Permissive licences only (REQ-PKG-3); Node 22 LTS and the current LTS; JDK 17.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-11.md with, per correction F1..F9 and per task T11.1..T11.6: status, the exact commands demonstrating each Validate item, observed results, which environment fallback applied; Deviations and Known gaps sections; the parity report embedded.
- Everything runnable from a clean checkout with: pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint, with no credential, on Node 22 and the current LTS; the tree green, the 100-column case included.
- The ADE launched and quit ten times in a row with a window every time, through `svatah run` on a self flow.
- `svatah eval self --report reports/self-parity.md` at 100 percent agreement, with coverage per side, wall time per side, and the one-sided list; a deliberately wrong expectation shown to fail the gate with both pieces of evidence.
- The live macOS gate, three consecutive runs, 7 of 7 plus both healing cases, with the project screen's cost on the bridge line.
- A flow edited and saved through the ADE and through `svatah ui`; a request edited and saved.

When finished, print a summary table of F1..F9 and T11.1..T11.6 with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-11`, with the display unlocked:

1. Run the six-command contract with no credential on Node 22 and the current LTS; confirm `git diff master..phase-11 -- docs/spec/{requirements,hld,lld,tasks}.md` is empty and that the only design changes are the two F4 fixes.
2. Run `svatah eval self` and read the parity report: agreement, coverage, disagreements, one-sided checks; rerun with a flow expectation deliberately broken.
3. Package the ADE and run a self flow that launches, opens a project, reads a screen, and quits, ten times; then the live gate three times, once beside the test suite.
4. Drive one screen through both sides by hand and compare their evidence.
5. Score on the ten parameters, and from this phase on report what neither side of the gate reached rather than re-running what both did.
