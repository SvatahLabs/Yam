# Phase 0 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root. A separate session verifies the result against the contract in the second block, so the implementer must leave the evidence described there.

---

## Prompt

```
You are implementing Phase 0 of the Svatah specification in this repository.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md
- docs/spec/hld.md
- docs/spec/lld.md
- docs/spec/tasks.md

Scope: tasks T0.1 through T0.6 in docs/spec/tasks.md, nothing else. Do not start Phase 1.

Decisions already made (do not re-open them):
- The Java project moves under legacy/ and the TypeScript pnpm workspace takes the repository root (T0.1, HLD §12).
- Package layout, import boundaries, and schema shapes are exactly as HLD §12 and LLD §1, §2, §3. Where the LLD is silent, choose the simplest option and record it.
- The uncommitted parser classes and PARSER_IMPROVEMENTS.md go to legacy/experiments/; CoreNLP, ONNX Runtime, and Guava leave build.gradle if unreferenced.

Working rules:
1. Work on a branch named phase-0 created from the current branch. Commit after each task with the message "T0.n: <task title>".
2. Follow each task's Do and Validate sections literally. A task is complete only when every Validate item is demonstrated by a test or a command that a verifier can re-run.
3. If the spec cannot be followed as written, do not silently deviate. Implement the closest faithful option and record the deviation in docs/spec/progress/phase-0.md under "Deviations" with the section reference and the reason. Do not edit the four spec documents.
4. No model calls and no network access are needed for Phase 0; do not add any.
5. Keep dependencies permissive-licensed (REQ-PKG-3) and Node 22 LTS only.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-0.md containing, per task T0.1..T0.6: status (done | partial | blocked), the exact commands that demonstrate each Validate item, and the observed result of running them. Include a "Deviations" section (may be empty) and a "Known gaps" section (may be empty).
- All validation runnable from a clean checkout with exactly: pnpm install && pnpm -r build && pnpm -r test. Any additional command needed for a Validate item must be listed in the progress file.
- The CI workflow from T0.2 present and passing on the branch.
- Generated JSON Schemas committed under packages/schema/json/ with the drift test from T0.3.
- docs/agent-surface.md (T0.4) and docs/flow-language.md (T0.6) present.
- evals/compiler/golden.jsonl with at least 120 entries and the hand-migrated fixture flows under evals/fixtures/flows/ (T0.6).
- The sample web application starting with pnpm --filter sample-web start on port 4173 and its VARIANTS.md (T0.5).

When finished, print a summary table of the six tasks with status and the commit hash of each, then stop. Do not begin Phase 1 even if time remains.
```

---

## Verification contract (used by the verifying session)

The verifier will, without reading the implementer's transcript:

1. Check out branch `phase-0` in a clean worktree and run `pnpm install && pnpm -r build && pnpm -r test`.
2. Read `docs/spec/progress/phase-0.md` and re-run every listed command, comparing observed results to the claimed ones.
3. Confirm each Validate item of T0.1..T0.6 in `docs/spec/tasks.md` is demonstrated, not merely asserted.
4. Confirm the import-boundary lint fails the two forbidden imports named in T0.2.
5. Confirm the generated schemas match LLD §3 field for field, including the automation fields (`guard`, `custom`, `invoke`, `Signature`, `onFailure`, `AuditLine`, `Checkpoint`, desktop candidate kinds, `aborted`, `guard` failure class) and that provenance is required where REQ-STD-4 says so.
6. Confirm no spec document was modified and that every deviation listed is justified against the cited section.
7. Report per task: verified, verified with deviations, or failed, with the reproducing command for each failure.
