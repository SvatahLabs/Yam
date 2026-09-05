# Phase 5 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root, after `master` has been fast-forwarded to `phase-4` and the Draft 2.6 amendments committed on it. It applies the Phase 4 corrections from `docs/spec/progress/phase-4-verification.md`, then implements Phase 5 (automation behaviors: resume, workflow runner, tool server, guards and compensation, trajectory compiler, and the ADE's record, bindings, heal review, surface explorer, and tool panel).

---

## Prompt

```
You are continuing the Svatah implementation. Phases 0 through 4 are merged on master, and Phase 4 was verified at 8.2/10 with corrections required. The spec on master is already Draft 2.6; do not edit the four spec documents. You will apply the corrections, then implement Phase 5.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md
- docs/spec/hld.md
- docs/spec/lld.md
- docs/spec/tasks.md
- docs/spec/progress/phase-3.md and docs/spec/progress/phase-4.md (what exists)

Branching: create branch phase-5 from master. Commit after each item with "P4-F<n>: <title>" or "T5.<n>: <task title>".

DRAFT 2.6 AMENDMENTS (already on master, for reference; hold the code to them):
- LLD §4.2: the grammar accepts `Expect <subject> to …` and the `Verify / Check that / Assert that / Ensure / Make sure / Confirm` prefixes for target, page-title, and URL predicates, lowering to the same IR as the canonical `should` forms; every alias has a golden entry.
- LLD §10: `svatah heal --run` accepts `--input` and `SVATAH_INPUT_<NAME>`; `summary.json` records input names, never values; an `unreachable` caused by a missing input names it.
- LLD §16: the compiler eval reads `compile.tier2`/`tier3` from the committed `evals/compiler/project/svatah.config.yaml`; a requested but unconfigured tier is `not measured`, never 0/N.
- LLD §7.3: attaching to a driver-hosted `…/session/<id>` endpoint must not send `session.new`; the browser is learned from `session.status`; both attach shapes are tested against recorded exchanges.

PHASE 4 CORRECTIONS (before any Phase 5 task):
F1 Heal replay inputs. Reproduce first: on a copy of evals/fixtures, corrupt every candidate of bindings/app/schedule-build-link.yaml, run simple.flow with the two --input values, then `svatah heal --run <id> --base-url <app>`: today it reports unreachable because the four-step replay has no inputs. Implement LLD §10 as amended and add the later-step-behind-login case with inputs to packages/cli/test/heal-cycle.test.ts for both command lines.
F2 Compiler eval configuration. Commit evals/compiler/project/svatah.config.yaml with compile.tier2 naming qwen2.5:3b and its pinned digest (357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b); make `svatah eval compiler` read that project's config by default; report a requested but unconfigured tier as `not measured` and exclude it from the threshold; regenerate reports/eval-compiler.md from a clean checkout so the published 90.2 percent reproduces with no extra files.
F3 BiDi attach. Reproduce first with chromedriver started with the webSocketUrl capability (the README's own commands): `session not created: session already exists`. Implement LLD §7.3 as amended; test both attach shapes against recorded exchanges; make scripts/bidi-independence.mjs run the stock-Chrome attach when a chromedriver is on PATH or named by SVATAH_CHROMEDRIVER, recording the browser in reports/adapter-bidi.md.
F4 Assertion aliases. Implement LLD §4.2 as amended in the Tier 1 grammar and docs/flow-language.md; add golden entries for every alias; keep the tier 1 golden at 100 percent.
F5 Progress file. Add a "Post-verification corrections" section to docs/spec/progress/phase-4.md with the verifier's results and the four defects.

PHASE 5 SCOPE: tasks T5.1 through T5.8 in docs/spec/tasks.md, in order. Nothing from Phase 6. Phase 5 delivers the automation behaviors and the ADE screens that review model decisions.

Environment and fallbacks (state which applied in the progress file):
- Model credential and local model server: same rules as Phases 3 and 4. The trajectory compiler (T5.5) must work with the fake gateway and with none; grounding in proposals may use the fake gateway and must say so.
- T5.4 needs a "cancel booking" control in apps/sample-web. Add it; then re-run the healing eval and update reports/eval-healing.md, because the element counts change (Phase 2's K8). State the before and after numbers.
- The ADE (apps/ade) builds and smokes on this host as in Phase 3; installers for other OSes remain a CI matter.

Decisions already made (do not re-open):
- Resume verifies plan and bindings hashes and refuses on mismatch with exit 12 (LLD §8.1, §15).
- The workflow runner is a one-story run with behavior "workflow", checkpoints and audit on, outputs returned as JSON (LLD §13.2). The tool server derives MCP tool schemas from story signatures, runs each call through the workflow runner with an agent invoker, refuses non-idempotent stories when tool.requireIdempotent, and never touches a model (LLD §13.3).
- Guards use the `expr` predicate over scope values; a compensating story runs with the failing story's scope and the run ends `aborted` with the policy recorded (LLD §8.3).
- The trajectory compiler groups by intent, normalises the intent through the synonym vocabulary into a Tier 1 sentence, derives element ids from `describe`, and writes proposals with `verified: false` bindings; uncompilable steps become `// review:` comments (LLD §13.4). It never writes outside proposals/.
- ADE screens render service responses and project files only; the record review re-picks through `/surface/:session/snapshot`; the heal review applies a proposal through the service; the surface explorer requires an intent per call and writes trajectory.jsonl; the tool panel starts and stops `tool serve` and lists invocations from audit lines (LLD §13.6).

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. If the spec cannot be followed as written, implement the closest faithful option and record it under Deviations in docs/spec/progress/phase-5.md with the section reference and reason. Do not edit the spec.
3. Model calls only through the gateway, only in the recorder, healer Regrounder, evals, and trajectory compile; the replay path, the workflow runner, and the tool server stay model-free and the import-boundary lint must still pass.
4. Permissive licences only (REQ-PKG-3); Node 22 LTS.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-5.md with, per correction F1..F5 and per task T5.1..T5.8: status, the exact commands demonstrating each Validate item, observed results, which environment fallback applied; Deviations and Known gaps sections.
- Everything runnable from a clean checkout with: pnpm install && pnpm browsers && pnpm -r build && pnpm -r test, with no credential; the compiler eval reproducing its published numbers from the checkout alone when Ollama serves the pinned model.
- Resume: a run interrupted at step 5 and resumed produces results identical to a full run from step 5 onward; a hash mismatch exits 12.
- Workflow: a story with a signature runs as a function and returns typed outputs; a non-idempotent story is refused under a production config without allowSideEffects.
- Tool server: an MCP client calls a recorded story with inputs and receives outputs and a runId; audit.jsonl shows the agent invoker with redacted inputs; the model endpoint blocked during the test.
- Guards and compensation: a guarded step never acts when its guard is false (audit shows no surface call); a failed booking triggers "cancel booking" and the run ends aborted with the policy recorded.
- Trajectory compiler: the six-call exploration from the MCP test compiles to a proposal whose Tier 1 compile succeeds for at least 80 percent of steps; nothing written outside proposals/.
- ADE: record review, bindings browser, heal review, surface explorer, and tool panel each demonstrated by a Playwright-driven or scripted test against the fixtures project; security and screen-rule tests still pass.

When finished, print a summary table of F1..F5 and T5.1..T5.8 with status and commit hash, then stop. Do not begin Phase 6.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-5`:

1. Run the contract with no credential, also on Node 22 with `CI=true`; confirm `git diff master..phase-5 -- docs/spec/{requirements,hld,lld,tasks}.md` is empty.
2. Re-run the later-step heal cycle behind the login through both command lines with inputs supplied by flag and by environment.
3. Run `svatah eval compiler --tier2` from the clean checkout with Ollama serving the pinned model and expect the published Tier 2 number; run it with Tier 2 unconfigured and expect `not measured`.
4. Attach the BiDi adapter to stock Chrome through chromedriver and run the conformance suite.
5. Compile every assertion alias in the amendment and expect the same IR as the canonical form.
6. Interrupt and resume a run; call a story as a workflow and as an MCP tool with the model endpoint blocked; trip a guard and a compensation and read the audit.
7. Drive the ADE's new screens against the fixtures project.
8. Score on the ten parameters and report per item: verified, verified with deviations, or failed, with a reproducing command for each failure.
