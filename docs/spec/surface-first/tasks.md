# Yam surface-first implementation tasks

Status: **M0–M4 delivered; M5 in progress (see [wave 5](progress/wave-5.md)).** Unchecked tasks are not implemented. Execute milestones in dependency order. P0 milestone completion is a release gate; P1/P2 work must not hide remaining P0 failures.

T01–T05 and the narrow CLI/MCP slice landed in [wave 1](progress/wave-1.md), T06–T09 and T12–T13 in [wave 2](progress/wave-2.md), T14–T17 in [wave 3](progress/wave-3.md) and T18–T20 in [wave 4](progress/wave-4.md); each record carries the evidence and the deviations. Every box below was ticked in wave 4, because a file whose header says "unchecked tasks are not implemented" and whose boxes were all empty was asserting that none of it existed.

The release gate is reviewed in [release-review.md](release-review.md), which names what is measured and what is still missing. **Nothing has been published.**

## M0 — Establish the product and contract baseline

- [x] **T01 · P0 · Product/specification — Reconcile the mission.** Requirements: SF-01, SF-02, SF-12, SF-16, SF-19. Update `docs/spec/requirements.md`, HLD/LLD, front-door requirements and design index to make connect/inspect/act/verify primary. Name which intent rules and Flows landing assertions are superseded. Preserve automation semantics and historical phase evidence. **Done:** no active acceptance criterion requires a project, flow, prose intent or Flows landing for direct control. Depends: none.
- [x] **T02 · P0 · Runtime/API — Freeze the v1 surface operation catalogue.** Requirements: SF-03, SF-06, SF-07, SF-09–SF-11, SF-14. Specify typed operations, action aliases, capability metadata, result envelope, structured errors and CLI exit mapping. Inventory every existing adapter action and all arguments from `AgentSurface`, including `ref2`, `name`, snapshot options and cancellation limits. **Done:** reviewed machine-readable catalogue and golden valid/invalid requests; generated CLI/MCP/service schemas agree. Depends: T01.
- [x] **T03 · P0 · QA — Turn audit failures into regression cases.** Requirements: SF-03, SF-17, SF-21. Reproduce unknown surface commands, ignored adapter, missing UI action form, missing-intent snapshot 500, and absent lifecycle tools with disposable projects. Preserve evidence labels distinguishing harness limitations. **Done:** tests fail for the observed reason on the baseline and are linked to the relevant requirement. Do not encode today’s failures as the desired behavior. Depends: none.

**M0 gate:** mission and API acceptance criteria are concrete; baseline failures are reproducible; the three specifications have traceability.

## M1 — Make live control an independent core

- [x] **T04 · P0 · Runtime — Extract surface control from project loading.** Requirements: SF-01, SF-03, SF-12. Add `packages/surface-control`, inject adapter factories and update import boundaries. Move duplicated capture/dispatch behavior out of `packages/cli/src/commands/mcp.ts` and `service-api.ts`; retain versioned legacy exporters. **Done:** connect/snapshot/act/check work with no flow/compiler/binding load and no model credential. Invalid unrelated flow files cannot prevent surface control. Depends: T02, T03.
- [x] **T05 · P0 · Service — Implement broker discovery and session lifecycle.** Requirements: SF-04, SF-05, SF-13, SF-15. Add projectless service startup, private endpoint discovery, token lifecycle, session/target inventory, attach/launch ownership, TTL and shutdown. Use OS-specific user-state paths and owner-only permissions. **Done:** separate CLI processes share a session; two targets coexist; close/expiry cleans owned resources but preserves attached user apps; stale descriptor recovery is tested. Depends: T04.
- [x] **T06 · P0 · Adapters — Implement target and capability discovery.** Requirements: SF-04, SF-09, SF-23. Add browser/tab, HTTP endpoint and native window discovery contracts; capability-backed readiness/doctor results across registered adapters. Remove hardcoded UI adapter choices as a source of truth. **Done:** invalid/unavailable adapter is refused before launch; service returns the effective adapter and target; multiple matches require selection. Unsupported platform rows are explicit. Depends: T02, T05.
- [x] **T07 · P0 · Runtime — Enforce reference scope and preconditions.** Requirements: SF-10, SF-11. Add generation-bound refs, structured snapshot nodes, truncation/cursors, target identity validation and stale recovery. Verify internal logging snapshots do not retarget caller refs. **Done:** navigation, replacement, second-tab and cross-session mutation cases touch no incorrect target; unsupported operations never dispatch. Depends: T04, T06.
- [x] **T08 · P0 · Runtime — Implement operation coordination and recovery.** Requirements: SF-11, SF-13, SF-14. Add target-level mutation arbitration, leases, handoff, deadlines, operation status, cancellation and deduplication. Persist dispatch state and distinguish unknown outcomes from failure. **Done:** two-client contention, crash-after-dispatch, lost response and duplicate-key tests produce no duplicate fixture side effect. Report adapter cancellation limits honestly. Depends: T05, T07.
- [x] **T09 · P0 · Security/evidence — Unify redacted session events and artifacts.** Requirements: SF-12, SF-15, SF-21. Separate technical event metadata from optional user intent; scope artifact reads, mask secrets and add bounded retention/export. Include refused/failed calls without accidentally executing them. **Done:** synthetic secrets never appear in result, protocol text, persisted event, trace or screenshot; unauthenticated and wrong-owner access fail; direct reads need no intent. Depends: T04, T05, T08.

**M1 gate:** one core supports a projectless web/HTTP/native session with explicit capability limitations and tested lifecycle/error semantics.

## M2 — Ship the standard human and agent interfaces

- [x] **T10 · P0 · CLI — Implement the direct command family.** Requirements: SF-01, SF-02, SF-06. Implement the operation table in `design.md`, top-level examples and help, stdin/file arguments, JSON/NDJSON behavior and stable exit codes. Generate “Copy CLI” data from real command definitions. **Done:** empty-directory connect→snapshot→act→check→close works across separate processes; every help example executes; malformed input remains machine readable; SIGINT is bounded. Depends: T05–T09.
- [x] **T11 · P0 · MCP — Publish surface-first stdio tools.** Requirements: SF-03, SF-07, SF-12, SF-20. Implement lifecycle, capability, describe, screenshot, event/status and handoff tools; structured content/output schemas and accurate annotations. Default to surface tools, add automation/legacy profiles. **Done:** generic SDK subprocess client completes the primary journey with no project/intent; initialization, tool discovery, invalid input, cancellation and disconnect are tested. Depends: T02, T05–T09.
- [x] **T12 · P0 · Service/SDK — Generate transport parity and compatibility.** Requirements: SF-03, SF-11, SF-19. Publish `/v1` routes from the catalogue and generate TS/Python/Java clients. Forward old `/surface` routes to the dispatcher with documented legacy translation. **Done:** shared corpus tests all supported arguments and error outcomes through CLI/MCP/HTTP; drag second ref, attribute name and maxNodes no longer disappear. Old supported clients still operate. Depends: T10, T11.
- [x] **T13 · P0 · Packaging/docs — Validate clean installation.** Requirements: SF-02, SF-07, SF-20. Update README, CLI README, MCP/REPL docs and quick starts. Use `@svatah/yam` package naming, installed binary paths and no repository-specific setup. Separate basic surface install from optional platform prerequisites and automation tutorials. **Done:** packed artifacts install outside the workspace, copied CLI/MCP examples pass there and no fake gateway appears in user defaults. Publish only through the existing release process. Depends: T10–T12.

**M2 gate:** the same live target is controllable through CLI, generic MCP and service/SDK without a flow. Error/schema parity is tested with real transports, not only in-memory wrappers.

## M3 — Replace the flow-first desktop journey

- [x] **T14 · P0 · UX — Implement the Surfaces shell and connect flow.** Requirements: SF-02, SF-04, SF-16–SF-18. Build Surfaces/Automations/Activity/Settings navigation in `packages/screens` and `apps/desktop`; add projectless startup, target chooser, readiness recovery and explicit attach/launch. Reuse accessible components/tokens. **Done:** connect and initial snapshot require no project; Surfaces is the default; unavailable adapters have an honest state; 1280×800 and 1440×1000 primary controls remain usable. Depends: T05, T06, T12.
- [x] **T15 · P0 · UX/runtime — Build the selected-target action inspector.** Requirements: SF-09–SF-11, SF-16–SF-18. Add semantic tree/preview selection, typed action inputs, checks, read/screenshot, progress and concise last-result feedback. Refresh on connect/action; place protocol details behind disclosure. **Done:** fill/click/drag/navigation/HTTP forms pass schema-valid requests, every offered action can be completed from the UI, and “Choose an action” cannot be a dead end. No toolbar overlap at stated sizes/zoom. Depends: T07, T08, T14.
- [x] **T16 · P0 · UX — Add shared control and agent setup.** Requirements: SF-05, SF-07, SF-13, SF-14, SF-17. Show agent-created sessions, owner/busy state, handoff and unknown outcomes; add copyable generic MCP configuration and connection test. **Done:** agent and person see one session and safely hand off; loss of connection offers inspection instead of replaying an uncertain action. Depends: T11, T14, T15.
- [x] **T17 · P1 · UX/automation — Regroup automation features and promotion.** Requirements: SF-19. Put flow authoring, record/heal/bindings and tool exposure under Automations, run evidence under Activity, and add Save as automation with review. Preserve project deep links, data and artifact compatibility. **Done:** old fixtures compile/replay with unchanged expected hashes/results; promotion creates unverified proposals only; the direct journey remains independent. Depends: T09, T14, T15.

**M3 gate:** formative human test and keyboard/visual checks pass the requirements; desktop control exercises the same dispatcher as CLI/MCP. Existing automation screens remain reachable during rollout.

## M4 — Prove the mission and release it honestly

- [x] **T18 · P0 · QA — Make Yam control the real packaged Yam.** Requirements: SF-18, SF-21. Promote the audit harness into `evals/self` with proper launch/readiness helpers. Use public CLI/MCP to drive Surfaces, connect, act, verify and close through AX and browser attachment independently; retain external screenshot/geometry/axe and fixture-state oracles. Browser-hosted renderer evidence stays labelled as such. **Done:** native target bootstraps on a provisioned runner and the public-interface suite passes with no hidden selector-based UI actions. A deliberately wrong postcondition fails the gate. Depends: T10–T16.
- [x] **T19 · P0 · QA/release — Publish coverage and performance.** Requirements: SF-09, SF-18, SF-20, SF-21. Report attempted/reached/passed/failed/blocked checks by platform/interface; run clean-package quick starts and defined timing budgets. Revalidate existing BiDi/Appium/UIA paths or mark them unvalidated with exact host reasons. **Done:** P0 scenarios pass; blocked required platforms block claims; no 100%-agreement headline omits the reachability denominator. Depends: T13, T18.
- [x] **T20 · P0 · Product/docs — Finish migration and release review.** Requirements: SF-01–SF-21 (P0 portions). Update support matrix, install/setup examples, user guidance, deprecations and screenshots to the shipped behavior. Verify zero unexpected changes to user project artifacts. **Done:** no broken copied command, unsupported universal claim or old Flows landing promise remains in active docs; release review includes real evidence and open limitations. Depends: T19.

## M5 — Extend reach without weakening the core

- [ ] **T00 · P0 · QA — Make the Yam-on-Yam suite dependable, and the parity gate conformant.** Requirements: SF-18, SF-21. Root-cause the intermittent `SESSION_NOT_FOUND` in `evals/self/yam-on-yam/`, fix the cause rather than the symptom, and run the suite ten times in a row unattended with the ten results published. Resolve the two disagreements in `reports/self-parity.md` by naming which oracle was wrong. Put the suite in CI behind the packaged build. **Done:** ten consecutive runs report the same attempted count and no failure; every pass declares its checks so the denominator does not move with the result; the parity report is conformant, or each remaining one-sided row names the oracle that was wrong. Depends: T18, T19. *(Not in the original plan: it came out of wave 4's verification, which left the suite passing without passing every time — see [progress/wave-4.md](progress/wave-4.md) "The reliability gap, stated rather than averaged".)*
- [ ] **T21 · P1 · MCP/service — Add Streamable HTTP MCP.** Requirement: SF-08. Pin protocol/SDK versions, implement negotiated transport, authentication and version-specific cancellation semantics. **Done:** generic remote-capable client passes the same conformance corpus and isolation/reconnect tests as stdio; no accidental exposure beyond configured scope. Depends: T11, T12.
- [ ] **T22 · P1 · Adapters — Deliver process/PTY.** Requirement: SF-22. Implement terminal snapshots, input, streams, signals, exit state and bounded artifact/filesystem access; incorporate existing planned `REQ-ADP-10` work. **Done:** Yam itself drives CLI/TUI smoke cases and checks exit/state; no undisclosed shell escape or out-of-root reads. Depends: T06–T09, T18.
- [ ] **T23 · P2 · Adapters — Expand native/mobile coverage.** Requirement: SF-23. Implement AT-SPI and close discovery/capability gaps for Appium/UIA/BiDi against provisioned platform runners. **Done:** each newly supported capability has a reproducible conformance result, limitations and version range; support labels are evidence-derived. Depends: T06, T07, T19.

## Requirement coverage index

| Requirements | Tasks |
|---|---|
| SF-01–SF-02 | T01, T04, T10, T13, T14, T20 |
| SF-03 | T02–T04, T11, T12 |
| SF-04–SF-05 | T05, T06, T14, T16 |
| SF-06–SF-08 | T02, T10–T13, T16, T21 |
| SF-09–SF-11 | T02, T06–T08, T12, T15, T19 |
| SF-12 | T01, T04, T09, T11 |
| SF-13–SF-15 | T05, T08, T09, T16 |
| SF-16–SF-18 | T00, T01, T03, T14–T16, T18, T19 |
| SF-19 | T01, T12, T17 |
| SF-20–SF-21 | T00, T03, T09, T11, T13, T18–T20 |
| SF-22–SF-23 | T06, T22, T23 |

Suggested first implementation slice: T01–T05, then a narrow T10/T11 web journey and its failing-input cases. This produces a working public control path before investing in the full UI. Do not begin by renaming sidebar entries while leaving the session/API gaps intact.
