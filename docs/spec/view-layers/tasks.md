# Terminal view layer — implementation tasks

Status: **delivered on `tui-view-layer`; nothing published.** Every box below was
ticked by work that ran, and the evidence — what was found, what was done
differently, and what has *not* been done — is in
[progress/wave-1.md](progress/wave-1.md). Two tasks carry a deviation and say so
in their own text: TV-15's mode key, and TV-C01's two sources.

The release remains the owner's call, and no tag, registry or push has happened.

## W0 — The model, before any view can be merged

Draft 2.27 merges two screens into one. That is a change to `@svatah/yam-screens`, and until it lands neither renderer can draw Session without inventing state the model does not have — which is the failure this whole specification exists to correct.

- [x] **TV-M01 · P0 · Model — One `session` screen with three modes.** Requirements: `REQ-ADE-14`, TV-15. Merge `packages/screens/src/screens/surfaces.ts` and the record screen into a `session` screen whose state carries the broker session, the snapshot, the element, the offers, the capture state, the sentence being said, and the flow being written. `mode: "record" | "say" | "do"` is a screen parameter, so it is a deep link in both renderers and a `--screen session --mode say` on the command line. **Done:** one screen id, one `load()`, and every field either has a reader in a view or is deleted; `apps/desktop/test/parity.test.ts`, `screen-rule.test.ts` and `shell.spec.ts` are updated in the same change rather than left red. Depends: none.
- [x] **TV-M02 · P0 · Model — Keep the action ids.** Requirements: `REQ-ADE-10`, TV-02. `surface.*` and `record.*` action ids do not change; what changes is which screen declares them and their `availableWhen`, which becomes mode-aware. **Done:** `tools/repo-checks/test/action-parity.test.ts` passes untouched; the palette fixture diff is a rename of screens, not of actions. Depends: TV-M01.
- [x] **TV-M03 · P0 · Model — The key tables leave the model.** Requirements: TV-01, TV-07. `Screen.keys` moves out of `@svatah/yam-screens` into each renderer: `packages/tui/src/input.ts` and an equivalent in the app. The model keeps actions; the views keep keys. **Done:** `packages/screens` matches no key vocabulary, and both renderers' tables are generated into their own help. Depends: TV-M01.
- [x] **TV-M04 · P0 · Model/service — `--json` says what changed.** Requirement: TV-02. The screen ids `surfaces` and `record` disappear from the model's published list; that is a breaking change to `yam ui --json`, `--screen`, deep links and the SDK's screen enum. Draft 2.28 removes them outright: nothing has shipped, so there is nobody to deprecate for, and an alias kept "just in case" is two names for one screen in the SDK enum, the deep links and the docs forever. List the removal in the changelog. **Done:** `--screen surfaces` is an error naming `session`, not a silent redirect; the SDK's generated enum is regenerated and every consumer in the repository compiles. Depends: TV-M01, TV-M02.

- [x] **TV-M05 · P0 · Model/service — Connected clients are state.** Requirements: TV-13, `SF-07`, `SF-08`. `AgentsState` carries `tools`, `refused` and `invocations` and nothing about *who is connected*: the `TUI-Mcp` board draws clients, transport, protocol version, profile and connection time, none of which exists. Add a `clients` list to the model, sourced from the stdio and HTTP MCP servers, and join it to the session holder that already exists. Draft 2.28 splits where it is read: tool **exposure** is configuration and is drawn under Automations, **clients and their calls** are activity and are drawn under Activity, and the **holder** appears on Session. The rail stays at four destinations. **Done:** the board's left region is model state rather than a drawing; a client that disconnects leaves the list; `--json` carries it. Depends: TV-M01. *(Found while drawing the MCP view — see [verification.md](verification.md) D4.)*

**W0 gate:** the model has one Session screen with modes, the action registry is unchanged, keys have left the model, and the rename is versioned rather than silent.

## W1 — The foundation, and two screens on it

- [x] **TV-T00 · P0 · Spike — Prove the terminal can do this, then throw it away.** Requirements: TV-03, TV-04, TV-10. Half a day: the alternate screen entered and restored, a region tree at fixed heights, a resize, one mouse click, and a frame redrawn from a fake event stream at the rate a live run implies. Not merged. **Done:** a written answer to "can Ink hold this, and at what frame cost", and either TV-T02/T03/T05 are confirmed in shape or the widget layer is re-planned before anything depends on it. Depends: none. *(B4 in [verification.md](verification.md): the one assumption in this specification that could reshape a wave.)*

- [x] **TV-T01 · P0 · Product/specification — Restate the parity claim.** Requirements: TV-01, TV-02. Drafts 2.26 and 2.27 of `docs/spec/requirements.md`: `REQ-TUI-1` loses "numbered panes, the same actions and keys"; `REQ-TUI-2` drops to P2. Write this specification set and link it from the requirements' companion list. **Done:** no active requirement asks the terminal to draw the app's panes; the superseded sentence is named in the change log. Depends: none.
- [x] **TV-T02 · P0 · Runtime — Own the screen.** Requirement: TV-03. `src/terminal.ts`: capability probe, alternate buffer, raw mode, mouse enable/disable, resize, and restore on quit, on `SIGINT`/`SIGTERM`/`SIGHUP` and on an uncaught throw. **Done:** the cockpit leaves no scrollback and no terminal is left in raw mode by any exit path the test can produce. Depends: TV-T01.
- [x] **TV-T03 · P0 · Runtime — Solve the layout.** Requirement: TV-04. `src/layout.ts`: the region tree and `solve()`, keeping `budget()` and its contract unchanged. Property tests for no-overflow and exact-fill on generated trees. **Done:** for ten thousand generated trees and every tree the views produce, boxes cover their parent exactly and cross no edge. Depends: TV-T01.
- [x] **TV-T04 · P0 · Design system — Render the tokens.** Requirement: TV-05. `hex` beside `ansi` in `@svatah/yam-ui-tokens`; `src/theme.ts` resolving a tone by capability with 24-bit, 256 and monochrome paths; `--color` and `NO_COLOR`. **Done:** the same token drives the app and the cockpit; no tone is distinguishable by colour alone. Depends: TV-T01.
- [x] **TV-T05 · P0 · View — Build the widgets.** Requirements: TV-04, TV-06. `src/widgets/`: `Region`, `List`, `Table`, `Source`, `KeyValue`, `Log`, `Tree`, `Overlay`, `StatusBar`, `Toast`, `Empty`. Every widget renders at a given height and pads to it; `List` and `Log` are virtualized. **Done:** a widget given a height of *n* draws *n* lines, with zero rows and with fifty thousand. Depends: TV-T03, TV-T04.
- [x] **TV-T06 · P0 · QA — Golden frames.** Requirement: TV-11. A harness rendering any screen at any size against the recorded fixtures, and the committed frames for the migrated screens. **Done:** a deliberate one-character view change fails the check; an empty project and a populated one are both covered. Depends: TV-T05.
- [x] **TV-T07 · P0 · View — Migrate Session, Flows and Run.** Requirements: TV-04, TV-06, TV-11, TV-14. `views/session.tsx` (Draft 2.27's three modes over one broker session, absorbing what were the Surfaces and Record screens), `views/flows.tsx` and `views/run.tsx` as region trees; the empty flow becomes an `Empty` rather than one blank numbered line. Session is first because it is the screen the cockpit will open on. `rows.ts` remains the fallback for the other nine. **Done:** three screens fill the terminal at the three sizes, the phantom `1` row is gone, connect → inspect → act → verify is completable from the terminal with no project open, and all three have golden frames. Depends: TV-T05, TV-T06, TV-M01.
- [x] **TV-T07b · P0 · View — Open where the app opens.** Requirement: TV-14. The cockpit's default screen becomes `session` in `packages/tui/src/app.tsx` and `index.tsx`, and a repository check reads the default out of both renderers and fails when they differ. **Done:** `yam ui` with no `--screen` lands on Session, as the app does; the check is shown to bite against a deliberate divergence. Depends: TV-T07.

- [x] **TV-T11 · P0 · Input — The key map as data.** Requirement: TV-07. `src/input.ts`: the table, the modes, the generated footer, the `?` overlay and `yam ui --keys --json`. **Done:** no key is advertised and unbound or bound and unadvertised; a digit typed in a filter does not change pane. Depends: TV-T02.
- [x] **TV-T07c · P0 · View/input — The three modes.** Requirement: TV-15. The mode strip, one-key switching with the session and the flow preserved (`m`; the digits stay with the regions, and the `TUI-Session` board's `1 record 2 say 3 do` is superseded — see the mode key's own comment in `packages/tui/src/keys.ts`), a mode-scoped key map, the picker in every mode, and **say**'s three answers to an ungroundable phrase. **Done:** a flow started by capture is continued by a written sentence and checked in **do** without reconnecting; a sentence typed in **say** never triggers an accelerator; an unbound phrase offers the picker, the model where configured, and leaving it unbound. Depends: TV-T07, TV-T11.

**W1 gate:** the cockpit owns the terminal, fills it, colours itself from the tokens, and two screens are drawn by their own views with frames under test.

## W2 — The remaining screens

- [x] **TV-T08 · P0 · View — Migrate the other nine screens.** Requirements: TV-04, TV-06, TV-11. `views/` for runs, bindings, record, heal, agents, api, data, import, settings. Each gets its own region tree and its own zero state naming a next action. **Done:** twelve views, twelve zero states with a bound key, thirty-six golden frames. Depends: TV-T07.
- [x] **TV-T09 · P0 · Cleanup — Delete `rows.ts`.** Requirement: TV-01. Remove the fallback renderer and the exports that only it needed. **Done:** no screen renders through the old uniform tuple; the package's public surface is the views and the widgets. Depends: TV-T08.
- [x] **TV-T10 · P0 · QA — Enforce the boundary.** Requirement: TV-01. A repository check: `packages/screens` matches no pane/region/key/colour/column vocabulary, and `packages/tui` computes no status word or label. **Done:** the check is shown to bite against a deliberate violation on each side. Depends: TV-T09.

**W2 gate:** every screen is drawn by a view of its own, the old renderer is gone, and the boundary is machine-checked rather than asserted in a comment.

## W3 — Interaction and liveness

- [x] **TV-T12 · P0 · QA — Action reachability.** Requirement: TV-02. For every screen, every `actionsForScreen(id)` entry is bound in the key map or listed by the palette. **Done:** the check fails when an action is added to the registry and reached from nowhere in the cockpit. Depends: TV-T11.
- [x] **TV-T13 · P1 · View — The palette.** Requirement: TV-08. Overlay, fuzzy scoring with highlighted matches, moving selection, recents, unavailable actions shown with their reason. **Done:** a selection can be moved and run; an unavailable action explains itself instead of disappearing. Depends: TV-T11.
- [x] **TV-T14 · P0 · Runtime — Subscribe.** Requirement: TV-09. `store.ts` subscribes through the SDK and applies events with the model's `applyEvent` family; `live`/`reconnecting`/`offline` in the status bar with a retry key. **Done:** a run started in another terminal changes the cockpit with no key pressed; a killed service produces a stated state, not a frozen screen. Depends: TV-T08.
- [x] **TV-T15 · P1 · Input — The mouse.** Requirement: TV-10. SGR 1006 decoding, click to focus and select, wheel to scroll, disabled again on exit. **Done:** every mouse affordance has a key that does the same thing; no terminal is left reporting. Depends: TV-T02, TV-T11.

- [x] **TV-T15b · P0 · View — Shared control, and the MCP view.** Requirement: TV-13. The holder in the status bar on every screen; the holder and explicit handoff on Surfaces; the Agents view showing connected clients and transports, tools published, tools refused with their reasons, and calls as they arrive over the subscription. **Done:** an agent taking a session is visible without changing screen; one key takes control back; a mutation refused because another client holds the target names that client. Depends: TV-T07, TV-T14.

**W3 gate:** the cockpit is driven the way a terminal application is driven, and it updates itself while a person watches.

## W4 — Close it out

- [x] **TV-T16 · P2 · CLI — Demote the workspace.** Requirement: TV-12. `REQ-TUI-2` at P2; fix the session teardown so quitting the cockpit does not kill the person's shell, title the panes, enable mouse — or remove `--tmux` and say so in the CLI help and the guides. **Done:** whichever is chosen is documented and tested; no P0 gate depends on tmux. Depends: TV-T14.
- [x] **TV-T17 · P0 · Design — Artboards for the terminal.** Requirements: TV-04, TV-05, TV-06. The eight boards — `TUI-Regions`, `TUI-Run`, `TUI-Palette`, `TUI-Empty`, `TUI-Surfaces`, `TUI-Surface-States`, `TUI-Mcp`, `TUI-Session` — and `App-Session` are drawn and on the canvas; what remains is the terminal rules in `scripts/audit-artboards.mjs` (nothing past the right edge at 80/120/200 columns; the frame fills its rows). **Done:** `pnpm artboards` measures the cockpit's own boards rather than passing them for want of a rule, and each rule is shown to bite. Depends: TV-T08.
- [x] **TV-T18 · P0 · Docs/evidence — Record the waves.** Requirements: TV-01..TV-20, all three layers. Refresh `pnpm ui:capture`, `docs/guides/use-the-app.md` and the generated package reference; write `progress/wave-*.md` with the evidence and the deviations. **Done:** the captures in the repository are of the cockpit that exists, and every requirement above is either evidenced or named as not met. Depends: TV-T17. A P2 left undone is recorded as undone; it does not hold the evidence.

## Checks this work moves

Three existing checks are written against the cockpit as it is today. Each moves with the code; none is deleted, because each states something still true.

* `tools/repo-checks/test/palette-parity.test.ts` greps `packages/tui/src/app.tsx` for `ACTIONS.filter(`. When the palette becomes an overlay widget it must be re-pointed at that module, keeping the claim — neither renderer filters or adds to the registry — intact (TV-T13).
* `packages/tui/test/cockpit.test.tsx` asserts four numbered panes and the artboard's keys. It is rewritten against the key map and the golden frames, which check the same things more strictly (TV-T06, TV-T11).
* `tools/repo-checks/test/tui-pty.test.ts` is unchanged and stays the contract that lets the view move: `--json` equals the model's state, in a real pseudo-terminal.

No new package is added, so HLD §12's package list and `tools/repo-checks/test/layout.test.ts` are untouched.

## WA — The app, on the same design (parallel to W1–W3, after W0)

**The first three are not optional and not deferrable.** TV-M01 removes the screens `Surfaces.tsx` and `Record.tsx` render; the app stops building the day W0 lands, so its migration is part of that work rather than a later wave. TV-A04 through TV-A07 are polish and may wait for a later release without leaving anything broken — that is the whole of the answer to B5.

- [x] **TV-A01 · P0 · App — The rail Draft 2.25 and 2.27 describe.** Requirement: TV-16. `Session` (default), `Automations`, `Activity`, `Settings` in `apps/desktop/.../Shell.tsx` — and in `docs/spec/design/macros.mjs`, whose `@@SIDEBAR` still draws the pre-2.25 rail of Flows, Runs, Bindings, Agents, API and Data, so **every app artboard in the repository is showing navigation the product abandoned two drafts ago**. **Done:** rail, artboards and `REQ-ADE-11` agree; a repository check reads the rail out of the macro and the shell and fails when they differ. Depends: TV-M01.
- [x] **TV-A03 · P0 · Design system — The primitives Session needs.** Requirement: TV-16. `packages/ui` gains `Tree`, `Log` (following, virtualized), `ModeStrip`, `PickerOverlay`, `Toast` and a resizable `Split`; each is added to the component sheet and to the axe-core pass that already gates it. **Done:** no Session view holds a bespoke tree or list; the sheet renders every new primitive in both themes. Depends: TV-M01.
- [x] **TV-A02 · P0 · App — Merge Surfaces and Record into Session.** Requirements: `REQ-ADE-14`, TV-16. One screen, three modes, one broker session, the mode in a strip and in the URL/params; `Surfaces.tsx` (723 lines) and `Record.tsx` (367) become one view over the merged state. **Done:** a capture continues as a written sentence and is checked in **do** without reconnecting, in the app, as in the cockpit. Depends: TV-M01, TV-A01, TV-A03.
- [x] **TV-A04 · P0 · Design system — Motion is part of the system.** Requirement: TV-16. Duration and easing tokens in `@svatah/yam-ui-tokens`; arrivals, status changes and mode switches animate; everything honours `prefers-reduced-motion`. **Done:** no state change a person did not cause is both silent and instant; with reduced motion set, every animation is replaced by an announcement, not merely removed. Depends: TV-A03.
- [x] **TV-A05 · P0 · App/QA — The empty and problem states, audited.** Requirements: TV-16, `SF-17`. Every app screen's zero state names its next action, and the six `SurfaceProblemKind` states are implemented in Session as they are drawn for the cockpit. **Done:** a check enumerates the states and fails on one that offers no next action; the `TUI-Surface-States` board and the app agree. Depends: TV-A02.

- [x] **TV-A06 · P0 · App/cockpit — Wire the theme that is already stored.** Requirement: TV-18. Apply `data-theme` at the app's root from `preferences.theme`; when it is `system`, read `nativeTheme.shouldUseDarkColors` and subscribe to its `updated` event so a change while the app is open is followed; expose the three choices in Settings. In the cockpit, `--theme`/`YAM_THEME` select the same two token tables. **Done:** switching the OS appearance changes the app without a restart; the component sheet and the app render the same tokens; `yam ui --theme light` is legible on a light terminal. Depends: TV-A03.
- [x] **TV-A07 · P0 · App — Fluid, and nothing chrome scrolls.** Requirement: TV-19, `SF-18`. Replace the fixed rail and inspector with fluid widths and stated minima; virtualize the tree, the lists and the log; draw scroll position; add the breakpoints between 960 px and 1440 px that the single existing one implies. **Done:** at 1280×800 and 1440×1000, at 100 % and 200 % zoom, no chrome is clipped and no page scrollbar exists; a measured check fails on a regression rather than an eye. Depends: TV-A02, TV-A03.

- [x] **TV-A08 · P0 · App/design system — The mark, everywhere it is missing.** Requirements: TV-16, TV-20. `apps/desktop/forge.config.ts` sets **no `icon` at all**, so the packaged application ships Electron's default; `.sv-brand-mark` (`shell.css:45`) is an 18 px accent square standing in for a logo, and `macros.mjs` gives every artboard the same square. Wire the vendored mark in `packages/ui/brand/` into all three, generate the platform icon sets from `app-icon-512.png`, and draw the 16 px asset on a 16 grid with a 1 px stroke rather than scaling the 48 px art. **Done:** the packaged app has its own icon in the dock, the task bar and the about panel; the app's topbar and every artboard carry the mark; the 16 px asset keeps the two-leaf fork that a solid silhouette loses. Depends: TV-A01.

**WA gate:** the app and the cockpit are the same design at two densities, and the artboards describe the product that exists.

## WC — The command line

- [x] **TV-C01 · P0 · CLI — Generate what can be generated from the command table, and keep the check.** Requirement: TV-17. `yam help`, `yam help <command>` and now `yam completion` all read `COMMANDS`. **The dispatch deliberately does not.** The original task said to make the table the single source and replace the parity check that would become a tautology; building it made the opposite argument the stronger one, and it is the repository's own: the palette fixture is hand-maintained precisely because "a check that generated the fixture from the registry would compare the registry with itself and pass whatever anyone called anything". The same is true here, so `help.ts` and `cli.ts`'s dispatch stay two sources with `action-parity` between them, and the completion script becomes the table's third reader. **Done:** a documented command can be completed and an undocumented one cannot; the two-source check still bites. Depends: none.
- [x] **TV-C02 · P0 · CLI — Every copied example runs.** Requirement: TV-17, `SF-20`. A check extracts every `yam …` line from help output and the guides and executes it against the fixtures project, in a temporary directory. **Done:** the check fails on a stale flag; no example needs a repository path. Depends: TV-C01.
- [x] **TV-C03 · P0 · CLI — One presentation.** Requirement: TV-17. `--json` on every ordinary command with the result alone on stdout and progress on stderr; colour from the same tokens through the same capability detection as the cockpit, `NO_COLOR` honoured; diagnostics that end in the next command. **Done:** a piped command emits exactly one JSON document; a failing command names what to run next; the same tone is the same colour in `yam run` and `yam ui`. Depends: TV-C01.

## Requirement coverage index

| Requirements | Tasks |
|---|---|
| TV-01 | TV-T01, TV-T09, TV-T10 |
| TV-02 | TV-T01, TV-T12 |
| TV-03 | TV-T02, TV-T15 |
| TV-04 | TV-T03, TV-T05, TV-T07, TV-T08, TV-T17 |
| TV-05 | TV-T04, TV-T17 |
| TV-06 | TV-T05, TV-T07, TV-T08, TV-T17 |
| TV-07 | TV-T11 |
| TV-08 | TV-T13 |
| TV-09 | TV-T14 |
| TV-10 | TV-T15 |
| TV-11 | TV-T06, TV-T07, TV-T08 |
| TV-12 | TV-T16 |
| TV-13 | TV-T15b |
| TV-14 | TV-T07b |
| TV-15 | TV-T07c |
| TV-16 | TV-A01..TV-A05 |
| TV-17 | TV-C01..TV-C03 |
| TV-18 | TV-A06 |
| TV-19 | TV-A07 |
| `REQ-ADE-14` | TV-M01, TV-T07, TV-T07c, TV-A02 |
