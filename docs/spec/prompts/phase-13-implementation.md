# Phase 13 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root, after `master` has been fast-forwarded to `phase-12` and its verification committed. It applies the Phase 12 corrections named in `docs/spec/progress/phase-12-verification.md`, then implements Phase 13 (process and terminal).

---

## Prompt

```
You are continuing the Svatah implementation. Phases 0 through 12 are merged on master, and 0.1.0 is released or prepared for the owner's trigger. The spec on master is Draft 2.16 or later; do not edit the four spec documents. You will apply the corrections, then implement Phase 13.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md (REQ-ADP-10 and REQ-SELF-4 are new)
- docs/spec/hld.md
- docs/spec/lld.md (§2.4's `process` kind, §4.2's patterns 34–38, §13.9's verification library)
- docs/spec/tasks.md (Phase 13, T13.1 through T13.4)
- docs/spec/progress/phase-12.md and docs/spec/progress/phase-12-verification.md

Branching: create branch phase-13 from master. Commit after each item with "P12-F<n>: <title>" or "T13.<n>: <task title>".

PHASE 12 CORRECTIONS (before any Phase 13 task): apply every finding docs/spec/progress/phase-12-verification.md lists under "Findings", in order, each as its own commit, with a self check for each, and add a "Post-verification corrections" section to docs/spec/progress/phase-12.md. The gate must be at 100 percent before T13.1 starts.

PHASE 13 SCOPE: tasks T13.1 through T13.4 in docs/spec/tasks.md, in order. Nothing beyond Phase 13.

Environment and fallbacks (state which applied in the progress file):
- The pseudo-terminal library must be under a permissive licence (REQ-PKG-3). If the one you choose needs a native build, it is an optional dependency with the pipe fallback; say which path the suite used.
- The cockpit checks are driven through the new adapter in a real pseudo-terminal; `script(1)` stays as their external side.
- This host is macOS with the Accessibility and Screen Recording grants on the terminal that runs Svatah; the display must be unlocked for the desktop flows, and `ax/session` says when it is not.
- Model credential and local model server: same rules as before. Every recording uses `--gateway fake`; the process kind records with no model at all.

Decisions already made (do not re-open):
- `process` is a surface kind with the same `snapshot`, `act`, `read`, `check` shape as the others; rows and files are references, not locators.
- The adapter never reads outside its configured root and never prints an input marked secret.
- The three REQ-SELF-3 oracles stay external; the target after T13.3 is exactly 45 of 48 on Svatah's side.
- `@svatah/verify` is the parity gate as it exists, packaged, with a catalogue schema; no second implementation.

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. If the spec cannot be followed as written, implement the closest faithful option and record it under Deviations in docs/spec/progress/phase-13.md with the section reference and reason. Do not edit the spec.
3. Model calls only through the gateway and only where earlier phases allow them; the replay path stays model-free; the import-boundary lint must still pass, extended so `adapter-process` depends on `surface` and `schema` only.
4. Permissive licences only (REQ-PKG-3); Node 22 LTS and the current LTS; JDK 17.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-13.md with, per correction and per task T13.1..T13.4: status, the exact commands demonstrating each Validate item, observed results, which environment fallback applied; Deviations and Known gaps sections; the parity report embedded.
- Everything runnable from a clean checkout with: pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint, with no credential, on Node 22 and the current LTS; the tree clean after the gate.
- The process conformance suite green, and the secret and root refusals demonstrated.
- `svatah eval self` at 100 percent with Svatah reaching 45 of 48 and the three REQ-SELF-3 oracles the only one-sided rows.
- The verification library's quick start passing against the packed tarball in an empty project.

When finished, print a summary table of the corrections and T13.1..T13.4 with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-13`, with the display unlocked:

1. Run the six-command contract with no credential on Node 22 and the current LTS; confirm `git diff master..phase-13 -- docs/spec/{requirements,hld,lld,tasks}.md` is empty.
2. Run `svatah eval self` and confirm 45 of 48 on Svatah's side with only the three oracles one-sided; break one process flow's expectation and confirm the gate bites.
3. Hand a secret input to a process flow and grep every artefact; read a file outside the root through the adapter and expect a refusal.
4. Drive the cockpit through the adapter at 100 and 160 columns and compare with the external capture.
5. Run the verification library's quick start against the tarball in an empty project.
6. Score on the ten parameters and report what neither side of the gate reached.
