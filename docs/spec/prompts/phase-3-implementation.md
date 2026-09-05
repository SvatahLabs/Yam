# Phase 3 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root. It applies the Draft 2.4 spec amendments and the Phase 2 corrections from `docs/spec/progress/phase-2-verification.md`, then implements Phase 3 (recorder with model grounding, model-backed healing, published evals, the new ADE shell and core screens).

---

## Prompt

```
You are continuing the Svatah implementation. Phase 2 is on branch phase-2 (tip 3d285f9), verified at 8.1/10 with corrections required. You will apply the Draft 2.4 spec amendments, the corrections, then implement Phase 3.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md
- docs/spec/hld.md
- docs/spec/lld.md
- docs/spec/tasks.md
- docs/spec/progress/phase-1.md and docs/spec/progress/phase-2.md (what exists)

Branching: create branch phase-3 from phase-2. Commit after each item with "Spec 2.4: <title>", "P2-F<n>: <title>", or "T3.<n>: <task title>".

SPEC AMENDMENTS (Draft 2.4, authorized by the verifier). Apply verbatim as the first commit and touch no other spec text.

requirements.md, REQ-LANG-10 row: replace the requirement text with
`compose:` expands in place; the run block defines execution order for the flow. A run block with no lines runs the story or composition of its own name. A flow with no run block runs its `scenario` blocks in file order and its `story` blocks not at all, matching the legacy parser.
requirements.md, §7 change log: add before the Draft 2.3 line: "- Draft 2.4 (after Phase 2 verification): `REQ-LANG-10` states the run-block semantics inherited from the legacy parser."

lld.md, §4.1: after the line beginning "`onFailure` values:" add a paragraph:
Run-block semantics (Draft 2.4): a `compose:` block's lines are story names; a `test:` or `run:` block's lines are story or composition names. A run block with no lines runs the story or composition of its own name, and when none exists it is `E_TEST_EMPTY`. A flow with no run block runs its `scenario` blocks in file order and its `story` blocks not at all (the legacy `addScenarioEntry` / `addStoryEntry` semantics).
lld.md, §3.4 StepResult: extend `failure?` with `session?: SessionState` ("the surface state at failure, so a healer can restore it without a plan").
lld.md, §8: insert before "### 8.1 Orchestration":
The executor receives the resolver, the custom-step runner, and the API runner as injected collaborators; `runtime` imports neither `steps` nor `adapter-http` (LLD §1). The CLI wires them, and a foreign runtime supplies its own or refuses plans that need them with a clear diagnostic. At flow start the executor opens the session at the flow's base URL with the configured storage state before the first story runs.
lld.md, §9.1 first bullet: replace "creates the Playwright adapter over the test's `context`, loads plan and bindings," with "creates its own browser context from the worker-scoped `browser` (Playwright's test-scoped `context` is torn down between stories), creates the Playwright adapter over it, loads plan and bindings,".
lld.md, §10: after the Replayer paragraph add:
Both implementations must first put the session where the flow starts, exactly as the executor does: open at the flow's base URL with the configured storage state, then replay the prefix of steps before the failing one. A failure at a story's first step is `reached` only after that navigation, never on a blank page. A run's failure record carries the session state at failure (`failure.session`, §3.4), so the session-state default can restore it from a run directory without a plan. `reached` must be verified by comparing the live URL path with the recorded one before relocalization runs.
lld.md, §13.5 first paragraph: append: "The functions are injected through a `ServiceApi` interface so the service imports only `@svatah/schema` (the CLI mounts the service, so an import the other way would be a cycle). `POST /run` validates the supplied inputs against the signatures of the stories the run invokes directly and answers 400 with the missing names before anything starts; `GET /project` includes each story's signature so a client can prompt for inputs."
lld.md, §16: append to the healing ground-truth bullet: " A proposal whose key matches but which cannot be re-synthesised into a unique candidate is `unverified`, counted separately and never as a recovery." and add a bullet: "- Timing assertions (REQ-COMP-2, REQ-NFR-4) run isolated from the browser suites or use a budget of at least three times the requirement; a timing test that fails only under parallel load is a defect in the test, not in the code."
lld.md, §17: add as first bullet: "- Draft 2.4 (after Phase 2 verification): run-block semantics (§4.1); `failure.session` on step results (§3.4); executor collaborators injected and flow-start navigation stated (§8); host context from the worker-scoped browser (§9.1); both replayers perform the flow-start navigation and verify the page (§10); service `ServiceApi` injection, input validation on `/run`, signatures on `/project` (§13.5); `unverified` eval outcome and the timing-test rule (§16)."

hld.md, §12 layout: replace the "(svatahADE)" line with
    ade/                  the new Svatah ADE (Electron), developed in-repo until its first release, then split to the svatahADE repository (ADR-17); also the desktop conformance target
hld.md, ADR-17: append: "Until its first tagged release the new ADE is developed in this repository under `apps/ade`, so Phase 3 and the desktop conformance work verify in one checkout; the split to the `svatahADE` repository happens at that release, and the prototype's code is archived there on a `prototype` branch."
tasks.md: T3.6 heading becomes "### T3.6 New ADE shell (`apps/ade`, fresh build; split to the svatahADE repository at first release)"; change log: add "- Draft 2.4 (after Phase 2 verification): T3.6 builds the ADE under `apps/ade` in this repository."

PHASE 2 CORRECTIONS (before any Phase 3 task):
F1 Heal from a run directory. Reproduce first: copy evals/fixtures to a temp dir, corrupt every candidate of bindings/home/sign-in-button.yaml, run simple.flow with --host none and the two --input values, then `svatah heal --run <id> --base-url <app>`: today it reports not-found because packages/cli/src/replayer.ts returns "reached" for a first step without opening the base URL; `svatah-bindings heal --run <id>` reports unreachable because results carry no session state. Fix per LLD §10 and §3.4 as amended: both replayers perform the flow-start navigation with storage state before replaying; the executor writes failure.session; reached is verified against the recorded URL path. Add an end-to-end test of the full cycle (break, run, heal, apply, re-run green) for both `svatah heal --run` and `svatah-bindings heal --run`, and one for a failure at a later step after a prior navigation.
F2 Malformed binding file. `svatah run` must report an unparseable or schema-invalid binding file as a diagnostic naming the file and exit with the config-error code, writing no partial run; add a test.
F3 Timing test. Make grammar.test.ts's 1,000-step assertion follow LLD §16 as amended (isolated or a 3x budget) and do the same for the executor overhead benchmark.
F4 Service inputs. Implement LLD §13.5 as amended: input validation on POST /run with a 400 listing missing names, signatures in GET /project; update openapi.json and the contract tests.
F5 Progress file. Add a "Post-verification corrections" section to docs/spec/progress/phase-2.md stating that the heal-from-run cycle did not work and why, and the verifier's Node 22 result.
F6 Nothing to do beyond applying the amendments; D1, D2, D4, D7, D8, D9 are no longer deviations.

PHASE 3 SCOPE: tasks T3.1 through T3.7 in docs/spec/tasks.md, in order. Nothing from Phase 4. Phase 3 delivers the recorder with model grounding, model-backed healing, the published grounding and healing evals, and the new ADE shell with its core screens under apps/ade.

Model access and credentials:
- The frontier model is Claude Opus 5 through the Anthropic SDK (model id claude-opus-5), adaptive thinking, structured output from the Zod answer schema, the stable instruction block marked for prompt caching, refusal stop reason handled as a tier failure (LLD §10). Use @anthropic-ai/sdk; do not call the API with raw fetch.
- Credentials come only from the environment (ANTHROPIC_API_KEY) or an existing `ant auth login` profile. Never write a key to any file, log, fixture, or test. Redaction tests must prove no secret reaches a prompt.
- If no credential is available in the session, implement everything against the fake gateway, mark T3.4's real-model runs and T3.5 as blocked in the progress file with the exact commands to run later, and do not fabricate numbers. Every eval report must state which gateway produced it.

Decisions already made (do not re-open):
- Grounding uses the surface snapshot text with refs as the model input; screenshots only as the configured vision fallback (LLD §11, Draft 1 §9.2 for the prompt g-1).
- The recorder reuses the executor's runStep so recorded behaviour equals replayed behaviour; it refuses to run when environment is production without --force-production.
- The recorder registers itself as the healer's Regrounder and as the bind() record mode when module (b) is installed; module (a) alone stays model-free.
- The ADE is a fresh Electron build under apps/ade: Electron current LTS via Forge's Vite plus TypeScript template, React renderer, typed preload bridge exposing only openProject, serviceInfo, pickFile, preferences; a client generated from GET /openapi.json; no storage beyond UI preferences; every screen renders a service response or a project file and nothing the CLI cannot produce (LLD §13.6).
- The ADE must be drivable by accessibility tools: app.setAccessibilitySupportEnabled(true) behind SVATAH_A11Y=1; every interactive control has a role and an accessible name.

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. If the spec cannot be followed as written, implement the closest faithful option and record it under Deviations in docs/spec/progress/phase-3.md with the section reference and reason. Do not edit the spec beyond the amendments above.
3. Model calls are allowed only in the gateway, the recorder, the healer's Regrounder, and the evals, and only through the gateway. The replay path stays model-free and the import-boundary lint must still pass.
4. Permissive licences only (REQ-PKG-3); Node 22 LTS.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-3.md with, per correction F1..F6 and per task T3.1..T3.7: status, the exact commands demonstrating each Validate item, observed results; Deviations and Known gaps sections; which gateway (fake or real) produced every number.
- Everything runnable from a clean checkout with: pnpm install && pnpm browsers && pnpm -r build && pnpm -r test, with no credential present (fake gateway). A separate documented command runs the real-model evals when ANTHROPIC_API_KEY is set.
- The heal cycle tests from F1 passing for both command lines.
- Recording of the four fixture flows: with the real model if available (bindings and record-report.json committed, cost under about $1 per 20-step story), otherwise with the fake gateway answering from the grounding eval cases, marked as such.
- Grounding eval cases (at least 150) committed with the report; full healing eval report with the model half if a credential was available.
- apps/ade: installers build on the host OS; the app opens the fixtures project, shows GET /project, runs a flow with live step results and screenshots, compiles a flow with inline lint, and produces the same runs/<id> files as the CLI. Renderer has no Node access (test). Electron accessibility flag present.
- A test proving no ADE screen contains logic the CLI lacks: every renderer data path maps to a service endpoint or a project file (a static check over the generated client usage is acceptable).

When finished, print a summary table of F1..F6 and T3.1..T3.7 with status and commit hash, then stop. Do not begin Phase 4.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-3`:

1. Run the contract with no credential present, also on Node 22; confirm the spec diff `phase-2..phase-3` is exactly the Draft 2.4 amendments.
2. Re-run the heal cycle on a corrupted binding through both command lines and expect a green re-run; then a second cycle where the failure is at a later step behind a navigation.
3. Feed `svatah run` a malformed binding file and expect a diagnostic and exit code, no stack trace.
4. Start the service and `POST /run` without required inputs; expect 400 with the missing names.
5. Inspect the recorder: block all hosts but the sample application during replay of recorded bindings and expect no failure; grep committed artifacts for any credential pattern.
6. If a credential is available to the verifier, re-run the grounding eval and compare to the committed report; otherwise confirm the report names the fake gateway.
7. Build and launch the ADE against the fixtures project, drive it through open, compile, run, results, and confirm the run directory matches a CLI run; confirm the renderer has no Node access.
8. Score on the ten parameters and report per item: verified, verified with deviations, or failed, with a reproducing command for each failure.
