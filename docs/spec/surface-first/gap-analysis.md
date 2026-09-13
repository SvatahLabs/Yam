# Yam mission gap analysis and dogfooding report

Audit date: 2026-09-07, America/Los_Angeles. Baseline commit: `a7557ae3f22a3bc2d7510c22184b485436ed88a9`. See [build metadata](evidence/metadata.json) for the exact existing artifacts inspected. This is a product and contract audit, not a full security review or adapter certification.

## Finding

Yam has much of the right execution foundation, but its primary product journey implements **author a behavior → bind → replay**, while the requested mission calls for **connect to a surface → inspect → act → verify**. Surface control currently serves flow creation. The desktop's information architecture and the public command/API gaps make that inversion visible.

The appropriate change is to elevate and finish the surface layer, standardize its public contract, and redesign the first journey around a live target. Rebuilding the adapters or adding another agent planner would miss the main gap. Flows, bindings, healing and runs retain value as optional ways to reuse and investigate successful automation.

## What already works and should be kept

The existing [AgentSurface contract](../../../packages/surface/README.md) separates callers from platform locators; adapters provide snapshot/act/read/check and typed errors. The repository registers Playwright, BiDi, Appium, HTTP, AX and UIA. Model-free replay, bindings/fingerprints, provenance and external conformance oracles are substantial foundations.

MCP is **already present**: this audit's real stdio `tools/list` returned seven project-operation tools and five raw surface tools. Yam MCP successfully read its own renderer, followed semantic references, typed in its own Intent field and checked its own error message. The finding is incomplete scope and parity, not “Yam has no MCP.” Likewise, the local service already owns multiple explorer sessions in memory; what is missing is a coherent public lifecycle and shared ownership contract across all clients.

## Gap register

Evidence levels: **Observed** means this audit executed the path; **Source** means current implementation/specification was inspected; **Historical** means an existing report, not a rerun. P0 is a surface-first release blocker, not a claim that every issue is a production emergency.

| ID | Priority / evidence | Gap and user impact | Traceability |
|---|---|---|---|
| G01 | P0 · Observed + Source | Front door leads with flows. CLI help describes behaviors, binding and replay. Desktop defaults to Flows, puts Run/Record/Bind targets in the toolbar and omits Explorer from its rail. A basic user must learn the automation authoring product before finding live control. | SF-01, SF-02, SF-16; T01, T10, T14 |
| G02 | P0 · Observed | `yam surface snapshot --json` and `yam surface act --json` both exit 64 with “Unknown surface subcommand.” The UI action registry nevertheless advertises those commands. A promised human/agent CLI path is absent. | SF-03, SF-06; T03, T10, T12 |
| G03 | P0 · Observed + Source | Explorer opens a session but supplies no action selector or typed argument form. After entering intent and clicking Act, it says “Choose an action.” The action registry requires an action that the renderer never collects. This is a broken control journey, not a styling preference. | SF-11, SF-16, SF-17; T03, T15 |
| G04 | P0 · Observed + Source | Adapter selection is cosmetic at the service boundary: `/surface/probe/open` with `adapter: does-not-exist` returns 200 and opens the configured Playwright surface. The route forwards only `headed`. Users cannot trust the displayed choice to define what is controlled. | SF-03, SF-04, SF-09, SF-17; T03, T06, T12 |
| G05 | P0 · Observed + Source | Intent is mandatory for even basic MCP inspection. HTTP snapshot without intent reaches a trajectory validation error and returns 500, while read returns 400 `missing-intent`. Compilation concerns burden live control and error semantics vary across operations. | SF-03, SF-11, SF-12; T03, T04, T09, T11 |
| G06 | P0 · Observed + Source | MCP exposes one lazily opened surface per server, with no public target discovery, connect/close, list sessions, capabilities or describe tools. Opening it loads a project and its flows/steps/bindings. HTTP has session open/close but no equivalent complete lifecycle. Agents cannot discover and manage surfaces through one portable interface. | SF-01, SF-04–SF-07, SF-09; T04–T06, T10–T12 |
| G07 | P0 · Source | HTTP surface wrappers drop `ref2` for drag, `name` for attribute reads, and snapshot options other than interactiveOnly. MCP has separate schemas and dispatch code. Sharing an adapter underneath has not produced interface parity. | SF-03, SF-06, SF-11; T02, T04, T12 |
| G08 | P0 · Observed + Source | MCP returns text-only payloads with no output schemas/structuredContent in the observed tools/results. Some operations return serialized JSON while `surface_read` can return a plain string. This is usable MCP, but callers must understand Yam-specific parsing. Action arguments are a loose record and check predicates a generic object. | SF-03, SF-07, SF-11; T02, T11 |
| G09 | P0 · Source | Core references/capabilities exist, but the public contract lacks a consistent session/target/snapshot revision envelope and shared concurrency, handoff and outcome-recovery semantics. MCP performs internal snapshots before calls for recording. Those semantics need adversarial validation before claiming dependable multi-client control; this audit did not demonstrate a wrong-target action. | SF-05, SF-10, SF-13, SF-14; T05, T07, T08 |
| G10 | P0 · Observed visual + Source | At 1440×1000, Explorer's Adapter/Open controls overlap and its title/metadata truncate. Most space goes to an empty trajectory and a compilation inspector, rather than the target or available actions. Flow landing spends large areas on comments, technical tiers and an empty inspector. These are observed hierarchy/layout issues; contrast and accessibility compliance were not measured here. | SF-16–SF-18; T14, T15, T18 |
| G11 | P0 · Source | Installation/docs do not foreground the standalone surface product. `docs/mcp.md` suggests `npx yam`, while the actual CLI package is `@svatah/yam`; package/app READMEs contain phase-era descriptions inconsistent with implemented features. Fresh-install behavior and registry availability were not tested. | SF-02, SF-20; T13, T20 |
| G12 | P1/P2 · Source + Historical | “Any surface” is ahead of evidenced breadth. Six adapters are registered; process/PTY and AT-SPI are not registered. WebMCP is browser-adapter behavior, not a seventh universal adapter. The existing self report names missing terminal access and incomplete native coverage. | SF-09, SF-21–SF-23; T06, T19, T22, T23 |
| G13 | P0 · Historical + this audit's scope | The existing self report headlines 100% agreement over 29 shared checks, but Yam reached only 30 of 48. Agreement is valuable and does not measure the unreached product journey. Native desktop could not be validated in this audit. Coverage and host blocks must be visible alongside parity. | SF-18, SF-21; T18, T19 |

Source locations: [front-door help](../../../packages/cli/src/help.ts), [desktop shell](../../../apps/desktop/src/renderer/shell/Shell.tsx), [rail](../../../packages/screens/src/index.ts), [action registry](../../../packages/screens/src/registry.ts), [Explorer renderer](../../../apps/desktop/src/renderer/shell/Secondary.tsx), [MCP implementation](../../../packages/mcp/src/server.ts), [project loader](../../../packages/cli/src/project.ts), [HTTP routes](../../../packages/service/src/server.ts), [surface dispatch wrapper](../../../packages/cli/src/service-api.ts), [adapter registration](../../../packages/cli/src/adapters.ts), [MCP setup docs](../../mcp.md), [historical self report](../../../reports/self-parity.md). These paths are repository evidence; proposed requirements take precedence only when adopted for implementation.

## How I used Yam to validate Yam

The retained [harness](evidence/dogfood.mjs) starts a real Yam service over a disposable copy of the fixture project, hosts the existing built desktop renderer in headless Chromium and supplies the Electron preload bridge's connection/preferences functions. A local proxy supplies same-origin access to the actual service; no screen responses or action outcomes are mocked. The target opened inside Explorer is a tiny local audit page with a button.

Playwright only provisions Chromium/context and loads the renderer. All observed UI navigation, typing, reading and checking are performed through **the real `yam mcp` subprocess and Yam's Playwright adapter**, using refs returned by Yam snapshots. Screenshot capture uses Yam's `screenshot()` adapter API because MCP has no dedicated screenshot tool. This is a meaningful Yam-on-Yam browser-surface test; it does not validate Electron preload, installer, native permissions, AX or UIA. Existing build artifacts were used and source was inspected to corroborate findings; this was not a clean release build.

The final harness exited 0, meaning the audit sequence completed. Several operations intentionally returned failures; exit 0 is not a claim that the audited product passed.

| Probe | Result |
|---|---|
| CLI help | Flow-oriented primary commands observed. |
| CLI snapshot/act | Both exit 64; retained stdout/stderr. |
| MCP initialize + tools/list | Succeeded through standard SDK stdio transport; 12 tools listed. |
| MCP surface_snapshot with intent | Succeeded against Yam renderer. |
| MCP surface_snapshot without intent | Rejected with tool input validation error. |
| MCP surface_read title | Returned `Yam`. |
| MCP click command palette → Surface explorer | Succeeded using observed semantic refs. |
| MCP click Open a session | Explorer opened a session on the local audit target. |
| MCP type intent → click Act on the element | UI displayed `Choose an action.` |
| MCP surface_check of that message | Returned `ok: true` and the actual observed text: Yam verified its own UX dead end. |
| HTTP open with nonexistent adapter | Returned 200 instead of refusing the adapter. |
| HTTP snapshot without intent | Returned 500 with a Zod validation message. |
| HTTP read without intent | Returned 400 with `missing-intent`. |
| HTTP close | Returned 202. |

[Raw calls/results](evidence/dogfood.json) · [Yam trajectory](evidence/trajectory.jsonl) · [landing screenshot](evidence/yam-landing.png) · [Explorer screenshot](evidence/yam-explorer.png) · [verified action dead end](evidence/yam-explorer-action.png).

Run from repository root with dependencies and existing CLI/renderer builds available:

```sh
node docs/spec/surface-first/evidence/dogfood.mjs
```

The harness needs local loopback binding and Chromium launch privileges, and currently reserves CDP port 9471. It writes artifacts beside itself and uses disposable projects under the OS temp directory. It closes its broker/browser clients on completion; temp project files are retained for investigation. No model, external target, account or production data is used. Repeat runs replace evidence output, so preserve a baseline elsewhere before comparing versions.

## Validation limitations and failed setup attempts

- Initial sandbox Chromium launch failed with a macOS Mach-port permission denial; loopback service startup also failed. The final local harness ran outside that sandbox after automatic approval. These are environment constraints, not adapter correctness failures.
- [Yam doctor under the sandbox](evidence/doctor-sandbox.json) reported AX accessibility unavailable, no window-owning desktop session and screenshot permission/display failure; UIA was skipped on macOS. This result does not establish the user's actual global permission state.
- `_electron.launch` could not launch/attach the packaged build in the attempted configuration; an elevated attempt timed out. The repository already documents that its packaged RunAsNode fuse requires a different launch/attach path. Treat this as a harness/coverage limitation, not evidence that Yam.app itself cannot launch. No native desktop pass is claimed.
- The existing `scripts/self-http.mjs` attempt failed at service bind under sandbox restrictions; [its output](evidence/self-http-sandbox.txt) is retained. The full self suite, mobile/Windows/Linux conformance, fresh installation, browser matrix and independent accessibility/performance tests were not rerun.
- The final audit harness initially needed corrections for optional fixture folders, ESM imports, config loading, same-origin service access and asynchronous screen loading. These were harness defects and are not included as product gaps.

## Recommended scope

Make projectless live control, a complete standard CLI/MCP contract, explicit target/session identity, and usable contextual UI actions the first release boundary. Move flows and runs into secondary navigation while preserving their artifacts and functionality. Then extend transport/platform coverage and optional session-to-automation promotion. The [requirements](requirements.md) define 23 traceable requirements; [tasks](tasks.md) provides 23 dependent implementation tasks and release gates.
