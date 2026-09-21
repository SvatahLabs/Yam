# Yam — High-Level Design

Status: Draft 2.25 · Date: 2026-09-07
Companion documents: [requirements.md](requirements.md) · [lld.md](lld.md) · [tasks.md](tasks.md) · [surface-first spec](surface-first/README.md)

## 1. Purpose and scope

This document describes the system that satisfies [requirements.md](requirements.md) Draft 2.25: a deterministic automation runtime whose primary journey is **connect → inspect → act → verify** against a live target, for a person and for an agent, with no project, flow, binding, plan or model credential required for direct control. The surface layer operates independently; flows and runs build on it as optional automation. It covers positioning, context, component decomposition by layer, data flows, artifact contracts, technology choices, architecture decisions, execution model, cross-cutting concerns, repository layout, delivery phases, and risks. Interface-level detail is in the LLD.

## 2. Positioning in one figure

```
 PRIMARY JOURNEY: connect → inspect → act → verify (no project, flow or model needed)

 ┌──────────── SURFACE CONTROL (independent, projectless) ─────────┐
 │   connect · snapshot · act · read · check · close                 │
 │   session lifecycle · target identity · shared operation dispatch  │
 ├──────────────────────────── BEHAVIOR ────────────────────────────┤
 │   test (oracle)        workflow (function)        tool (MCP)      │
 │   Playwright Test host · standalone runtime · trajectory compiler │
 ├──────────────────────── DETERMINISM (the standard) ──────────────┤
 │   flow → plan.json · bindings/ · resolver · relocalization        │
 │   checkpoints · audit · provenance · conformance suites            │
 ├──────────────────────────── SURFACE ─────────────────────────────┤
 │   snapshot(refs) · act(ref) · read · check · session               │
 │   Playwright │ BiDi │ Appium │ UIA │ AX │ AT-SPI │ HTTP │ WebMCP   │
 └──────────────────────────────────────────────────────────────────┘
        model calls: compile residue · record grounding · heal · trajectory compile (never at replay)
```

## 3. Context

External systems: the target platform (web app, mobile app, desktop app, HTTP service); the platform driver behind each adapter (Playwright browsers, a BiDi-capable stock browser, an Appium server, OS accessibility APIs); an optional local model server; the Anthropic API for Tier 3, grounding, and healing; the CI system or external orchestrator that invokes replay; and external agents that call Yam over MCP either to run tools or to explore through the surface.

Actors: authors (people or agents) who write flows or explore; reviewers who approve plans, bindings, and heal diffs in pull requests; operators who invoke runs from CI, cron, or an agent; foreign-runtime implementers who consume the published schemas.

## 4. Architectural principles

1. **Artifacts, not sessions.** Every model decision is a committed, diffable file. Replay reads files only. (REQ-RUN-1, REQ-AGT-3)
2. **The surface is the only way down.** Nothing above the surface knows a locator, a protocol, or a platform. (REQ-SURF-2, REQ-SURF-5)
3. **The determinism layer is the standard.** Schemas, conformance suites, and provenance are published; adapters and runtimes are interchangeable against them. (REQ-STD-*)
4. **Testing is a behavior, not the identity.** Guards, checkpoints, abort policy, typed signatures, and audit are in the contract from the first schema version even though test behavior ships first. (REQ-AUTO-*, REQ-BEH-5)
5. **Adopt the runner, do not replace it.** Web test behavior runs inside Playwright Test; the core stays runner-agnostic for everything else. (REQ-RUN-12, REQ-RUN-13)
6. **Pieces adoptable alone.** The bindings and model-free healing module works in a plain Playwright project with no flow language. (REQ-PKG-1, REQ-PKG-2)
7. **Fail at authoring, not at replay.** Ambiguity, unbound targets, unsatisfiable expectations, undefined variables, and type errors are rejected by `compile` or `record`. (REQ-COMP-1, REQ-COMP-6, REQ-REC-5)
8. **No platform, no fork, no transport.** Orchestration is external; browsers are consumed, not built; CDP, BiDi, and WebMCP are used, not replaced. (REQ-AGT-4, REQ-ADP-10)
9. **Keep what works.** The execution model (one session per flow, flows parallel, stories sequential, fail-fast per flow) and the 65-action vocabulary carry over from the Java framework. (REQ-RUN-3, REQ-RUN-10)

## 5. Components by layer

### 5.1 Surface layer

| # | Component | Responsibility | Requirements |
|---|---|---|---|
| S1 | **Agent surface spec** | TypeScript interface plus JSON Schema for snapshot, act, read, check, session; capabilities descriptor; reference scheme. | REQ-SURF-1, 4, 5 |
| S2 | **Adapter registry** | Name-based registration and selection; import boundary. | REQ-SURF-2 |
| S3 | **Playwright adapter** | Default web adapter; ARIA snapshot with refs; actionability; dialogs, windows, frames; tracing. | REQ-ADP-1 |
| S4 | **HTTP adapter** | Named requests; cookie sharing with a web session. | REQ-ADP-2, 3 |
| S5 | **BiDi adapter** | Stock browsers over WebDriver BiDi; independence proof. | REQ-ADP-4 |
| S6 | **Appium adapter** | Android Chrome and native. | REQ-ADP-5 |
| S7 | **Desktop adapters** | Windows UIA, macOS AX, Linux AT-SPI; same snapshot shape. | REQ-ADP-6, 7, 8 |
| S8 | **WebMCP candidate** | Detect declared site tools; `webmcp` candidate kind; preferred at replay. | REQ-ADP-9 |
| S9 | **Surface conformance suite** | Fixed calls and expected effects against the sample apps. | REQ-SURF-3, REQ-STD-2 |

### 5.2 Determinism layer

| # | Component | Responsibility | Requirements |
|---|---|---|---|
| D1 | **Schemas** | IR, plan, bindings, results, audit, checkpoint, config, surface messages; canonical serialisation. | REQ-STD-1, 4 |
| D2 | **Bindings store** | Element files keyed by id and context; canonical YAML; dictionary; hash. | REQ-REC-6, 9 |
| D3 | **Resolver** | Candidate order, exactly-one rule, timeouts, structured errors; `webmcp` preference. | REQ-RUN-5 |
| D4 | **Synthesis and fingerprinting** | Model-free candidate bundles and fingerprints per adapter kind. | REQ-REC-3, 4 |
| D5 | **Relocalization** | Fingerprint scoring against the live tree; no model. | REQ-HEAL-1 |
| D6 | **Executor core** | Plan interpretation, scope, guards, checkpoints, abort policy, results, audit, failure classes; runner-agnostic. | REQ-RUN-1..10, 13, REQ-AUTO-1..6 |
| D7 | **Healer** | Failure selection, relocalization, optional model re-grounding, verification, diff. | REQ-HEAL-1..6 |
| D8 | **Provenance and cost** | Attached to every model-produced artifact; cost table. | REQ-AGT-3, REQ-NFR-2 |
| D9 | **Runtime conformance suite** | Plans, bindings, expected results for foreign runtimes. | REQ-STD-2, 3 |

### 5.3 Behavior layer

| # | Component | Responsibility | Requirements |
|---|---|---|---|
| B1 | **Spec reader** | Flow files, signatures, data, API requests, config. | REQ-LANG-1..3, 8..10, 13 |
| B2 | **Intent compiler** | Tier 0 custom steps → Tier 1 grammar → Tier 2 local → Tier 3 frontier; target dictionary; validation; lint; plan writer. | REQ-LANG-4..7, 14..16, REQ-COMP-* |
| B3 | **Recorder** | Drive plan on an adapter, ground with the model gateway, synthesise, verify, write bindings and report; also the `bind()` record mode for host tests. | REQ-REC-1..11 |
| B4 | **Model gateway** | Local and frontier backends; schema-constrained output; caching; redaction; provenance. | REQ-COMP-3, 4, REQ-NFR-2, 3, 6 |
| B5 | **Playwright Test host** | Generated spec per flow; fixture wrapping the executor core; `bind()` fixture for plain tests; dual result output. | REQ-RUN-12, REQ-REC-11, REQ-BEH-1 |
| B6 | **Workflow runner** | Story as function: inputs, guards, checkpoints, resume, abort policy, outputs. | REQ-BEH-2, REQ-AUTO-3, 5, 7 |
| B7 | **Tool server** | Stories over MCP as deterministic tools; audit per invocation. | REQ-BEH-3, REQ-AUTO-6, 8 |
| B8 | **Trajectory compiler** | Surface trajectory plus stated intents → story draft, plan, bindings in `proposals/`. | REQ-BEH-4 |
| B9 | **CLI and MCP server** | All operations; raw surface exposure for agents. | REQ-AGT-1, 2, 4 |
| B10 | **Migration tool** | v1/v2 → v3 flows, seed bindings, data. | REQ-LANG-11 |
| B11 | **Evals** | Compiler, grounding, healing, conformance; published reports. | REQ-COMP-9, REQ-REC-10, REQ-HEAL-5, REQ-PKG-4 |
| B12 | **Local service** | `yam serve`: HTTP plus event stream over the CLI operations, results, bindings, API client, and raw surface; the single integration point for clients. Starts with no project for direct surface control. | REQ-ADE-1 |
| B13 | **Yam** (separate repository, new build) | Electron desktop client with Surfaces as the default navigation. Surface control is directly reachable without visiting Automations or opening a project. Automations hold project, flows, recording, binding, healing and runs. Reference client of B12. Also the desktop conformance target for S7. | REQ-ADE-2..9, REQ-ADP-6, 7 |
| B14 | **Front door** (Draft 2.20) | The command line's default (state and next verb), `check`, per-command help and topics, the next-step diagnostics catalogue, the session context group, and the tmux workspace over `yam ui`. Arrangement and guidance over the same functions; no new artifact. | REQ-CLI-1..9, REQ-TUI-2 |
| B15 | **Surface control** (Draft 2.25) | Shared operation dispatcher, session lifecycle, operation catalogue generating CLI/MCP/service schemas. No import of compiler, recorder, gateway or service. | SF-01..SF-07, SF-09..SF-12 |

## 6. Data flows

### 6.1 Authoring (test or workflow)

```
flows/*.flow + steps/*.ts + data.yaml + api/*.yaml
   ─► B1 reader ─► B2 compiler ─► plan.json + lint.json
                       │ tier 2/3 residue ─► B4 gateway
plan.json + bindings/ ─► B3 recorder ─► bindings/ (new) + runs/<id>/record-report.json
                            │ ground(phrase, snapshot) ─► B4 gateway
```

### 6.2 Bindings for a plain Playwright test (module a)

```
test.spec.ts: const el = await bind("login.username-field")
  record mode: B3 grounds phrase → D4 synthesis → D2 store writes bindings/login/username-field.yaml
  run mode:    D3 resolver reads store → returns a Playwright Locator; no model
  on failure:  D7 healer → D5 relocalize → diff
```

### 6.3 Replay (any behavior)

```
plan.json + bindings/ + data.yaml + inputs ─► D6 executor ─► S* adapter ─► platform
                                                  └─► runs/<id>/{results.jsonl, audit.jsonl, checkpoints/, summary.json, traces/}
web test behavior: B5 host wraps D6 inside Playwright Test (fixtures, sharding, reporters, trace viewer)
```

### 6.4 Healing

```
runs/<id>/ + bindings/ ─► D7 healer ─► D5 relocalize ─► [B4 one call] ─► verify story via D6 ─► heal/bindings.diff + report
```

### 6.5 Tool invocation by an agent

```
agent ─MCP─► B7 tool server ─► validate inputs against signature ─► D6 executor (no model) ─► outputs + audit record ─► agent
```

### 6.6 Trajectory compile

```
agent ─MCP─► B9 raw surface (snapshot/act/read with stated intent per call) ─► trajectory.jsonl
trajectory.jsonl ─► B8 ─► proposals/<date>/<name>.flow + plan fragment + bindings (verified: false) ─► review
```

### 6.7 app session

```
app (Electron main) ─spawn─► B12 yam serve --port <p> --project <dir>
app renderer ─HTTP─► B12: projects, compile, lint, record, run, results, bindings, api, surface
app renderer ◄─events─ B12: step results, record decisions, heal proposals (WebSocket or SSE)
B12 ─► B2/B3/D6/D7 exactly as the CLI does; all artifacts land in the project directory
```

The prototype spawned `jar/yam-service-1.0.3.jar` on port 8095 and kept projects, flows, locators, data, and results in electron-db, so the client and the framework had separate sources of truth. The new app keeps only UI preferences locally; every screen is a view over files in the project directory reached through the service, so the app, the CLI, CI, and an agent over MCP all see the same artifacts.

## 7. Artifact contracts

All artifacts are JSON or YAML validated against schemas in `packages/schema`, each with `schemaVersion`.

| Artifact | Location | Producer | Consumers |
|---|---|---|---|
| Flow files | `flows/**/*.flow` | human, migrate, trajectory compiler (proposals only) | B1 |
| Custom steps | `steps/**/*.ts` | human | B2, D6 |
| Run data | `data.yaml` | human, migrate | B2, D6 |
| API requests | `api/*.yaml` | human, migrate | B2, S4 |
| Project config | `yam.config.yaml` | human | all |
| Plan | `plan.json` | B2 | B3, D6, D7, foreign runtimes |
| Bindings | `bindings/<app>/<page>/<element>.yaml` | B3, D7, migrate | D3, D7 |
| Run results | `runs/<runId>/results.jsonl`, `summary.json` | D6 | D7, CI, humans |
| Audit log | `runs/<runId>/audit.jsonl` | D6 | operators, reviewers |
| Checkpoints | `runs/<runId>/checkpoints/<stepId>.json` | D6 | D6 resume |
| Record report | `runs/<runId>/record-report.json` | B3 | reviewers |
| Heal diff | `runs/<runId>/heal/bindings.diff`, report | D7 | reviewers |
| Trajectory | `runs/<runId>/trajectory.jsonl` | B9 | B8 |
| Proposals | `proposals/<date>/*` | B8 | reviewers |
| Surface spec | `packages/schema/json/surface.*.schema.json` | D1 | adapter implementers |

Step IR (abridged; full in LLD §3):

```json
{
  "id": "validate-login/3",
  "text": "Type {input.email} into the username field",
  "action": "type",
  "target": { "ref": "login.username-field", "phrase": "the username field", "status": "bound", "scope": "page" },
  "args": { "value": { "kind": "input", "name": "email" } },
  "guard": null,
  "expect": null,
  "capture": null,
  "origin": { "tier": 1, "rule": "type-into", "confidence": 1.0 },
  "timeoutMs": 10000
}
```

## 8. Technology choices

| Concern | Choice | Rationale | Alternatives |
|---|---|---|---|
| Core language | TypeScript, Node 22 LTS, pnpm workspaces | Playwright, Playwright Test, MCP SDK, and Zod are native; the agent-browser ecosystem's reference implementations are TS. | Python (better local-model tooling, weaker runner story); Java (kept as a conformance runtime). |
| Default web adapter | Playwright | Actionability, ARIA snapshots with refs, dialogs, frames, tracing, managed browsers. Consumed as an adapter, not as the core. | BiDi first (thinner, no Safari, more to build). |
| Test host | Playwright Test | Fixtures, projects, sharding, retries, reporters, trace viewer for free; the executor is a fixture. | Bespoke runner (rejected: ecosystem loss). |
| Independence adapter | WebDriver BiDi via a thin client | W3C standard, stock Chrome, Edge, Firefox; proves the surface boundary. | Puppeteer (CDP-centric). |
| Mobile | Appium through WebdriverIO client | Android Chrome parity; native by accessibility. | Playwright Android (Chrome only, experimental). |
| Desktop | Windows UIA first (via a Node binding or a wrapped driver), macOS AX second, AT-SPI third | UIA is the most complete desktop accessibility API and where demand is; same snapshot shape. | Vision-only computer use (per-step model; not deterministic). |
| Schemas | Zod → JSON Schema | One source for TS types and the published contract. | Hand-written schema plus codegen. |
| Grammar | PEG (peggy) | Readable, deterministic, positions for errors. | Regex tables (what the Java parsers did). |
| Custom steps | `defineStep(template, handler)` in TS | Typed escape hatch; compiled to `custom` IR steps; matched before grammar. | Cucumber glue (untyped strings). |
| Local model | Ollama or llama.cpp over HTTP with JSON-schema-constrained output | Language-neutral; guaranteed parseable. | In-process ONNX. |
| Frontier model | Anthropic API, Claude Opus 5, adaptive thinking, structured outputs, prompt caching | Few calls needing page understanding; cached instruction block. | Any provider behind the gateway. |
| MCP | `@modelcontextprotocol/sdk` | Tool server and raw surface exposure. | — |
| Persistence | Files in the repo | Reviewable, diffable, no service. | SQLite index for results (P2). |
| Local service | Fastify plus WebSocket (or SSE) in `packages/service` | Thin HTTP façapp over the same functions the CLI calls; one integration point for the app and other clients. | gRPC (heavier for an Electron renderer). |
| Desktop client | New Yam: Electron current LTS via Electron Forge's Vite template, TypeScript throughout, React renderer, context isolation with a typed preload bridge, a generated service client from the local service's OpenAPI description, bundled CLI. | The prototype proves the jobs; its Electron 8 shell, jQuery renderer, and electron-db storage conflict with the service boundary, the file-based source of truth, and the security baseline, so a new build is cheaper than retrofitting. Electron keeps it a UIA and AX conformance target. | Upgrade the prototype in place (rejected: three foundations to replace); Tauri (rejected: WebView accessibility trees are less uniform than Chromium's for the desktop adapters). |
| Testing | vitest; Playwright Test for adapters; sample web, mobile, and desktop apps | Fast unit loop; real platforms for conformance. | — |

## 9. Architecture decisions

**ADR-1 Two phases with committed artifacts.** Model output becomes files under review; replay reads files. Rejected: per-step model at run time.

**ADR-2 Core moves to TypeScript; Java becomes a conformance runtime.** The new components depend on capabilities native to TS. The Java project's vocabulary and execution model are carried as data and design.

**ADR-3 Accessibility-tree grounding, not vision.** Semantic snapshots are cheaper and give references directly; vision is a configured fallback through the frontier model only.

**ADR-4 Four compiler tiers at authoring time.** Custom typed steps, grammar, local model with pinned digest, frontier model. Rejected: training from scratch.

**ADR-5 Bindings keyed by element id and context.** Stable across app versions; the context hash detects page-shape changes.

**ADR-6 Healing is offline and emits a diff; heal-on-fail marks runs `healed`.** Green always means a deterministic replay passed.

**ADR-7 Expectations are predicates.** The 22 assert and validate actions collapse to `expect`; the same predicates serve as guards.

**ADR-8 Playwright is the default adapter, not the core.** The published agent surface is the boundary; a BiDi adapter is built to prove it; no browser is forked.

**ADR-9 Web test behavior runs inside Playwright Test.** The executor is a fixture; one generated spec per flow. The core remains runner-agnostic for workflow and tool behaviors and non-web adapters.

**ADR-10 Tier 0 custom typed steps.** The prose model needs an escape hatch for logic; it is typed against the IR and matched before the grammar so users never hit a wall.

**ADR-11 Modular packaging; bindings module first.** The bindings and model-free healing module for plain Playwright users is the adoption wedge; it has no dependency on the flow language.

**ADR-12 Automation guarantees in the schema from version 1.** Guards, checkpoints, abort policy, signatures, and audit are fields now, runtime support later; retrofitting them would break the standard.

**ADR-13 No RPA platform.** Scheduling, queues, human-in-the-loop UI, and dashboards are external; Yam is invoked through CLI and MCP.

**ADR-14 The artifact layer is the standard.** Versioned schemas, published conformance suites, mandatory provenance. Transport standards (CDP, BiDi, WebMCP) and agent-surface competitors (Playwright MCP, ABP) are used or interoperated with, not challenged.

**ADR-15 Desktop through the same surface.** OS accessibility trees map to the same snapshot shape; UIA first, AX second, AT-SPI third; vision fallback only where trees are absent.

**ADR-17 The app is rebuilt to the vision; the prototype is the blueprint of jobs, not code to retain.** The prototype establishes that a desktop client must let a person manage a project, author flows, run them, inspect results and screenshots, and exercise APIs. The new app delivers those jobs redesigned around the new artifacts (prose flows with lint, plan view, record with review, bindings and heal review, audit, surface explorer, tool panel), talks to the core only through the local service, and stores nothing but UI preferences. Because it is an Electron app whose Chromium exposes an accessibility tree through UIA and AX, it replaces a separate desktop sample application for validating the OS adapters. Rejected: upgrading the prototype in place (its shell, renderer, and storage all conflict with the new boundaries), keeping electron-db as a second source of truth, letting the renderer import core packages directly, and building a separate desktop sample app. Until its first tagged release the new app is developed in this repository under `apps/desktop`, so Phase 3 and the desktop conformance work verify in one checkout; the split to the `svatahADE` repository happens at that release, and the prototype's code is archived there on a `prototype` branch.

**ADR-16 Trajectory compile replaces a standalone explorer.** Agents explore through Yam's raw surface so their trajectories are captured and compiled into deterministic tools, rather than Yam owning an exploration agent.

## 10. Execution model

- A **run** has an id, config snapshot, plan hash, bindings hash, invoker identity, and behavior (`test|workflow|tool`).
- Flows are the unit of parallelism (`workers`). Each flow owns one adapter session, one variable scope, one results stream, one audit stream.
- The run block's order is expanded (compositions inline) exactly as `ExecutionController.executeFlow` did.
- Story invocation: inputs validated against the signature; `{input.*}` in scope; outputs collected from captures at the end.
- Per step: guard (if any) → resolve target → perform → expectation (if any) → capture → checkpoint → result and audit lines.
- Failure: classify; apply the flow's `onFailure` policy (`stop` default: remaining steps and stories `skipped`; `compensate:<flow>`: run it with the current scope, then stop; `continue`: next story). `continueOnFailure` remains as the alias of `continue`.
- Resume: `--resume <runId> --from <stepId>` loads the checkpoint, verifies plan and bindings hashes, restores scope, and continues; session state restore is adapter-specific (web: URL and storage state).
- Exit code: non-zero on `failed`, `healed`, or `aborted`.
- In the Playwright Test host, each flow is one spec file and each story one `test()`; the fixture holds the session and scope; Playwright's retries re-run a story only when the flow's policy allows.

## 11. Cross-cutting concerns

**Determinism (REQ-NFR-1, REQ-RUN-1, 2).** Runtime packages cannot import the gateway (lint rule). Timeouts are explicit in the IR. `webmcp` candidates are deterministic because the site declares the tool; if a declaration disappears, resolution falls through to locators.

**Secrets (REQ-REC-7, REQ-NFR-6).** `${ENV}` indirection in `data.yaml`; `secret` input type; redaction in prompts, audit, and reports; masked screenshots.

**Provenance (REQ-AGT-3, REQ-STD-4).** Mandatory on Tier 2/3 steps, bindings, heal entries, proposals; schema-enforced.

**Cost (REQ-NFR-2).** The gateway sums tokens per invocation and prints cost from a price table.

**Audit (REQ-AUTO-6).** One line per surface call with reference, args (redacted), outcome, and timing, plus run-level invoker and inputs.

**Environment policy (REQ-AUTO-7).** `environment: production` refuses recording and requires `idempotent` or `allowSideEffects`.

**Observability (REQ-NFR-5).** JSON-lines logs; optional OpenTelemetry spans per flow, story, step, surface call.

## 12. Repository layout

```
yam/                      github.com/SvatahLabs/Yam (Draft 2.18)
  packages/
    schema/               Zod + generated JSON Schemas: ir, plan, bindings, results, audit, checkpoint, config, surface
    surface/              AgentSurface interface, adapter registry, reference scheme, capabilities
    page-script/          the DOM walker adapters evaluate in a page: roles, names, states, refs (Draft 2.29)
    adapter-playwright/   default web adapter
    adapter-http/         API adapter
    adapter-bidi/         WebDriver BiDi adapter (P1)
    adapter-appium/       mobile adapter (P1)
    adapter-uia/          Windows UI Automation (P2)
    adapter-ax/           macOS Accessibility (P2)
    adapter-process/      command in a pseudo-terminal, streams, exit code, files under a root (T22)
    adapter-atspi/        Linux AT-SPI over the accessibility bus (T23; implemented, unvalidated)
    bindings/             store, resolver, synthesis, fingerprint, relocalization   ← module (a) core
    healer/               failure selection, repair, verify, diff                    ← module (a)
    playwright-test/      bind() fixture for plain Playwright tests                   ← module (a)
    bindings-cli/         yam-bindings bin: bindings, heal, conform, eval healing  ← module (a)
    host-playwright/      flow host: yam fixture, generated spec per flow, reporter ← module (b)
    runtime/              executor core: scope, guards, checkpoints, policies, results, audit
    spec/                 flow reader, grammar, target dictionary, signatures
    steps/                defineStep API and Tier 0 matcher
    compiler/             tiers, lint, plan writer
    gateway/              model gateway
    recorder/             grounding, session, report; bind() record mode
    workflow/             story-as-function runner, resume
    tool/                 MCP tool server over stories
    contract/             the operation catalogue and the fingerprint every client checks — schema and zod only, drives nothing (PK-07)
    mcp/                  the MCP server over stdio and Streamable HTTP, its own installable so a CLI install does not carry the SDK (PK-05)
    surface-control/      shared operation dispatcher, session lifecycle, the broker — no compiler/recorder/gateway/service imports (Draft 2.25)
    screens/              headless screen model and action registry (Draft 2.11, LLD §13.7)
    ui-tokens/            design tokens for both themes, TS and generated CSS (Draft 2.11)
    ui/                   React components on Radix primitives, the component sheet (Draft 2.11)
    tui/                  yam ui, the Ink terminal cockpit (Draft 2.11, REQ-TUI-1)
    sdk/                  typed client generated from the OpenAPI description (Draft 2.11, LLD §13.8)
    verify/               catalogue schema, source runners, comparison, report — the parity gate as a package (Draft 2.16, planned: Phase 15)
    trajectory/           trajectory capture and compile (P2)
    cli/                  yam CLI + MCP server (operations + raw surface)
    service/              local HTTP + event-stream service (yam serve) for the app and other clients
    migrate/              v1/v2 → v3, plus prototype database import (P2)
    conformance/          surface and runtime conformance suites
  clients/
    python/, java/        clients generated from the same description (Draft 2.11)
  apps/
    sample-web/           sample web app with variants
    desktop/              Yam, the desktop client (Electron; Draft 2.19), developed in-repo until its first release (ADR-17); also the desktop conformance target
  evals/
    compiler/  grounding/  healing/  conformance/
  docs/spec/              this document set
  evals/migrate/source/   the four legacy sample flows, the locator file and ActionSynonyms.java, kept as the migrate inputs (Draft 2.18; `legacy/` itself is gone)
```

Published npm modules (Draft 2.3; no aggregate packages, each package publishes individually). Draft 2.18: the scope is the organisation, so the product name is the prefix — `@svatah/yam` publishes as `@svatah/yam` and every other package below as `@svatah/yam-<name>`; the names in this paragraph are the directory names. Module groups: module (a) = `@svatah/yam-schema`, `@svatah/yam-surface`, `@svatah/yam-adapter-playwright`, `@svatah/yam-bindings`, `@svatah/yam-healer`, `@svatah/yam-playwright-test`, `@svatah/yam-bindings-cli`, `@svatah/yam-conformance`; module (b) = `@svatah/yam-spec`, `@svatah/yam-steps`, `@svatah/yam-compiler`, `@svatah/yam-gateway`, `@svatah/yam-recorder`, `@svatah/yam-runtime`, `@svatah/yam-host-playwright`, `@svatah/yam-workflow`, `@svatah/yam-tool`, `@svatah/yam-trajectory`, `@svatah/yam-service`, `@svatah/yam-migrate`, `@svatah/yam`; module (c) = the schema and conformance packages consumed by foreign runtimes. `runtime` stays in module (b); module (a) reaches replay only through the healer's `Replayer` plugin (LLD §10). Other adapters are separate packages.

## 13. Delivery phases

| Phase | Outcome | Requirements closed |
|---|---|---|
| 0 | Skeleton, schemas with automation fields, surface spec, sample web app with variants, language reference, golden seed | REQ-STD-1, REQ-SURF-1, REQ-LANG-12 |
| 1 | **Module (a):** Playwright adapter, bindings store, resolver, synthesis, fingerprints, relocalization, `bind()` fixture, model-free healer, `yam bindings` CLI, adapter conformance suite; published healing eval (relocalize-only) | REQ-ADP-1, REQ-SURF-2..5, REQ-REC-3, 4, 6, 9, 11, REQ-RUN-5, REQ-HEAL-1(relocalize), 2, 3, 5(relocalize), 6, REQ-PKG-1(a), 2 |
| 2 | **Module (b) test behavior:** reader, Tier 0 and Tier 1, lint, executor core, HTTP adapter, Playwright Test host, migration, local service, compatibility run | REQ-LANG-*, REQ-COMP-1, 2, 5..9, REQ-RUN-1..4, 6..10, 12, 13, REQ-ADP-2, 3, REQ-BEH-1, 5, REQ-AUTO-5, 6, REQ-NFR-8, REQ-ADE-1 |
| 3 | **Recorder, model healing, app foundation:** gateway, grounding, session, report, `record`; healer with re-grounding; grounding and full healing evals published; new app shell and core screens (project, flow editor with lint, plan view, run with live events, results, API client, data editor) | REQ-REC-1, 2, 5, 7, 8, 10, REQ-HEAL-1(model), 4, 5(model), REQ-AGT-3, REQ-NFR-2, 6, REQ-ADE-2, 3, 7 |
| 4 | **Independence and tiers:** BiDi adapter, Appium adapter, Tier 2 and 3, privacy mode, REPL, MCP server with raw surface | REQ-ADP-4, 5, REQ-COMP-3, 4, REQ-NFR-3, REQ-RUN-11, REQ-AGT-2 |
| 5 | **Automation behaviors:** guards, checkpoints, resume, abort policies, workflow runner, tool server, environment policy, trajectory compiler; app record review, bindings and heal review, surface explorer and tool panel | REQ-AUTO-1..4, 7, 8, REQ-BEH-2, 3, 4, REQ-LANG-14, REQ-ADE-4, 5, 8 |
| 6 | **Reach:** Windows UIA and macOS AX validated against the app, prototype data import, WebMCP candidate, Java conformance runtime, Tier 2 fine-tune | REQ-ADP-6, 7, 9, REQ-STD-3, REQ-ADE-6, 9 |
| 7 | **Hardening and release candidate (Draft 2.8):** the live desktop gates pass on the hosts that can run them and the pipeline carries every gate; the Java runtime's artifacts validate; the dialog IR and the type check join the contract; the fine-tune is measured or stated blocked; module (a), the CLI, the schemas, and the app installers are packaged as a 0.1.0 release candidate with the published evals attached | REQ-PKG-1, 2, 4, REQ-STD-2, 3, REQ-ADP-6, 7 (closed live) |
| 8 | **Ship (Draft 2.9):** the packaged app opens a project with a resolved Node runtime and the gate opens one without a dialog; the AX bridge meets the budget on the measured project screen and the macOS gate passes live; dialog arming is documented, linted and audited; the fine-tune is withdrawn from 0.1.0's claims with the Tier 2 corpus as its precondition; 0.1.0 is published from the pipeline by a manual, token-gated step the owner triggers, with installers and the eval reports attached | REQ-ADE-2, 6 (packaged), REQ-ADP-7 (budget), REQ-PKG-1, 4 (published) |
| 9 | **Builder surfaces, foundation (Draft 2.11):** the headless screen model and its action registry, the design system on Radix with the approved tokens, `@svatah/yam-sdk` generated from the OpenAPI description with Python and Java clients, the app shell rebuilt as rail, workspace and inspector with the Flows and Run screens live, `yam ui` rendering the same two screens; the Phase 8 corrections applied | REQ-ADE-10, 11, 12, 13, REQ-TUI-1, REQ-SDK-1, 2 (foundation) |
| 10 | **Builder surfaces, complete (Draft 2.11):** every screen of the former eleven rebuilt on the model in both renderers (record review, runs and evidence, heal review, bindings, agents and tools, API, data, explorer, import, settings), the command palette with parity asserted, the accessibility contract enforced by the desktop suite, the app installers rebuilt, the packaged app the conformance target again | REQ-ADE-10..13, REQ-TUI-1, REQ-ADE-6 (re-validated) |
| 11 | **Corrections, and Yam verifies Yam (Draft 2.14):** the Phase 10 corrections including the windowless launch; `app.launch`/`app.quit`, `Quit the app`, CDP attach, desktop grounding; `evals/self` and `yam eval self`, the two-sided parity gate at 100 percent agreement with coverage and one-sided checks published; the verification contract becomes the gate | REQ-SELF-1, 2, 3, REQ-ADE-6, REQ-ADP-1, 7 |
| 12 | **Release 0.1.0 and the open P0 items (Draft 2.10, renumbered 2.14):** the desktop gate is race-free and load-aware; the compiler golden set reaches 300; the app names every control and the gate makes a real run before reading results; the three-OS CI matrix is observed on a runner the owner attaches; 0.1.0 is published by the owner's trigger and verified from the registry by a scripted install into an empty project; the Windows gate carried | REQ-COMP-9, REQ-PKG-1, 2, 4 (from the registry), REQ-ADE-6, REQ-ADP-6 (carried) |
| 13 | **Yam (Draft 2.18, 2.19):** the product named Yam under the Svatah brand and the `@svatah` scope, the frozen Java project removed, GitHub Actions the only CI, the readiness corrections with trusted publishing, the documentation set with its generated reference, the desktop client renamed from the ADE to Yam; the publish and its verification the owner's | REQ-PKG-1, 2, 4, REQ-STD-1 (under the new names) |
| 14 | **The front door (Draft 2.20):** `yam` prints state and the next verb, `check`, one-screen top-level help with per-command help and topics, next-step diagnostics, `heal` on the last run, the session context documented once, no internal vocabulary, and `yam ui --tmux`; runs before T13.6's publish. Draft 2.21: the human gateway, a person as primary grounder through the driven session, and `yam explore`, an agent's first draft as a proposal, with the front door naming both | REQ-CLI-1..10, REQ-TUI-2, REQ-REC-12, REQ-AGT-5 |
| 15 | **Process and terminal (Draft 2.16):** the `process` surface kind and adapter, patterns 34–38, the six outside-surface checks moved to Yam's side, `@svatah/yam-verify` published for third parties; the parity gate's ceiling reaches 45 of 48; the tmux workspace is the adapter's first target | REQ-ADP-10, REQ-SELF-1, 2, 4 |
| 16 | **Surface-first (Draft 2.25):** the primary journey becomes connect → inspect → act → verify with no project, flow or intent required; `packages/surface-control` with the shared operation dispatcher, session lifecycle and the operation catalogue generating CLI/MCP/service schemas; `yam surface` direct commands; MCP default profile foregrounds surface tools with optional intent; desktop navigation becomes Surfaces (default), Automations, Activity, Settings; the six verified defects fixed; see [surface-first spec](surface-first/README.md) | SF-01..SF-23 |

## 14. Risks and mitigations

| Risk | Mitigation | Requirement |
|---|---|---|
| Module (a) does not get adopted, so the wedge fails | Ten-minute quick start; published healing numbers; zero dependency on the flow language | REQ-PKG-2, 4 |
| Healing numbers disappoint | Publish anyway; relocalization thresholds are the honest signal; weight tuning on the variant eval | REQ-HEAL-5 |
| Playwright internal snapshot API changes | Isolated in the adapter; public `ariaSnapshot()` fallback with own refs | LLD §7.3 |
| Playwright Test host limits (retries vs policies) | Retries disabled unless the flow policy permits; documented | REQ-RUN-12 |
| Surface abstraction leaks platform specifics | Conformance suite; capabilities descriptor for optional features | REQ-SURF-3 |
| Desktop adapters are large and CI-hostile | Last phase; UIA first; documented host requirements; vision fallback where trees are absent; the app as target means CI can build and launch it on Windows and macOS runners | REQ-ADP-6, 7, REQ-ADE-6 |
| New app grows into a second product and slows the core | The app is a view over the service; a screen exists only when the service endpoint and file it renders already exist; no screen has logic the CLI lacks (review rule) | REQ-ADE-2, 3 |
| Electron accessibility tree is incomplete for custom widgets | Enable `app.setAccessibilitySupportEnabled(true)` in the app; add ARIA roles and names in the app UI where the tree is thin, which also improves its accessibility | REQ-ADE-6 |
| Automation in production causes side effects | Environment policy, idempotency declaration, guards, compensation, audit | REQ-AUTO-* |
| Scope creep into an RPA platform | Non-goals; external orchestration only | ADR-13 |
| Natural-language ambiguity | Compile errors with suggestions; Tier 0 for logic; lint on multi-match targets | REQ-COMP-1, 8, REQ-LANG-15, 16 |
| Model drift changes compiles | Pinned digests and prompt versions; committed plan makes re-compile a visible diff | REQ-AGT-3, REQ-COMP-7 |
