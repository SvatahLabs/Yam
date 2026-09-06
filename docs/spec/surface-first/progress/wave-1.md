# Surface-first wave 1 progress

## T01 — Reconcile the mission in the existing spec

**Status:** complete

**Changes made:**
- `docs/spec/requirements.md`: Draft 2.1 → Draft 2.25. Objective rewritten to make connect → inspect → act → verify the primary journey, with surface operating independently of automation layers. Updated: REQ-AGT-1 (direct surface control commands), REQ-AGT-2 (intent optional, default profile foregrounds surface tools), REQ-ADE-8 (intent optional for agent workbench), REQ-ADE-11 (Surfaces default navigation, supersedes Flows-first rail), REQ-BEH-4 (intent optional for trajectory, no-intent compiles to review step), REQ-CLI-2 (surface noun group includes direct control). Change log entry added.
- `docs/spec/hld.md`: Draft 2.1 → Draft 2.25. Purpose rewritten for surface-first. Positioning figure gains SURFACE CONTROL layer. Component B15 (surface-control) added. Repository layout gains `surface-control/`. Desktop navigation updated to Surfaces/Automations/Activity/Settings. Phase 16 added to delivery table.
- `docs/spec/lld.md`: Draft 2.1 → Draft 2.25. Desktop information architecture updated to Surfaces-first. MCP section updated: default profile foregrounds surface tools with optional intent; supersedes intent-required schema. Change log entry added.
- `docs/spec/tasks.md`: Draft 2.1 → Draft 2.25. Phase 16 added referencing surface-first tasks.

**Superseded assertions:**
- REQ-ADE-11's Flows-first rail (Draft 2.11) → Surfaces-first navigation (Draft 2.25, SF-02, SF-16)
- REQ-AGT-2's intent-required MCP schema (Draft 2.24) → intent optional for direct control (Draft 2.25, SF-12)
- REQ-BEH-4's intent-required trajectory calls → intent optional, no-intent compiles to review step (Draft 2.25, SF-12)
- LLD §13.5's project-required surface dispatch → projectless service startup (Draft 2.25)
- LLD §13.7's Flows-first information architecture (Draft 2.11) → Surfaces-first (Draft 2.25)

**Preserved:**
- All automation semantics (flows, compilation, recording, healing, runs, behaviors)
- All historical phase records (Phases 0–15)
- All requirement IDs (no renumbering)
- All existing acceptance criteria for automation features

**Deviations:** none.

**Known gaps:** none.

---

## T02 — Freeze the v1 surface operation catalogue

**Status:** complete

**Package:** `packages/surface-control/` (`@svatah/yam-surface-control`)

**Files created:**
- `src/catalogue.ts`: 10 operations (connect, snapshot, act, read, check, close, sessions, capabilities, describe, screenshot). Each descriptor carries CLI flags/exit codes, MCP tool name/annotations, and service method/path. Typed Zod input/output schemas per operation. Lookup functions: `operationByName`, `operationByCliSubcommand`, `operationByMcpTool`, `operationByServicePath`. Exports `SURFACE_TOOL_NAMES`, `SURFACE_CLI_SUBCOMMANDS`, `ERROR_CODES` (15 codes), `CLI_EXIT_CODES`.
- `src/envelope.ts`: `makeRequestId()`, `successEnvelope()`, `failedEnvelope()`, `refusedEnvelope()` — build typed `ResultEnvelope` with `{schemaVersion, requestId, sessionId?, status, result?, error?, timing?}`.
- `src/sessions.ts`: `createSessionStore()` → `SessionStore` with `create/get/list/remove/closeAll`. Session IDs: `s_<12-hex>`.
- `src/dispatcher.ts`: 10 dispatch functions wrapping `AgentSurface` calls with envelopes and error mapping. `DispatchContext` holds the `SessionStore`. `headed` passed to adapter factory (not `SessionInit`).
- `src/index.ts`: Re-exports all public API.
- `test/catalogue.test.ts`: 17 tests — uniqueness, one-source-propagation, lookup, schema validation.
- `test/sessions.test.ts`: 6 tests — create, get, list, remove, closeAll.
- `test/envelope.test.ts`: 6 tests — makeRequestId, success/failed/refused builders.

**Design decision:** One `OPERATIONS` array is the single source of truth. CLI, MCP, and service definitions are derived from each descriptor — changing one entry propagates to all three interfaces.

**Import boundaries enforced:** `surface-control` depends only on `@svatah/yam-schema` and `@svatah/yam-surface`. No imports from compiler, recorder, gateway, or service.

**Deviations:** none.

**Known gaps:** none.

---

## T03 — Turn audit failures into regression cases

**Status:** complete

**Files created:**
- `packages/surface-control/test/audit-regressions.test.ts`: 15 tests covering all 6 verified defects from the gap analysis. 6 tests fail on the baseline (demonstrating the defects), 9 pass (verifying the new catalogue has correct schemas).

**Defect → regression test mapping:**
- G02 (SF-03, SF-06): surface subcommands must exist beyond "conform" — tests catalogue subcommands and checks source for hard-coded single-command gate
- G03 (SF-11, SF-17): Explorer must provide a surface action selector — tests renderer source for action selection UI
- G04 (SF-03, SF-04, SF-09): adapter selection must be real — tests catalogue schema, dispatcher rejection, and service source for adapter in request body
- G05 (SF-03, SF-12): intent must be optional for direct control — tests catalogue schemas and checks service source for "missing-intent" gate
- G07 (SF-03, SF-06, SF-11): ref2, name, and snapshot options must not be dropped — tests catalogue schemas, dispatcher forwarding, and service source for ref2/name in calls
- G11 (SF-02, SF-20): docs must reference @svatah/yam, not bare yam — tests docs/mcp.md for unscoped package references

**Evidence:** 6 tests fail for the observed baseline reason; 9 tests pass validating the correct contract in the new catalogue and dispatcher. Tests do not encode broken behavior as correct.

**Import boundaries:** regression tests read source files for cross-package assertions rather than importing from CLI, screens, or service packages.

**Deviations:** none.

**Known gaps:** none.

---

## T04 — Extract surface control from project loading

**Status:** complete

**Files created:**
- `packages/surface-control/src/adapter-factory.ts`: `createAdapterFactory()` builds an `AdapterFactoryFn` from a resolver and a registry lister. Validates adapter registration before creating a surface. Constructs a minimal `Config` with `DEFAULT_CONFIG` — no project, no flows, no bindings needed.
- `packages/surface-control/test/projectless.test.ts`: 6 tests proving connect/snapshot/act/read/check/close work with no project loaded, adapter factory refuses unknown adapters, dispatcher has no project dependency, and source files import no compiler/recorder/gateway/service packages.

**Done conditions verified:**
- connect/snapshot/act/check work with no flow/compiler/binding load: tested with stubbed surface, all return `status: "succeeded"`
- No model credential needed: dispatcher chain has no gateway or model import
- Invalid unrelated flow files cannot prevent surface control: dispatcher takes a pre-created surface via factory, not a project
- Import boundary enforced: automated test scans every source file for forbidden imports

**Deviations:** none.

**Known gaps:** none.

---

## T05 — Broker discovery and session lifecycle

**Status:** complete

**Files created/modified:**
- `packages/surface-control/src/broker.ts`: Broker descriptor lifecycle: `writeBrokerDescriptor()`, `readBrokerDescriptor()`, `removeBrokerDescriptor()`, `discoverBroker()`, `generateToken()`, `isProcessAlive()`, `brokerStateDir()`. Descriptor stores URL, token, PID, and startedAt. OS-specific state directories (darwin: ~/Library/Application Support/yam, linux: $XDG_STATE_HOME/yam, win32: %APPDATA%/yam). Owner-only permissions (0o700 dir, 0o600 file).
- `packages/surface-control/src/sessions.ts`: Extended with `SessionMode` (launch/attach), TTL, `touch()` for activity tracking, `expireSessions()` for TTL sweep. `closeAll()` only closes launched surfaces, preserving attached ones.
- `packages/surface-control/test/broker.test.ts`: 11 tests — token generation, descriptor read/write/remove, owner-only permissions, stale process cleanup, idempotent remove.
- `packages/surface-control/test/sessions.test.ts`: Updated to 11 tests — adds mode, touch, expiry, attach/launch close semantics.

**Done conditions verified:**
- Stale descriptor recovery: dead PID descriptor cleaned up automatically on discover
- Close/expiry cleans launched resources, preserves attached: tested in sessions and expiry
- Token lifecycle: generateToken produces unique 32-char hex tokens
- OS-specific paths: brokerStateDir returns platform-appropriate directories

**Deviations:** Wave 1 does not implement multi-process broker sharing (full broker service with HTTP). The descriptor is written/discovered, but wave 1 CLI processes are self-contained — each manages its own sessions in-process. The broker descriptor is the foundation for T10'/T11' to share sessions across processes.

**Known gaps:** none.

---

## T10' — Narrow yam surface command family

**Status:** complete

**Files created/modified:**
- `packages/cli/src/commands/surface-control.ts` (new): CLI command handler for the 10 surface operations. Reads the catalogue subcommands, dispatches to the surface-control dispatcher, translates error codes to exit codes, supports `--json` output. Supports `--input` for act args and check predicates (file path or stdin via `-`).
- `packages/cli/src/cli.ts` (modified): Intercepts surface control subcommands before they reach module (a). The dispatch order is: `surface doctor` → surface control subcommands → `surfaceCommand` (conform) → module (b).
- `packages/cli/src/help.ts` (modified): Added 7 new command entries (connect, snapshot, act, read, check, close, sessions) with synopsis, descriptions, options, and exit codes. Updated NOUNS for surface to list all subcommands.
- `packages/cli/package.json` (modified): Added `@svatah/yam-surface-control` as a dependency.
- `packages/bindings-cli/src/commands/surface.ts` (modified): Replaced the hard-coded reject-all-except-conform gate with a fall-through for unknown subcommands.

**Done conditions verified:**
- G02 regression test now passes: surface subcommands are recognised
- CLI help includes connect, snapshot, act, read, check, close, sessions
- Each command maps to the catalogue's exit codes

**Deviations:** Wave 1 CLI processes are self-contained (each manages its own session store in-process). The journey across separate processes requires a broker service (wave 2). Within a single process, all 6 commands work.

**Known gaps:** none.

---

## T11' — Narrow MCP surface profile

**Status:** complete

**Files modified:**
- `packages/cli/src/commands/mcp.ts`: Replaced 4 legacy surface tools (surface_snapshot/act/read/check with lazy session) with 10 catalogue-driven tools using the surface-control dispatcher. Added surface_connect, surface_close, surface_sessions, surface_capabilities, surface_describe, surface_screenshot. Intent optional on all surface tools. Project root optional — surface tools work without a project. Trajectory capture is lazy: no pre-call snapshot (previously every surface call took a full `snapshot({interactiveOnly: true})` before dispatching).
- `docs/mcp.md`: Updated to document 11 surface tools (10 + trajectory), optional intent, projectless mode. Fixed `npx yam` → `npx @svatah/yam` (G11). Reorganised to put surface tools first. Simplified trajectory documentation.
- `packages/cli/test/mcp.test.ts`: Updated tool list (12 → 18 published tools). Updated intent test: was "required", now "optional". Added session ID requirement test. Rewritten exploration test to use connect/session/close flow. Added no-intent test proving calls work without intent but don't write trajectory.

**Done conditions verified:**
- Surface tools work without a project (no root argument to buildMcpServer)
- Intent is optional on all surface tools
- Session-based workflow: connect → snapshot → act → read → check → close
- Trajectory written only when intent is provided and project exists
- Lazy evidence: removed pre-call snapshot (previously every call did a full page read)
- All 10 operations from the catalogue registered as MCP tools
- docs/mcp.md documents exactly the tools the server offers

**Deviations:** Trajectory evidence is lazy (no pre-call snapshotHash or describe capture). The spec says "make the trajectory's evidence cheap or lazy" — this is the lazy path. A future wave can add opt-in rich evidence.

**Known gaps:** none.

---

## T0B — The six verified defects

**Status:** pending
