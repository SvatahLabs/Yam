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

**Status:** pending

---

## T03 — Turn audit failures into regression cases

**Status:** pending

---

## T04 — Extract surface control from project loading

**Status:** pending

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
