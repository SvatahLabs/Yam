# Phase 7 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root, after `master` has been fast-forwarded to `phase-6` and the Draft 2.8 amendments committed on it. It applies the Phase 6 corrections from `docs/spec/progress/phase-6-verification.md`, then implements Phase 7 (hardening and the 0.1.0 release candidate).

---

## Prompt

```
You are continuing the Svatah implementation. Phases 0 through 6 are merged on master, and Phase 6 was verified at 8.4/10 with corrections required. The spec on master is already Draft 2.8, which adds Phase 7 to docs/spec/tasks.md; do not edit the four spec documents. You will apply the corrections, then implement Phase 7.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md
- docs/spec/hld.md
- docs/spec/lld.md
- docs/spec/tasks.md
- docs/spec/progress/phase-5.md, docs/spec/progress/phase-6.md, and docs/spec/progress/phase-6-verification.md (what exists, and what the verifier measured)

Branching: create branch phase-7 from master. Commit after each item with "P6-F<n>: <title>" or "T7.<n>: <task title>".

DRAFT 2.8 AMENDMENTS (already on master, for reference; hold the code to them):
- LLD §3.2: `dialog` args are `{ action: "accept" | "dismiss", text? }`; every adapter reads `action`; a missing `action` is never defaulted to accept.
- LLD §7.5: bridges over osascript and PowerShell are permitted; one snapshot reads the window with bulk attribute reads in a bounded number of process invocations; the ADE's project screen (≥400 nodes) snapshots within 10 s; the report records nodes, wall time, ms per node; a timeout after `doctor` said `granted` is reported as a bridge timeout with those numbers. `automationId` reads `AXIdentifier`, then `AXDOMIdentifier`, then `aria-label`. Screenshots are scoped to the window's box.
- LLD §14: the runtime suite validates a foreign runtime's `results.jsonl` and `summary.json` against the published schemas before comparing; the committed fixture is a projection and says so; the desktop suite is a second case list selected by surface kind.
- LLD §15: `surface doctor [--adapter]`, `eval finetune export`, and the desktop gate script (report path against the current directory, window poll up to 60 s) are in the command table.
- LLD §16: desktop healing cases through `SVATAH_A11Y_VARIANT=1|2`; the verification contract now includes `pnpm -r typecheck` and `pnpm lint`.
- LLD §13.5: `POST /migrate` imports into the open project only.

PHASE 6 CORRECTIONS (before any Phase 7 task):
F1 AX bridge. Reproduce first on a macOS host with the permission granted: `pnpm --filter @svatah/ade exec electron-forge package && node scripts/desktop-conformance.mjs --adapter ax --report /tmp/ax.md` fails 7 of 7 with a 10 s timeout at "the surface opens", and a direct `window()` read of the ADE's 35-node welcome window takes about 10 s. Implement LLD §7.5 as amended (this is T7.1's core); the verifier measured `entireContents()` at 121 ms and `properties()` at 19 ms per element on the same window, so the budget is reachable in the same design.
F2 Java artifacts. Reproduce first: validate `runs/<id>/results.jsonl` and `summary.json` written by `runtimes/java` against `stepResultSchema` and `summarySchema` from `@svatah/schema`; every line fails. Implement LLD §14 as amended (T7.4).
F3 Desktop healing cases. T6.1's Validate item "a healing variant subset (renamed control, moved panel) passes relocalization" was neither implemented nor recorded as a deviation. Implement LLD §16 as amended (part of T7.1) and add a "Post-verification corrections" note to docs/spec/progress/phase-6.md saying it was missed.
F4 Dialog. Reproduce first on the sample `/widgets` page: `Dismiss the dialog` leaves the confirm result saying `confirmed`. Implement LLD §3.2 as amended (T7.3).
F5 Type check. `pnpm -r typecheck` fails in `@svatah/workflow` on master. Fix it and put `typecheck` in the contract (T7.3).
F6 Desktop gate script. `--report ../x.md` writes inside `evals/`; the ADE wait is a fixed 8 s while the window can take 15 s or more. Fix both (T7.1).
F7 Progress file. Add a "Post-verification corrections" section to docs/spec/progress/phase-6.md with the verifier's live AX numbers, the schema finding, and F3.

PHASE 7 SCOPE: tasks T7.1 through T7.6 in docs/spec/tasks.md, in order. Nothing beyond Phase 7.

Environment and fallbacks (state which applied in the progress file):
- This host is macOS with the Accessibility permission granted to the terminal that runs Svatah (the verifier's `svatah surface doctor` reported `granted`). If your session's terminal reports `denied`, say so with the `doctor` output and ask for the grant before T7.1's Validate; do not fabricate a live result.
- T7.2's Windows gate cannot run here. Fix what recorded exchanges can reach, wire the pipeline, and record the exact blocked command; a Windows result is welcome if a machine is available.
- T7.5 needs hours of machine time for the full schedule (249 iterations, about 100 s per validation pass). Run it to completion in the background while you work on T7.6 if the host allows; otherwise run the shortest schedule that produces a tuned digest and report its measured number as what it is. No improvement is reported without a measurement.
- T7.6 publishes nothing: dry runs and packed tarballs only. No push to Bitbucket unless asked.
- Model credential and local model server: same rules as before. Every recording in the suite uses `--gateway fake`.

Decisions already made (do not re-open):
- The desktop bridges stay process-based (osascript, PowerShell); a native module is not required and not wanted in this phase. The fix is bulk reads, not a new module.
- The Java runtime remains a conformance target with the fixture's feature set; unimplemented actions fail by name. Its artifacts must validate.
- The dialog fix is an IR-level agreement, not an adapter-side alias: adapters read `action` only.
- Release candidate means packed tarballs, a release workflow that stops at the artifact step, and a scripted quick start; no registry publish.

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. If the spec cannot be followed as written, implement the closest faithful option and record it under Deviations in docs/spec/progress/phase-7.md with the section reference and reason. Do not edit the spec.
3. Model calls only through the gateway and only where earlier phases allow them; the replay path stays model-free; the import-boundary lint must still pass.
4. Permissive licences only (REQ-PKG-3); Node 22 LTS and the current LTS; JDK 17.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-7.md with, per correction F1..F7 and per task T7.1..T7.6: status, the exact commands demonstrating each Validate item, observed results, which environment fallback applied; Deviations and Known gaps sections.
- Everything runnable from a clean checkout with: pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint, with no credential, on Node 22 and the current LTS.
- reports/adapter-ax.md from a live run with nodes, wall time, and ms per node, 7 of 7 plus the two healing cases; or the exact blocked command and the `doctor` output.
- reports/adapter-uia.md from a live run, or the exact blocked command; the pipeline definition carrying both desktop gates and the Java conformance.
- reports/runtime-java.md stating artifacts valid and zero mismatches, from two runs.
- The dialog golden entries and the `/widgets` run in the suite.
- reports/eval-finetune.md with measured base-versus-tuned numbers and the digest, or the blocked command.
- The packed tarballs' file lists and the quick-start script's output against them.

When finished, print a summary table of F1..F7 and T7.1..T7.6 with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-7`:

1. Run the contract with no credential on Node 22 and the current LTS, including `typecheck` and `lint`; confirm `git diff master..phase-7 -- docs/spec/{requirements,hld,lld,tasks}.md` is empty.
2. Package the ADE and run the AX gate live; time a direct `window()` read of the project screen; compare with the report's numbers.
3. Validate the Java runtime's artifacts against the schemas independently, run the suite twice, and strip a line to see the suite fail.
4. Run `Dismiss the dialog` and `Accept the dialog` against `/widgets` and read the page.
5. Reproduce the fine-tune measurement from the published digest, or confirm the blocked command.
6. Unpack the tarballs into an empty Playwright project and run the quick start.
7. Score on the ten parameters and report per item: verified, verified with deviations, or failed, with a reproducing command for each failure.
