# Yam view layers

Status: proposed implementation specification, from the owner's decisions of 2026-09-09: `yam ui` **shares the model and the action registry and owns its own view layer**; direct control and authoring become one **Session** screen with three modes (Draft 2.27); and the same reasoning is applied to the other two surfaces a person meets — the command line and the app.

Requirement ids keep the `TV-` prefix they were written with. §0 of the requirements says ids do not renumber, and Draft 2.19 kept `REQ-ADE-*` through a product rename for the same reason; a prefix that has outgrown its first meaning is cheaper than a specification whose ids move. This document defines future behavior; command examples are not claims about the current release.

This document covers three view layers over one model: the **terminal** (`TV-01`–`TV-15`), the **app** (`TV-16`), and the **command line** (`TV-17`). Read [design](design.md), [implementation tasks](tasks.md) and the tasks' [verification](verification.md) together. Requirement IDs use `TV-` to avoid colliding with the existing specification. `REQ-TUI-1` is restated and `REQ-TUI-2` demoted by Draft 2.26 of [requirements.md](../requirements.md).

## Why this exists

`yam ui` was built as the *second renderer* of the screen model, and the parity it was held to was drawn at the wrong layer: the same panes, the same keys, the same picture as the app. Everything a terminal is good at — filling the screen, a live tail, a fuzzy palette, the mouse, a colour ramp — had no place to live, because it did not exist in a model shared with a browser. What shipped is the app's tables in boxes, drawn into the scrollback:

* the cockpit renders inline, not into the alternate screen, so the shell prompt sits above it;
* a pane is as tall as its content, so an empty project draws ten rows and leaves forty rows of black;
* an empty flow renders as one blank line numbered `1` under a full-width inverse bar, because `"".split("\n")` is one line and `empty: "no file open"` is unreachable;
* the palette cannot move its selection — `Enter` runs the first match, always;
* the design tokens are hexadecimal and the terminal is given eight ANSI names;
* nothing is live: the cockpit re-reads only when a key is pressed, in a product whose subject is runs.

None of those is a defect of the model. All of them are consequences of a view layer that was never allowed to be one.

## The boundary

| The model owns (`@svatah/yam-screens`) | The view owns (`@svatah/yam-tui`) |
|---|---|
| `ScreenState` and the shape `--json` prints | Layout: regions, sizing, fill, collapse |
| `ACTIONS`: id, label, `cli`, `availableWhen`, `run()` | Which key runs which action; chords and modes |
| `applyEvent`, `applyRecordEvent`, `applyHealEvent` | Focus, cursor, scroll, selection |
| Status tones and the design tokens | How a tone becomes colour in *this* terminal |
| Which actions a screen has | Palette behaviour, overlays, help, toasts |
| Everything a number or a status word means | Empty-state presentation, animation, mouse |

The rule in one sentence: **`packages/screens` may not describe a pane, a key or a colour; `packages/tui` may not compute a number, a status word or a label.**

## Functional requirements

| ID | Priority | Requirement and acceptance condition |
|---|---|---|
| TV-01 | P0 | The boundary above is enforced, not merely stated. `@svatah/yam-screens` contains no pane, region, key, colour or terminal dimension; `@svatah/yam-tui` derives every number, status word and label from the model. A repository check fails on a violation in either direction. |
| TV-02 | P0 | Parity is *data and actions*, not pictures. For every screen, every action `actionsForScreen(id)` offers is reachable from the cockpit by a key or the palette, and `yam ui --json` equals `screenById(id).load(service, params)` key for key. No requirement asks the terminal to draw the app's panes or bind the app's keys. |
| TV-03 | P0 | The cockpit owns the screen while it runs: alternate buffer, no scrollback, and the terminal restored on quit, on `SIGINT`/`SIGTERM`/`SIGHUP`, and on an uncaught throw. A cockpit that dies leaving a terminal in raw mode with the mouse enabled is a defect of this requirement. |
| TV-04 | P0 | Every region fills the box it is given. The rendered frame is exactly the terminal's rows and never wider than its columns, for every screen, at 80×24, 120×40 and 200×50, with an empty project and with a populated one. |
| TV-05 | P0 | Colour is the design tokens rendered for a terminal: 24-bit where the terminal reports it, 256 where it does not, and a monochrome path that loses no information. A status is never colour alone — the word or the glyph is always beside it, as `REQ-ADE-12` already requires of the app. |
| TV-06 | P0 | Every zero state names its next action and binds a key to it: no screen may draw an empty box and stop. This is `SF-17` applied to the terminal. |
| TV-07 | P0 | The key map is data. The footer, the `?` overlay and `yam ui --keys --json` are generated from one table and cannot disagree. Input has modes, so typing into a filter or a form never collides with navigation, and no action is unreachable because a digit was spent on pane focus. |
| TV-08 | P1 | The palette moves its selection, scores its matches, shows unavailable actions with the reason `availableWhen` gives rather than hiding them, and draws as an overlay over the cockpit rather than as a box appended beneath it. |
| TV-09 | P0 | The cockpit is live: it subscribes to the service event stream through the SDK and applies events with the model's own `applyEvent` family. A stream that drops is a stated state with a route back, never a frozen screen. |
| TV-10 | P1 | The mouse works where the terminal reports it — click to focus a region and select a row, wheel to scroll — and the keyboard remains complete without it. Mouse reporting is disabled again when the cockpit exits. |
| TV-11 | P0 | Every screen at three terminal sizes is a committed golden frame. A change to a view is a diff in a text file, not a screenshot somebody remembers to look at. |
| TV-12 | P2 | `yam ui --tmux` (alias `yam workspace`) is a convenience, not a release gate. It must not kill a person's shell when the cockpit quits, must title its panes, and must enable mouse reporting in the session; failing a decision to keep it, it is removed and the removal is documented. |
| TV-13 | P0 | Shared control is visible. The cockpit says who holds each target, names the agent when an agent holds it, and offers explicit handoff under a key; a call refused because another client holds the target is shown with that reason. While Yam serves MCP, the connected clients, the tools published, the tools refused *and why*, and every call as it arrives are readable in the terminal. This is `SF-13` and `SF-16` applied to the cockpit. |
| TV-14 | P0 | The cockpit opens where the app opens. Draft 2.27 makes **Session** the default destination (`REQ-ADE-11`, `REQ-ADE-14`); the cockpit still loads `flows` (`packages/tui/src/app.tsx`, `packages/tui/src/index.tsx`). The default becomes Session, and a repository check holds the two renderers to one default. |
| TV-15 | P0 | The cockpit implements `REQ-ADE-14`'s three modes on one screen: the mode is visible in a strip, `1`/`2`/`3` switch it, switching never drops the session or the flow being written, and the key map is mode-scoped so a sentence typed in **say** is a sentence and not a series of accelerators. The picker (`p`) is available in every mode. A phrase **say** cannot ground stops and offers the three groundings — point at it, ask the model where one is configured, or leave the line unbound — rather than failing the step. |

## The mocks

Nine artboards and five frames, drawn to this specification. They are proposals, not the shipped product.

| Artboard | Shows |
|---|---|
| [`TUI-Regions`](../design/artboards/TUI-Regions.html) | The alternate screen filled by a solved region tree; status bar, scroll position, toast, generated footer (TV-03..TV-07) |
| [`TUI-Run`](../design/artboards/TUI-Run.html) | A run arriving over the event stream, with a different region tree and a dropped-stream state (TV-09) |
| [`TUI-Palette`](../design/artboards/TUI-Palette.html) | The palette as an overlay with fuzzy matches and reasons on unavailable actions, and the generated `?` overlay at 80×24 (TV-07, TV-08) |
| [`TUI-Empty`](../design/artboards/TUI-Empty.html) | An empty project today and with a view layer of its own, at the same size (TV-04, TV-06) |
| [`TUI-Session`](../design/artboards/TUI-Session.html) | The default screen under Draft 2.27: one session, three modes, with **say** active — a sentence grounded and run, the flow accumulating beside it, and an unbound phrase asking rather than failing — and **record** below it (TV-14, TV-15) |
| [`TUI-Surfaces`](../design/artboards/TUI-Surfaces.html) | The **do** mode in full: targets, the snapshot tree with its refs and generation, a typed action form, and a verified result (TV-02, TV-06) |
| [`TUI-Surface-States`](../design/artboards/TUI-Surface-States.html) | The connect form — discovery, a typed endpoint, and ownership chosen before anything is touched — and all six `SurfaceProblemKind` states, each with the key that answers it (TV-06) |
| [`App-Session`](../design/artboards/App-Session.html) | The same design in the app: the rail `REQ-ADE-11` describes, Session with its three modes, the flow being written, and an unbound phrase offering its three groundings (TV-16) |
| [`TUI-Mcp`](../design/artboards/TUI-Mcp.html) | The cockpit while Yam serves MCP: clients and transports, tools published and refused with reasons, live calls, and an agent holding a target with the key that takes it back (TV-09, TV-13) |
| TV-16 | P0 | The app is held to the same boundary and the same Session design. Its rail is Session (default), Automations, Activity, Settings; the Surfaces and Record screens merge into Session's three modes; and `packages/ui` grows the primitives that design needs and does not have — a tree, a following log, a mode strip, a picker overlay, a toast and a resizable split. Motion becomes part of the system: today `packages/ui/ui.css` and `apps/desktop/.../shell.css` contain **zero** transitions and keyframes between them, so in an app that is already live — `Shell.tsx` subscribes to the event stream — arriving rows and changing statuses are silent jumps. Every state change a person did not cause is animated or it is announced; none is both silent and instant. |
| TV-17 | P0 | The command line is a view layer too, and its presentation is specified rather than incidental: one state-and-next-verb front door, help that is generated from the same command table the parser uses, diagnostics that name the next command, `--json` on every ordinary command with the result alone on stdout and progress on stderr, and colour that follows the same tokens and degrades the same way. A copied example from any help output executes. |
| TV-18 | P0 | Theme is a preference the product keeps, in every view layer. The app follows `light`, `dark` or `system`, and `system` means the operating system's setting *and* its changes while the app is open, not its value at launch. `preferences.ts` already stores the choice and defaults it to `system`; nothing applies it — `data-theme` appears nowhere outside `packages/ui`'s component sheet, and `nativeTheme` is never read. The cockpit takes `--theme` and `YAM_THEME`; a terminal cannot be asked reliably what it is, so the default is the terminal's own background and Yam does not guess. Both themes are the `@svatah/yam-ui-tokens` tables that already exist. |
| TV-19 | P0 | Nothing that is chrome scrolls, and nothing is fixed that should be fluid. The window, the rail, the toolbars, the mode strip, the inspector's frame and the status bar are always whole at every supported size; only a region's *contents* scroll, virtualized, with the position drawn. The app has one breakpoint today, at 960 px, above which the rail and inspector are a fixed 580 px of any window; the layout becomes fluid with stated behaviour at `SF-18`'s sizes — 1280×800 and 1440×1000, at 100 % and 200 % zoom — and a check measures it rather than a person remembering to look. |
| TV-20 | P0 | What is shown is what ships. Every capture, artboard and screenshot in the repository is of the product as an end user meets it — the real mark, the real icon, the real frames at real sizes, from the built application rather than from a drawing of it. An artboard may lead the implementation, and while it does it is labelled a proposal; once the thing exists, the evidence is regenerated from the thing. No published image is a mockup wearing the product's name. |

```console
$ pnpm artboards --shoot /tmp/tui        # renders and measures all of them
$ cat frames/flows-120x40.txt            # the same cockpit as text, exactly 120x40
$ cat frames/welcome-80x24.txt           # and the empty directory at 80x24
```

The [frames](frames/README.md) are what TV-11's golden check will hold the views to, written by hand first so the check has something to disagree with.

## Not in scope, and why

**Watching a flow execute *on* the surface you have selected.** It is the obvious next thing to want, and it is not a view-layer change. As the code stands the two are different connections to the same application: `yam run` builds its own surface through `createSurface` (`packages/cli/src/commands/run.ts`), while Surfaces sessions are held by the broker in `@svatah/yam-surface-control` with session ids, generation-scoped refs and ownership. `RunState` carries no session id, no target identity and no refs, so there is nothing in the model to join a running step to a session, and a view that drew them side by side would be asserting a relationship the runtime does not have.

Two things follow, and both belong outside this specification:

1. **The join is a runtime change.** For a run to be watchable on a surface, the runner would take a broker session rather than making its own — which also brings it under `SF-13`'s arbitration, and makes pausing a run and taking control mid-step possible. That is a requirement about the runtime and the broker, not about the terminal.
2. **Until then, two writers can reach one target.** A person holding a session on an application while a run drives the same application are, today, two independent connections. Whether `SF-13`'s serialisation sees the second one is worth establishing before anything is drawn about it.

What this specification does instead is make the *relationship* navigable: a failed step names its target and offers to open it in Surfaces, and a session offers `Save as automation`, which already exists (`surface.save-automation`).

## Measurable acceptance scenarios

1. **An empty directory.** `yam ui` in a directory with no project fills the terminal, names what is missing, and offers `yam init` under a key that runs it. No phantom row, no empty box without a next action.
2. **A watched run.** `yam run` in one terminal, `yam ui` in another: steps change state in the cockpit with no key pressed, and the audit region tails the run's events.
3. **A narrow terminal.** 80×24: every screen is whole, nothing is drawn past the right edge, nothing is clipped, and every action remains reachable through the palette.
4. **An agent.** `yam ui --json` and `yam ui --keys --json` describe the cockpit's state and its key map with no terminal allocated; the state equals the model's.
5. **A held target.** An agent connects over MCP and takes a session; the cockpit names it in the status bar of whatever screen is open, the Surfaces screen shows the holder, and one key takes control back. A second client's mutation on the held target is refused *in the open*, with the reason.
6. **A hostile exit.** The cockpit is killed with `SIGKILL`'s survivable cousins and by an induced throw; in each case the terminal comes back with its own buffer, its cursor and no mouse reporting.
