# `@svatah/yam-adapter-uia`

The Windows UI Automation adapter (REQ-ADP-6,
[LLD §7.5](../../docs/spec/lld.md)). It implements the published agent surface
over `UIAutomationClient`, so a Yam flow drives a desktop application through
the same `snapshot` / `act` / `read` / `check` calls it uses on a web page.

Its conformance target is the **Yam ADE** (REQ-ADE-6): an Electron
application whose Chromium publishes the renderer's accessibility tree once
`app.setAccessibilitySupportEnabled(true)` has been called, which is what
`YAM_A11Y=1` does.

```yaml
# yam.config.yaml
adapter: uia
app:
  processName: "Yam ADE"
```

There is no default process name. Driving "whatever is frontmost" would make a
run depend on what the person at the machine last clicked.

## What it needs of a host

**No permission.** This is the difference from the macOS adapter, and it is the
first thing to know if you have used that one: Windows grants no accessibility
permission and asks for none. Two things can still go wrong:

| `yam surface doctor --adapter uia` says | It means |
|---|---|
| `available` | `UIAutomationClient` loads and the root element answers |
| `unavailable` | PowerShell is constrained — check that `powershell.exe` is on PATH and that Constrained Language Mode is not in force |
| `unsupported` | not Windows |

And one thing that reports as "no window" rather than as an error: **a process
at a higher integrity level than Yam is invisible to UI Automation.** An
application started as administrator needs Yam started the same way. That is
the failure that wastes the most time on Windows, so the adapter's message names
it.

## What it is built on, and why

`UIAutomationClient` through PowerShell, not a Node binding over the UIA COM
API.

LLD §7.5 offers the choice: "a Node binding over the UI Automation COM API **or
a wrapped driver with the same surface**". A COM binding means `node-gyp`, a
compiler on every machine that installs the package, and a prebuild matrix —
and REQ-PKG-3 keeps the dependency tree permissive rather than merely licensed.
Windows already ships a client of that API in the .NET Framework, on every
installation since Vista.

The cost is a process per call and a marshalled property read per attribute,
which the breadth-first walk with a node budget is sized for. The bridge is one
interface (`UiaBridge`); a COM implementation drops in behind it without
anything above changing.

## Acting is a pattern, then the mouse

A UIA **control pattern** is the accessible way to operate a control.
`InvokePattern.Invoke()` presses a button without moving the mouse;
`ValuePattern.SetValue()` writes a whole string into a field without typing it;
`SelectionItemPattern.Select()` picks a tab — which is why `click` tries
`Invoke`, then `SelectionItem`, then `Toggle` before it falls back. A tab has no
`Invoke`: pressing one *selects* it.

Where a provider declares no invocable pattern, the fallback is a click at the
centre of the element's bounding rectangle, which is why the box is in the
snapshot.

The order matters beyond speed. `SetValue` does not fire the keystroke events
`SendKeys` does, so a field with a JavaScript `keyup` handler behaves
differently under the two. The pattern is preferred anyway, because it is the
deterministic one: it either sets the value or reports that it cannot.

## What it can and cannot do

| Capability | | Why |
|---|---|---|
| `windows` | yes | `SetFocus` on the main window |
| `screenshot` | yes | `Graphics.CopyFromScreen` |
| `restore` | yes | activates the window; a desktop application's state is its own |
| `dialogs` | no | a Windows dialog is a top-level window of its own |
| `frames` | no | a Chromium `<iframe>` is more of the same document |
| `drag` | no | `mouse_event` gives press, move and release, but not the timing a real pointer has, and a drag that silently did nothing would be worse than one that says so |
| `upload`, `trace`, `webmcp` | no | browser ideas |

`navigate`, `back`, `forward` and `refresh` throw `NavigationError`.

## Candidates

| Kind | From | Survives |
|---|---|---|
| `automationId` | `AutomationId`, which for Chromium content *is* the DOM `id` (LLD §7.5) | a re-layout, a rename, a translation |
| `role` + `name` | the ARIA role and `Name` | a re-layout |
| `text` | the element's value | — |
| `controlPath` | `Window[title]/Group[2]/Button[name]` | a rename |
| `coords` | the centre of the bounding rectangle | nothing |

`controlPath` segments use the **UIA control type**, not the ARIA role, so a
path reads against what Inspect and Accessibility Insights show.

## The keyboard

`SendKeys` is the only keyboard Windows gives a script without P/Invoke, and its
notation is its own: `{ENTER}`, and `^` `%` `+` for Control, Alt and Shift. A
value is escaped before it is sent — `+^%~(){}[]` are `SendKeys` syntax, so a
password containing `%` would otherwise send an Alt chord instead of typing a
per-cent sign.

A flow written on a Mac that says `cmd+a` means "the platform's own modifier",
which here is Control.

## Running the conformance suite

```powershell
pnpm -r build
pnpm --filter @svatah/yam-ade exec electron-forge package
node scripts/desktop-conformance.mjs --adapter uia --report reports/adapter-uia.md
```

It checks the host first and refuses to write a report from a run that could not
start. CI runs it on a `windows-latest` runner (`desktop-conformance` in
`.github/workflows/ci.yml`).

## Testing without Windows

Every rule above the bridge is a pure function of a `UiaNode[]`, and the bridge
is an interface. `test/recorded.ts` replays UI Automation trees recorded from the
real ADE (`node scripts/record-desktop-tree.mjs --shape uia --screen <name>`).

`test/parity.test.ts` is the one worth reading: it records **one** ADE window in
both platform vocabularies and checks that this adapter and `@svatah/yam-adapter-ax`
normalise it to the same tree — which is REQ-SURF-4 stated as a test rather than
as a claim. It found two real defects that neither adapter's own tests could
have: a `<select>`'s options were `menuitem` on macOS and `option` on Windows,
and a `<td>` was `cell` on one and `row` on the other. Both needed an adapter to
read an element's *parent*, which the flat role maps in `@svatah/yam-surface` cannot
express.
