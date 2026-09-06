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

**Status:** pending

---

## T10' — Narrow yam surface command family

**Status:** pending

---

## T11' — Narrow MCP surface profile

**Status:** pending

---

## T0B — The six verified defects

**Status:** pending
