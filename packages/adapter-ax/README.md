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

### `ax/session`: is anyone at this machine? (Draft 2.12 §7.5)

`doctor` also reports whether any process in the login session owns an on-screen
window:

```
ok    ax/session   9 application(s) own a window: Finder, Svatah ADE, …
warn  ax/session   only loginwindow owns a window — the display is locked
```

The permission can be granted and the adapter perfectly ready and *nothing will
get a window*, because the display is locked, the machine is at the login
screen, or the session has no WindowServer at all — an SSH login, a headless
runner. `loginwindow` is the process that owns the screen in all three cases.

It is **advisory**: nothing is misconfigured, so `doctor`'s exit code does not
change. What it changes is what `scripts/desktop-conformance.mjs` can do — the
gate polls sixty seconds for the ADE's window and then exits 2, and on a locked
display it now says *that* is why rather than reporting a launch failure. Both
the Phase 9 implementation and its verification lost the live measurement to
this and had only "showed no window within 60000 ms" to go on.

## What it is built on, and why

`AXUIElement` through **System Events** and `osascript`, not through a native
N-API module.

A native module would call `AXUIElementCopyAttributeValue` directly and be an
order of magnitude faster. It would also need a compiler on every machine that
installs this package. macOS already ships a client of that same API — System
Events, whose `UI elements` and `attributes` *are* `AXUIElement` under a
scripting name — and driving it needs nothing installed and the same permission.

### The cost, and the bulk reads that pay it (Draft 2.8 §7.5)

Every Apple event costs about the same fixed 16–25 ms whatever it carries, so
the only number that matters is **how many events one snapshot sends**. The
first version of this bridge asked each element for each attribute — about
seventeen events per node — which measured 650 ms *per node* against the ADE's
35-node welcome window, and failed every case of the live macOS gate on the
surface's ten-second deadline (Phase 6 verification, F1).

The window read is therefore breadth-first over **containers**, and every read
answers for a whole set of children at once:

| event | what it answers |
|---|---|
| `properties of every UI element of C` | role, subrole, title, description, value, name, help, enabled, focused, selected, position, size |
| `value of attribute "AXChildren" of every UI element of C` | which children are containers, so no event is spent on a leaf |
| `value of attribute "AXIdentifier" \| "AXDOMIdentifier" \| "AXPlaceholderValue" \| "AXExpanded" …` | what `properties` leaves out, for containers that hold a control |
| `name of every action of every UI element of C` | `AXPress` and friends, so `act` uses an accessibility action rather than a click |

Measured against the ADE's own 199-node menu-bar tree on an M-series Mac:
**103 Apple events, 2.07 s, 10.4 ms per node**, in one `osascript` invocation.
§7.5's budget — the ADE's project screen, at least 400 nodes, inside 10 s — is
met with room.

Two consequences worth knowing. The window script is **AppleScript**, not JXA,
because only AppleScript can ask a plural specifier for `properties` (JXA
answers `Can't get object.`), and that one form is the whole design. And a bulk
read is all-or-nothing — one child without `AXDOMIdentifier` fails the read for
the set — so each optional attribute keeps a success and a failure count and is
abandoned once it has failed eight times without earning its place.

The script carries its own deadline, a second inside the caller's, so a window
it cannot finish comes back as a *measured* bridge timeout — nodes,
milliseconds, events — rather than as a killed process with nothing to say. A
deadline exceeded after `doctor` has said `granted` is reported as exactly that,
never as a permission prompt.

If this ever becomes the bottleneck again, the bridge is one interface
(`AxBridge`) and a native implementation drops in behind it without anything
above changing.

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
real ADE (`node scripts/record-desktop-tree.mjs --shape ax --screen <name>`), so the mapping, the
candidates, the predicates and the whole surface are exercised on a machine that
cannot reach the accessibility API at all. What that cannot prove is that
`osascriptBridge` reads a real `AXUIElement` correctly — which is why the
conformance run above exists and why
[`docs/spec/progress/phase-6.md`](../../docs/spec/progress/phase-6.md) records
whether it was made.
