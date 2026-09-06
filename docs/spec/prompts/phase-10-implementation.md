# Phase 10 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root, after `master` has been fast-forwarded to `phase-9` and the Draft 2.12 amendments committed on it. It applies the Phase 9 corrections from `docs/spec/progress/phase-9-verification.md`, then implements Phase 10 (builder surfaces, complete).

---

## Prompt

```
You are continuing the Svatah implementation. Phases 0 through 9 are merged on master; Phase 9 was verified at 8.4/10 with corrections required. The spec on master is Draft 2.12; do not edit the four spec documents or the mockups under docs/spec/design/. You will apply the corrections, then implement Phase 10.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md
- docs/spec/hld.md
- docs/spec/lld.md (§13.6, §13.7, §13.8, and §7.5's Draft 2.12 rules)
- docs/spec/tasks.md (Phase 10, T10.1 through T10.4)
- docs/spec/design/README.md, base.css, and every artboard under docs/spec/design/artboards/
- docs/spec/progress/phase-9.md and docs/spec/progress/phase-9-verification.md

Branching: create branch phase-10 from master. Commit after each item with "P9-F<n>: <title>" or "T10.<n>: <task title>".

PHASE 9 CORRECTIONS (before any Phase 10 task; together they are T10.4's first half):
F1 The fixture recorder runs `comp` inside evals/fixtures and records GET /runs, so any other run there changes the answer. Reproduce first: run any flow into evals/fixtures/runs, then `node scripts/record-screen-fixtures.mjs --check`. Work on a temporary copy of the fixtures project.
F2 clients/python/svatah_sdk/__pycache__/*.pyc are tracked. Ignore `__pycache__/` and `*.pyc`, untrack them.
F3 axe-core 4.10.3 reports `landmark-unique` (11 nodes) on the component sheet through `pnpm sheet:audit --axe`. Give the eleven landmarks distinct names or regions, add the rule to scripts/audit-sheet.mjs, and make CI fetch axe-core at test time (outside the dependency tree) to run beside the audit; a rule axe reports and the audit does not is a defect in the audit.
F4 The Flows state carries "run 20 s ago" as text, and `tui-pty.test.ts › prints the Flows screen the same way` flaked on Node 22 ("run 19 s ago"). State carries timestamps; renderers format relative time. The cockpit clips its inspector pane at the captured width; size panes to the terminal, collapse the inspector below 120 columns, and record the size in a capture.
F5 On the Run screen: toolbar buttons wrap when the title is long (truncate the title, never wrap buttons); the "Candidates tried" heading renders twice; the audit pane shows kind and outcome only while the model carries the call detail (render `locate · booking.book-now-button · testid #0 · ok`).
F6 Progress file. Add a "Post-verification corrections" section to docs/spec/progress/phase-9.md with the verifier's results: the contract on Node 22 with the one flake, axe's finding, the fixture check's dependence on the runs directory, the parity check's behaviour on the built package, and that `pnpm clients:smoke` is `node scripts/smoke-clients.mjs`.
F7 `surface doctor --adapter ax` gains `ax/session` (LLD §7.5, Draft 2.12): when only `loginwindow` owns a window, say the display is locked; the gate names that as the cause of its exit 2.

PHASE 10 SCOPE: tasks T10.1 through T10.4 in docs/spec/tasks.md, in order. T10.2's four secondary screens are designed first: add full artboards for API, Data, Explorer, and Import to docs/spec/design/artboards/ in the same system and stop to say so in the progress file before building them; the owner reviews them at verification. Nothing from Phase 11.

Environment and fallbacks (state which applied in the progress file):
- This host is macOS with the Accessibility permission granted to the terminal that runs Svatah. The display was locked during both the Phase 9 implementation and its verification, so the live gate reported a launch failure (exit 2) for both. If `svatah surface doctor --adapter ax` reports `ax/session` locked, say so and do not fabricate a live result; T10.3's live gate is the verifier's to run on an unlocked display if yours stays locked.
- The Run screen's Stop action needs `POST /runs/:id/stop` (T10.4): cancel between steps in the executor, mark the run `stopped` in the summary, and audit it. It is a runtime change; keep it small.
- Model credential and local model server: same rules as before. Every recording in the suite uses `--gateway fake`.

Decisions already made (do not re-open):
- One screen model, two renderers; the action registry is the single list; parity is asserted by the repository check against the built package.
- The ADE stays the desktop conformance target; T10.3 rewrites the desktop cases to the new structure and deletes the legacy screens and app.css.
- The four secondary screens follow the same system; their artboards are added, not the existing ones changed.

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. Where a mockup and the LLD disagree, the LLD wins; record it under Deviations in docs/spec/progress/phase-10.md with the section and the artboard. Do not edit the spec.
3. Model calls only through the gateway and only where earlier phases allow them; the replay path stays model-free; the import-boundary lint must still pass.
4. Permissive licences only (REQ-PKG-3); Node 22 LTS and the current LTS; JDK 17.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-10.md with, per correction F1..F7 and per task T10.1..T10.4: status, the exact commands demonstrating each Validate item, observed results, which environment fallback applied; Deviations and Known gaps sections.
- Everything runnable from a clean checkout with: pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint, with no credential, on Node 22 and the current LTS.
- Every screen driven end to end through its own controls in the packaged ADE under Playwright and in `svatah ui` under a pseudo-terminal, against the fixtures project with the fake gateway; screenshots of both renderers per screen.
- The four new artboards under docs/spec/design/artboards/.
- The desktop conformance cases rewritten to the new structure, and the live gate's result or the `ax/session` line that blocked it.
- The fixture check passing with unrelated runs present; the audit and a real axe run agreeing; a run stopped from the Run screen.

When finished, print a summary table of F1..F7 and T10.1..T10.4 with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-10`, with the display unlocked:

1. Run the six-command contract with no credential on Node 22 and the current LTS; confirm `git diff master..phase-10 -- docs/spec/{requirements,hld,lld,tasks}.md` is empty and that the only design change is four added artboards.
2. Package the ADE and drive every screen through its own controls; compare each with its artboard; take the AX screenshot.
3. Run `svatah ui` on every screen in a pseudo-terminal at 100 and 160 columns.
4. Run the live macOS gate three times against the rebuilt ADE with the new cases, once beside the test suite.
5. Put three unrelated runs into the fixtures project and run the fixture check; run the audit and axe-core on the sheet; stop a run from the Run screen.
6. Score on the ten parameters and report per item: verified, verified with deviations, or failed, with a reproducing command for each failure.
