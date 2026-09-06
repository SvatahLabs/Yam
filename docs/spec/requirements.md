# Yam — Requirements Specification

Status: Draft 2.1 · Date: 2026-09-02 · Owner: Atul Sharma
Companion documents: [hld.md](hld.md) · [lld.md](lld.md) · [tasks.md](tasks.md)

Draft 2 re-baselines Draft 1 after the positioning review. Nothing from Draft 1 has been implemented, so IDs were allowed to move. The change log in §7 lists every change.

## 0. How to read this document

Every requirement has a stable ID (`REQ-<area>-<n>`), a priority, and a verification method. IDs are referenced from the HLD, LLD, and tasks; from Draft 2 onward do not renumber. Priorities: **P0** first usable release, **P1** following iteration, **P2** planned, **P3** possible.

Verification methods: **T** automated test, **E** eval suite with a numeric threshold and a published report, **R** review of an artifact, **D** demo.

## 1. Objective and positioning

Yam is a **deterministic automation runtime with a standard agent surface**. It lets a person or an agent describe a behavior once in plain language, compiles that description into a typed plan with element bindings by driving the target platform, and then replays the plan deterministically with no model in the loop, on any platform for which an adapter exists.

It is built in three layers:

1. **Surface.** A published, agent-native abstraction API (`snapshot` with stable references, `act` by reference, `read`, `check`, session state) implemented by adapters: Playwright, WebDriver BiDi, Appium, OS accessibility (Windows UI Automation, macOS Accessibility, Linux AT-SPI), HTTP, and WebMCP-declared site tools.
2. **Determinism.** The step IR, the bindings store with fingerprints, the resolver, model-free relocalization, provenance, checkpoints, and replay. This layer is the standard the project publishes.
3. **Behavior.** Plain-language flows compiled to plans. Three behaviors run on the same plan: **test** (expectations and a pass or fail oracle), **workflow** (guards, typed inputs and outputs, checkpoints, abort policy), and **tool** (a recorded flow exposed over MCP as a deterministic tool an agent calls instead of driving the platform itself).

What Yam is not: a testing tool as its identity, an RPA platform (no scheduler, queue, human-in-the-loop UI, or dashboard), a browser fork, or a per-step model agent.

Constraints stated by the owner:

1. No text tags or sigils in flows (the `+action+`, `~locator~`, `*data*`, and `$[key:value]$` forms are retired).
2. No locators of any kind in flows.
3. Bindings are recorded by executing the flow on the real platform, using a model on the first pass only.
4. The core moves to a stack where the surface, the model gateway, and the runner ecosystem are native; multi-language consumption comes from published schemas and foreign runtimes.
5. Pieces must be adoptable alone. The bindings and healing module for plain Playwright users ships first.
6. Testing is the first fully supported behavior because it has an oracle and a controlled environment, but the automation guarantees are in the contract from the start.
7. A desktop client, the Yam app (desktop app), is part of the offering. The existing prototype at `github.com/a-t-u-l/svatahADE` (Electron, spawning the Java service jar) is the blueprint of the jobs such a client must do: manage projects, author flows, run them, inspect results and screenshots, exercise APIs. The new app is designed to the three-layer vision around the new artifacts; none of the prototype's code, storage, or UI framework is a constraint. The app is an Electron application and doubles as the desktop application against which the OS accessibility adapters are validated.

## 2. Glossary

| Term | Meaning |
|---|---|
| Agent surface | The published abstraction API adapters implement: `snapshot`, `act`, `read`, `check`, session and navigation state. |
| Adapter | An implementation of the agent surface for one platform or protocol. |
| Flow file | A `.flow` text file with stories, compositions, and a run block. Unit of parallel execution. |
| Story / scenario | A named, ordered list of steps with an optional typed signature (inputs, outputs). Synonyms. |
| Composition | A named ordered list of story names (`compose:` block). |
| Run block | The `test:` (alias `run:`) block naming which stories or compositions execute, in order. |
| Step | One sentence. Compiles to exactly one IR step. |
| Target | The noun phrase naming an element ("the username field"). |
| Step IR | JSON representation of a compiled step; the contract between compiler, recorder, runtime, healer, behaviors, and foreign runtimes. |
| Plan | `plan.json`: compiled IR for every story, with provenance. |
| Binding | A resolved target: ranked locator candidates plus a structural fingerprint, keyed by element id and context. |
| Bindings store | Directory of YAML binding files, committed to the repo. |
| Recorder | Component that drives a plan on a platform and produces bindings, grounding unbound targets with a model. |
| Executor | Runtime core that replays a plan against bindings through an adapter, with no model. |
| Host | An integration that runs the executor inside another runner (first: Playwright Test). |
| Healer | Offline component that repairs bindings after a classified locator failure, model-free first, and emits a diff. |
| Guard | A predicate evaluated before a step acts; failure aborts per policy without side effects. |
| Checkpoint | Recorded step-level state sufficient to resume a flow from that step. |
| Abort policy | Per-flow rule on failure: `stop`, `compensate` (run a named flow), or `continue`. |
| Behavior | A way of running a plan: test, workflow, or tool. |
| Trajectory | The sequence of surface calls an agent made while exploring; compilable into a plan and bindings. |
| Tier 0 / 1 / 2 / 3 | Compiler stages: custom typed step definitions / controlled grammar / local small model / frontier model. |

## 3. Functional requirements

### 3.1 Agent surface and adapters (`REQ-SURF`, `REQ-ADP`)

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| REQ-SURF-1 | The agent surface is a published TypeScript interface and a language-neutral specification (JSON Schema for its message shapes) covering: `snapshot()` returning a semantic tree with stable element references, `act(action, ref, args)`, `read(kind, ref)`, `check(predicate, subject)`, navigation and session state, dialogs, windows and frames, files, and a `capabilities()` descriptor. | P0 | T, R |
| REQ-SURF-2 | Adapters are registered by name and selected by configuration; compiler, recorder, executor, healer, and behaviors depend only on the surface. An import-boundary check enforces this. | P0 | T |
| REQ-SURF-3 | A surface conformance suite (a fixed set of surface calls with expected snapshot shapes and effects on the sample application) validates every adapter; an adapter is "conformant" only when the suite passes. | P0 | T |
| REQ-SURF-4 | `snapshot()` output is normalised across adapters: roles, names, states, and a reference scheme with the same shape whether the source is ARIA, UIA, AX, AT-SPI, or Appium page source. | P0 | T |
| REQ-SURF-5 | The surface never exposes raw locators to callers above it; callers address elements by reference or by binding candidate. | P0 | R |
| REQ-ADP-1 | Playwright adapter (Chromium, Firefox, WebKit) is the default web adapter. | P0 | T |
| REQ-ADP-2 | HTTP adapter executes named requests with method, URL, headers, query and path params, form and JSON bodies, basic auth, cookies, redirects, TLS options, and file upload; responses are JSON-path addressable. | P0 | T |
| REQ-ADP-3 | HTTP calls from a web flow can share the session's cookies or not. | P0 | T |
| REQ-ADP-4 | WebDriver BiDi adapter drives stock Chrome, Edge, and Firefox with no patched builds; it proves the surface boundary and passes the conformance suite. | P1 | T |
| REQ-ADP-5 | Appium adapter targets Android Chrome and native Android; native bindings use accessibility id, resource id, and XPath candidates. | P1 | T |
| REQ-ADP-6 | Windows UI Automation adapter drives desktop applications; candidates are automation id, role plus name, and tree path. The conformance target is the new Yam Electron application. | P2 | T |
| REQ-ADP-7 | macOS Accessibility adapter with the same candidate kinds; documents the accessibility permission grant. Conformance target as REQ-ADP-6. The adapter snapshots the app's project screen within the surface's default deadline, and its conformance report records nodes read and milliseconds per node (Draft 2.8). | P2 | T |
| REQ-ADP-8 | Linux AT-SPI adapter. | P3 | T |
| REQ-ADP-9 | WebMCP-aware behaviour: when a page declares tools, the recorder may store a `webmcp` candidate and the executor prefers it over locators for that binding. | P2 | T |
| REQ-ADP-10 | A `process` adapter drives a command in a pseudo-terminal or an attached one: the screen, the streams, the exit code, and files under a configured root are the surface; keystrokes, commands, and signals are the actions; it never reads outside its root or prints a secret handed to it (Draft 2.16). | P1 | T |
| REQ-ADP-10 | An external frozen-step browser (for example an ABP-style build) can be wrapped as an adapter; no browser is forked or vendored in this project. | P3 | R |
| REQ-ADP-11 | Selenium / WebDriver classic adapter is possible but not scheduled. | P3 | — |

### 3.2 Flow language (`REQ-LANG`)

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| REQ-LANG-1 | A flow file consists of blocks introduced by `story:`, `scenario:`, `compose:`, `test:` or `run:` followed by a name; a block ends at a blank line or the next header. Story and scenario names are unique per project. | P0 | T |
| REQ-LANG-2 | Headers accept metadata in parentheses before the colon: `enabled`, `dataProvider`, `filePath`, `continueOnFailure`, `tags`, `onFailure` (`stop|compensate:<flow>|continue`), `idempotent`. | P0 | T |
| REQ-LANG-3 | `//` and `#` comment lines; indentation ignored. | P0 | T |
| REQ-LANG-4 | A step is one plain-language sentence with no sigils, locator strings, or locator-type prefixes; any such pattern is a compile error pointing at `migrate`. | P0 | T |
| REQ-LANG-5 | Literal values are double-quoted. | P0 | T |
| REQ-LANG-6 | Variables use braces: `{name}` same story, `{Story name.name}` another story in the flow, `{data.key}` run-level data, `{input.name}` a story input. Replaces `#var#`, `#story.var#`, `$key`. | P0 | T |
| REQ-LANG-7 | Capture with `… as <name>` or `Remember <target> as <name>`. Replaces `var : name` and `var(type) : name`. | P0 | T |
| REQ-LANG-8 | API steps reference named requests in `api/`: `Call the "active count" API and remember the response as activeCount`. | P0 | T |
| REQ-LANG-9 | Run-level data comes from `data.yaml` (or JSON) and `YAM_DATA_*` environment variables; secrets by `${ENV}` indirection under a `secrets:` list. | P0 | T |
| REQ-LANG-10 | `compose:` expands in place; the run block defines execution order for the flow. A run block with no lines runs the story or composition of its own name. A flow with no run block runs its `scenario` blocks in file order and its `story` blocks not at all, matching the legacy parser. | P0 | T |
| REQ-LANG-11 | `migrate` converts v1/v2 flows, `.locator`, and `.data` files into v3 flows, a seed bindings store, and `data.yaml`, preserving names and step order. | P0 | T, R |
| REQ-LANG-12 | A grammar reference documents every sentence pattern with at least two examples and every IR action. | P0 | R |
| REQ-LANG-13 | A story may declare a typed signature: `inputs:` and `outputs:` lines directly under the header, each `name: type [= default]` with types `string|number|boolean|json|secret`. Outputs must be captured names. | P0 | T |
| REQ-LANG-14 | Guard sentences: `Only if <predicate>` and `Unless <predicate>` prefix a step or stand alone before a step; a failed guard aborts per the flow's `onFailure` policy without performing the step. | P1 | T |
| REQ-LANG-15 | Custom typed step definitions (Tier 0): a `steps/` directory of TypeScript files exporting `defineStep(pattern, handler)` where `pattern` is a sentence template with typed placeholders and `handler` receives the surface, resolved args, and scope. Custom steps compile to an IR step with `action: "custom"` and are matched before the grammar. | P0 | T |
| REQ-LANG-16 | Every sentence compiles to exactly one step; ambiguity between a custom step and a grammar pattern is a compile error naming both. | P0 | T |

### 3.3 Intent compiler (`REQ-COMP`)

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| REQ-COMP-1 | Each step yields exactly one IR step or a compile error; every step records tier of origin and confidence. | P0 | T |
| REQ-COMP-2 | Tier 1 is a deterministic controlled grammar over the full action set with the existing synonym vocabulary; offline; 1,000 steps in under 1 s. | P0 | T, E |
| REQ-COMP-3 | Tier 2 is a local 1.7B to 4B instruct model with output constrained to the IR JSON Schema, temperature 0, fixed seed, pinned digest in provenance. | P1 | T, E |
| REQ-COMP-4 | Tier 3 is a frontier model used only when configured and only for Tier 2 residue; prompt versioned in provenance. | P1 | T |
| REQ-COMP-5 | Target phrases resolve to element ids through a project target dictionary; unknown targets are `unbound` for the recorder. | P0 | T |
| REQ-COMP-6 | Variable and input validation: every reference is defined earlier by order; inputs without defaults must be supplied at run; outputs must be captured. Violations are compile errors. | P0 | T |
| REQ-COMP-7 | `plan.json` is byte-stable for identical inputs. | P0 | T |
| REQ-COMP-8 | `lint` reports ambiguous targets, Tier 2/3 steps, low confidence, unused captures, sleeps over 5 s, side-effecting steps in stories not marked `idempotent` when used as tools. | P0 | T |
| REQ-COMP-9 | Compiler golden set of at least 300 pairs; Tier 1 exact match 100 percent on its subset; end-to-end at least 95 percent; report published per release. | P0 | E |

### 3.4 Recorder and bindings (`REQ-REC`)

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| REQ-REC-1 | The recorder executes a plan on an adapter, grounds each `unbound` target once, and writes bindings; bound targets are reused unless `--rebind`. | P0 | T, D |
| REQ-REC-2 | Grounding uses the surface `snapshot()` (semantic tree with references) as the primary model input; screenshots only as a configured fallback when no candidate is found. | P0 | T |
| REQ-REC-3 | Candidate synthesis is model-free and produces a ranked list per adapter kind; candidates matching more than one element are dropped. | P0 | T |
| REQ-REC-4 | A structural fingerprint is stored per binding entry: tag or control type, selected attributes, own text, neighbour text, ancestor role path, bounding box, sibling index. | P0 | T |
| REQ-REC-5 | The recorder performs the step with the top candidate and verifies any expectation before committing; failure stops the session with a report. | P0 | T |
| REQ-REC-6 | Bindings are scoped by context (URL or window pattern plus a structural hash of the surrounding subtree); different contexts are separate entries. | P0 | T |
| REQ-REC-7 | The recorder never handles credentials; sessions are injected (storage state, environment session); secrets are `{data.*}` values injected by the executor and never sent to a model. | P0 | T, R |
| REQ-REC-8 | A record report lists per step the snapshot size, decision, tokens, cost, and chosen candidate. | P0 | T |
| REQ-REC-9 | Recorder output is plain files inside the project directory, suitable for a pull request. | P0 | R |
| REQ-REC-10 | Grounding eval of at least 150 cases; accuracy at least 95 percent on the sample application; report published. | P1 | E |
| REQ-REC-11 | Bindings can be recorded for plain host tests without any flow file: `bind("page.element")` in a Playwright test triggers recording on first use in record mode and resolves from the store in run mode. | P0 | T, D |

### 3.5 Runtime executor (`REQ-RUN`)

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| REQ-RUN-1 | The executor makes no model calls; the runtime packages cannot import the model gateway (build-time check). | P0 | T, R |
| REQ-RUN-2 | Same plan, bindings, data, and application state yield the same step outcomes on two runs. | P0 | T |
| REQ-RUN-3 | Flows run in parallel up to a worker count; stories within a flow are sequential; each flow owns one session on its adapter. | P0 | T |
| REQ-RUN-4 | Default failure semantics: remaining steps and stories in the flow are `skipped`; `continueOnFailure` and `onFailure` policies override. | P0 | T |
| REQ-RUN-5 | Resolution tries candidates in order with a per-candidate timeout, requires exactly one match, and reports every candidate tried on failure. | P0 | T |
| REQ-RUN-6 | Variable scoping: run data read-only and global; captures scoped to the flow and namespaced by story; inputs scoped to the story. | P0 | T |
| REQ-RUN-7 | Each step records identifiers, timing, status (`passed|failed|skipped|healed|aborted`), matched candidate, screenshot on failure (or always), and failure class. | P0 | T |
| REQ-RUN-8 | Failure classes: `locator`, `timeout`, `assertion`, `guard`, `data`, `navigation`, `dialog`, `script`, `infrastructure`, `unknown`. | P0 | T |
| REQ-RUN-9 | A run directory holds `results.jsonl`, `summary.json`, `audit.jsonl`, screenshots, and adapter traces; exit code is non-zero on failure, healed, or aborted. | P0 | T |
| REQ-RUN-10 | Every action in the existing Selenium vocabulary has an implementation on the Playwright adapter. | P0 | T |
| REQ-RUN-11 | REPL: one sentence at a time against an open session, appended to a session flow and bindings. | P1 | D |
| REQ-RUN-12 | Playwright Test host: for web test behavior, the executor runs inside Playwright Test through a generated spec per flow and a fixture, inheriting fixtures, projects, sharding, retries, reporters, and the trace viewer. Results are additionally written in the Yam schema. | P0 | T, D |
| REQ-RUN-13 | The runtime core is runner-agnostic and usable standalone (workflow and tool behaviors, non-web adapters). | P0 | T |

### 3.6 Automation guarantees (`REQ-AUTO`)

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| REQ-AUTO-1 | Guards: an `expect` predicate may be attached to a step as a precondition; the executor evaluates it before acting and never performs the action if it fails. | P0 schema, P1 runtime | T |
| REQ-AUTO-2 | Checkpoints: after each step the executor records a checkpoint (step id, scope snapshot, session URL or window, captured values) sufficient to resume. | P0 schema, P1 runtime | T |
| REQ-AUTO-3 | Resume: `run --resume <runId> --from <stepId>` continues a flow from a checkpoint with the same plan and bindings hash; mismatch is refused. | P1 | T |
| REQ-AUTO-4 | Abort policy per flow: `stop` (default), `compensate:<flow>` (run the named flow with the current scope, then stop), `continue`. Recorded in results as `aborted` with the policy applied. | P0 schema, P1 runtime | T |
| REQ-AUTO-5 | Typed inputs and outputs: a story with a signature is invocable as a function; inputs are validated by type before execution; outputs are returned in the result and available to callers. | P0 | T |
| REQ-AUTO-6 | Audit log: `audit.jsonl` records invoker identity (user, CI job, or agent id), inputs (secrets redacted), every surface call with reference and outcome, and outputs. | P0 | T |
| REQ-AUTO-7 | Environment policy: config declares `environment: test|staging|production`; production requires `idempotent` or an explicit `allowSideEffects` on each flow run; recording is refused against production unless overridden. | P1 | T, R |
| REQ-AUTO-8 | Side-effect declaration: stories may be marked `idempotent`; lint warns when a non-idempotent story is exposed as a tool. | P1 | T |

### 3.7 Behaviors (`REQ-BEH`)

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| REQ-BEH-1 | Test behavior: flows with expectations produce a pass or fail oracle, run in the Playwright Test host for web and in the standalone runtime for other adapters. | P0 | T |
| REQ-BEH-2 | Workflow behavior: a story with a signature runs as a function with guards, checkpoints, abort policy, and outputs; `yam workflow run <story> --input k=v` returns outputs as JSON. | P1 | T, D |
| REQ-BEH-3 | Tool behavior: `yam tool serve` exposes selected stories over MCP as tools whose schema derives from the story signature; each invocation is a deterministic run with an audit record; no model is involved in execution. | P1 | T, D |
| REQ-BEH-4 | Trajectory compiler: an agent's exploration over the surface (a recorded sequence of surface calls with the agent's stated intent per call) compiles into a story draft, a plan, and bindings, written to `proposals/` for review. Replaces the standalone explorer. | P2 | D |
| REQ-BEH-5 | Behaviors share one plan; switching behavior never requires recompiling or re-recording. | P0 | T |

### 3.8 Healer (`REQ-HEAL`)

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| REQ-HEAL-1 | The healer consumes a run, selects `locator` failures, and repairs by fingerprint relocalization first (no model), then one model re-grounding call per element if configured. | P0 relocalize, P1 model | T |
| REQ-HEAL-2 | Repairs are a diff to the bindings store plus a report; plan and flows are never modified. | P0 | T, R |
| REQ-HEAL-3 | A repaired binding is verified by re-running the failed story before inclusion. | P0 | T |
| REQ-HEAL-4 | Heal-on-fail during a run is behind a policy flag, off by default, and marks the run `healed`, never `passed`. | P1 | T |
| REQ-HEAL-5 | Healing eval over at least 20 deliberate UI changes; relocalization alone at least 60 percent, with one model call at least 85 percent; results published per release with the method. A repair counts as recovered only when the repaired binding resolves to the ground-truth element; the denominator is bindings that lost at least one candidate, with bindings that stopped resolving entirely reported alongside. | P0 relocalize, P1 model | E |
| REQ-HEAL-6 | Healing works for bindings used from plain host tests (REQ-REC-11) without a flow file. | P0 | T |

### 3.9 Agentic surface (`REQ-AGT`)

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| REQ-AGT-1 | CLI: `compile`, `lint`, `record`, `run`, `heal`, `migrate`, `repl`, `eval`, `bindings`, `workflow`, `tool`, `surface` (interactive surface calls for agents), with `--json`. | P0 | T |
| REQ-AGT-2 | MCP server exposes the CLI operations and the raw agent surface (`snapshot`, `act`, `read`, `check`) so external agents can explore through Yam and have trajectories captured. | P1 | D |
| REQ-AGT-3 | Every model-produced artifact carries provenance: model id or digest, prompt version, timestamp, tokens, cost, cache hit. | P0 | T |
| REQ-AGT-4 | Orchestration is external: the project ships examples for CI, cron, and an MCP-driven agent, and no scheduler, queue, or UI of its own. | P0 | R |

### 3.10 Packaging and adoption (`REQ-PKG`)

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| REQ-PKG-1 | Three independently installable modules: (a) bindings and model-free healing for plain Playwright Test users, (b) flow language, compiler, recorder, and behaviors, (c) schemas, surface spec, and foreign runtimes. Module (a) has no dependency on (b). | P0 | T, R |
| REQ-PKG-2 | Module (a) is usable in an existing Playwright project by adding one dependency and one fixture; documented quick start under ten minutes. | P0 | D |
| REQ-PKG-3 | All dependencies permissive (MIT, Apache-2.0, BSD); the project itself Apache-2.0. | P0 | R |
| REQ-PKG-4 | Published evals: compiler, grounding, healing, and adapter conformance results are generated per release and published with the release notes. | P0 | R |

### 3.11 Standard and multi-language (`REQ-STD`)

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| REQ-STD-1 | IR, bindings, results, audit, checkpoint, config, and surface message schemas are JSON Schema files versioned with `schemaVersion` and published. | P0 | T |
| REQ-STD-2 | Adapter conformance suite (REQ-SURF-3) and runtime conformance suite (plans plus bindings plus expected results) are published and runnable by third parties. | P0 | T |
| REQ-STD-3 | A foreign runtime (first: Java on Playwright for Java) executes `plan.json` and bindings without the TypeScript compiler and passes the runtime conformance suite; its `results.jsonl` and `summary.json` validate against the published schemas, and the suite checks that before it compares (Draft 2.8). | P2 | T |
| REQ-STD-4 | Provenance is mandatory on every model-produced artifact; schema validation rejects artifacts without it. | P0 | T |

### 3.12 Desktop client and local service (`REQ-app`)

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| REQ-ADE-1 | The core exposes a local service (`yam serve`) over HTTP plus an event stream (WebSocket or SSE) covering: project discovery, compile and lint, record, run with live step events, results, audit and screenshots, bindings read and verify, heal, API client requests, and raw surface calls. The service is the only integration point for the app and for any other client; the app is its reference client. | P1 | T |
| REQ-ADE-2 | The app is a new Electron application (current LTS, context isolation, no `nodeIntegration`, preload bridge) that bundles or locates the CLI, spawns or connects to the local service, and has no storage of its own beyond UI preferences. The project directory is the only source of truth; anything the app shows is a file the CLI also reads or writes. | P1 | R, T |
| REQ-ADE-3 | The app covers the prototype's jobs, redesigned around the new artifacts: project open and init; prose flow editor with live lint and Tier 0 step discovery; plan view per story (compiled steps, tier, confidence, unbound targets); run with live step events, screenshots, and audit; results history read from `runs/`; API client backed by the HTTP adapter with save-to-`api/`; data editor for `data.yaml` with secrets masked. | P1 | D, T |
| REQ-ADE-4 | Record with review: a record session streams grounding decisions; the app shows the snapshot excerpt, chosen reference, candidate bundle, and fingerprint per target, with accept, re-pick by clicking in the driven session, or reject, before bindings are written. The screen chooses the gateway (a credentialed model or the committed fake answers, labelled as such) and shows a failed session as an alert with advice a screen user can act on. | P2 | D |
| REQ-ADE-5 | Bindings and healing review: a bindings browser with context entries and dry-resolve status; a heal review that shows a proposed diff with before and after candidates and applies it on accept. | P2 | D |
| REQ-ADE-6 | The app enables Chromium accessibility support so its own UI is drivable by the UIA and AX adapters; Yam flows against the app (open project, edit flow, run, open result, API client) form the desktop conformance suite. The desktop conformance target is the **packaged** app, which must open a project on every supported host with a Node runtime resolved as LLD §13.6 states; the gate opens the fixtures project without a dialog (Draft 2.9). | P2 | T |
| REQ-ADE-7 | The app remains a local developer client. It has no scheduler, queue, multi-user server, or dashboard role (consistent with REQ-AGT-4). | P0 | R |
| REQ-ADE-8 | Agent workbench: a surface explorer that drives any adapter session step by step with `intent` recorded, and a tool panel that exposes stories over MCP from the app and shows tool invocations with their audit records. | P2 | D |
| REQ-ADE-9 | Prototype data import: a one-time import of an existing prototype database (projects, flows, locators, data, API requests) into a project directory, through `migrate --from-prototype`. Results and screenshots from the prototype are not imported. | P2 | T |
| REQ-ADE-10 | The app is one of two renderers of a headless screen model (`@svatah/yam-screens`) whose screens, actions, and keys are shared with the terminal cockpit; an action exists once, with one name, in the palette, the TUI, the SDK, and the CLI, and a repository check asserts it (Draft 2.11). | P1 | T, R |
| REQ-ADE-11 | The app is organised as a left rail (Flows, Runs, Bindings, Agents and tools; API, Data; Import, Settings), a centre workspace, and a right inspector, with a command palette on ⌘K; every one of the former eleven screens has exactly one home; the approved mockups under `docs/spec/design/` are the visual reference (Draft 2.11). | P1 | R, D |
| REQ-ADE-12 | The app is built on a design system (`@svatah/yam-ui-tokens`, `@svatah/yam-ui` on Radix primitives): dark-first with a light theme, one accent, status colours never without a word or glyph, and every interactive control carrying a visible label that is its accessible name and a stable id (Draft 2.11). | P1 | T, R |
| REQ-ADE-13 | Every screen's state is available as JSON through the service and the SDK; nothing exists only in a UI, so an agent can use the same screens through the service or through the accessibility adapters (Draft 2.11). | P1 | T |
| REQ-TUI-1 | `yam ui` is a full authoring cockpit in the terminal: a standalone Ink application over the local service rendering the same screen model as the app, with numbered panes, the same actions and keys, the same command palette, and a `--json` mode that streams screen state and audit lines for agents; no tmux dependency (Draft 2.11). | P1 | T, D |
| REQ-SDK-1 | `@svatah/yam-sdk` is a typed TypeScript client generated from the service's OpenAPI description, with typed event subscription and the screen model's actions runnable out of process; drift between the description and the client fails the build (Draft 2.11). | P1 | T |
| REQ-SDK-2 | Python and Java clients are generated from the same description, published with the release, and versioned with it (Draft 2.11). | P1 | T, R |
| REQ-SELF-1 | Yam verifies itself: `evals/self` holds prose flows that drive the sample application, the packaged app through the desktop adapters, the local service through the HTTP adapter, and the cockpit through its JSON mode; a phase is not accepted until the suite is green (Draft 2.14). | P1 | T, E |
| REQ-SELF-2 | Every self check has an independent external implementation; `yam eval self` runs both sides and publishes agreement, coverage per side, and every disagreement and one-sided check; the gate requires 100 percent agreement on the checks both sides reach, and one-sided checks are published as Yam's own shortcomings (Draft 2.14). | P1 | E, R |
| REQ-SELF-3 | Three oracles stay external by design: the healing eval's ground-truth keys, axe-core on the component sheet, and the renderer-versus-adapter tree agreement (Draft 2.14). | P1 | T, R |
| REQ-SELF-4 | The catalogue schema, the source runners, the comparison, and the report are a published package, `@svatah/yam-verify`, and `yam eval self --catalogue <file>` runs any project's catalogue, so a third party gates its own application two-sidedly with the same rules (Draft 2.16). | P1 | T, R |

## 4. Non-functional requirements

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| REQ-NFR-1 | Determinism: replay has no network dependency other than the target platform. | P0 | T |
| REQ-NFR-2 | Cost: model usage confined to `compile` (Tier 2/3), `record`, `heal`, and trajectory compile; estimated and actual tokens and cost printed per invocation. | P0 | T |
| REQ-NFR-3 | Privacy: Tier 3 can be disabled and Tier 2 local so no step text leaves the machine during compile; local-only recording is P2. | P1 | T |
| REQ-NFR-4 | Performance: executor overhead under 5 ms per step excluding adapter time; resolution of a valid first candidate is one query. | P1 | T |
| REQ-NFR-5 | Observability: JSON-lines logs with run, flow, story, step ids; optional OpenTelemetry. | P1 | T |
| REQ-NFR-6 | Security: secrets never appear in plan, bindings, results, audit, traces, or prompts; screenshots of secret-injecting steps are masked. | P0 | T, R |
| REQ-NFR-7 | Portability: macOS, Linux, Windows on Node 22 LTS; CI examples for GitHub Actions. Desktop adapters document their host requirements. | P0 | T |
| REQ-NFR-8 | Compatibility: migrated `simple.flow`, `svatah.flow`, `execution.flow`, `natural_language_login.flow` run end to end against the sample application. | P0 | T |
| REQ-NFR-9 | Quality gates: unit coverage at least 80 percent on compiler, resolver, executor, bindings; eval thresholds enforced in CI. | P0 | T, E |
| REQ-NFR-10 | Licensing as REQ-PKG-3. | P0 | R |

## 5. Explicit non-goals

- An RPA platform: scheduling, queues, human-in-the-loop UI, dashboards. Orchestration is external. The app is a local developer client, not a platform.
- A browser fork or vendored browser build.
- A new transport protocol competing with CDP, WebDriver BiDi, or WebMCP.
- Training a transformer from scratch. Fine-tuning a small pretrained model on accepted pairs is in scope (P2).
- Screenshot-based grounding as the primary strategy.
- Per-step model execution at run time.
- Supporting v1/v2 syntax at run time; `migrate` only.

## 6. Traceability

Each requirement is referenced by at least one HLD section, one LLD section, and one task, or is explicitly marked unscheduled in the matrix at the end of [tasks.md](tasks.md).

## 7. Change log from Draft 1

- Objective rewritten from "two-phase testing library" to "deterministic automation runtime with a standard agent surface"; three layers and three behaviors introduced.
- New groups: `REQ-SURF` (agent surface), `REQ-AUTO` (automation guarantees), `REQ-BEH` (behaviors), `REQ-PKG` (packaging and adoption), `REQ-STD` (standard and multi-language; absorbs former `REQ-X`).
- `REQ-ADP` expanded: BiDi (P1), Appium (P1), Windows UIA (P2), macOS AX (P2), Linux AT-SPI (P3), WebMCP candidate (P2), external frozen-step browser as adapter (P3), Selenium (P3). No browser fork.
- `REQ-LANG-13..16` added: story signatures, guard sentences, Tier 0 custom typed steps, ambiguity rule.
- `REQ-REC-11` and `REQ-HEAL-6` added: bindings and healing for plain Playwright tests (the adoption wedge).
- `REQ-RUN-12` and `REQ-RUN-13` added: Playwright Test host; runner-agnostic core.
- `REQ-RUN-7/8` extended with `aborted` status and `guard` failure class; `REQ-RUN-9` adds `audit.jsonl`.
- `REQ-COMP-8` lint extended with idempotency and long sleeps.
- `REQ-AGT-3` (explorer) replaced by `REQ-BEH-4` (trajectory compiler); `REQ-AGT-4` now states external orchestration.
- Healing evals and all evals must be published per release (`REQ-PKG-4`, `REQ-HEAL-5`).
- Priorities reordered so the bindings module (module a) is P0 and ships first.
- Draft 2.7 (after Phase 5 verification): `REQ-ADE-4` requires a gateway choice and screen-appropriate failure advice.
- Draft 2.8 (after Phase 6 verification): `REQ-STD-3` requires a foreign runtime's artifacts to validate against the published schemas; `REQ-ADP-7` requires the macOS adapter to snapshot the app's project screen within the surface deadline and to publish its read cost. Phase 7 (hardening and release candidate) added to the delivery plan; no new requirement ids.
- Draft 2.9 (after Phase 7 verification): `REQ-ADE-6` names the packaged app as the conformance target and requires it to open a project on every supported host; ADR-4's fine-tune target is recorded as not met for 0.1.0 (measured 86.8 % → 13.2 %) and a Tier 2 corpus is its precondition. Phase 8 (ship) added to the delivery plan; no new requirement ids.
- Draft 2.10 (after Phase 8 verification): no requirement text changes. `REQ-ADP-7`'s budget is met live (589 nodes in about 1 s on a quiet machine) and the cost line gains load average and CPU count (LLD §7.5); `REQ-COMP-9`'s 300-entry golden set is the one P0 item still short (222) and is Phase 9's T9.2. Phase 9 (release 0.1.0 and the open P0 items) added to the delivery plan.
- Draft 2.11 (builder surfaces, after the owner's design review of 2026-09-05): `REQ-ADE-10..13`, `REQ-TUI-1`, `REQ-SDK-1..2` added; Phase 9 (builder surfaces foundation) and Phase 10 (builder surfaces complete) inserted; the release phase becomes Phase 11.
- Draft 2.12 (after Phase 9 verification): no requirement text changes; T10.4 added for the verification's corrections and the run-stop route.
- Draft 2.13 (after Phase 10 verification): no requirement text changes; T11.7 added for the verification's corrections, the windowless-launch diagnosis, and the editing work a release needs.
- Draft 2.14 (Yam verifies Yam): `REQ-SELF-1..3` added; Phase 11 becomes corrections plus the self-verification suite and parity gate; the release moves to Phase 12.
- Draft 2.15 (after Phase 11 verification): no requirement text changes; T12.7 added to close the one-sided list's language gaps and the verification's three findings before the release.
- Draft 2.16 (process and terminal): `REQ-ADP-10` and `REQ-SELF-4` added; Phase 13 added after the release.
- Draft 2.19 (the desktop client is Yam, owner decision of 2026-09-06): the Electron client is no longer called the ADE; it is **Yam** — `Yam.app`, bundle id `com.svatah.yam`, package `@svatah/yam-desktop` under `apps/desktop` — and prose says "the app". The `REQ-ADE-*` ids keep their letters, as §0 requires; the prototype-database import is `--from-prototype`. No requirement text changes.
- Draft 2.18 (Yam, owner decisions of 2026-09-06): no requirement text changes; the product is named Yam under the Svatah brand and the `@svatah` scope, the frozen Java project leaves the repository, and the repository moves to `github.com/SvatahLabs/yam`; Phase 13 inserted for that work, process and terminal renumbered to Phase 14.
- Draft 2.17 (after Phase 12 verification): no requirement text changes; T13.2 extended with the sentences that close the last non-oracle one-sided checks; 0.1.0 accepted for the owner's validation.
- Draft 2.4 (after Phase 2 verification): `REQ-LANG-10` states the run-block semantics inherited from the legacy parser.
- Draft 2.3 (after Phase 1 verification): `REQ-HEAL-5` defines recovery against the ground-truth element and the denominator.
- Draft 2.1: `REQ-ADE-1..9` added for the local service and a new Yam Electron client designed to the vision, with the prototype as the blueprint of jobs only; the app is the desktop conformance target for `REQ-ADP-6/7`; constraint 7 added.
