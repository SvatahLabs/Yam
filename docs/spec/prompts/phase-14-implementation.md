# Phase 14 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root, on `main` (or `yam-bootstrap` until it is pushed) with Phase 13 committed. It implements Phase 14 (the front door), which ships in 0.1.0 before T13.6's publish.

---

## Prompt

```
You are continuing the Yam implementation. Phases 0 through 13 are committed. The spec is Draft 2.20; do not edit the four spec documents. You will implement Phase 14, the front door.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md (§3.13, REQ-CLI-1..9, and REQ-TUI-2 are new)
- docs/spec/hld.md (§5.3 B14, §13 row 14)
- docs/spec/lld.md §15.1 — the project state, the next verb, the help text (verbatim), `check`, the diagnostics catalogue, the session group, the help topics, the vocabulary check, the tmux workspace
- docs/spec/tasks.md (Phase 14, T14.1 through T14.6)
- docs/spec/progress/phase-13.md

Branching: create branch phase-14 from the current head. Commit after each task with "T14.<n>: <task title>".

PHASE 14 SCOPE: tasks T14.1 through T14.6 in docs/spec/tasks.md, in order. Nothing beyond Phase 14: no new artifact, no package boundary change, no change to the runtime, the schemas or the adapters. The functions behind every verb stay where they are; this phase arranges them and makes them speak.

Environment and fallbacks (state which applied in the progress file):
- tmux is needed only for T14.5's live checks; the test for the no-tmux path removes it from PATH. If tmux is not on this host, install it with Homebrew and say so.
- No model credential is needed anywhere in this phase; `--gateway fake` for any recording a check makes.
- The desktop adapters are not exercised; the doctor's refusal in T14.4 is produced with a fake bridge.

Decisions already made (do not re-open):
- The top-level help text is the one in LLD §15.1, verbatim; a test compares it.
- `yam` with no arguments exits 0 in every state; usage-and-exit-64 is for an unknown command only.
- `lint` and `compile` remain as aliases of `check`'s halves; nothing is removed from the command line.
- Session options keep the Draft 2.5 precedence; they are documented once and referred to, not restated.
- The exit-code topic is generated from the `EXIT` constant; it is never hand-written.
- The tmux layout is driven through tmux's command line only, so Phase 15's process adapter can drive the same session.

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. If the spec cannot be followed as written, implement the closest faithful option and record it under Deviations in docs/spec/progress/phase-14.md with the section reference and reason. Do not edit the spec.
3. User-facing strings contain no internal vocabulary (REQ-CLI-9); the repo check enforces it and must be green.
4. Permissive licences only (REQ-PKG-3); no new runtime dependency for the workspace beyond tmux on the host.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-14.md with, per task T14.1..T14.6: status, the exact commands demonstrating each Validate item, observed results, which environment fallback applied; Deviations and Known gaps sections.
- Everything runnable from a clean checkout with: pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint, with no credential, on Node 22 and the current release; the tree clean after the gate; pnpm docs:check clean.
- A transcript, in the progress file, of a newcomer's session: `yam init`, `yam`, `yam check`, `yam record` (with YAM_PICK), `yam run`, a binding removed, `yam run`, `yam heal`, `yam` — every prompt and every reply, so a reader sees the journey the phase promises.
- `yam eval self` green with the three new checks two-sided.

When finished, print a summary table of T14.1..T14.6 with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-14`:

1. Run the six-command contract with no credential on Node 22 and the current release; confirm `git diff <base>..phase-14 -- docs/spec/{requirements,hld,lld,tasks}.md` is empty.
2. Play the newcomer's session from the transcript by hand and confirm every reply matches; then break each condition of the diagnostics catalogue and confirm the sentence and the verb.
3. Compare `yam help` with LLD §15.1 verbatim; run every `--help` and confirm exit 0 and no other command's options.
4. Start `yam ui --tmux`, list the panes, count the `yam serve` processes, detach, attach again; remove tmux from PATH and confirm the fallback line.
5. Grep every user-facing string for internal vocabulary; put "module (b)" back into the help and confirm the repo check fails.
6. Score on the ten parameters and report what a newcomer would still not understand.
