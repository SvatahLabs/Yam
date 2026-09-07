# Surface-first wave 3 progress

Wave 3 replaces the flow-first desktop with the surface-first one: T14 (Surfaces
shell and connect flow), T15 (action inspector), T16 (shared control and agent
setup), T17 (automations regrouped). This record is written as each task lands.

Branch: `surface-first-wave-3`, from `master`.

---

## Pre-existing failures on `master` repaired to reach a green gate

The wave-3 contract requires the whole gate (`pnpm -r build && -r typecheck && -r
test && lint`, and `pnpm docs:check`) to pass. Verifying the base found several
failures already present on `master` — none introduced by wave 3, each confirmed
by the files being unmodified by this branch. They are repaired here, minimally,
because a red gate cannot be handed to the verifier; the change to each is small
and unambiguous, and flagged to the owner at the T14 checkpoint.

| Failure | Cause (inherited from waves 1–2) | Repair |
|---|---|---|
| `tools/repo-checks/test/layout.test.ts` — "expected 32 to be 31" | `packages/surface-control` was added as the 32nd package and listed in HLD §12, but the count constant was not bumped. | `31` → `32`, with the reason. |
| `tools/repo-checks/test/yam.test.ts` — CHANGELOG/release count | `surface-control` is publishable (release set is 31), but CHANGELOG and `release.yml` still said 30. | 30 → 31 in `CHANGELOG.md` and `.github/workflows/release.yml`. |
| `tools/repo-checks/test/docs.test.ts` — broken link | `packages/surface-control` had no `README.md`, though its `package.json` publishes one and the generated docs page links to it. | Added `packages/surface-control/README.md`; regenerated `docs/reference/generated`. |
| `apps/desktop/test/review.test.ts` — explorer "no intent" | Asserted the *old* intent-required explorer; SF-12 (this wave's requirement) makes intent optional. | Updated to assert a no-intent call is accepted (SF-12); the Explorer routes are retired in T15. |
| `packages/cli/test/{explore,mcp}.test.ts` — typecheck | Stale test types: `answer()` typed `{text}` but surface tools answer the wave-2 envelope; a `report` cast omitted `written`. | `answer()` → `unknown` (each site casts); added `written` to the cast. |

---

## T14 — The Surfaces shell and the connect flow

**Status:** complete (pending owner review at the task-by-task checkpoint).

**Requirements:** SF-02, SF-04, SF-05, SF-16, SF-17, SF-18.

### The one contract reaches the desktop (foundation)

The desktop was the only client that could not reach the broker: wave 2 served
the catalogue's routes (`/targets`, `/sessions`, `/sessions/:session/*`) but they
were absent from the service's OpenAPI, so the app's generated client had no
method for them. Closed here without the desktop growing a session store of its
own:

- `packages/service/src/openapi.ts`: the catalogue's service routes are described
  (bare paths, matching what the service already serves). Written out rather than
  imported, because the service may not import `surface-control` (LLD §1) and
  `contract.test.ts` pins the served document to `openApiDocument("0.1.0")`.
- `tools/repo-checks/test/surface-catalogue-openapi.test.ts` (new): fails when a
  catalogue operation's method or bare path is missing from the document — so the
  hand-written copy is a red build, not silent drift (the wave-2 failure mode).
- `apps/desktop/src/renderer/client.generated.ts`: regenerated; gains
  `getTargets`, `postSessions`, `getSessions`, `deleteSessionsBySession`,
  `getSessionsBySessionCapabilities` and the `postSessionsBySession*` family.
- `packages/screens/src/service.ts` + `fake.ts`: `ScreenService` gains those
  methods; the fake answers the catalogue's `ResultEnvelope`.
- The SDK/Python/Java clients were regenerated (`node scripts/generate-clients.mjs`).

### The screen model

- `packages/screens/src/screens/surfaces.ts` (new): the `surfaces` screen. Loads
  `GET /targets` + `GET /sessions`, groups adapters by platform family (Browser /
  API / Native app / Device), carries each adapter's readiness and its exact
  prerequisite when unavailable, lists open sessions with a status pill, and
  reads a discovery failure inline (never blanking the screen). Holds no session
  store, no operation list — a client of the broker and nothing else.
- `packages/screens/src/types.ts`: `surfaces` added to `SCREEN_IDS` (first, so it
  is the default); `url` added to `ScreenParams`.
- `packages/screens/src/index.ts`: primary navigation is now `SECTIONS` —
  Surfaces, Automations, Activity, Settings — with `sectionOf`/`defaultScreenOf`;
  `RAIL` is derived from the sections. Surfaces opens by default.
- `packages/screens/src/registry.ts`: `surface.connect` (`yam surface connect
  --url`), `surface.disconnect` (`yam surface close`), `surface.discover` (`yam
  surface targets`). A connect reports the adapter the service *used*, never the
  one asked for; a refusal carries the service's own reason (SF-04, SF-17).
- `packages/screens/fixtures/palette.json`: regenerated (+4 rows); the action
  registry, the palette fixture and the CLI still agree (action-parity green).

### The renderer

- `apps/desktop/src/renderer/shell/Surfaces.tsx` (new): the screen and its
  inspector. The connect form — URL, an Advanced adapter chooser, the primary
  **Connect surface** button — is its own bar under the toolbar, *not* crammed
  into the 40px toolbar (see the defect the driven test caught, below). Discovery
  is grouped by family with an honest `requires` column; the sessions list marks
  the selected session for the inspector.
- `apps/desktop/src/renderer/shell/Shell.tsx`: the rail is the four sections, each
  a header that opens its default screen with its screens beneath; Surfaces is the
  default; the crumb is section-first. `Surfaces` is wired into both dispatch
  tables.
- `apps/desktop/src/main/index.ts`: **projectless startup**. With no
  `YAM_APP_PROJECT`, the app opens a service on a private, empty workspace under
  the user-data directory and comes up on Surfaces — no project chooser, and the
  workspace is not remembered. Surfaces reaches only the broker, so nothing is
  written there (SF-01).

### Validate — every item demonstrated by something re-runnable

Model-level, against a real fake broker (the catalogue's envelopes):
`pnpm --filter @svatah/yam-screens test` — 61 tests, incl. `test/surfaces.test.ts`
(11): discovery grouped with an unavailable adapter's exact prerequisite; the
empty state in the design's own words; a disconnected session's pill; a discovery
failure carried inline (base error unset); connect refusing with no URL and never
touching the broker; connect reporting the adapter the *service* used; connect
surfacing the service's refusal reason; disconnect only when a session is
selected; recheck.

Contract/wiring, against a real service:
- `pnpm --filter @svatah/yam-service exec vitest run test/contract.test.ts` (42) —
  served `/openapi.json` equals the document; catalogue routes described.
- `pnpm --filter @svatah/yam-desktop exec vitest run test/client.test.ts` (3) —
  the committed client is exactly what the description generates; one method per
  route.
- `pnpm --filter @svatah/yam-repo-checks exec vitest run test/surface-catalogue-openapi.test.ts`
  (2), `test/action-parity.test.ts` (10).

Driven — the real built renderer, in headless Chromium, over a real projectless
`yam serve` and its broker, connecting through the real Playwright adapter
(`apps/desktop/test/surfaces-dogfood.mjs`, the dogfood.mjs approach aimed at
Surfaces), at **1440×1000** and **1280×800**:

`pnpm --filter @svatah/yam-desktop exec node test/surfaces-dogfood.mjs` — the
harness builds the renderer and drives it. **18/18 checks pass at both sizes**,
stable across repeated runs (the flake below was fixed):

```
[1440x1000] opens into Surfaces by default — title=Surfaces
[1440x1000] the Surfaces section is current
[1440x1000] empty state invites a connection            (design's own words)
[1440x1000] discovery lists a Browser adapter           (playwright, real broker)
[1440x1000] an unavailable adapter shows an honest reason
[1440x1000] connect field and button are usable, no overlap
[1440x1000] the session shows the adapter the service used — s_… playwright · web ready
[1440x1000] the connected session is selectable and inspectable
[1440x1000] disconnect closes the session
… and the same nine at 1280x800.
```

The connect is keyboard-only (focus the URL, type, Enter) and reaches a real
session through the real Playwright adapter over the real broker — no project,
nothing written to the workspace. Screenshots (in the harness's temp dir):
`surfaces-empty-{1440x1000,1280x800}.png`, `surfaces-connected-{…}.png`.

**Two real defects the driving found and fixed** — not asserted-about-code:

1. **Toolbar overlap at 1440×1000.** The connect URL field, in the 40px toolbar,
   overlapped the Connect button (`url.right=693 > connect.x=635`) — the exact
   class the audit named. Fixed by moving the connect form to its own bar
   (`.sv-surfaces-connect`); re-driven clean at both sizes.
2. **A reload storm raced selection.** The URL field was model-controlled, so the
   model re-loaded on every keystroke; that churn made selecting the connected
   session flaky (passed at 1440, failed at 1280 in the same run). Fixed by
   holding the URL and adapter as the window's own draft state (the API screen's
   `draft` pattern) and handing them to the connect action — no per-keystroke
   reload. Selection is reliable across repeated runs afterwards.

### The defect the driven test caught

A screenshot of the happy path is not evidence. Driving the real renderer at
1440×1000 found the connect **URL field overlapping the Connect button in the
toolbar** — the same class the audit named ("the old Explorer's controls
overlapping at 1440×1000"). Fixed by moving the connect form out of the 40px
toolbar into its own bar (`.sv-surfaces-connect`); re-driven clean at both sizes.

### SF-17 state coverage (T14's connect-flow states)

`loading` (renderer shows "Loading…" before the model resolves), `empty` (design
wording), `unsupported` (an adapter unavailable with its exact prerequisite),
`disconnected` (session pill), and discovery `error` (inline, recoverable) are
covered by the model tests and the driven run. `permission-denied`, `busy`,
`stale` and `unknown-outcome` belong to the selected-target action inspector and
shared control — they are driven in T15/T16, against a session, and are noted
here rather than claimed.

### Downstream updates the nav change required

Adding the `surfaces` screen and reordering the rail rippled into other renderers
and cross-checks, each updated to the new information architecture:

- `apps/desktop/test/screen-rule.test.ts`: `Surfaces.tsx` added to the per-screen
  file list.
- `apps/desktop/test/shell.spec.ts`: the "opens into Flows" case became "opens
  into Surfaces by default"; it drives the four sections and Flows one click away.
  (It runs against the packaged app, so it skips in the gate as `shell.spec` does.)
- `packages/tui/test/cockpit.test.tsx`: the `[`/`]` rail-walk expects the
  surface-first order (`flows` → `bindings`), and "twelve screens" → "thirteen".
- `evals/self/checks.yaml`: the renamed app-Playwright case name updated to match;
  the `yam` self-story that drives the same journey is revalidated in M4.

### Deviations

- **Explicit attach vs. launch (SF-04).** The catalogue's `connect` takes a URL,
  adapter and `headed` — it has no `targetId`, so "attach to a discovered target"
  is not expressible through it yet. T14 implements URL connect (launch) and the
  adapter the service returns; attaching to an already-running target needs a
  `targetId` on the `connect` operation the wave-2 catalogue does not carry. Left
  for reconciliation (extend the catalogue, or T16's shared-control work), not
  silently marked done.
- **Keyboard row selection (SF-18).** Keyboard-only *connect → close* works (focus
  the URL, type, Enter; the new session is auto-selected; Disconnect is live). But
  the sessions/adapters tables are `@svatah/yam-ui`'s `Table`, whose rows are not
  yet keyboard-focusable, so *choosing among several sessions* by keyboard rides
  on a `Table` enhancement made in T15 (where row selection drives the inspector).
- **TUI rail.** `packages/tui` still reads `RAIL` as a flat list; its section
  grouping is a T17 follow-up. It compiles and runs; the desktop is this wave's
  subject.

### Known gaps

- The Explorer (`explorer` screen and `/surface/:session/*` routes) is still
  present, transitional; T15 replaces it. Two "surface" screens coexist until then.
- Projectless main-process startup is verified by the renderer harness over a real
  service and by the main-process unit tests; a packaged-app launch-into-Surfaces
  case is added in `apps/desktop/test/surfaces.spec.ts` for the verifier to run
  when the app is packaged (it skips otherwise, as `shell.spec.ts` does).
