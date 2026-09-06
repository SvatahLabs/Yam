# Svatah ADE

The Automation Development Environment: an Electron client for the local service,
and the service's reference client (REQ-ADE-1, 2).

```bash
pnpm -r build                      # the CLI the ADE spawns
pnpm --filter @svatah/ade start    # run it
pnpm --filter @svatah/ade make     # installers for this platform
pnpm --filter @svatah/ade smoke    # open the fixture project and quit
```

Each of those fetches Electron's runtime binary first if it is not there.
`electron`'s own postinstall does not reliably run under pnpm — a store hit
installs the package without its binary — and the failure it causes is
confusing, so the scripts run one idempotent downloader rather than leaving a
person to discover it.

Developed in this repository until its first tagged release, then split to the
`svatahADE` repository (HLD ADR-17, Draft 2.4). It is also the desktop
conformance target for the UIA and AX adapters (REQ-ADP-6, 7).

## The rule the whole thing is built around

**Every screen renders a service response or a project file, and nothing the CLI
cannot produce** (T3.7). The project directory is the only source of truth; the
ADE stores a theme, a window size and a list of recent projects, and nothing else
(REQ-ADE-2).

Three things make that structural rather than aspirational:

- The renderer's service client is **generated** from `GET /openapi.json`
  (`scripts/generate-ade-client.mjs`), so a screen can only call a route the
  service publishes. `test/client.test.ts` regenerates it and diffs.
- Every value a screen displays carries the endpoint it came from
  (`fromEndpoint`), and `test/screen-rule.test.ts` reads the renderer's sources
  and fails on a call or an attribution that is not a real route.
- The preload bridge is **four functions** — `openProject`, `serviceInfo`,
  `pickFile`, `preferences` — with no generic `invoke`. Everything else goes over
  HTTP to the service, which calls the CLI's own functions.

`test/parity.test.ts` is the consequence, checked: an edit through the ADE and a
compile from the CLI give the same plan hash, a run started through the ADE
writes the same `runs/<id>` files, and the editor's lint is `svatah lint --json`.

## The accessibility variants (`SVATAH_A11Y_VARIANT`)

The ADE is the desktop conformance target (REQ-ADE-6), and Draft 2.8 LLD §16
makes it the desktop *healing* target too. `SVATAH_A11Y=1` publishes the
renderer's accessibility tree; `SVATAH_A11Y_VARIANT` then changes one thing
about the interface, so that a binding recorded against the real one can be
measured against a changed one — the desktop half of what
`apps/sample-web/VARIANTS.md` is for the web.

| Variant | What changes | What it breaks |
|---|---|---|
| `0` (unset) | nothing — the real interface | — |
| `1` | the rail's **Flows** row becomes **Editor**; the welcome screen's **Open a project…** button becomes **Choose a project…** | the *name* a binding matched on; the structure is untouched |
| `2` | the Record screen's gateway control moves out of the toolbar and into the session panel's head | the control's *place* in the tree — its `controlPath`, its neighbours, its sibling index and its box; the name and the role are untouched |

Both keep every control's `id`, which is what the desktop adapters publish as
`automationId` and what the healing cases use as ground truth — the equivalent
of `apps/sample-web`'s `data-svatah-eval`, and excluded from scoring for the
same reason.

The variant reaches the renderer as a query parameter on the window's URL rather
than through the preload bridge, because LLD §13.6 says that bridge exposes four
functions and only those four.

```bash
SVATAH_A11Y=1 SVATAH_A11Y_VARIANT=1 open -a "…/Svatah ADE.app"

# and the gate that drives all three, launching the ADE once per variant:
node scripts/desktop-conformance.mjs --adapter ax --report reports/adapter-ax.md
```

## Security

`contextIsolation`, no `nodeIntegration`, `sandbox`, a loopback-only
`connect-src`, refused navigation and window opening, and Electron's fuses flipped
in the packaged binary (`RunAsNode` off). `test/security.test.ts` reads all of it.

The service's token never enters a URL: the screenshot view fetches bytes with the
token in a header and holds a blob, rather than the easier `?token=` an `<img>`
would need.

## The service's lifecycle

On project open the main process spawns `svatah serve --project <dir> --port 0`,
reads the one handshake line, and writes a lock in the app's user-data directory —
never in the project, because a token in a repository is a token in a pull
request. A second window, or a reload, adopts that service instead of starting a
rival one on the same `runs/`. Quitting stops the service the ADE started, and a
lock whose service does not answer is removed rather than adopted.

`svatah serve` deliberately writes no lock of its own ("a token in a file is a
token that outlives the process that needed it"), which is right for a command a
person stops with Ctrl-C. The lock belongs to whoever can guarantee its lifetime.

## Why Vite 7 and not 8

Vite 8 makes `lightningcss` (MPL-2.0) a hard dependency, and REQ-PKG-3 allows
MIT, Apache-2.0 and BSD only. Vite 7 keeps it an optional peer that nothing here
asks for. `@vitejs/plugin-react` is pinned to the 5.x line for the same reason —
6.x requires Vite 8.

## What is not here yet

Record review, the bindings browser and heal review are T5.7; the surface explorer
and the tool panel are T5.8 (REQ-ADE-4, 5, 8).
