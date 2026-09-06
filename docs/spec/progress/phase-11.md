# Phase 11 — corrections, and Svatah verifies Svatah

Branch `phase-11` from `master` (`7f57be9`, Draft 2.14) · Date: 2026-09-06
Subject: the nine findings of the Phase 10 adversarial verification, then
T11.1–T11.6.

Every claim below names the command that makes it and what that command answered
on this host. Where a command could not be run, the section says so, gives the
command a verifier should run instead, and says what *was* measured in its place.
Nothing here reports a number nobody took.

`git diff master..phase-11 -- docs/spec/{requirements,hld,lld,tasks}.md` is
empty. Under `docs/spec/design/` the changes are F4's two: `artboards/Data.html`
and `base.css`; `macros.mjs` is extracted from `build.mjs` so the new audit and
the canvas build expand the same sidebar and top bar.

## The results, stated up front

- **The windowless packaged launch was a locked display, and the ADE was never
  at fault.** The ADE makes its window every time — its own log says
  `window.creating` → `renderer.did-finish-load` → `window.ready-to-show
  visible=true` in 322 ms — and `CGWindowList` shows that window on screen at
  layer 0. With the screen locked, macOS answers `AXWindows` with *the
  application element* for every application on the machine, TextEdit and Notes
  included. `ax/session` reads `CGSSessionScreenIsLocked` now and says so.
- **The live macOS gate is conformant, three consecutive runs.** 10 cases across
  ADE variants 0, 1 and 2, both healing cases relocalized, the project screen
  read at 1,017 nodes in 1,502–1,680 ms (1.48–1.65 ms per node) at load average
  4.7–7.3.
- **Svatah launches, drives and quits the ADE.** `svatah run evals/self` — 31
  passed, 0 failed — and the lifecycle flow ten times running with no ADE and no
  `svatah serve` left behind by any of them.
- **The recorder records against the ADE.** `pnpm self:record`: three bindings
  written and verified, every one resolved by `automationId`, the flow replayed
  green, and a binding recorded at variant 0 relocalized at variant 1 onto the
  element with the recorded id.
- **`svatah eval self` runs both sides of 48 checks and compares them**, and the
  report's one-sided list — thirty-seven of them — is the deliverable this phase
  is proudest of: every one names the sentence the flow language does not have
  or the surface Svatah cannot open.
- **What this host could not do at first was see any window at all.** The
  display was locked for the first four hours of the phase; the owner unlocked
  it, and everything desktop in this file was measured after that. The locked
  measurements are kept below because they are what identified F1.

## The host, and what it could and could not do

- macOS (`darwin arm64`, Darwin 25.3.0), Node v25.6.1, pnpm 10.30.2.
- **Accessibility: granted.** `svatah surface doctor --adapter ax` says
  `ok ax/accessibility granted`.
- **Screen Recording: refused.** So every screenshot is `unreachable` with the
  doctor's line, never fabricated:
  `warn ax/screen-recording refused — could not create image from rect`. The AX
  screenshot of `pnpm ade:shoot` is the only artefact this costs.
- **The display was locked, then unlocked.** `ax/session` answered
  `the screen is locked (CGSSessionScreenIsLocked)` for the first part of the
  phase and `10 application(s) own a window: …` afterwards. Every desktop number
  below was taken unlocked.
- **Windows is unreachable.** The UIA half of every desktop check is published
  as `unreachable` and is not stubbed: `svatah surface doctor --adapter uia`
  says `skip uia/platform not Windows`, and `scripts/desktop-conformance.mjs
  --adapter uia` exits 2 without writing a report.
- **No model credential.** Every recording is `--gateway fake`, including the
  new desktop ones, and every artefact it wrote says `fake:grounding-cases` in
  its provenance.
- **Node 22 was not run here.** This host has one Node (v25.6.1). The contract's
  second leg is a verifier's: `pnpm -r typecheck && pnpm -r test` with `CI=true`
  on Node 22. Recorded as K3, inherited from Phase 10.

---

# The Phase 10 corrections (T11.1)

## F1 — the packaged ADE "runs without a window"

**Status: diagnosed and closed.** Commit `28690a6`.

Draft 2.13 says to add the window-lifecycle log and the graceful quit route
*first*, and to diagnose with them. Both are in, and the diagnosis is:

**The ADE made its window every time.** With `SVATAH_ADE_DEBUG=1` the
application writes `<userData>/ade-debug.log`, and a launch reads:

```
2026-09-06T02:29:39.579Z app.ready packaged=true version=44.1.1 …
2026-09-06T02:29:39.580Z app.accessibility-enabled
2026-09-06T02:29:39.580Z window.creating width=1280 height=860 packaged=true a11y=1 variant=0
2026-09-06T02:29:39.901Z renderer.did-finish-load id=1 visible=true minimized=false bounds={"x":95,"y":33,"width":1280,"height":853}
2026-09-06T02:29:39.901Z window.ready-to-show id=1 visible=true minimized=false bounds={"x":95,"y":33,"width":1280,"height":853}
```

322 ms from ready to a visible window with a loaded renderer. `CGWindowList` —
the WindowServer's own list, which no permission gates — showed that window
on screen at layer 0.

**What could not see it was the accessibility API, and not only for the ADE.** A
native probe (`clang`, `AXUIElementCopyAttributeValue`, no Svatah in it at all)
asked every regular application on the machine for its `AXWindows`:

| Application | `AXWindows` | `AXRole` of the first |
|---|---|---|
| Svatah ADE | 1 | `AXApplication` |
| TextEdit (with a document open) | 1 | `AXApplication` |
| Notes, System Settings, Passwords, ChatGPT, Claude | 1 | `AXApplication` |
| Finder | 1 | `AXScrollArea` (the desktop) |

`CFEqual` says that first "window" **is the application element**. Every
application answered the same way, Apple's own included, so it is a property of
the host. `CGSessionCopyCurrentDictionary` said why:
`CGSSessionScreenIsLocked = 1`.

Confirmed in both directions on the same host: locked, TextEdit reads
`role=AXApplication title=TextEdit`; unlocked, the same probe reads
`role=AXWindow title=doc.txt`.

**Why `ax/session` did not catch it, and what it does now.** The check tested
"does anything own a window", and a locked screen *keeps* every application's
windows — so it answered `usable: true` with eleven owners on a machine where
nothing could be read. It answers a **state** now — `usable`, `locked`,
`no-session`, `unknown` — reading `CGSSessionScreenIsLocked` first (which is
also much cheaper: the AX scan below it exceeded the five-second budget it had
inherited from the permission check, so the machines that most needed an answer
got "could not tell"; it has fifteen seconds of its own now). And "owns a
window" is `AXRole === 'AXWindow'`, not a non-empty list.

Measured, locked:

```
warn  ax/session  the screen is locked (CGSSessionScreenIsLocked) — macOS keeps every
                  application's windows and shows none of them to an accessibility client
```

and unlocked: `ok ax/session 10 application(s) own a window: …`.

**Four more defects the diagnosis turned up, all fixed:**

- `hasWindow()` in the gate asked System Events for `count windows`. That is the
  same accessibility read one process away under a second permission, and it
  answered `0` for **every** application on the machine when refused —
  indistinguishable from "the ADE has no window yet". It reads the API directly
  now, and `hasProject()` walks the window whose role is `AXWindow` rather than
  `AXWindows[0]`, which on a locked screen was the application and six thousand
  menu items.
- A `pkill` ended the ADE's main process where it stood, so `before-quit` never
  ran and the `svatah serve` it had spawned was orphaned. A signal runs the same
  quit the menu does now; `before-quit` has a grace timer; and the gate asks for
  a graceful quit before it signals at all.
- A quit *while a project was opening* orphaned the service every time —
  `before-quit` looked at a `service` that is only assigned after the handshake,
  and the gate quits the ADE about a second after ready and two seconds before
  the service is listening. One leftover per gate launch.
- `fastify.close()` waited on the `/events/sse` stream that never ends, so every
  ADE quit took the five seconds its child-stop allows before `SIGKILL`. The
  streams are ended on close: **a quit is 428 ms now, measured, down from
  5,100**.

**The evidence, re-runnable:** `node scripts/ade-launch-loop.mjs --times 10`
asks three independent questions per launch — the application's own log,
`CGWindowList`, and the accessibility API — and prints the doctor's line when
the third disagrees with the first two.

Locked (which is what identified F1):

```
round  1: window created, shown, renderer loaded, on screen 1, accessibility unreadable, quit graceful in 490 ms, leftovers ade=0 service=0
…
10/10 launches created, showed and loaded a window; every launch had one on screen;
not every launch was readable through the accessibility API; no round(s) left a process behind.
```

Unlocked:

```
round  1: window created, shown, renderer loaded, on screen 1, accessibility readable, quit graceful in 2130 ms, leftovers ade=0 service=0
round  2: … accessibility readable, quit graceful in 836 ms, leftovers ade=0 service=0
round  3: … accessibility readable, quit graceful in 654 ms, leftovers ade=0 service=0
3/3 launches created, showed and loaded a window; every launch had one on screen;
every launch was readable through the accessibility API; no round(s) left a process behind.
```

## F2 — the three live failures

**Status: closed; the gate is conformant.** Commits `e62eca2`, `8307f21`.

**The id rule fails on every macOS window that has ever existed.** The window's
close, minimise and zoom buttons belong to the window manager: macOS creates
them, names them by subrole (P8-F3's table) and gives an application no way to
put an identifier on them. `isWindowChrome` in `@svatah/surface` is a closed
list of what the platform owns — five AX subroles, five Windows automation ids —
read from the adapter's `native` bag and never from a name, so a button an
*application* labelled "Close" still has to carry an id. The snapshot case
exempts them and asserts they are *there*: a tree that stopped reading the window
frame is a tree that silently shrank.

**`rail-flows` would not relocalize at variant 1**, and this one was a defect in
the ADE. Radix's `Dialog.Portal` mounts a `<div>` into `<body>` when the palette
opens and leaves it there, so the accessibility tree gains a permanent extra
generic container above the whole application the first time anybody presses ⌘K.
Measured on the rail item's role path:

| after | role path |
|---|---|
| a fresh window | `… document, group, navigation, button` |
| one palette use, for ever | `… document, group, group, navigation, button` |

`controlPath` and `rolePath` are the desktop candidates (LLD §7.5), so every
desktop binding in a session changed shape the moment someone opened the
palette. The palette — and the `Chooser`'s select, which had the same defect and
was found the same way on the API screen — portal into a host created at first
render now. Traced through the gate's whole navigation sequence, the rail's path
is eleven at every screen.

**`ade.inspector` found no candidate table.** Two things: every list screen
already takes `params.x ?? rows[0]` (now stated in `screens.test.ts` for all
five, so a sixth added without a default fails there), and `openScreen`
snapshotted the instant after a rail click — a request the ADE answers with a
`load()` over five or six endpoints. It waits for two consecutive reads of the
same tree.

**Variant 2 could not be passed at all.** LLD §16 asks for the moved gateway to
relocalize "with the same weights and threshold as the web healing eval", and
`rolePathSimilarity` was a common *suffix* — so one `<div>` inserted near the
leaf took it from 1 to 0.08, and the case's ceiling was **0.66 against a
threshold of 0.72** however good the healer was. That is the trap `Record.tsx`
already records about the inspector: "a variant that no model-free repair can
survive measures the variant rather than the healer."

The measure ignores anonymous containers now — `group`, `generic`, `none`,
`presentation` — and compares the landmark ancestry and the roles that mean
something, which is LLD §13.6's own reasoning for the ADE carrying landmark
roles. It is still a suffix, so a button proposed for a combobox shares nothing.
**The web healing eval is unchanged by it**, line for line:

| | before | after |
|---|---|---|
| `healing eval [no-test-ids]` | 92.6% (50/54) | 92.6% (50/54) |
| `healing eval [with-test-ids]` | 78.9% (15/19) | 78.9% (15/19) |

And variant 2's panel says what it is beside the control, because a control alone
in a panel has no neighbours and 0.2 of the weight is neighbours.

**The fixtures are re-recorded** from the live app at variants 0, 1 and 2, and
the recorder synthesises the window's three buttons beside the window it already
synthesised — CDP describes the page, and neither the frame nor its buttons are
in it. The cross-adapter parity check compares those three on role, reference,
depth, parent and state but not on name: "minimise" and "Minimize" are each
platform's own word, and a flow never names either.

**The gate, three consecutive runs** (`node scripts/desktop-conformance.mjs
--adapter ax`):

```
"ax" is conformant — 10 cases across variants 0, 1 and 2 → /tmp/p11/gate-t11-1.md
"ax" is conformant — 10 cases across variants 0, 1 and 2 → /tmp/p11/gate-t11-2.md
"ax" is conformant — 10 cases across variants 0, 1 and 2 → /tmp/p11/gate-t11-3.md
```

with both healing cases `relocalized` every time, and the bridge line:

| run | project screen | per node | calls | load |
|---|---|---|---|---|
| 1 | 1,017 nodes in 1,632 ms | 1.60 ms | 16,277 | 7.33 over 8 CPUs |
| 2 | 1,017 nodes in 1,502 ms | 1.48 ms | 16,277 | 5.71 over 8 CPUs |
| 3 | 1,017 nodes in 1,680 ms | 1.65 ms | 16,277 | 4.66 over 8 CPUs |

## F3 — the Record screen's toolbar

**Status: closed.** Commit `bbc584a`.

The title's floor is `min-width: 12ch`, so the flexbox cannot take it below
twelve characters — a bar with too much in it overflows instead, and `Toolbar`
watches for that with a `ResizeObserver` and hides actions until it stops: the
secondary ones right to left first, then the primary and the dangerous one. The
bar says how many went, in a hint whose space is reserved whether or not
anything is shed.

Three things had to be true for that to work and none of them was:

- **`hidden` did not hide.** The UA rule `[hidden] { display: none }` is a type
  selector and loses to `.sv-btn { display: inline-flex }`, so a button the bar
  had "shed" stayed exactly where it was while the bar reported two controls put
  away. One `[hidden] { display: none !important }` in `ui.css`.
- **A field in a toolbar was a column.** `.sv-field` stacks its label over its
  control, which is right in a panel and wrong in a forty-pixel bar. It is a row
  there now and truncates its value: "fake — committed answers from
  evals/grounding/cases" was four hundred pixels of toolbar.
- **Three screens had their own toolbar.** Flows, Run and Record each built one,
  so the floor and the shedding — which live in the shared component — applied to
  none. Run and Flows use the shared `Toolbar`, which gained the three things
  they had it for: their own title, a pill beside it, and a label a screen says
  better than the registry.

`availableWhen` was already rendered by the shared component and is now rendered
everywhere, because everywhere *is* the shared component: Accept, Re-pick and
Reject are disabled with no session open, measured.

Two Playwright cases on the packaged application:
`pnpm --filter @svatah/ade exec playwright test -g "P10-F3"` — the Record
toolbar at 1440 and 1100 px through `Emulation.setDeviceMetricsOverride` (a
`<style>` forcing the app wider than its window measures the *window's*
overflow, not the toolbar's), and a sweep from 1900 px down to 760 px asserting
that at every width the bar is one row, the title keeps its floor, the hint
counts what went, and no primary is shed while a secondary is still on the bar.

## F4 — the artboards

**Status: closed.** Commit `6354bb0`.

The Data inspector says `set` alone — a secret's character count is a fact about
a secret (REQ-NFR-6) — and its "Read by" is a list of rows with the story above
the step and the step truncated, because a two-column table cannot truncate and
a step's sentence is longer than a 340 px column. `base.css`'s toolbar is
`nowrap` with the same twelve-character floor the build keeps.

And the reading is a command: **`pnpm artboards`** renders every artboard with
`base.css` and the macros expanded and asks the browser the four questions the
findings were. It found three more of the same defect on artboards approved in
earlier phases — the candidate table in Bindings, Main and RecordReview ran 12,
26 and 50 px past the inspector, always with a CSS selector or an XPath in one
cell. `width: 100%` on a table whose content is wider is a request rather than a
constraint; `table-layout: fixed` is the constraint it looks like, in `base.css`
and in `ui.css` both.

```
$ pnpm artboards
ok    Agents.html … ok    Tokens.html
15 artboard(s) fit their frames.
```

`tools/repo-checks/test/artboards.test.ts` shows every rule biting against an
artboard written to break exactly one.

## F5 — a slow probe misattributed

**Status: closed.** Commit `28690a6` (with F1).

`ax/session` answers a *state*, and the gate may name a cause for `locked` and
`no-session` and for nothing else. `unknown` — which is what a probe that did not
answer produces — is reported as an unanswered probe, and the advice says in so
many words that it "says nothing about the display either way".
`packages/adapter-ax/test/bridge.test.ts` has a case for each of the four
answers, including a timed-out probe asserting the detail does **not** contain
"locked".

## F6 — `pnpm ade:shoot` rewrites the tree

**Status: closed.** Commit `ec8f10d`.

It writes to a temporary directory and says which; `pnpm ade:shoot:update` (or
`--update`, or `--out <dir>`) refreshes the committed set. `build.mjs`'s
`.dc.html` expansions are ignored for the same reason: they are a build product
of the artboards.

## F7 — the suite assumes it owns the machine's ADE

**Status: closed.** Commit `ec8f10d`.

`node scripts/package-ade.mjs --test` builds `apps/ade/out-test` as
`Svatah ADE Test`, bundle id `com.electron.svatah-ade-test`, and the suite
prefers it. Forge takes its configuration from a file rather than the command
line, so the switch is an environment variable and the script is the portable
way to set one — `FOO=1 pnpm …` is not a thing on Windows, where this work has
to run.

Demonstrated: `pnpm --filter @svatah/ade exec playwright test` — **38 passed** —
with a *product-build* ADE open on the fixtures project throughout, and that
instance still running afterwards.

## F8 — spec drift absorbed

**Nothing to do.** Draft 2.13 recorded it and Draft 2.14 is on `master`.

## F9 — the cockpit draws past the right edge

**Status: closed.** Commit `4e44091`.

`tui-pty.test.ts › at 100 columns` drew a 104-character line on a 100-column
terminal on master and passed in a worktree whose paths are longer — so the
overflow was a property of the *content*. The cause was `draw()` in `panes.tsx`:
a cell with neither a `width` nor `grow` was given `text.length`, whatever that
happened to be, and every grower then got a floor of four columns on top.

The budget is arithmetic in `layout.ts` now, covers every cell, and
`packages/tui/test/layout.test.ts` holds it to `sum(sizes) + gaps <= width` over
the shapes the pane model produces and **ten thousand generated lines**. Three
more places had the same shape of defect and are closed with it: a pane's box
sized itself to its content, `PaneBox` floored its inner width at eight on panes
that can be narrower, and the footer wrapped when a screen had enough
accelerators.

`cockpit.test.tsx`'s "renders without throwing" waited a fixed fifty
milliseconds for a promise; it polls. Two diagnostics sharing a code and a line
no longer collide on a React key.

## K6, K7 — the editing a release needs

**Status: closed.** Commit `cb3f913`.

**The flow editor.** Read is the annotated view — the gutter glyph from the last
run, the lint warning on the line, the plan's note — and Edit is a text area
holding exactly the text `GET /flows/:file` answered. Save writes it back through
`PUT /flows/:file`; the screen re-loads, which re-lints. The state carries the
file's `text` beside its `lines` rather than either being derived from the
other: a round trip through the annotated lines loses a trailing newline the
first time anybody saves.

`flows.save` was sending the project-relative `flows/simple.flow` to a route
rooted at the flows directory, so it asked for `flows/flows/simple.flow` — and
the generated client percent-encodes the separator, so the route did not even
match. `load()` has always sent the basename to `GET`; the write sends the same
unit now, which is why the read worked and the write 500ed.

**The API screen.** Method, URL, headers and body are a form; a blank last header
row is how one is added and blanking a name is how one is removed. `api.save`
writes `api/<name>.yaml` through `PUT /api/:name`, which is the file an `api`
step reads.

**In `svatah ui`, `e` opens `$EDITOR`** — the same `flows.save` action and the
same `PUT`, with the text from the editor a person already has. Ink is unmounted
while the editor owns the terminal, and an editor opened and closed saves
nothing.

Evidence: two Playwright cases that edit `simple.flow`, save it, watch the lint
pane report the new line, re-open it from the service to prove it is on disk, and
put it back; one that adds a header to a saved request and re-reads it; and two
cockpit cases that drive `e` with a scripted `$EDITOR`.

`docs/spec/progress/phase-10.md` gains a "Post-verification corrections" section
so a reader of that file is not left with nine open defects that are closed here.

---

# T11.2 — launch, quit, attach

**Status: complete.** Commit `31621e8`.

**`app.launch` and `app.quit`** are configuration, and the doing of them is
`@svatah/surface`'s `lifecycle.ts` — the same three decisions on both platforms,
with only the commands differing. A desktop session opens by launching when no
process of that name **owns a window** (not "is running": a process still
exiting and a helper sharing its application's name are both running and neither
can be driven), and closes by quitting. A session that found the application
already up does not remember a launch and will not quit it.

**`Quit the app` is pattern 31**, in the grammar, the IR,
`docs/flow-language.md` and four golden entries. A desktop adapter runs the
graceful route, then a signal, then `SIGKILL`, and fails when the process
survives all three; a web adapter refuses it, exactly as a desktop adapter
refuses `navigate`. The PEG ordering is recorded where it bit: `"quit"` matches
the first four letters of "quits" and `"app"` the first three of "application",
and PEG does not backtrack into a choice that has matched.

```
$ node scripts/eval-compiler.mjs
  tier1: 185/185 exact match (100.0%)
  tier2: 33/38 exact match (86.8%)
  overall: 221/226 (97.8%)
  Meets REQ-COMP-9.
```

**`app.attach.cdpUrl` / `SVATAH_CDP_URL`** attaches the Playwright adapter to a
Chromium that is already running, and *disconnects* rather than closing it.

### Validate

| Item | Command | Answer |
|---|---|---|
| The flow, green through the AX adapter three times | `node packages/cli/dist/bin.js run evals/self --host none` | `11 passed, 0 failed` ×3, no ADE and no `svatah serve` left behind |
| The same flow attached over CDP | ADE with `--remote-debugging-port`, then `SVATAH_CDP_URL=… svatah run evals/self/cdp --host none` | `5 passed, 0 failed`, with the ADE **still running** afterwards |
| Launched and quit ten times without a leftover | `svatah run evals/self --host none --flow flows/99-ade-lifecycle.flow` ×10 | 10/10 `6 passed, 0 failed`; `ade=''` and `serve=''` after every one |

### Three defects the self flow found

- **`locate` did not wait, in any adapter.** Playwright's *actions* auto-wait;
  `locator.all()` is a query and answers from the page as it is this instant. So
  every flow that clicked something and then looked for what the click produced
  raced the application — on the web it usually won, and against the ADE, where
  clicking a project starts a service, it lost about one run in three. All three
  adapters retry a locate that finds nothing until `candidateTimeoutMs`.
- **`config.flows.include` and `exclude` did nothing.** In the schema since
  Draft 1 and read by no one, so a project that narrowed its flows was quietly
  running all of them.
- **A relative `app.launch.bundle` meant nothing.** It is resolved from the
  project root now, like every other path a project names.

---

# T11.3 — desktop grounding

**Status: complete.** Commit `42ad870`.

**A desktop session says which *window* it is in.** LLD §3.3 has always said a
binding's context pattern is "a URL *or window-title* pattern", and the recorder
only ever read `state().url` — so every desktop binding it wrote was keyed on
`/` and every desktop grounding question was asked without saying which screen it
was about. The question carries `Window: Svatah ADE` where a web one carries
`Page: …`.

**The candidate list had only the web's kinds.** REQ-REC-3 asks for "a ranked
list per adapter kind", and a recording against the ADE came out with `role` and
`text`. `automationId` is proposed just under a test id and above role-and-name;
`controlPath` where a CSS path is.

**A desktop tree can be stable and wrong.** After a click that starts a service
the previous screen sits there unchanged for a second or two, so "the tree
stopped changing" is satisfied by the screen the click was meant to replace. A
`not-found` on a desktop surface is asked once more against the screen as it is
after a pause, and only when the tree has actually changed.

**The fake gateway gains a desktop case set**, recorded from the ADE:
`pnpm grounding:desktop-cases` launches the packaged application, records the
welcome screen, opens the fixtures project through its own Recent button, walks
the rail's eight screens and the palette's four, and turns every control with a
name and an id into a case — 93 of them. The ground truth is the `automationId`.
`desktop-answers.jsonl` is the desktop twin of `fixture-answers.jsonl`.

### Validate

```
$ pnpm self:record                    # three consecutive runs
recorded 3 binding(s) — candidate kinds: automationId, controlPath, role, text
record exit 0, replay exit 0, relocalize exit 0
```

- every binding of the flow written and verified, every one resolved by
  `automationId`;
- the same flow replayed green;
- and the relocalization, from `pnpm self:relocalize`:

```
recorded at variant 0: text "Flows", candidates automationId, role, controlPath
at variant 1 the same control is named "Editor"
the recorded role+name candidate now resolves to 0 element(s)
relocalize: relocalized 0.750; proposed rail-flows against the recorded rail-flows
```

The middle line is what makes the last one mean something: the variant broke the
recorded candidate, and the repair found the element with the recorded id
without being allowed to see the id.

---

# T11.4, T11.5 — the self suite and the parity gate

**Status: complete.** Commit `0a9d891`.

`evals/self` is a Svatah project whose flows drive the packaged ADE through the
accessibility tree; `evals/self/cdp` is the same flows through the DOM over CDP.
`evals/self/checks.yaml` is the catalogue — 48 checks, each with a sentence and
two implementations — and `svatah eval self` runs both sides and compares them.

**The runners are per source, not per check**, because running the suite that
holds a check once per check would run the ADE's Playwright suite thirty-eight
times. Each source runs once and answers with a map of name → verdict. A source
that cannot run at all makes every check it carries `unreachable` with the same
reason, which is what the one-sided list is for; `2` is `unreachable` for a
script, the convention `surface doctor` and the desktop gate already use.

**The tree-agreement oracle** (`pnpm tree:agreement`) is the one check with no
Svatah in it: the DOM Chromium renders on one side, the accessibility tree macOS
publishes from it on the other.

```
$ pnpm tree:agreement
the renderer and the accessibility snapshot agree about 58 identified control(s)
(58 in the DOM, 340 in the tree)
```

It found two things while being written. A `tabpanel` with an id is not a control
a flow can name, and its "accessible name" is whatever text is inside it — a
whole flow file, in one case. And `text-transform: uppercase` means the
accessible name macOS publishes is "INSPECTOR" where `textContent` says
"Inspector": the adapter is right, because §13.7's contract is "a visible label
that is its accessible name" and the visible label is the transformed one.

### Two defects the suite found in the ADE

- **Two controls with one accessible name.** The rail's "Import prototype
  database" row and the Import screen's button of that name, so any sentence
  naming it was ambiguous (`W_AMBIGUOUS_TARGET`). The button is "Import the
  database" now: a rail row says where you are going, a button says what it does.
- **A flow that quits the application has to run last.** One session serves a
  whole run, so a `Quit the app` in the middle leaves every flow after it driving
  something that is not there. The self flows are numbered and each says why.

### Validate

| Item | Command | Answer |
|---|---|---|
| `svatah run evals/self` green | `node packages/cli/dist/bin.js run evals/self --host none` | **31 passed, 0 failed, 0 skipped** |
| Every Playwright case has a check with the same id | `pnpm --filter @svatah/repo-checks exec vitest run test/self-catalogue.test.ts` | 7 passed |
| Every check has both sides or says why | the same file's third and fourth cases | 7 passed |
| The gate, at 100 percent | `node packages/cli/dist/bin.js eval self --report reports/self-parity.md` | see below |
| A wrong expectation makes it fail | `pnpm self:bite` | `the gate bit: a wrong expectation is a disagreement, with both sides' evidence` |
| The README names the gate | `README.md` § "The verification contract" | in |

`tools/repo-checks/test/self-catalogue.test.ts` holds the catalogue to its own
rules in a second rather than in the gate's minutes — and the case that matters
is the last one: every `unreachable` must name *what Svatah lacks* rather than
how somebody felt about it. It rejected ten reasons while this phase was being
written, and each of them is now a sentence somebody could implement from.

---

# T11.6 — the contract

`docs/spec/progress/phase-11.md` is this file. The parity report is embedded
below, and the one-sided list is read as Svatah's shortcomings with what each
would take.

---

# The parity report

<!-- REPORT -->

---

# The one-sided list, read as shortcomings

Thirty-seven of the forty-eight checks have only one side, and three of those
are external **by design** (REQ-SELF-3). The remaining thirty-four are Svatah's
own, and they are three gaps said in many places.

## 1. An assertion over a set

The flow language asserts about **one** element (patterns 23 and 24). It has no
sentence for "every control on this screen has an id", "no secret is anywhere on
this screen", "the inspector says each of its headings once", "the rows of this
table are these".

**What it would take.** A `check` step over a *snapshot* rather than over a
target — the shape `surface check` already has, lifted into the language:

```
Every button on this screen should have an id
No text on this screen should contain {data.card.number}
```

That is one new pattern with a quantifier and a scope, and it would close
**about a third of this list** in one change. It is the single highest-value
thing Phase 12 could do for the gate's coverage.

## 2. A window Svatah cannot resize

The toolbar rules are measured at several widths, and `app.launch` names no size
and there is no `resize` action. Four checks.

**What it would take.** `app.launch.size`, and a `Resize the window to 1100 by
860` sentence that a desktop adapter performs with `AXSetValue` on the window's
`AXSize` — which the AX bridge's `setValue` command can already carry.

## 3. A run inside a run

The ADE's Run button starts a Svatah run, and no sentence waits for a *second*
run to finish and reads its result. Four checks.

**What it would take.** The HTTP adapter can already call the local service; what
is missing is a `Wait for … to …` over a *service response* rather than over an
element — pattern 19 extended to a JSON path, which the `api` step's expectations
(pattern 26) already have the vocabulary for.

## 4. The ones that are genuinely not Svatah's job

- **`cockpit.pseudo-terminal`, `cockpit.json-is-the-model`.** Driving a terminal
  needs a pseudo-terminal adapter, and the surface kinds are `web`, `desktop`,
  `mobile` and `http` (LLD §2.4). A fifth kind is a phase of its own, and the
  question it would answer — "does the cockpit draw?" — is one `script(1)`
  already answers well.
- **`clients.generated-smoke`.** What it checks is that three generated clients
  *agree*, which is a comparison between programs.
- **`design.artboards-fit`.** The artboards are HTML files, not an application.
- **`ade.the-import-screen-previews-into-the-open-project-and-nowhere`.** Asserts
  about the filesystem after a preview, and no adapter reads a directory.
- **`gate.desktop-conformance`.** The gate *is* Svatah's own conformance suite,
  driven by a script that launches three ADE variants and carries fingerprints
  between them. A flow cannot relaunch its own application at a different
  variant mid-run.

## 5. And one the *external* side lacks

`ade.launch-open-read-quit`. No Playwright case launches or quits the
application: `_electron.launch` cannot open a packaged build with the
`RunAsNode` fuse off (T8.1), so the ADE's own suite attaches to a build somebody
else started. Launching and quitting is what T11.2 gave Svatah and the external
side does not have — the first check in this repository where Svatah reaches
something its external oracle cannot.

---

# Deviations

**D1 — `rolePathSimilarity` ignores anonymous containers (LLD §6.4, §16).**
§6.4 fixes the five weights and §16 requires "the same weights and threshold as
the web healing eval". Both hold: the weights and the threshold are untouched
and the *same function* serves both evals. What changed is what the function
counts — `group`, `generic`, `none` and `presentation` are dropped before the
common suffix is taken. Without it LLD §16's own variant 2 was arithmetically
unpassable (ceiling 0.66, threshold 0.72). The web healing eval's published
numbers are unchanged: 92.6% and 78.9%, line for line.

**D2 — `evals/self` has two projects, not one (LLD §13.9).** §13.9 describes
`evals/self/` as "a Svatah project" with flows over four adapters. The desktop
half needs `app.launch` and `app.quit`; the attaching half must *not* have them,
because a session that launched its own ADE would be reading a different
application from the one the accessibility side read. One `svatah.config.yaml`
per directory is the tool's own rule, so `evals/self/cdp` is a second project
reading the same `flows/` and `steps/`.

**D3 — the self flows are numbered (LLD §13.9).** `01-`, `02-`, `99-`. One
session serves a whole `svatah run`, so a flow ending in `Quit the app` has to be
the last; the number says so where a reader will see it.

**D4 — the HTTP and SDK sides of the self suite are catalogued, not written.**
§13.9 asks for flows "over the HTTP adapter against the local service, and over
the SDK against `svatah ui --json`". The catalogue has the checks and names what
each side would be; the HTTP flows are not written and the SDK side is
`unreachable` with its reason (no adapter drives a terminal). Recorded as K1
below rather than half-written: a flow that asserted nothing would make the
gate's coverage number a lie.

**D5 — the `Toolbar` sheds the primary action too, when it must.** Draft 2.13
says the toolbar "sheds secondary controls into the palette before" the title's
floor. On a bar narrow enough that the floor would still be broken, the primary
and the dangerous action are shed as well — secondary first, always. The
alternative is breaking the rule the correction is about.

---

# Known gaps

**K1 — the HTTP and SDK sides of the self suite are not written.** See D4. The
checks are in the catalogue and the gate reports them `unreachable` with the
reason; writing them is a morning's work and the shape is
`evals/self/http/svatah.config.yaml` with `adapter: http` and JSON-path
expectations against a `svatah serve` the gate starts.

**K2 — no AX screenshot.** Screen Recording is refused on this host, so
`pnpm ade:shoot` takes the twelve renderer screenshots and says why the
thirteenth is missing rather than fabricating one.

**K3 — Node 22 has not been run here.** This host has one Node (v25.6.1). The
contract's second leg is a verifier's.

**K4 — the Windows UIA gate is unrun.** Inherited. The UIA adapter's recorded
trees and its parity with the AX adapter are re-checked here against the
re-recorded ADE, which is what this phase could do without a Windows host. Every
desktop check's Windows half is published as `unreachable`.

**K5 — the compiler golden set is 226 against REQ-COMP-9's 300.** Inherited;
this phase added four (pattern 31) and did not otherwise touch it.

**K6 — the gate takes about ten minutes.** It runs the ADE's Playwright suite,
the cockpit's pseudo-terminal cases, the healing eval, the desktop conformance
gate and two `svatah run`s. That is honest — every one of those is a real oracle
— and it is too slow to run on every commit. `--only <check-id>` and
`--side svatah|external` exist for the inner loop.

**K7 — the parity gate has no Windows and no Linux answer.** Every source that
needs a window says `unreachable` off macOS, which is correct and makes the
gate's *agreement* number a macOS number. A verifier on another host should read
the coverage column before the agreement one.
