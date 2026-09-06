# Svatah — Task Breakdown

Status: Draft 2.1 · Date: 2026-09-02
Companion documents: [requirements.md](requirements.md) · [hld.md](hld.md) · [lld.md](lld.md)

## How to use this file

- Tasks are grouped by delivery phase (HLD §13) and ordered so each depends only on earlier tasks unless stated. Draft 2 renumbers tasks; nothing from Draft 1 had started.
- Each task lists **Refs** (requirement IDs and design sections), **Do**, **Validate**, and an estimate in ideal engineer-days.
- A task is done when its Validate items pass in CI and the referenced requirements' verification methods are satisfied.
- Phase 1 is the adoption wedge (module a). It must be releasable on its own before Phase 2 starts.

---

## Phase 0 — Foundation

### T0.1 Freeze the Java project and clean the branch
**Refs:** HLD ADR-2, REQ-NFR-8 · **Est:** 0.5
**Do:** Do not commit the six uncommitted parser classes or `PARSER_IMPROVEMENTS.md`; move them under `legacy/experiments/` or delete. Remove `stanford-corenlp` (three artifacts), `onnxruntime`, and `guava` from `build.gradle` if unreferenced; confirm `./gradlew compileJava`. Move the Java project under `legacy/`. Commit the Draft 2 spec.
**Validate:** `./gradlew compileJava` green from `legacy/`; `git status` clean; HLD §12 matches the layout.

### T0.2 Workspace skeleton and boundaries
**Refs:** LLD §1, REQ-SURF-2, REQ-PKG-1, 3, REQ-NFR-7 · **Est:** 1.5
**Do:** pnpm workspace with every package in HLD §12 (empty `index.ts`), shared tsconfig, tsup, vitest, eslint boundary rules exactly as LLD §1, licence checker, GitHub Actions on ubuntu, macos, windows, and a `release` workflow that attaches eval reports.
**Validate:** CI green on three OSes; a throwaway import from `bindings` to `compiler` and from `runtime` to `gateway` each fails the lint; licence check passes.

### T0.3 Schema package with automation fields
**Refs:** REQ-STD-1, 4, REQ-AUTO-1, 2, 4, 5, 6 (schema parts), LLD §3 · **Est:** 3
**Do:** Zod definitions for everything in LLD §3 including `guard`, `custom`, `invoke`, `Signature`, `StoryMeta.onFailure`, desktop scopes and candidate kinds, `AuditLine`, `Checkpoint`, `Invoker`, `aborted`, `guard` failure class. Generate JSON Schemas at build; `canonicalJson`/`canonicalYaml`; provenance required on Tier 2/3 steps, non-human bindings, heal entries, proposals (schema refinement).
**Validate:** Round-trip tests per schema; committed generated schemas with a drift test; a binding without provenance is rejected; a Tier 2 step without provenance is rejected; `schemaVersion` constant `1.0.0`.

### T0.4 Agent surface spec
**Refs:** REQ-SURF-1, 4, 5, LLD §2 · **Est:** 2
**Do:** `packages/surface`: `AgentSurface`, `Snapshot`, `Capabilities`, registry, typed errors, snapshot text renderer, wire schemas generated from Zod. Write `docs/agent-surface.md` describing the contract for adapter implementers, including the role mapping tables for UIA, AX, and Appium.
**Validate:** Wire schemas committed; a mock adapter passes registry and error-type tests; the doc lists every method and every capability flag (test greps).

### T0.5 Sample web application with variants
**Refs:** LLD §16, REQ-NFR-8, REQ-HEAL-5 · **Est:** 2.5
**Do:** `apps/sample-web` reproducing the pages the sample flows use plus alert, select, iframe, new-tab, a canvas-only control, and `GET /api/active-count`; `?variant=1..20` deliberate UI changes documented in `VARIANTS.md`; port 4173.
**Validate:** Smoke test per page and variant; each variant changes at least one binding-relevant property (DOM diff test).

### T0.6 Language reference and golden seed
**Refs:** REQ-LANG-12, REQ-COMP-9, LLD §4.2 · **Est:** 2
**Do:** `docs/flow-language.md` with block grammar, signatures, guards, patterns 1–30 with two examples each, custom steps, variables, migration table. `evals/compiler/golden.jsonl` with at least 120 `tier: 1` entries. Hand-migrated v3 fixtures for the four sample flows.
**Validate:** Every golden entry validates; the doc names every `Action` value (test).

---

## Phase 1 — Module (a): bindings and model-free healing for Playwright users

### T1.1 Playwright adapter
**Refs:** REQ-ADP-1, REQ-RUN-10, LLD §7.1 · **Est:** 5
**Do:** Implement `AgentSurface` on Playwright: session, snapshot with refs (isolated `snapshot.ts` plus fallback), `locate` for every candidate kind incl. `coords`, `describe`, every action in the mapping table, `check` for every predicate, dialogs, windows, frames, masked screenshots, `state`/`restore`, tracing, capabilities.
**Validate:** One Playwright test per action and predicate on `apps/sample-web`; snapshot refs resolve back to the same element; `restore` returns to URL and storage state; capabilities list matches implementation (test).

### T1.2 Surface conformance suite (web)
**Refs:** REQ-SURF-3, REQ-STD-2, LLD §14 · **Est:** 2
**Do:** `packages/conformance/surface`: scripts of calls and expected invariants per sample page; `svatah surface conform --adapter playwright`.
**Validate:** Playwright adapter passes; a deliberately broken mock adapter fails with a readable report.

### T1.3 Bindings store, context hash, resolver
**Refs:** REQ-REC-6, 9, REQ-RUN-5, LLD §6.1–6.3 · **Est:** 2.5
**Do:** Store load/write/hash with canonical YAML; dictionary; snapshot-based context hash; resolver with candidate timeouts, exactly-one rule, `nth`, `webmcp` preference stub, `LocatorError` with candidates and drift flag.
**Validate:** Round-trip byte identity; resolver matrix with a stub surface; hash invariance to text, sensitivity to structure.

### T1.4 Synthesis and fingerprinting
**Refs:** REQ-REC-3, 4, LLD §7.4 (Draft 1 strategy), §3.3 · **Est:** 3
**Do:** `synthesise(surface, ref)` and `fingerprint(surface, ref)` over `describe()`: ordered strategy, uniqueness filter, auto-id heuristic, stable CSS and relative XPath, scores; neighbour text and role path.
**Validate:** For every interactive element on every sample page, the top candidate resolves uniquely to that element; fingerprints stable across reloads; snapshot of bundles committed for review.

### T1.5 Relocalization
**Refs:** REQ-HEAL-1 (relocalize), 5 (relocalize), LLD §6.4 · **Est:** 3
**Do:** Candidate collection, weighted score, threshold and margin, re-synthesis with lineage.
**Validate:** Component tests on synthetic descriptions; on sample variants, record on 0 and relocalize on 1..20: at least 60 percent recovered; no false accept on the duplicate-buttons variant.

### T1.6 `bind()` fixture with record, run, heal modes
**Refs:** REQ-REC-11, REQ-HEAL-6, REQ-PKG-1, 2, LLD §6.5, §9.2 · **Est:** 4
**Do:** `@svatah/bindings/playwright` test extension: `bind(id, phrase?)`; run mode via resolver; record mode via interactive headed picker (no model) with `provenance.model: "human"`; heal mode with inline relocalization and `healed` annotation; bind-failure lines to `.svatah/bind-failures.jsonl`; `svatah bindings list|show|verify|prune`.
**Validate:** A plain Playwright project (fixture in `examples/plain-playwright`) records three bindings by picker in headed mode, replays headless with the model endpoint blocked, breaks on variant 3, heals inline, and the annotation reads `healed`; quick start doc verified by a fresh-checkout CI job that completes in under ten minutes.

### T1.7 Model-free healer job and diff
**Refs:** REQ-HEAL-2, 3, 6, LLD §12, §10 (plugin interface) · **Est:** 3
**Do:** `heal --from-bind-failures` and `heal --run <id>`: select locator failures, replay to the failing point (for flows: runtime; for bind-failures: re-run the named Playwright test in record-less mode), relocalize, verify by re-run, `bindings.diff` and report; `Regrounder` plugin interface with a no-op default.
**Validate:** Variant-based end-to-end: failure, heal, diff applies with `git apply`, re-run passes; unrepairable reported; plan and flows untouched.

### T1.8 Healing eval (relocalize-only) and publish
**Refs:** REQ-HEAL-5, REQ-PKG-4 · **Est:** 1.5
**Do:** `svatah eval healing --no-model` over variants with a Markdown report; release workflow attaches it.
**Validate:** Threshold 0.60 met; report artifact present on a tagged pre-release.

### T1.9 Module (a) release
**Refs:** REQ-PKG-1, 2, 3 · **Est:** 1
**Do:** Publish `@svatah/bindings`, `@svatah/schema`, `@svatah/conformance`, `@svatah/adapter-playwright` 0.1; README with the ten-minute quick start and the published healing numbers.
**Validate:** `npm install` in a clean Playwright project works; module (a) has no dependency on module (b) packages (test inspects the dependency tree).

---

## Phase 2 — Module (b): flow language, compiler, executor, test behavior

### T2.1 Spec reader with signatures and guards
**Refs:** REQ-LANG-1, 2, 3, 9, 10, 13, 14 (parse), LLD §4.1 · **Est:** 2
**Do:** Block parser with `inputs:`/`outputs:` lines, guard lines and prefixes, meta keys incl. `onFailure`, `idempotent`, `tags`; `data.yaml` with secrets; `api/*.yaml`.
**Validate:** Unit tests per rule; `E_DUP_STORY`, `E_TEST_EMPTY`, signature type errors, `onFailure` value validation.

### T2.2 Synonym vocabulary and target dictionary
**Refs:** REQ-COMP-5, LLD §4.3 · **Est:** 1
**Do:** Port `ActionSynonyms.java` to `actions.yaml` under the new action names; trie resolver; normalisation; dictionary from bindings, `targets.yaml`, and unbound phrases.
**Validate:** Every Java synonym resolves; normalisation table; ambiguity yields `W_AMBIGUOUS_TARGET`.

### T2.3 Tier 0 custom typed steps
**Refs:** REQ-LANG-15, 16, LLD §5 · **Est:** 2.5
**Do:** `defineStep` API, template compiler with typed placeholders, loader for `steps/`, matcher ahead of Tier 1, `E_STEP_AMBIGUOUS`, `custom` IR emission, `StepContext` for execution.
**Validate:** Example step with a `target` placeholder compiles, records (Phase 3) and runs; ambiguity test; handler cannot reach the adapter (type test).

### T2.4 Tier 1 grammar
**Refs:** REQ-COMP-1, 2, REQ-LANG-4..7, LLD §4.2 · **Est:** 4
**Do:** `step.peggy` covering patterns 1–29 and legacy phrasings; sigil rejection; captures and ValueRefs incl. `{input.*}`; `invoke` and guard predicates.
**Validate:** 100 percent on `tier: 1` golden; every sigil form rejected; fixtures parse with zero errors; 1,000 steps under 1 s.

### T2.5 Compiler pipeline, validation, plan, lint
**Refs:** REQ-COMP-1, 5..9, REQ-AUTO-5 (compile-time), LLD §4 (Draft 1 pipeline), §3.2 · **Est:** 3
**Do:** Tier 0 → 1 pipeline with pluggable 2/3; target resolution; variable, input, output, and invoke validation; canonical `plan.json` with `--stable`; lint codes including `W_CUSTOM`, idempotency and long-sleep warnings.
**Validate:** Byte-stability; error matrix; fixtures compile clean; a story exposing outputs not captured fails.

### T2.6 HTTP adapter
**Refs:** REQ-ADP-2, 3, LLD §7.2 · **Est:** 2
**Do:** Request builder mirroring `ApiRequest`, templating, response, JSON-path capture, session-cookie sharing.
**Validate:** Field matrix against a local server; cookie-sharing test.

### T2.7 Executor core with policies, checkpoints, audit
**Refs:** REQ-RUN-1..4, 6..9, 13, REQ-AUTO-1, 2, 4, 5, 6 (runtime), REQ-NFR-1, 4, 5, LLD §8 · **Est:** 5
**Do:** Orchestration, scope with inputs, `runStory` with signature validation and outputs, `runStep` with guards, `invoke`, `custom`, checkpoints, audit proxy over the surface, policies `stop|continue|compensate`, failure classes, results writer, summary with outputs, exit codes, JSON-lines logging, optional OpenTelemetry.
**Validate:** Stub-surface tests: parallelism, skip semantics, policy matrix, guard skip without act, invoke with inputs and outputs, checkpoint files per step, audit redaction of `secret` values, overhead under 5 ms per step; determinism test on the sample app.

### T2.8 Playwright Test host
**Refs:** REQ-RUN-12, REQ-BEH-1, LLD §9 · **Est:** 3
**Do:** In the module (b) package `host-playwright`: `svatah` fixture, `host generate`, reporter writing Svatah results, retry policy gating, annotations with failure class; re-export `bind()` from `@svatah/playwright-test`. `@svatah/playwright-test` itself gains nothing and keeps no runtime dependency.
**Validate:** Generated specs for the fixtures run under Playwright Test with two shards and the HTML reporter; Svatah `results.jsonl` produced alongside; retries disabled unless permitted (test).

### T2.9 Migration tool
**Refs:** REQ-LANG-11, LLD §11 (Draft 1) · **Est:** 3
**Do:** v2 regex port; action and assertion mapping; sentence rewriting; `.locator` to seed bindings; inline locators to phrases; `.data` to `data.yaml` with secret indirection; review report.
**Validate:** `src/test/resources` migrates to flows compiling clean with equal story names and step counts; candidate counts equal `&` alternatives; golden output compared byte-for-byte.

### T2.10 CLI for module (b) and compatibility run (milestone)
**Refs:** REQ-AGT-1, REQ-NFR-8, REQ-BEH-5, LLD §15 · **Est:** 2
**Do:** `compile`, `lint`, `run` (both hosts), `migrate`, `init`, `doctor`; run the migrated fixtures with hand-completed seed bindings on `apps/sample-web` in CI, twice, diffing results.
**Validate:** All steps pass except documented unsupported ones; identical results across the two runs; the same plan runs under `--host playwright` and `--host none` with identical statuses (REQ-BEH-5).

### T2.11 Local service
**Refs:** REQ-ADE-1, REQ-ADE-7, LLD §13.5 · **Est:** 3
**Do:** `packages/service`: Fastify on `127.0.0.1` with a bearer token, every endpoint in LLD §13.5 delegating to the CLI's functions, WebSocket event stream (SSE fallback), `svatah serve`. No business logic in handlers (lint rule: `service` may import only `cli`'s command functions and `schema`).
**Validate:** Contract tests per endpoint against the fixtures project; an unauthenticated request is refused; a `run` streams one `step.result` per step and a final `run.summary`; the same run started via CLI and via service produces identical `results.jsonl`.

### T2.12 Module (a) command line and healer replay plugin
**Refs:** REQ-PKG-1, 2, REQ-HEAL-1, LLD §1, §10, HLD §12 · **Est:** 2
**Do:** Create `@svatah/bindings-cli` (bin `svatah-bindings`) holding `bindings list|show|verify|prune`, `heal --from-bind-failures`, `surface conform`, and `eval healing`, moved out of `@svatah/cli`; `@svatah/cli` depends on it and mounts the same commands under `svatah`. Add the `Replayer` plugin interface to `@svatah/healer` with the session-state default; register a runtime-backed `Replayer` from `@svatah/cli` for flow runs.
**Validate:** The dependency-tree test covers `bindings-cli` as module (a); a clean install of the module (a) tarballs exposes `svatah-bindings`; `svatah heal --run <id>` on a Phase 2 run directory replays to the failing step through the runtime, while `svatah-bindings heal --from-bind-failures` still works with no module (b) package installed.

---

## Phase 3 — Recorder, model healing, published evals

### T3.1 Model gateway
**Refs:** REQ-COMP-3, 4 (interfaces), REQ-AGT-3, REQ-NFR-2, 6, LLD §10 · **Est:** 3
**Do:** Anthropic and local backends, schema-constrained output, adaptive thinking, cached system block, refusal handling, provenance, disk cache, cost table, `render()` redaction.
**Validate:** Request-shape tests; secret never in captured request; cache hit costs zero; refusal returns `GatewayRefusal` without retry.

### T3.2 Grounding over the surface
**Refs:** REQ-REC-2, 7, LLD §11, Draft 1 §9.2 · **Est:** 3
**Do:** `ground(step, surface, gateway)`: snapshot text with refs, pruning, prompt `g-1`, null handling, vision fallback, `describe` → synthesis, dry-check, entry construction; environment refusal.
**Validate:** Recorded-snapshot tests with a fake gateway; pruning keeps interactive nodes; redaction; vision only when allowed; refuses in `production` without `--force-production`.

### T3.3 Recorder session, report, `record` command, `Regrounder`
**Refs:** REQ-REC-1, 5, 8, 9, REQ-HEAL-1 (model), LLD §11, §10 · **Est:** 3
**Do:** Session loop reusing `runStep`, `--rebind`, filters, stop on failed expectation, report, `record` CLI; register the recorder as the healer's `Regrounder` and as `bind()` record mode when module (b) is installed.
**Validate:** Recording `simple.flow` with a fake gateway produces verified bindings; impossible expectation stops without writing; `bind()` in record mode uses the model when module (b) is present (test toggles installation).

### T3.4 Grounding eval and full healing eval, published
**Refs:** REQ-REC-10, REQ-HEAL-5 (model), REQ-PKG-4 · **Est:** 2.5
**Do:** 150 grounding cases from sample pages; `eval grounding` threshold 0.95; `eval healing` with model threshold 0.85; scheduled CI with real gateway, PR CI with cache; release attaches both reports.
**Validate:** Thresholds met; reports attached to a tagged release.

### T3.5 First real recording (milestone)
**Refs:** REQ-REC-1..9, REQ-NFR-8 · **Est:** 1
**Do:** Re-record the four fixtures with the real model; commit bindings and report.
**Validate:** Replay passes with the model endpoint blocked; record cost under about $1 per 20-step story.

### T3.6 New ADE shell (`apps/ade`, fresh build; split to the svatahADE repository at first release)
**Refs:** REQ-ADE-2, 7, HLD ADR-17, LLD §13.6 · **Est:** 3
**Do:** Scaffold Electron current LTS with Forge's Vite plus TypeScript template; `main/` with window, project chooser, service process lifecycle (spawn `svatah serve --port 0`, read port and token, health-check, stop on close, connect if a lock file exists), and the accessibility flag; typed preload bridge with only `openProject`, `serviceInfo`, `pickFile`, `preferences`; React renderer with a client generated from `GET /openapi.json`; preferences store; installers for macOS, Windows, Linux in CI. Archive the prototype's code on a `prototype` branch of the repository.
**Validate:** Renderer has no Node access (test); the app opens a fixture project and shows `GET /project` data; killing the app stops the service; Electron security checklist passes; installers build on three OSes.

### T3.7 ADE core screens
**Refs:** REQ-ADE-3, LLD §13.6 · **Est:** 6
**Do:** Project screen (open, init); flow editor with inline lint from `/compile` and a custom-step palette; plan view per story (step, tier, confidence, target status); run screen with live `step.result` events, screenshots, audit tail, and `run.summary`; results history from `GET /runs`; API client over `POST /api/request` with save to `api/`; data editor over `GET/PUT /data` with secrets masked. Screen rule: every screen renders a service response or a project file and nothing the CLI cannot produce.
**Validate:** Editing a flow in the ADE and compiling from the CLI yields the same `plan.json`; a run started from the ADE produces the same `runs/<id>` files as the CLI; lint warnings in the editor match `svatah lint --json`; a review confirms no ADE-only logic.

---

## Phase 4 — Independence, tiers, agent access

### T4.1 WebDriver BiDi adapter
**Refs:** REQ-ADP-4, REQ-SURF-3, LLD §7.3 · **Est:** 8
**Do:** Thin BiDi client; adapter actionability; injected snapshot with accessible names; candidate `locate`; dialogs, windows, frames as far as BiDi allows, with capabilities flags for gaps.
**Validate:** Passes the surface conformance suite on stock Chrome and Firefox; fixtures replay on BiDi with identical statuses to Playwright (runtime conformance).

### T4.2 Appium adapter
**Refs:** REQ-ADP-5, LLD §7.4 · **Est:** 5
**Do:** WebdriverIO client; webview and native contexts; page-source snapshot conversion; candidate kinds.
**Validate:** Emulator job (or documented manual gate) replays `svatah.flow` on Android Chrome; native sample grounds and replays three steps; conformance subset passes.

### T4.3 Tier 2 local model
**Refs:** REQ-COMP-3, REQ-NFR-3, LLD §4.3 (Draft 1) · **Est:** 3
**Do:** Local backend with schema-constrained output, digest pinning, few-shot retrieval, confidence penalty, `W_TIER2`; `docs/local-model.md`.
**Validate:** With Tier 3 off and non-localhost network blocked, at least 80 percent exact match on the `tier: 2` golden subset (added here); byte-identical recompiles; digest mismatch fails without the flag.

### T4.4 Tier 3 and compiler eval publish
**Refs:** REQ-COMP-4, 9, REQ-PKG-4 · **Est:** 1
**Do:** Prompt `c3-1`; `W_TIER3`; `eval compiler` per-tier report attached to releases.
**Validate:** Overall 0.95 met; provenance on every Tier 3 step.

### T4.5 REPL
**Refs:** REQ-RUN-11 · **Est:** 2
**Do:** Sentence-at-a-time compile, ground, execute; session flow and bindings on exit.
**Validate:** stdin-driven integration test for three sentences; `docs/repl.md`.

### T4.6 MCP server with raw surface and trajectory capture
**Refs:** REQ-AGT-2, REQ-BEH-4 (capture), LLD §15, §13.4 · **Est:** 3
**Do:** Operation tools plus `surface_*` tools requiring `intent`; `trajectory.jsonl` writer; streaming progress.
**Validate:** MCP client integration test drives `compile`, `run`, and a six-call surface exploration that yields a well-formed trajectory file.

### T4.7 Privacy mode
**Refs:** REQ-NFR-3 · **Est:** 0.5
**Do:** Documented config and a CI test blocking non-localhost network for `compile` and `run`.
**Validate:** Test passes; doc lists which commands still need a remote model.

---

## Phase 5 — Automation behaviors

### T5.1 Resume from checkpoint
**Refs:** REQ-AUTO-3, LLD §8.1 · **Est:** 2
**Do:** `--resume --from`: checkpoint load, hash verification, scope and session restore (web: URL and storage state).
**Validate:** Interrupt a fixture run at step 5, resume, results equal a full run from step 5 onward; hash mismatch exits 12.

### T5.2 Workflow runner and CLI
**Refs:** REQ-BEH-2, REQ-AUTO-5, 7, LLD §13.2 · **Est:** 2.5
**Do:** `runWorkflow`, `workflow run` with `--input`, outputs as JSON, environment policy enforcement (`production` requires `idempotent` or `allowSideEffects`).
**Validate:** A story with signature runs as a function and returns typed outputs; a non-idempotent story is refused in `production` config without the override.

### T5.3 Tool server
**Refs:** REQ-BEH-3, REQ-AUTO-6, 8, LLD §13.3 · **Est:** 3
**Do:** `tool serve`: tools from signatures; invoker identity from the MCP client; audit per call; `requireIdempotent`; no gateway import (boundary).
**Validate:** An MCP client calls a recorded "Book a slot" story with inputs and receives outputs and a `runId`; `audit.jsonl` shows agent invoker and redacted inputs; model endpoint blocked during the test.

### T5.4 Guard sentences and compensation end to end
**Refs:** REQ-LANG-14, REQ-AUTO-1, 4 · **Est:** 1.5
**Do:** Wire guard grammar to executor guard evaluation incl. `expr` predicates over scope; `compensate:<story>` flows on the sample app (a "Cancel booking" story).
**Validate:** Guarded step never acts when the guard is false (audit shows no surface call); failed booking triggers cancel and the run is `aborted` with the policy recorded.

### T5.5 Trajectory compiler
**Refs:** REQ-BEH-4, LLD §13.4 · **Est:** 4
**Do:** Group by intent, map calls to IR, sentence normalisation, ids from `describe`, synthesis at capture, proposals output, `// review:` for uncompilable steps.
**Validate:** The trajectory from T4.6 compiles to a proposal whose Tier 1 compile succeeds for at least 80 percent of steps; nothing written outside `proposals/`.

### T5.7 ADE record review, bindings and heal review
**Refs:** REQ-ADE-4, 5, LLD §13.6 · **Est:** 5
**Do:** Record screen: start `POST /record`, stream `record.decision` and `record.candidates`, show snapshot excerpt, chosen reference, candidate bundle, and fingerprint per target, with accept, reject, or re-pick by clicking in the driven session through `/surface/:session/snapshot`; bindings browser with context entries and dry-resolve status; heal review rendering `heal.proposal` as a before and after candidate diff with apply.
**Validate:** Demo: author a three-step story, record against the sample web app, reject one grounding and re-pick, and confirm the written binding matches the pick; a healed variant shows a proposal that applies and re-runs green.

### T5.8 ADE surface explorer and tool panel
**Refs:** REQ-ADE-8, REQ-BEH-3, 4, LLD §13.6 · **Est:** 3
**Do:** Surface explorer: open an adapter session, show the snapshot tree, act by clicking a node with a required `intent`, produce `trajectory.jsonl` and offer "compile to proposal"; tool panel: start and stop `tool serve` for selected stories and show invocations with audit lines.
**Validate:** A six-step exploration compiles to a proposal in `proposals/`; an MCP client invocation appears in the tool panel with its audit record.

### T5.6 Behavior docs and examples
**Refs:** REQ-AGT-4, REQ-BEH-1..3 · **Est:** 1
**Do:** `examples/` for CI, cron, and an MCP-driven agent invoking a tool; docs stating that orchestration is external.
**Validate:** Examples run in CI where feasible; docs linked from README.

---

## Phase 6 — Reach

### T6.1 Windows UIA adapter validated against the ADE
**Refs:** REQ-ADP-6, REQ-ADE-6, REQ-SURF-3, LLD §7.5, §16 · **Est:** 9
**Do:** UIA adapter with role mapping, `automationId` and `controlPath` candidates, patterns and input fallback, screenshots, `state`/`restore`; desktop conformance flows against the ADE (create project, open flow, run, open result, API client); add ARIA roles and names in the ADE UI where the tree is thin.
**Validate:** Surface conformance on a Windows runner that builds and launches the ADE with `SVATAH_A11Y=1`; the desktop flows record and replay; a healing variant subset (renamed control, moved panel) passes relocalization.

### T6.2 macOS Accessibility adapter validated against the ADE
**Refs:** REQ-ADP-7, REQ-ADE-6 · **Est:** 8
**Do:** AX adapter as LLD §7.5; `surface doctor` permission check; same desktop flows.
**Validate:** Conformance on a macOS runner with the permission granted; the desktop flows replay.

### T6.6 Prototype data import
**Refs:** REQ-ADE-9, LLD §13.5 · **Est:** 1.5
**Do:** `svatah migrate --from-ade <path>` reading the prototype's electron-db files and emitting config, flows (then v2→v3), seed bindings, `data.yaml`, and `api/*.yaml`; an "Import prototype database" action in the ADE project screen.
**Validate:** A captured prototype database converts to a project that compiles clean and whose story names and step counts match.

### T6.3 WebMCP candidate
**Refs:** REQ-ADP-9, LLD §6.3, §4.2 #30 · **Est:** 2
**Do:** Detect `navigator.modelContext` tools in the Playwright adapter; `webmcp` candidate synthesis at record; resolver preference; pattern 30.
**Validate:** On the WebMCP sample page, replay uses the declared tool; removing the declaration falls through to locators.

### T6.4 Java conformance runtime
**Refs:** REQ-STD-3, LLD §14 · **Est:** 8
**Do:** `runtime-java` on Playwright for Java and Jackson consuming plan, bindings, data; existing `ApiClient` for HTTP; results and summary in schema.
**Validate:** Runtime conformance suite: zero mismatches in status and matched candidate versus the TS runtime.

### T6.5 Tier 2 fine-tune pipeline
**Refs:** ADR-4, REQ-COMP-3 · **Est:** 5
**Do:** Export accepted pairs from merged plans; LoRA fine-tune script; publish digest; base-vs-tuned eval.
**Validate:** At least 5 points improvement on `tier: 2` golden without Tier 1 regressions.

---

## Phase 7 — Hardening and release candidate (Draft 2.8)

### T7.1 The macOS Accessibility live gate passes, and the desktop healing cases
**Refs:** REQ-ADP-7, REQ-SURF-3, REQ-ADE-6, LLD §7.5, §14, §16 · **Est:** 4
**Do:** Rewrite the AX bridge's window read to bulk attribute reads (`entire contents` plus `properties`, one process invocation per snapshot); make the timeout message a bridge timeout with nodes and milliseconds when `doctor` has said `granted`; poll for the ADE window up to 60 s; resolve `--report` against the current directory; record nodes read, wall time, and ms per node in the report. Add `SVATAH_A11Y_VARIANT=1|2` to the ADE (LLD §16) and the desktop healing cases to the desktop suite for both adapters.
**Validate:** `node scripts/desktop-conformance.mjs --adapter ax` passes 7 of 7 on a macOS host with the permission granted, with the project screen (≥400 nodes) read within 10 s and the cost in the report; the two healing cases relocalize at variant 1 and 2 and the report says so; `svatah surface doctor` still reports `denied` and `prompt-pending` correctly against recorded exchanges.

### T7.2 Windows UIA live gate and the pipeline that carries every gate
**Refs:** REQ-ADP-6, REQ-STD-2, REQ-STD-3, LLD §7.5, §14 · **Est:** 3
**Do:** Run the UIA gate on a Windows machine or runner and fix what it finds (the bridge scripts are untested against a real `UIAutomationClient`); add the desktop conformance legs and the Java runtime conformance to `bitbucket-pipelines.yml`, the repository's remote, with the macOS leg allowed to fail only on a hosted runner that cannot grant the permission; keep the GitHub workflow in step.
**Validate:** `reports/adapter-uia.md` from a live run, 7 of 7 plus the healing cases, or the exact blocked command and the host's `doctor` output; the pipeline definition runs the Java conformance and both desktop gates and is green or blocked per leg with the reason recorded in the progress file.

### T7.3 Dialog IR agreement, type check in the contract, small defects
**Refs:** REQ-LANG-*, REQ-RUN-8, LLD §3.2, §15, §16 · **Est:** 1.5
**Do:** `dialog` args become `{ action, text? }` end to end: grammar, `modelStepSchema`, the Playwright and BiDi adapters, the Java runtime (fail by name if unimplemented), pattern 21 golden entries and a run against `/widgets`. Fix `@svatah/workflow`'s `Config` construction so `pnpm -r typecheck` is green, and add `typecheck` to the contract in the README and the CI. Fix the report path and the window poll of the desktop gate script if T7.1 has not.
**Validate:** `Dismiss the dialog` leaves the sample page saying `dismissed` and `Accept the dialog` saying `confirmed`, in the suite; `pnpm -r typecheck` exits 0 from a clean checkout; the contract line in `README.md` includes it.

### T7.4 The Java runtime writes the published schemas
**Refs:** REQ-STD-3, LLD §3.4, §14 · **Est:** 2
**Do:** Emit full `StepResult` and `Summary` records (`startedAt`, `endedAt`, `durationMs`, `inputs` as names, `failure` as today); make `scripts/runtime-conformance.mjs` validate both files against `stepResultSchema` and `summarySchema` before comparing and fail on the first invalid line with its path; document the fixture as a projection in `evals/conformance/runtime/README.md`.
**Validate:** The suite reports `artifacts valid` and zero mismatches, twice; a deliberately stripped line makes it fail with the schema path; `reports/runtime-java.md` carries both facts.

### T7.5 The fine-tune, measured
**Refs:** ADR-4, REQ-COMP-3 · **Est:** 2 (plus machine time)
**Do:** Complete the training run (`scripts/finetune-tier2.mjs`), or a documented shorter schedule if the full one exceeds the host, publish the tuned digest, and run `scripts/finetune-eval.mjs` base versus tuned on the `tier: 2` golden subset with Tier 1 unchanged.
**Validate:** The measured numbers in `reports/eval-finetune.md` with the digest, iterations, and host; the five-point target met or the shortfall stated; or the exact blocked command and why. No improvement is reported without a measurement.

### T7.6 Release candidate 0.1.0
**Refs:** REQ-PKG-1, 2, 3, 4, REQ-STD-1, 2, LLD §16 · **Est:** 4
**Do:** Version every publishable package 0.1.0 with a changelog; `npm pack` dry runs for module (a) (`@svatah/bindings`, `@svatah/healer`, `@svatah/playwright-test`, `@svatah/bindings-cli`), the `svatah` CLI, and `@svatah/schema` with the JSON Schema files and the conformance fixtures included; a release workflow that builds the ADE installers on the three-OS matrix and attaches `reports/*.md` to the release notes; the module (a) ten-minute quick start executed from the packed tarballs in an empty Playwright project by a script, not by hand.
**Validate:** `pnpm release:dry-run` produces the tarballs and lists their contents; the quick-start script passes against the tarballs on Node 22 and the current LTS with no credential; the licence check passes on the packed dependency trees; the release workflow runs to the artifact step on the pipeline that exists.

Phase 7 total: 16.5 ideal days.

---

## Phase 8 — Ship (Draft 2.9)

### T8.1 The packaged ADE opens a project
**Refs:** REQ-ADE-2, REQ-ADE-6, LLD §13.6 · **Est:** 2.5
**Do:** Resolve the service's runtime as §13.6 states (`SVATAH_NODE`, then `node` on `PATH` of the supported major or newer, then a Node beside the CLI under `resources/` when packaged with one); never `process.execPath` in a packaged build; the Project screen's alert names the three places when none is found; `doctor` and the smoke check report the chosen runtime. `SVATAH_ADE_PROJECT=<dir>` opens a project on ready. `scripts/ade-smoke.mjs` and the ADE smoke test run against the packaged application when `apps/ade/out/` exists and say so. The desktop gate passes the fixtures project through `SVATAH_ADE_PROJECT`.
**Validate:** The packaged ADE, launched by hand with no environment, opens a project from its Recent list within 30 s and shows the eleven tabs; with `PATH` emptied it shows the alert and opens nothing; `pnpm ade:smoke` runs against the packaged app in CI on the three-OS matrix; the gate's variant 0 log shows the project screen open before the first case.

### T8.2 The AX bridge within budget, and the macOS gate green
**Refs:** REQ-ADP-7, REQ-SURF-3, REQ-ADE-6, LLD §7.5, §14, §16 · **Est:** 4
**Do:** Read the whole window in a fixed number of Apple events (`properties of every UI element of entire contents`, plus one event per optional attribute over the same set), or a native helper reading `AXUIElement` when that cannot reach the budget on the project screen; honour the caller's deadline in the script; report skipped for a case with no checks; run each healing case only at its variant.
**Validate:** `node scripts/desktop-conformance.mjs --adapter ax` passes 7 of 7 plus both healing cases on a macOS host with the permission granted and an unlocked display; the report's bridge line is a snapshot of the project screen (≥400 nodes) within 10 s; a `window()` call with a 60 s deadline is allowed to run 60 s.

### T8.3 Dialog arming: documented, linted, audited
**Refs:** REQ-LANG-*, REQ-RUN-8, LLD §3.2, §4.2 · **Est:** 1
**Do:** Rewrite pattern 21 in `docs/flow-language.md` with the arming order and a worked example; implement `W_DIALOG_UNARMED` and `W_DIALOG_NEVER_OPENED` in lint with golden entries; write the `kind:"dialog", armed:false` audit line in the executor.
**Validate:** A flow with the click before the dialog step lints with `W_DIALOG_UNARMED` and its run's audit shows the unarmed default; the reference's own examples lint clean and run as documented, in the suite.

### T8.4 The fine-tune withdrawn from 0.1.0, and the corpus that would bring it back
**Refs:** ADR-4, REQ-COMP-3 · **Est:** 2
**Do:** Record in `reports/eval-finetune.md` and the release notes that the Tier 2 fine-tune target is not met and the tuned digest is not used; add `svatah eval finetune corpus`, which collects sentences the grammar refuses from the golden set's `tier: 2` entries, the migration fixtures' review notes, and a new `evals/compiler/refused.jsonl` seeded with at least 150 reviewed (sentence, Step) pairs; export pairs from that corpus only, with the golden `tier: 2` subset still excluded.
**Validate:** The corpus export reports its sources and counts and shares no sentence with the golden set; no training run is required, and none is reported unless measured with early stopping on a held-out split that is not the training set.

### T8.5 Publish 0.1.0
**Refs:** REQ-PKG-1, 2, 3, 4, REQ-STD-1, 2, LLD §16 · **Est:** 2
**Do:** A `custom: publish` Bitbucket pipeline and a manually dispatched GitHub workflow that run the release dry run, the packed quick start, the reports, then `npm publish` for the 26 packages under the owner's scope using a token supplied as a pipeline secret, and attach the ADE installers and `reports/*.md` to the release. The implementer prepares and dry-runs it; the owner triggers it.
**Validate:** The pipeline's dry-run mode runs end to end from a clean checkout and prints the exact publish commands it would run, with the token absent; the publish step refuses to run without the manual trigger and the token; a `CHANGELOG.md` entry for 0.1.0 lists what is in, what is measured, and what is withdrawn.

### T8.6 The Windows UIA gate (carried)
**Refs:** REQ-ADP-6, LLD §7.5 · **Est:** 2 (needs a Windows host)
**Do:** Run the gate on a Windows machine or an attached runner; fix what a real UI Automation tree finds.
**Validate:** `reports/adapter-uia.md` from a live run, 7 of 7 plus the healing cases; or the exact blocked command and the host's `doctor` output, unchanged from Phase 7.

Phase 8 total: 13.5 ideal days.

---

## Phase 9 — Builder surfaces, foundation (Draft 2.11)

The owner reviewed and approved the mockups under `docs/spec/design/` on 2026-09-05. This phase builds the foundations both renderers stand on and proves them with two screens end to end. Nothing in the old ADE is deleted until Phase 10 replaces it.

### T9.1 The screen model and the action registry
**Refs:** REQ-ADE-10, REQ-ADE-13, LLD §13.7 · **Est:** 4
**Do:** `@svatah/screens`: the `Screen`, `State`, `Action`, `Binding` types; the twelve screen ids; `load()` for every screen from the service and files; the action registry with `id`, `label`, `run`, `availableWhen`, `cli`; a fake-service harness for tests. A repository check reads the registry, the CLI's command table, and the palette fixture and fails when an action's id, label, or CLI command differs between them.
**Validate:** Every screen loads against the fake service in tests with the state the mockup shows for the fixtures project; the parity check passes and a deliberately renamed action makes it fail; `svatah ui --json` (T9.4) prints exactly the model's state.

### T9.2 The design system
**Refs:** REQ-ADE-12, LLD §13.7 · **Est:** 3
**Do:** `@svatah/ui-tokens` (CSS variables for both themes from `docs/spec/design/base.css`, the type ramp, the status set) and `@svatah/ui` (React components on Radix primitives: button, field, select, pill, chip, table, tabs, rail item, inspector sections, alert, palette, kbd), every component requiring a visible label and an id; a component sheet page rendering all of them in both themes that the accessibility adapters can read.
**Validate:** The sheet passes an axe-core run with zero violations; every interactive component throws in development without a label and an id; the two themes differ only in tokens; the licence check stays permissive.

### T9.3 The SDK and the generated clients
**Refs:** REQ-SDK-1, REQ-SDK-2, LLD §13.8 · **Est:** 3
**Do:** `@svatah/sdk` generated from `packages/service/openapi.json` at build time (client, typed events over SSE and WebSocket, `actions` from `@svatah/screens`); Python and Java clients generated from the same description into `clients/python` and `clients/java` with their build files; a drift check that regenerates and diffs.
**Validate:** The SDK drives a fake-gateway record session end to end in a test (start, decision, accept, stop) and subscribes to its events; the Python and Java clients each run one smoke script against a live service (`GET /project`, `POST /run`, events) in CI; regenerating from a changed description fails the drift check.

### T9.4 The two renderers, two screens each
**Refs:** REQ-ADE-11, REQ-TUI-1, REQ-ADE-6, LLD §13.6, §13.7 · **Est:** 5
**Do:** The ADE shell rebuilt as top bar, rail, workspace, inspector, status bar, and palette on `@svatah/ui`, rendering `flows` (list, editor with lint, plan inspector) and `run` (live steps, audit, evidence) from the model; the other screens still reachable through the old tabs behind a "Legacy" rail item until Phase 10. `svatah ui` (`@svatah/tui`, Ink) rendering the same two screens with four panes, keys, and the palette; `--json`. Both open or adopt the service the same way. Apply the Phase 8 corrections to the desktop gate first (P8-F1..F3).
**Validate:** The packaged ADE opens the fixtures project into the new Flows screen, and the desktop suite's snapshot case finds every control on it named and id'd; a record and a run driven through the new Run screen's buttons under Playwright; `svatah ui` runs `comp` in a pseudo-terminal test and its `--json` output equals the model's state; the same action ids appear in both palettes.

### T9.5 Progress and the design record
**Refs:** LLD §13.7 · **Est:** 0.5
**Do:** `docs/spec/progress/phase-9.md`; where a mockup and the LLD disagreed, the deviation and the choice; screenshots of both renderers for the two screens, the ADE's taken through the AX adapter.
**Validate:** The two screenshots exist and match the mockups' structure; every deviation names its section.

Phase 9 total: 15.5 ideal days.

---

## Phase 10 — Builder surfaces, complete (Draft 2.11)

### T10.1 The authoring loop screens
**Refs:** REQ-ADE-10..13, REQ-TUI-1, LLD §13.7 · **Est:** 6
**Do:** `record` (session, decisions, re-pick through the snapshot, deadline), `runs` (list, filters, evidence inspector), `heal` (proposals, before and after, scores, apply), `bindings` (table, resolver order, verify, prune) on the model in both renderers, to the mockups.
**Validate:** Each screen driven end to end through its own controls in the ADE under Playwright and in `svatah ui` under a pseudo-terminal, against the fixtures project with the fake gateway; every control named and id'd; the palette lists every action of the four screens.

### T10.2 Agents and tools, API, Data, Explorer, Import, Settings
**Refs:** REQ-ADE-10..13, REQ-TUI-1, LLD §13.7 · **Est:** 5
**Do:** The remaining screens on the model in both renderers; the Secondary wireframes become full designs first, added to `docs/spec/design/` for the owner's review before they are built.
**Validate:** As T10.1; the explorer requires an intent per call and writes `trajectory.jsonl`; the import writes only into the open project.

### T10.3 Retire the old screens, re-validate the target
**Refs:** REQ-ADE-6, REQ-ADP-7, LLD §7.5, §16 · **Est:** 2
**Do:** Delete the legacy screens and `app.css`; update the desktop conformance cases to the new structure (rail items, inspector, palette) and the recorded trees; rebuild installers.
**Validate:** The macOS gate green live against the rebuilt packaged ADE, 7 of 7 plus healing; the snapshot case asserts zero unnamed controls; the ADE smoke passes on the three-OS matrix definition.

Phase 10 total: 13 ideal days.

---

## Phase 11 — Release 0.1.0 and the open P0 items (Draft 2.10, renumbered in 2.11)

### T11.1 The desktop gate, race-free and load-aware
**Refs:** REQ-ADP-7, REQ-SURF-3, LLD §7.5, §14 · **Est:** 1.5
**Do:** The gate waits until no process of the previous launch remains before launching the next variant; the bridge addresses the process that owns a window when several share the name; the cost line records the one-minute load average and the CPU count; a read that exceeds the deadline is retried once and the report says so; the CI desktop legs run nothing else on their runner.
**Validate:** Three consecutive gate runs on macOS, one started with `pnpm -r test` running in parallel, all conformant or failing only with a retried, recorded deadline; a test that fakes two same-named processes and shows the one with a window is chosen; the report's bridge line carries the load figures.

### T11.2 The compiler golden set at 300
**Refs:** REQ-COMP-9, LLD §16 · **Est:** 2.5
**Do:** Extend `evals/compiler/golden.jsonl` to at least 300 entries across every pattern and tier, drawing Tier 2 entries from `refused.jsonl` only where a reviewer has fixed the answer and moving them out of the corpus so the test set and the training set stay disjoint; regenerate `reports/eval-compiler.md`.
**Validate:** 300 or more entries; Tier 1 exact match 100 percent; end-to-end at least 95 percent with the pinned Tier 2 model; the corpus test still reports zero overlap with the golden set.

### T11.3 The ADE names every control, and the gate makes a run before it reads results
**Refs:** REQ-ADE-6, LLD §13.6, §16 · **Est:** 1.5
**Do:** Name the three unnamed buttons on the Project screen and any other interactive control the desktop snapshot case finds without a name; make the snapshot case fail on an unnamed interactive control; before `ade.result`, the gate runs one story against `apps/sample-web` through the Run screen so the results table branch is exercised (K6).
**Validate:** The live report's `ade.snapshot` asserts zero unnamed controls; `ade.result` reads a table with one run and its status; both green live.

### T11.4 The three-OS matrix observed
**Refs:** REQ-ADE-6, REQ-PKG-1, REQ-STD-2 · **Est:** 1 (plus the owner's action)
**Do:** Write `docs/ci.md` with the exact steps to attach a self-hosted macOS and Windows runner to the Bitbucket workspace, or to mirror the repository to GitHub where the matrix already exists; the owner chooses and attaches. Once a runner exists, run `custom: desktop-gates` and the `ade-installers` matrix and record the results.
**Validate:** The document, and either the observed pipeline runs with their reports, or the exact blocked step and what the owner has to do.

### T11.5 0.1.0 published and verified from the registry
**Refs:** REQ-PKG-1, 2, 4 · **Est:** 1.5 (plus the owner's action)
**Do:** The owner triggers `custom: publish` with the token. Add `scripts/quick-start-registry.mjs`, which installs the four module (a) packages by version from the registry into an empty Playwright project and runs the quick start; add a `CHANGELOG.md` release date and the git tag `v0.1.0`.
**Validate:** The registry quick start passes on Node 22 and the current LTS after the publish; until the owner publishes, the script runs in tarball mode and says so, and the tag is not created.

### T11.6 The Windows UIA gate (carried)
**Refs:** REQ-ADP-6, LLD §7.5 · **Est:** 2 (needs a Windows host)
**Do and Validate:** as T8.6. The Phase 8 corrections (gate race, load line, unnamed buttons) are applied in Phase 9, so T11.1 and T11.3 inherit them and re-verify.

Phase 11 total: 10 ideal days.

---

## Traceability matrix

| Requirement | HLD | LLD | Tasks |
|---|---|---|---|
| REQ-SURF-1, 4, 5 | §5.1 S1 | §2 | T0.4 |
| REQ-SURF-2 | §4 p2, §5.1 S2 | §1, §2.4 | T0.2, T0.4 |
| REQ-SURF-3 | §5.1 S9 | §14 | T1.2, T4.1, T6.1, T6.2 |
| REQ-ADP-1 | §5.1 S3 | §7.1 | T1.1 |
| REQ-ADP-2, 3 | §5.1 S4 | §7.2 | T2.6 |
| REQ-ADP-4 | §5.1 S5, ADR-8 | §7.3 | T4.1 |
| REQ-ADP-5 | §5.1 S6 | §7.4 | T4.2 |
| REQ-ADP-6, 7 | §5.1 S7, ADR-15, ADR-17 | §7.5 | T6.1, T6.2 |
| REQ-ADE-1 | §5.3 B12, §6.7 | §13.5 | T2.11 |
| REQ-ADE-2 | §5.3 B13, ADR-17 | §13.6 | T3.6 |
| REQ-ADE-3 | §5.3 B13, ADR-17 | §13.6 | T3.7 |
| REQ-ADE-4, 5 | §5.3 B13 | §13.6 | T5.7 |
| REQ-ADE-6 | §5.3 B13, §14 | §7.5, §16 | T6.1, T6.2 |
| REQ-ADE-7 | ADR-13, ADR-17 | §13.6 | T2.11, T3.6 |
| REQ-ADE-8 | §5.3 B13 | §13.6 | T5.8 |
| REQ-ADE-9 | §5.3 B10 | §13.5 | T6.6 |
| REQ-ADP-8 | §5.1 S7 | §7.5 | not scheduled (P3) |
| REQ-ADP-9 | §5.1 S8 | §6.3, §4.2 | T6.3 |
| REQ-ADP-10, 11 | ADR-8, ADR-14 | — | not scheduled (P3) |
| REQ-LANG-1..3, 9, 10, 13 | §5.3 B1 | §4.1 | T2.1 |
| REQ-LANG-4..7 | §5.3 B2 | §4.2 | T2.4 |
| REQ-LANG-8 | §5.3 B1, S4 | §4.2, §7.2 | T2.1, T2.6 |
| REQ-LANG-11 | §5.3 B10 | §11 (Draft 1) | T2.9 |
| REQ-LANG-12 | §13 Phase 0 | §4.2 | T0.6 |
| REQ-LANG-14 | §5.3 B2, §10 | §4.1, §8.2 | T2.1, T5.4 |
| REQ-LANG-15, 16 | ADR-10 | §5 | T2.3 |
| REQ-COMP-1, 2 | §5.3 B2, ADR-4 | §4 | T2.4, T2.5 |
| REQ-COMP-3 | ADR-4 | §4.3 (Draft 1), §10 | T3.1, T4.3 |
| REQ-COMP-4 | ADR-4 | §10 | T3.1, T4.4 |
| REQ-COMP-5 | §5.3 B2 | §4.3 | T2.2, T2.5 |
| REQ-COMP-6, 7, 8 | §4 p7 | §4, §3.2 | T2.5 |
| REQ-COMP-9 | §5.3 B11 | §16 | T0.6, T4.4 |
| REQ-REC-1, 5, 8, 9 | §5.3 B3 | §11 | T3.3 |
| REQ-REC-2, 7 | ADR-3, §11 | §11, §10 | T3.2, T3.1 |
| REQ-REC-3, 4 | §5.2 D4 | §7.4 (Draft 1), §3.3 | T1.4 |
| REQ-REC-6 | ADR-5 | §6.2 | T1.3 |
| REQ-REC-10 | §5.3 B11 | §16 | T3.4 |
| REQ-REC-11 | §6.2, ADR-11 | §6.5, §9.2 | T1.6, T3.3 |
| REQ-RUN-1, 2 | §4 p1, §11 | §1, §8 | T0.2, T2.7, T2.10 |
| REQ-RUN-3, 4, 6 | §10 | §8.1, §8.3, §8.5 | T2.7 |
| REQ-RUN-5 | §5.2 D3 | §6.3 | T1.3 |
| REQ-RUN-7, 8, 9 | §5.2 D6 | §3.4, §8.4, §8.6 | T2.7 |
| REQ-RUN-10 | §4 p9 | §7.1 | T1.1 |
| REQ-RUN-11 | §5.3 B9 | §15 | T4.5 |
| REQ-RUN-12 | ADR-9, §5.3 B5 | §9 | T2.8 |
| REQ-RUN-13 | ADR-9 | §8 | T2.7, T2.10 |
| REQ-AUTO-1, 2, 4 | ADR-12, §10 | §3.2, §3.4, §8.2, §8.3 | T0.3 (schema), T2.7 (runtime), T5.4 |
| REQ-AUTO-3 | §10 | §8.1 | T5.1 |
| REQ-AUTO-5 | §10 | §3.2, §8.1 | T0.3, T2.5, T2.7, T5.2 |
| REQ-AUTO-6 | §11 | §3.4, §8.6 | T0.3, T2.7, T5.3 |
| REQ-AUTO-7 | §11 | §11, §13.2 | T3.2, T5.2 |
| REQ-AUTO-8 | §5.3 B7 | §13.3, §4 lint | T2.5, T5.3 |
| REQ-BEH-1 | §5.3 B5 | §13.1 | T2.8 |
| REQ-BEH-2 | §5.3 B6 | §13.2 | T5.2 |
| REQ-BEH-3 | §5.3 B7 | §13.3 | T5.3 |
| REQ-BEH-4 | §5.3 B8, ADR-16 | §13.4 | T4.6, T5.5 |
| REQ-BEH-5 | §4 p4 | §13 | T2.10 |
| REQ-HEAL-1 | §5.2 D5, D7, ADR-6 | §6.4, §12 | T1.5, T1.7, T3.3 |
| REQ-HEAL-2, 3 | §5.2 D7 | §12 | T1.7 |
| REQ-HEAL-4 | ADR-6 | §12 | T3.3 (flag wiring), T2.7 |
| REQ-HEAL-5 | §5.3 B11 | §16 | T1.8, T3.4 |
| REQ-HEAL-6 | §6.2 | §6.5, §12 | T1.6, T1.7 |
| REQ-AGT-1 | §5.3 B9 | §15 | T1.6, T2.10, T3.3, T5.2, T5.3 |
| REQ-AGT-2 | §5.3 B9 | §15 | T4.6 |
| REQ-AGT-3 | §11 | §3.5, §10 | T0.3, T3.1 |
| REQ-AGT-4 | ADR-13 | — | T5.6 |
| REQ-PKG-1 | ADR-11, §12 | §1 | T0.2, T1.6, T1.9, T2.12 |
| REQ-PKG-2 | §14 | §6.5 | T1.6, T1.9 |
| REQ-PKG-3 | §8 | §1 | T0.2, T1.9 |
| REQ-PKG-4 | §5.3 B11 | §16 | T1.8, T3.4, T4.4 |
| REQ-STD-1, 4 | ADR-14, §5.2 D1 | §3 | T0.3 |
| REQ-STD-2 | §5.1 S9, §5.2 D9 | §14 | T1.2, T4.1, T6.4 |
| REQ-STD-3 | §13 Phase 6 | §14 | T6.4 |
| REQ-NFR-1 | §11 | §1, §8 | T0.2, T2.7 |
| REQ-NFR-2 | §11 | §10 | T3.1 |
| REQ-NFR-3 | §8 | §4.3 (Draft 1) | T4.3, T4.7 |
| REQ-NFR-4, 5 | §11 | §8 | T2.7 |
| REQ-NFR-6 | §11 | §10, §8.2 | T3.1, T1.1 |
| REQ-NFR-7 | §11 | §1 | T0.2 |
| REQ-NFR-8 | §13 Phase 2 | §16 | T0.5, T2.9, T2.10, T3.5 |
| REQ-NFR-9 | §5.3 B11 | §16 | all phases (CI gates) |
| REQ-NFR-10 | §8 | §1 | T0.2 |

## Estimate summary

| Phase | Ideal days | Releasable outcome |
|---|---|---|
| 0 | 11.5 | Foundation |
| 1 | 25 | `@svatah/bindings` 0.1 for Playwright users, with published healing numbers |
| 2 | 32.5 | Module (b) 0.1: prose flows, test behavior in Playwright Test; local service; module (a) CLI and replay plugin |
| 3 | 21.5 | Recorder with model grounding; full healing; published evals; new ADE shell and core screens |
| 4 | 22.5 | BiDi and Appium adapters; local and frontier tiers; REPL; MCP |
| 5 | 22 | Workflow and tool behaviors; trajectory compile; ADE record, bindings and heal review, surface explorer, tool panel |
| 6 | 33.5 | Desktop adapters validated against the ADE; prototype import; WebMCP; Java runtime; fine-tune |
| **Total** | **170.5** | |

## Changes from Draft 1

- Phases reordered: module (a) ships in Phase 1 before any flow language work; test behavior in Phase 2; recorder in Phase 3; independence adapters and tiers in Phase 4; automation behaviors in Phase 5; desktop, WebMCP, Java, fine-tune in Phase 6.
- New tasks: surface spec (T0.4), conformance suites (T1.2), `bind()` fixture (T1.6), model-free healer and published eval (T1.7, T1.8), module (a) release (T1.9), Tier 0 steps (T2.3), Playwright Test host (T2.8), BiDi adapter (T4.1), MCP raw surface and trajectory capture (T4.6), resume (T5.1), workflow (T5.2), tool server (T5.3), guards and compensation (T5.4), trajectory compiler (T5.5), desktop adapters (T6.1, T6.2), WebMCP (T6.3).
- Estimate grows from 91.5 to 146 ideal days; the first releasable module lands at day 36.5 instead of at the end of Phase 1.
- Draft 2.11 (builder surfaces, after the owner's design review): Phase 9 (foundation: screen model, design system, SDK, two screens in both renderers) and Phase 10 (every screen, retire the old ones) inserted; the release phase and its tasks renumbered 11 and T11.x. Total 239 ideal days.
- Draft 2.10 (after Phase 8 verification): Phase 9 added — T9.1 the desktop gate race-free and load-aware, T9.2 the golden set at 300, T9.3 named controls and a real run before results, T9.4 the three-OS matrix observed, T9.5 0.1.0 published by the owner and verified from the registry, T9.6 the Windows gate carried. Total 210.5 ideal days.
- Draft 2.9 (after Phase 7 verification): Phase 8 added — T8.1 the packaged ADE opens a project, T8.2 the AX bridge within budget and the macOS gate green, T8.3 dialog arming documented, linted, audited, T8.4 the fine-tune withdrawn and its corpus, T8.5 publish 0.1.0 by a manual token-gated step, T8.6 the Windows gate carried. Total 200.5 ideal days.
- Draft 2.8 (after Phase 6 verification): Phase 7 added — T7.1 AX live gate and desktop healing cases, T7.2 UIA live gate and the pipeline, T7.3 dialog IR and type check, T7.4 Java artifacts in the published schemas, T7.5 the fine-tune measured, T7.6 release candidate 0.1.0. Total 187 ideal days.
- Draft 2.4 (after Phase 2 verification): T3.6 builds the ADE under `apps/ade` in this repository.
- Draft 2.3 (after Phase 1 verification): T2.8 targets the new `host-playwright` package; T2.12 added for `bindings-cli` and the healer `Replayer` plugin. Total 170.5 ideal days.
- Draft 2.1: local service (T2.11); new ADE built to the vision with the prototype as blueprint: shell (T3.6), core screens (T3.7), record and heal review (T5.7), surface explorer and tool panel (T5.8), prototype data import (T6.6); T6.1 and T6.2 validate against the new ADE instead of a separate sample desktop app. Total 168.5 ideal days; module (a) release date unchanged.
