# The app, driven by Yam, as somebody who has never seen it

Yam drove the packaged Yam through the MCP tools (`surface_connect` with the `ax`
adapter, then `surface_snapshot` and `surface_act`) with no project open and
nothing set up. Everything below was read out of the application's own
accessibility tree, which is what a screen reader reads and what a flow sentence
addresses. Nothing here is an opinion about a mockup.

## What arrives

386 nodes. 34 interactive controls, none unnamed — the naming rule holds. Then:

```
button  "Open a project"
button  "yam-shell-ZSPbBQ"      button "yam-shell-aTz9sp"      button "yam-shell-v5WyAd"
button  "Session section"       button "Session"
button  "Automations section"   button "Flows" … "Import prototype database"
heading "Session"
button  "Disconnect"            [disabled]
button  "Recheck targets"
button  "Check the surface"     [disabled]
button  "Refresh and select again" [disabled]
tab     "Record"  tab "Say"  tab "Do" [selected]
textbox "URL"  combobox "Adapter"  checkbox "Show the browser"  button "Connect surface"
```

## The blockers

### Getting started

**B1. The recent projects are machine names.** `yam-shell-ZSPbBQ`,
`yam-shell-aTz9sp`, `yam-shell-v5WyAd` are the app's own scratch workspaces,
offered in the position where a person expects their work. Three of the five
things in the top bar are noise they did not make.

**B2. Most of the rail is a wall.** Flows, Bindings, Runs, Agents and tools, API,
Data and Import all reach the same screen: *"is about a project — its flows,
bindings, runs and proposals — and none is open."* Seven of nine destinations
are shut, and nothing said so before the click.

**B3. That sentence begins mid-clause.** The screen's name is a separate node, so
what a screen reader announces starts at "is about a project". Read aloud it has
no subject.

**B4. It names a screen that no longer exists.** "Surfaces needs no project" —
Surfaces became Session in Draft 2.27.

### Dead ends

**B5. Say mode has no input.** It explains that *"a sentence is grounded against
the session already open and appended to the flow"* and offers **nowhere to type
one**: no textbox, no combobox, and no enabled control beyond the rail. One of
the three modes is a paragraph.

**B6. Record mode, with a surface connected, sends you to a wall.** It says
*"No recording session. Press Record on the Flows screen"* — and Flows is behind
B2. Connect → Record → Flows → "needs a project". For somebody without a project
the loop has no exit.

**B7. Disconnect is disabled in Record mode while a surface is connected.** The
escape hatch is missing in the one mode where a person gets stuck, which is how
the owner came to kill a browser by hand.

### The toolbar

**B8. It leads with what you cannot do.** On arrival three of its four buttons —
Disconnect, Check the surface, Refresh and select again — are disabled.

**B9. The first task is below and after the toolbar.** URL, Adapter, Show the
browser and Connect surface are the only things a new person can do, and they sit
underneath a bar of mostly-dead controls, after it in reading order.

**B10. The mode strip comes after the toolbar in tree order.** The control that
changes what the toolbar *means* is encountered after the toolbar.

### Accessibility

**B11. Every control announces "collapsed".** Chromium publishes `AXExpanded=0`
broadly and `tree.ts` turns that into a state, so a screen reader says "collapsed"
on every button in the window. It is noise the adapter passes through: a state
that only makes sense for roles that can expand.

**B12. Headings are shouted.** `INSPECTOR`, `CONNECT AN AGENT`, `BROWSER`, `API`,
`NATIVE APP`, `DEVICE` reach the tree in capitals — visual styling has become the
accessible name, and some screen readers spell capitals out.

**B13. The heading outline is flat.** `Session > INSPECTOR > CONNECT AN AGENT >
BROWSER > API > NATIVE APP > DEVICE > OTHER` with no nesting, so nothing says
which section belongs inside which.

**B14. There is a hidden heading.** `heading "OTHER"` is published and not drawn.

**B15. Empty scaffolding is announced.** 6 tables, 15 rows and 106 cells exist on
a screen where nothing is connected.

**B16. Text carries its content in `value`, not `name`.** 141 nodes.

### Comprehension

**B17. "nothing connected · do".** The mode appears as a lowercase word in a
subtitle, where "do" reads as a fragment rather than as a state.

**B18. One sentence, four times.** *"Choose a browser, app, device or API to
control"* is on the screen four times — and it over-promises: the field takes a
URL, an application name or an endpoint, and "device" is Appium, which is not
installed.

**B19. Four of five adapters explain why they cannot work.** BiDi wants
`YAM_BIDI_URL`; UIA says "this host is darwin"; Appium wants a server on 4723;
AT-SPI says "this host is darwin". A new person's first screen is mostly a list
of things this machine cannot do.

**B20. The MCP configuration block is on the first screen.** A JSON snippet for
agent authors, before the person has done anything.

### Found while driving

**B21. Two processes named "Yam" defeat `--app Yam`,** and the error blames the
wrong thing: *"the application has gone"* when the truth is that two answered and
the one picked had no window.

## What this says about the design

The screen is organised around **the model's shape** — sessions, adapters,
snapshots, modes — and not around **what a person came to do**. Every blocker
above is a variation on one of three faults:

1. **The room is arranged for the furniture.** The toolbar comes before the task,
   the mode strip after the toolbar, the inspector's agent configuration before
   the first connection. Reading order follows the component tree.

2. **Doors are drawn that do not open.** Seven rail destinations, three toolbar
   buttons, one whole mode, and four adapters are on the screen and unusable, and
   each is discovered by trying.

3. **The app says what it *is*, not what to *do*.** "A sentence is grounded
   against the session already open and appended to the flow" is true and is not
   an instruction. The one screen that gets this right is the empty state that
   says "Enter a URL above and press Connect surface".

## The rethink

**R1. One first task, above everything.** The connect row is the only thing a new
person can do; it belongs at the top of the workspace, before the toolbar, with
the toolbar appearing once there is something to act on.

**R2. Modes become a consequence, not a chooser.** Record, Say and Do are three
things to do *with a connected surface*. Offer them where they apply — after a
connection — rather than as three tabs, one of which is empty and one of which
sends you to a wall.

**R3. A closed door is drawn closed.** A rail item that needs a project says so
*on the rail*, not after the click. One "Open a project" invitation, once.

**R4. Adapters are a status, not a catalogue.** Show what is ready. Put the four
that need something behind "Other ways to connect", with the one command each
needs.

**R5. The empty states give the next keystroke.** The pattern already exists
("Enter a URL above and press Connect surface"); it should be the rule, and
Say's paragraph should become a field.

**R6. Visual styling leaves the accessible name.** Capitals belong in CSS.
Sections nest. Empty tables are not built until they have rows.

**R7. Recents are the person's, not the machine's.** The app's own scratch
workspaces do not belong in the same list as the projects somebody made.

## Method, so this can be re-run

The walkthrough is `surface_connect --app Yam --adapter ax`, then
`surface_snapshot` at each step and `surface_act` to press. The broker must be
started by the binary that holds the macOS Accessibility grant *before* the
application launches, or every native session asks on behalf of `Yam.app`, which
nobody granted — `evals/self/yam-on-yam/run.mjs` explains this at its top and
does it.
