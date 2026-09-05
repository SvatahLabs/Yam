# Phase 8 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root, after `master` has been fast-forwarded to `phase-7` and the Draft 2.9 amendments committed on it. It applies the Phase 7 corrections from `docs/spec/progress/phase-7-verification.md`, then implements Phase 8 (ship).

---

## Prompt

```
You are continuing the Svatah implementation. Phases 0 through 7 are merged on master, and Phase 7 was verified at 7.9/10 with corrections required. The spec on master is already Draft 2.9, which adds Phase 8 to docs/spec/tasks.md; do not edit the four spec documents. You will apply the corrections, then implement Phase 8.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md
- docs/spec/hld.md
- docs/spec/lld.md
- docs/spec/tasks.md
- docs/spec/progress/phase-7.md and docs/spec/progress/phase-7-verification.md (what exists, and what the verifier measured)

Branching: create branch phase-8 from master. Commit after each item with "P7-F<n>: <title>" or "T8.<n>: <task title>".

DRAFT 2.9 AMENDMENTS (already on master, for reference; hold the code to them):
- LLD §13.6: the ADE never runs the CLI with its own binary. The runtime is resolved from SVATAH_NODE, then a `node` on PATH of the supported major or newer, then a Node beside the CLI under resources/ when one is packaged; none found renders the Project screen's alert naming the three places. `svatah surface doctor` and the smoke check report the chosen runtime. SVATAH_ADE_PROJECT=<dir> opens a project on ready. The smoke check runs against the packaged application when apps/ade/out/ exists.
- LLD §7.5: the budget is satisfied only by a measured snapshot of the ADE's project screen with a project open, written into the report by the gate; whole-window reads in a fixed number of events or a native helper; the caller's deadline is honoured; a case with no checks is skipped; a healing case runs only at its variant.
- LLD §3.2 and §4.2: a `dialog` step arms the answer for the next dialog and is written before the step that opens one; lint W_DIALOG_UNARMED and W_DIALOG_NEVER_OPENED; an unarmed default writes an audit line `kind:"dialog", armed:false, answer:"accept"`.
- Requirements: REQ-ADE-6 names the packaged ADE as the conformance target; ADR-4's fine-tune target is recorded as not met for 0.1.0.

PHASE 7 CORRECTIONS (before any Phase 8 task):
F1 The packaged ADE cannot open a project. Reproduce first: package the ADE, launch it by hand, press a Recent project; the main-process log says `svatah serve did not print its handshake within 30000 ms` and a second ADE instance appears. `service.ts` spawns process.execPath with the RunAsNode fuse off. Implement LLD §13.6 as amended (this is T8.1).
F2 The bridge misses the budget on the real screen. Reproduce first with the unpackaged ADE and a project open: `bridge.window()` on the project screen reads about 190 nodes in 9.8 s (51–55 ms per node) and the screen has 488. Implement LLD §7.5 as amended (this is T8.2).
F3 Pattern 21 is order-dependent and undocumented. Reproduce first: `Click the Show confirm button` then `Dismiss the dialog` leaves the page saying `confirmed`. Implement LLD §3.2/§4.2 as amended (this is T8.3).
F4 A case with zero checks is reported failed; healing cases are run and failed at variant 0. Fix in the desktop suite runner (T8.2).
F5 `osascriptBridge({ timeoutMs })` does not reach the script's deadline; it stops at ten seconds whatever the caller asked. Fix (T8.2).
F6 Progress file. Add a "Post-verification corrections" section to docs/spec/progress/phase-7.md with the verifier's live gate result (2 of 9 at every variant, the handshake failure, 51–55 ms per node on the project screen) and the findings above.

PHASE 8 SCOPE: tasks T8.1 through T8.6 in docs/spec/tasks.md, in order; T8.6 only if a Windows host is available. Nothing beyond Phase 8.

Environment and fallbacks (state which applied in the progress file):
- This host is macOS with the Accessibility permission granted to the terminal that runs Svatah; the display was unlocked when the verifier ran the gate. If `svatah surface doctor` says denied or no application has a window, say so with the output and wait; do not report a live number you did not take.
- The ADE's window has taken between 1 s and 60 s to appear on this host and once did not appear; the gate polls, and your smoke check must too.
- T8.5 prepares and dry-runs the publish. It does not publish. No token exists in this environment and none must be written anywhere; the owner triggers the pipeline.
- T8.4 requires no training run. If you run one, it is measured on a held-out split that is not the training set, with early stopping, and reported as what it is.
- Model credential and local model server: same rules as before. Every recording in the suite uses `--gateway fake`.

Decisions already made (do not re-open):
- The desktop bridges stay process-based unless the project screen cannot be read within 10 s that way, in which case a native helper is permitted for the window read only, with the process bridge kept for actions.
- The RunAsNode fuse stays off. The runtime is resolved, never the ADE's own binary.
- The fine-tune is withdrawn from 0.1.0. The corpus is the deliverable; a new measurement is optional and must be honest.
- Publishing is the owner's action. The implementer's deliverable is a pipeline that proves it would work without a token present.

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. If the spec cannot be followed as written, implement the closest faithful option and record it under Deviations in docs/spec/progress/phase-8.md with the section reference and reason. Do not edit the spec.
3. Model calls only through the gateway and only where earlier phases allow them; the replay path stays model-free; the import-boundary lint must still pass.
4. Permissive licences only (REQ-PKG-3); Node 22 LTS and the current LTS; JDK 17.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-8.md with, per correction F1..F6 and per task T8.1..T8.6: status, the exact commands demonstrating each Validate item, observed results, which environment fallback applied; Deviations and Known gaps sections.
- Everything runnable from a clean checkout with: pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint, with no credential, on Node 22 and the current LTS.
- The packaged ADE opening a project: the smoke check's output against apps/ade/out/, and a screenshot of the project screen taken through the AX adapter's own screenshot.
- reports/adapter-ax.md from a live run, 7 of 7 plus both healing cases, with the project screen's measured snapshot cost; or the exact blocked command and the doctor output.
- The dialog lint entries in the golden set, the audit line in a run, and pattern 21 rewritten.
- The fine-tune corpus export with its sources and counts, and the withdrawal recorded in reports/eval-finetune.md and CHANGELOG.md.
- The publish pipeline's dry-run output printing the exact commands with no token present.

When finished, print a summary table of F1..F6 and T8.1..T8.6 with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-8`:

1. Run the six-command contract with no credential on Node 22 and the current LTS; confirm `git diff master..phase-8 -- docs/spec/{requirements,hld,lld,tasks}.md` is empty.
2. Package the ADE, launch it by hand with no environment, and open a project from its Recent list; empty PATH and expect the alert.
3. Run the AX gate live on an unlocked display and time a direct `window()` read of the project screen; compare with the report's numbers.
4. Run the click-then-dismiss flow and read the lint warning and the audit line; run the reference's own example.
5. Run the fine-tune corpus export and check it against the golden set.
6. Run the publish pipeline's dry-run mode and confirm it prints the commands and refuses to publish.
7. Score on the ten parameters and report per item: verified, verified with deviations, or failed, with a reproducing command for each failure.
