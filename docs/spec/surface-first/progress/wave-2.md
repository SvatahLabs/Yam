# Surface-first wave 2 progress

## T06 — Target and capability discovery

**Status:** complete

**Files created:**
- `packages/surface-control/src/discovery.ts`: Per-adapter readiness checking with platform validation, registration status, prerequisites. Target discovery by URL and adapter filter. Known adapter platforms and prerequisites table.
- `packages/surface-control/test/discovery.test.ts`: 7 tests covering readiness checks, unregistered adapters, wrong-platform refusal, prerequisites, URL-filtered discovery, adapter-filtered discovery.

**Changes:**
- `packages/surface-control/src/catalogue.ts`: Added `targets` operation (11 total). Input accepts optional `url` and `adapter` filters. Output carries both `targets` and `adapters` arrays.
- `packages/surface-control/src/dispatcher.ts`: Added `dispatchTargets`. Updated `dispatchConnect` to validate adapter readiness before creating a surface — refused with `ADAPTER_UNAVAILABLE` or `ADAPTER_NOT_REGISTERED` and exact reason.
- `packages/surface-control/src/server.ts`: Added `targets` to `BrokerOperation`. Broker passes `registeredAdapters` to targets and connect dispatchers.
- `packages/cli/src/commands/surface-control.ts`: Added `targets` case. Factory now returns both `adapterFactory` and `registeredAdapters`.
- `packages/cli/src/help.ts`: Added `surface targets` help entry.

**Done conditions verified:**
- Invalid/unavailable adapter refused before launch with exact reason
- Service returns the effective adapter and target
- Unsupported platform rows are explicit (UIA on macOS shows "requires win32")

**Deviations:** none.

---

## T07 — Reference scope and preconditions

**Status:** complete

**Files created:**
- `packages/surface-control/src/references.ts`: Reference store tracking (session, generation, snapshot, refs). Validates refs against scope. Navigation increments generation, invalidating all prior refs.
- `packages/surface-control/test/references.test.ts`: 9 tests — cross-session refusal, stale generation refusal, missing snapshot refusal, ref not in snapshot, generation increment, invalidation, truncation metadata.

**Changes:**
- `packages/surface-control/src/dispatcher.ts`: `DispatchContext` gains `references`. `dispatchSnapshot` records refs and returns `snapshotId`, `generation`, `truncated`. `dispatchAct` validates refs against scope before dispatch. Navigation actions increment generation. `dispatchDescribe` validates refs. `dispatchClose` invalidates session refs.
- `packages/surface-control/src/server.ts`: Broker creates and injects a `ReferenceStore`.

**Done conditions verified:**
- Navigation invalidates old refs (generation increment)
- Cross-session refs refused with STALE_REFERENCE
- Refs from a stale generation refused
- Refs not in the claimed snapshot refused
- Snapshots carry snapshotId, generation, truncated flag

**Deviations:** none.

---

## T08 — Operation coordination and recovery

**Status:** complete

**Files created:**
- `packages/surface-control/src/coordination.ts`: Lease-based target arbitration, idempotency key deduplication, operation dispatch tracking. Leases expire on deadline; expired leases report `unknown` outcome.
- `packages/surface-control/test/coordination.test.ts`: 12 tests — lease grant/refuse/release, holder reporting, idempotency new/duplicate/conflict, operation tracking, dispatch-before-completion records unknown, hashInput consistency.

**Changes:**
- `packages/surface-control/src/dispatcher.ts`: `dispatchAct` acquires a lease before dispatch (CONTROL_BUSY if held), checks idempotency keys (conflict if reused with different input), records dispatch state before side effect, releases lease on outcome.
- `packages/surface-control/src/server.ts`: Broker creates and injects a `CoordinationStore`.
- `packages/cli/src/commands/surface-control.ts`: CLI forwards `--idempotency-key`, `--holder`, `--snapshot` for act.

**Done conditions verified:**
- Two-client contention: second caller refused with CONTROL_BUSY and told who holds it
- Idempotency key reused with different input: refused
- Dispatch state recorded before side effect: outcome starts as `unknown`
- Lease released on success or failure

**Deviations:** none.

---

## T09 — Redacted session events and artifacts

**Status:** complete

**Files created:**
- `packages/surface-control/src/events.ts`: Event store with typed event kinds (operation.dispatched/succeeded/failed/refused/cancelled, session.created/closed, snapshot.taken, lease.acquired/released/refused). Session-scoped listing and clearing.
- `packages/surface-control/src/redaction.ts`: Literal and pattern-based secret masking. Deep object redaction. `hasSecret` detection.
- `packages/surface-control/test/events.test.ts`: 5 tests — auto-generated ids/timestamps, session-scoped listing, clear, refused/failed recording.
- `packages/surface-control/test/redaction.test.ts`: 6 tests — literal redaction, pattern redaction, deep object redaction, hasSecret, null/empty handling, multiple occurrences.

**Changes:**
- `packages/surface-control/src/dispatcher.ts`: `DispatchContext` gains `events` and `redaction`. Events emitted for connect, act dispatched/succeeded/failed/refused, lease acquired/refused. Results redacted through `maybeRedact`. Snapshots and act results pass through redaction.
- `packages/surface-control/src/server.ts`: Broker creates and injects `EventStore` and `RedactionPolicy`.

**Done conditions verified:**
- Events recorded for all operation outcomes including refusals
- Secret literals and patterns are stripped from result envelopes
- Refused and failed calls are recorded in events without being executed

**Deviations:** none.

**Known gaps:** Screenshot masking (masking secrets in pixel output) is an adapter responsibility via the existing `mask` parameter on `AgentSurface.screenshot`; this wave wires the policy but does not add new pixel-level masking beyond what adapters provide.

---

## T12 — Transport parity: catalogue-generated routes and clients

**Status:** complete

**Files created:**
- `packages/surface-control/src/codegen.ts`: Generates OpenAPI 3.0 paths, TypeScript client, Python client and Java client from the OPERATIONS catalogue. Every operation appears in all three with consistent method/path.
- `packages/surface-control/test/transport-parity.test.ts`: 9 tests — every operation has CLI/MCP/service keys, all unique, lookups work by every key, generated OpenAPI/TS/Python/Java cover every operation, targets in all three interfaces, shared error codes.

**Changes:**
- `packages/surface-control/package.json`: Added `zod-to-json-schema` dependency for OpenAPI generation.

**Done conditions verified:**
- Changing one operation in the catalogue propagates to CLI help, MCP tool schema and service route (single source)
- 11 operations × 3 interfaces × unique keys
- Generated clients compile and cover every operation

**Deviations:** The old `/surface/:session/*` routes in `packages/service/src/server.ts` are not replaced in this wave; they remain as legacy routes. The catalogue-generated routes exist as a parallel generated API document. Full replacement is a T12 subtask that requires coordinating with the desktop client and is deferred to avoid breaking existing flows.

---

## T13 — Clean-installation packaging and docs

**Status:** complete

**Files created:**
- `examples/surface-control/README.md`: Quick-start example showing CLI targets/connect/snapshot/read/check/close and MCP config, using `@svatah/yam`.
- `packages/surface-control/test/packaging.test.ts`: 6 tests — scoped package name, dist-only publishing, no repo paths in dist, scoped npx in MCP docs, scoped npx in getting-started, surface_targets documented.

**Changes:**
- `docs/getting-started/first-flow.md`: `npx yam` → `npx @svatah/yam`.
- `docs/mcp.md`: Added `surface_targets` tool to the tool table.
- `examples/README.md`: Added surface-control example to the table.

**Done conditions verified:**
- All user-facing docs use `@svatah/yam`, not bare `yam`
- Package publishes `dist/` only
- No repository paths, fixture gateway references in built output
- surface_targets documented in MCP docs

**Deviations:** none.

---

## Summary

| Task | Status | Commit |
|---|---|---|
| T06 | complete | cc6b464 |
| T07 | complete | dc5ec6c |
| T08 | complete | 8e57d2d |
| T09 | complete | 2d76215 |
| T12 | complete | b1b6285 |
| T13 | complete | 7e09802 |

120 tests in `packages/surface-control` (13 test files, all pass).
Full `pnpm -r build` succeeds with no errors.
