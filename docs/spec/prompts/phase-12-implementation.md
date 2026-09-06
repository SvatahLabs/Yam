# Phase 12 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root, after `master` has been fast-forwarded to `phase-12` and its verification committed. Draft 2.14 made Phase 12 the corrections and the self-verification wave, so this release phase is Phase 12. It applies the Phase 12 corrections named in `docs/spec/progress/phase-12-verification.md`, then implements Phase 12 (release 0.1.0 and the open P0 items).

---

## Prompt

```
You are continuing the Svatah implementation. Phases 0 through 11 are merged on master. The spec on master is Draft 2.15; do not edit the four spec documents. You will apply the corrections the Phase 12 verification lists, then implement Phase 12.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md
- docs/spec/hld.md
- docs/spec/lld.md
- docs/spec/tasks.md
- docs/spec/progress/phase-12.md and docs/spec/progress/phase-12-verification.md (what exists, and what the verifier measured)

Branching: create branch phase-12 from master. Commit after each item with "P11-F<n>: <title>" or "T12.<n>: <task title>".

DRAFT 2.10 AMENDMENTS (already on master, for reference; hold the code to them):
- LLD §7.5: the window read is an in-process AXUIElementCopyAttributeValue helper (the JXA Objective-C bridge qualifies) and the Apple-event form is struck; the cost line counts accessibility calls and records the one-minute load average and the CPU count; the gate retries a deadline once and says so; the bridge addresses the process that owns a window when several share the name; the gate does not launch the next variant until no process of the previous launch remains; a CI desktop leg runs nothing else on its runner.
- LLD §13.6: onServiceOpened is a one-way sixth preload entry; the packaged ADE carries a pnpm deploy of the CLI under Resources/svatah and ships no Node by default; the gate and the smoke check launch the packaged ADE through LaunchServices on macOS; every interactive control on the ADE's Project screen is named, and the desktop snapshot case reports an unnamed one as a defect.
- LLD §15: `eval finetune corpus` and the corpus-only export (no --ref, no --project); `surface doctor` severities ok, skip, warn, FAIL.

PHASE 11 CORRECTIONS (before any Phase 12 task): apply every finding docs/spec/progress/phase-12-verification.md lists under "Findings", in order, each as its own commit, and add a "Post-verification corrections" section to docs/spec/progress/phase-12.md. The verification contract is now `svatah eval self` (LLD §13.9): every correction lands with a self check, and the gate must be at 100 percent agreement before T12.1 starts.

PHASE 12 SCOPE: T12.7 first, then tasks T12.1 through T12.6 in docs/spec/tasks.md, in order; T12.4 and T12.5 each contain an owner's action you prepare and do not perform; T12.6 only if a Windows host is available. Nothing beyond Phase 12.

Environment and fallbacks (state which applied in the progress file):
- This host is macOS with the Accessibility permission granted to the terminal that runs Svatah. The Screen Recording grant depends on the terminal: the verifier's had it, yours may not; `svatah surface doctor` says which, and a screenshot you cannot take is recorded with the doctor line, not fabricated.
- Run the desktop gate on a quiet machine and record the load average it reports; a run beside a build is a valid load test for T12.1, not a conformance result.
- T12.2's Tier 2 entries need the pinned local model served by Ollama, which this host has; every new golden entry is reviewed by you and stated as such in the progress file.
- T12.4: write docs/ci.md and stop; do not create accounts, runners, or mirrors. T12.5: do not publish and do not create the tag; the registry script runs in tarball mode until the owner publishes.
- Model credential and local model server: same rules as before. Every recording in the suite uses `--gateway fake`.

Decisions already made (do not re-open):
- The bridge stays the JXA in-process helper; no compiled module.
- The golden set and the refused corpus stay disjoint; an entry promoted to the golden set leaves the corpus.
- Publishing and runner attachment are the owner's actions. Your deliverables are the documents and scripts that make them one step.

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. If the spec cannot be followed as written, implement the closest faithful option and record it under Deviations in docs/spec/progress/phase-12.md with the section reference and reason. Do not edit the spec.
3. Model calls only through the gateway and only where earlier phases allow them; the replay path stays model-free; the import-boundary lint must still pass.
4. Permissive licences only (REQ-PKG-3); Node 22 LTS and the current LTS; JDK 17.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-12.md with, per correction and per task T12.1..T12.7: status, the exact commands demonstrating each Validate item, observed results, which environment fallback applied; Deviations and Known gaps sections.
- Everything runnable from a clean checkout with: pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint, with no credential, on Node 22 and the current LTS.
- reports/adapter-ax.md from three consecutive live runs with load figures, and the parallel-load run's outcome.
- reports/eval-compiler.md at 300 or more entries with the three numbers REQ-COMP-9 names.
- The live report's snapshot case asserting zero unnamed controls and the results case reading one real run.
- docs/ci.md, and the registry quick-start script's tarball-mode output.

When finished, print a summary table of F1..F4 and T12.1..T12.7 with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-12`:

1. Run the six-command contract with no credential on Node 22 and the current LTS; confirm `git diff master..phase-12 -- docs/spec/{requirements,hld,lld,tasks}.md` is empty.
2. Package the ADE and run the gate three times, once with the test suite running in parallel; read the load figures and the retry line.
3. Count the golden set, run the compiler eval, and check the corpus overlap.
4. Read the live report's snapshot and results cases; press the Project screen's buttons through the bridge and confirm every one has a name.
5. Run the registry quick-start script in tarball mode; if the owner has published, run it against the registry.
6. Score on the ten parameters and report per item: verified, verified with deviations, or failed, with a reproducing command for each failure.
