# Phase 6 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root, after `master` has been fast-forwarded to `phase-5` and the Draft 2.7 amendments committed on it. It applies the Phase 5 corrections from `docs/spec/progress/phase-5-verification.md`, then implements Phase 6 (desktop adapters validated against the ADE, WebMCP candidate, the Java conformance runtime, the Tier 2 fine-tune pipeline, and the prototype import).

---

## Prompt

```
You are continuing the Svatah implementation. Phases 0 through 5 are merged on master, and Phase 5 was verified at 8.7/10 with corrections required. The spec on master is already Draft 2.7; do not edit the four spec documents. You will apply the corrections, then implement Phase 6.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md
- docs/spec/hld.md
- docs/spec/lld.md
- docs/spec/tasks.md
- docs/spec/progress/phase-4.md and docs/spec/progress/phase-5.md (what exists)

Branching: create branch phase-6 from master. Commit after each item with "P5-F<n>: <title>" or "T6.<n>: <task title>".

DRAFT 2.7 AMENDMENTS (already on master, for reference; hold the code to them):
- LLD §3.2: `Step.guard` gains `target?: TargetRef`, so "Only if the login error is hidden, click the sign in button" compiles; the recorder grounds it and the resolver resolves it before evaluation. `E_GUARD_NO_TARGET` remains for a target guard with no element anywhere; `E_GUARD_OTHER_TARGET` goes away.
- LLD §8.3: a compensating story's steps keep their own statuses; the failing step carries `policyApplied`; the flow and run are `aborted`.
- LLD §15: `svatah trajectory compile` is in the command table. LLD §13.4: the trajectory line shape is `{ seq, at, intent, call, args?, ref?, describe?, result?, error?, snapshotHash?, url? }`; a proposal's context hash is the page hash.
- LLD §13.5: `POST /record` takes `gateway`, answers 409 while a session is open, and a pending decision expires after `record.decisionDeadlineMs` (default 10 minutes). LLD §13.6 and REQ-ADE-4: the Record screen chooses the gateway and renders `record.failed` as an alert with screen-appropriate advice.

PHASE 5 CORRECTIONS (before any Phase 6 task):
F1 Compensation statuses. Reproduce first: `svatah run --story "I want to book and then fail"` records the two steps of `cancel a booking` as `aborted` although the audit shows them executed. Implement LLD §8.3 as amended; update the policy tests and `docs/flow-language.md`'s abort-policy description.
F2 ADE gateway choice. Implement REQ-ADE-4 and LLD §13.6 as amended: a gateway control on the Record screen (default `anthropic` when `GET /project` reports a credential, else `fake`, both labelled), sent in `POST /record`; `record.failed` rendered as an alert. `GET /project` reports whether a credential is present without revealing it. Extend `apps/ade/test/review.test.ts` and the screen-rule test.
F3 Guard target. Implement `Step.guard.target` end to end: grammar (pattern 28's documented example compiles again), compiler validation, recorder grounding, resolver, executor, golden entries g-123 and g-124 restored to the documented form, `docs/flow-language.md` pattern 28 restored.
F4 Decision deadline and 409. Implement `record.decisionDeadlineMs` in the config schema and the service; document the 409 in the OpenAPI description (already the behaviour) and the deadline; a test for each.
F5 Progress file. Add a "Post-verification corrections" section to docs/spec/progress/phase-5.md with the verifier's Node 22 result and the findings above.

PHASE 6 SCOPE: tasks T6.1 through T6.6 in docs/spec/tasks.md. Order for this host: T6.2 (macOS Accessibility) before T6.1 (Windows UIA), then T6.3, T6.4, T6.6, T6.5. Nothing beyond Phase 6.

Environment and fallbacks (state which applied in the progress file):
- This host is macOS. T6.2's AX adapter is validated here against the ADE launched with SVATAH_A11Y=1; the accessibility permission must be granted to the terminal or the test runner, and `svatah surface doctor` must say so when it is not. If the permission cannot be granted in the session, implement and unit-test against recorded AX trees, mark the live gate blocked with the exact command, and do not fabricate a conformance result.
- T6.1's UIA adapter cannot be run on this host. Implement it against recorded UIA trees (hand-authored in the documented shape, said so plainly), wire the Windows CI job, and mark the live gate blocked with the exact commands.
- T6.4 needs JDK 17 (present) and Playwright for Java; the runtime conformance fixture under evals/conformance/runtime is the target; zero mismatches in status and matched candidate.
- T6.5 needs a fine-tuning stack. If none is available, implement the export of accepted (sentence, Step) pairs from merged plans and the training and evaluation scripts, run the export, and mark the training run blocked with the exact command; do not report an improvement you did not measure.
- T6.6 needs a prototype database. None is on this machine: synthesise an electron-db fixture in the documented shape, say so, and validate the import against it.
- Model credential and local model server: same rules as before.

Decisions already made (do not re-open):
- Desktop adapters implement AgentSurface with the same snapshot shape; `automationId` and `controlPath` candidates; actions through the platform's patterns with a pointer fallback at the element's box centre (LLD §7.5). The desktop conformance flows are: open project, open a flow, run, open a result, API client, against the ADE (LLD §16).
- WebMCP: a `webmcp` candidate is synthesised at record time when `navigator.modelContext` declares a tool matching the target; the resolver prefers it and falls through to locators when the declaration is gone (LLD §6.3, §4.2 pattern 30). The sample app gains a WebMCP-declaring page.
- The Java runtime consumes plan.json, bindings, and data.yaml, executes the same action set and resolver rules, and writes results and summary in the published schemas (LLD §14). It is a conformance target, not a second product.
- The fine-tune pipeline exports only pairs from plans that were merged, trains a LoRA on the Tier 2 base model, publishes the digest, and compares base against tuned on the golden `tier: 2` subset (HLD ADR-4).
- Prototype import maps the electron-db records exactly as LLD §13.5 lists; results and images are not imported.

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. If the spec cannot be followed as written, implement the closest faithful option and record it under Deviations in docs/spec/progress/phase-6.md with the section reference and reason. Do not edit the spec.
3. Model calls only through the gateway and only where earlier phases allow them; the replay path stays model-free and the import-boundary lint must still pass.
4. Permissive licences only (REQ-PKG-3); Node 22 LTS; JDK 17 for the Java runtime.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-6.md with, per correction F1..F5 and per task, status, the exact commands demonstrating each Validate item, observed results, which environment fallback applied; Deviations and Known gaps sections.
- Everything runnable from a clean checkout with: pnpm install && pnpm browsers && pnpm -r build && pnpm -r test, with no credential; the Java runtime built and tested with `./gradlew` or `mvn` from its own directory and wired into the runtime conformance script.
- The AX adapter's conformance result against the ADE, or the exact blocked command and the permission state `svatah surface doctor` reports.
- The WebMCP sample page and a test showing the declared tool is preferred and then falls through.
- The Java runtime's conformance report under reports/ with zero mismatches.
- The fine-tune export produced from the repository's own merged plans, and either the measured base-versus-tuned numbers or the blocked command.
- The prototype import test against the synthesised database, producing a project that compiles clean.

When finished, print a summary table of F1..F5 and the Phase 6 tasks with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-6`:

1. Run the contract with no credential, also on Node 22 with `CI=true`; confirm `git diff master..phase-6 -- docs/spec/{requirements,hld,lld,tasks}.md` is empty.
2. Run the compensation story and expect the compensating steps recorded with their own statuses.
3. Drive the ADE Record screen with the fake gateway and expect a decision to render and accept; start one with no credential and `anthropic` selected and expect an alert, not a CLI flag.
4. Compile pattern 28's documented example and expect a guard with its own target; run it.
5. Grant accessibility permission and run the AX conformance flows against the ADE; compare with the report.
6. Build and run the Java runtime against the conformance fixture and diff its results.
7. Load the WebMCP sample page, record, and confirm the `webmcp` candidate is preferred and then bypassed when the declaration is removed.
8. Score on the ten parameters and report per item: verified, verified with deviations, or failed, with a reproducing command for each failure.
