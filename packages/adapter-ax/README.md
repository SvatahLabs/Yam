# `@svatah/adapter-ax`

The macOS Accessibility adapter (REQ-ADP-7, [LLD §7.5](../../docs/spec/lld.md)).
It implements the published agent surface over `AXUIElement`, so a Svatah flow
drives a desktop application through the same `snapshot` / `act` / `read` /
`check` calls it uses on a web page.

Its conformance target is the **Svatah ADE** (REQ-ADE-6): an Electron
application whose Chromium publishes the renderer's accessibility tree once
`app.setAccessibilitySupportEnabled(true)` has been called, which is what
`SVATAH_A11Y=1` does.

```yaml
# svatah.config.yaml
adapter: ax
app:
  processName: "Svatah ADE"
```

There is no default process name. Driving "whatever is frontmost" would make a
run depend on what the person at the machine last clicked.

## The permission

macOS gates the accessibility API behind a per-application grant. **The grant is
for the program running Svatah**, not for Svatah and not for the application
being driven — a permission granted to Terminal does not carry to iTerm, to VS
Code, or to a CI agent, and macOS does not re-read the setting for a process
that is already running.

```
System Settings → Privacy & Security → Accessibility → add your terminal, switch it on
```

Check it before anything else:

```bash
svatah surface doctor --adapter ax
```

| It reports | It means |
|---|---|
| `granted` | the accessibility API answers |
| `prompt-pending` | nobody has answered the prompt yet — including the case where the prompt is on screen right now, or where there is no one to answer it |
| `denied` | the permission was refused for this program; switch it on and **restart the program** |
| `unsupported` | not macOS |

A session refuses to open when the permission is missing, with that message. It
is checked before the first snapshot on purpose: a session that opened and then
failed on its first `locate` would report a `locator` failure for an element
that was there all along.

## What it is built on, and why

`AXUIElement` through **System Events** and `osascript`, not through a native
N-API module.

A native module would call `AXUIElementCopyAttributeValue` directly and be an
order of magnitude faster. It would also need a compiler on every machine that
installs this package. macOS already ships a client of that same API — System
Events, whose `UI elements` and `attributes` *are* `AXUIElement` under a
scripting name — and driving it needs nothing installed and the same permission.

The cost is stated rather than hidden: every attribute read is an Apple event,
so a large window is measured in seconds where a native module would be
measured in milliseconds. The walk fetches a window breadth-first with a node
budget for that reason. If this becomes the bottleneck, the bridge is one
interface (`AxBridge`) and a native implementation drops in behind it without
anything above changing.

## What it can and cannot do

| Capability | | Why |
|---|---|---|
| `windows` | yes | switching between an application's windows is `AXRaise` |
| `screenshot` | yes | `screencapture`; needs the *Screen Recording* permission, which is a separate grant |
| `restore` | yes | activates the window; a desktop application's state is its own |
| `dialogs` | no | a macOS sheet is an element of the window's own tree (`AXSheet`), not a separate surface |
| `frames` | no | a Chromium `<iframe>` is more of the same `AXWebArea` |
| `drag` | no | a drag is press-move-release and System Events has no such sequence |
| `upload`, `trace`, `webmcp` | no | browser ideas |

`navigate`, `back`, `forward` and `refresh` throw `NavigationError`: a desktop
application has no address bar, and answering them with a silent no-op would let
a plan compiled for the web "pass" against an application it never touched.

## Candidates

`describe()` and the recorder's synthesis produce, best first:

| Kind | From | Survives |
|---|---|---|
| `automationId` | `AXIdentifier`, else the DOM `id` (`AXDOMIdentifier`), else the `aria-label` (`AXDescription`) | a re-layout, a rename, a translation |
| `role` + `name` | the ARIA role and the accessible name | a re-layout |
| `text` | the element's value | — |
| `controlPath` | `Window[title]/AXGroup[2]/AXButton[name]` | a rename |
| `coords` | the centre of the element's box | nothing |

LLD §7.5 names `aria-label` and `AXIdentifier` as the macOS sources for
`automationId`. The DOM `id` sits between them because the conformance target is
an Electron application: a `<select id="record-gateway">` has an `id` and no
`AXIdentifier`, and an `id` is an identity where a label is wording.

## Running the conformance suite

```bash
pnpm -r build
pnpm --filter @svatah/ade exec electron-forge package
node scripts/desktop-conformance.mjs --adapter ax --report reports/adapter-ax.md
```

That checks the permission first and refuses to write a report from a run that
could not start.

## Testing without the permission

Every rule above the bridge is a pure function of an `AxNode[]`, and the bridge
is an interface. `test/recorded.ts` replays accessibility trees recorded from the
real ADE (`node scripts/record-ax-tree.mjs --screen <name>`), so the mapping, the
candidates, the predicates and the whole surface are exercised on a machine that
cannot reach the accessibility API at all. What that cannot prove is that
`osascriptBridge` reads a real `AXUIElement` correctly — which is why the
conformance run above exists and why
[`docs/spec/progress/phase-6.md`](../../docs/spec/progress/phase-6.md) records
whether it was made.
