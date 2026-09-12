# Terminal view layer — design

Companion to [requirements](README.md) and [tasks](tasks.md). Everything here lives under `packages/tui/`; the only changes outside it are one field in `@svatah/yam-ui-tokens`, the restated requirement, and the repository checks.

## Module map

```
packages/tui/src/
  terminal.ts     capabilities, alternate screen, mouse, resize, restore   (new)
  theme.ts        tokens → 24-bit / 256 / mono                             (new)
  layout.ts       the region tree and the width budget                     (rewritten, budget kept)
  input.ts        the key map as data; modes; mouse decoding               (new)
  store.ts        the reducer: screen, focus, cursors, overlays, toasts    (grown from model.ts)
  widgets/        Region, List, Table, Source, KeyValue, Log, Tree,
                  Overlay, StatusBar, Toast, Empty                         (new)
  views/          one module per screen, returning a view descriptor       (new; replaces rows.ts)
  app.tsx         mount, subscription, key dispatch, overlay stack         (rewritten)
  rows.ts         retained until the last view is migrated, then deleted
```

## The region tree

`layout.ts` today allocates three widths and two row counts, and its `budget()` holds the contract `sum(sizes) + gaps <= width` for any cells and any width. That contract is the best thing in the current cockpit and it is kept verbatim. What is added is the half that was missing: **vertical fill**.

A view returns a tree of regions rather than four fixed panes:

```ts
type Region =
  | { split: "row" | "column"; children: Region[] }
  | { id: string; widget: Widget; weight?: number; min?: number; max?: number;
      collapseBelow?: number };
```

`solve(tree, columns, rows)` returns a box per region. Its contract, asserted by property tests exactly as the width budget is today:

* **no overflow** — no box crosses the terminal's right or bottom edge;
* **exact fill** — the boxes of a split cover their parent's rows and columns with nothing left over;
* **collapse, never clip** — a region under `collapseBelow` leaves the row and becomes reachable full-width, which is what the inspector already does at 120 columns and is now a general rule.

Four numbered panes remain the *default* tree for authoring screens, because numbered panes are a good terminal idiom. They stop being the only one: Run wants a wide step list over a live log, Surfaces wants a target list beside a snapshot tree, and neither has to pretend to be a tree/main/inspector/audit.

## Widgets

Each widget renders **at a given height**, padding to it. That single rule is what removes the forty rows of black from a tmux pane, and it is checked by TV-04 rather than trusted.

| Widget | For |
|---|---|
| `Region` | Border, title, focus treatment, scroll indicator |
| `List` / `Table` | Rows of cells through the existing width budget; virtualized |
| `Source` | Flow text: line gutter, outcome glyph, selected step |
| `KeyValue` | Inspectors |
| `Log` | A tail that follows, with a "jump to end" state when it does not |
| `Tree` | Snapshot and project trees, with expand/collapse |
| `Overlay` | Centered box over a scrim: palette, help, confirm |
| `StatusBar` | Project, service, screen, counts, connection state |
| `Toast` | What the last action said, for a few seconds, over the frame |
| `Empty` | Headline, one sentence, and the key that fixes it (TV-06) |

## Theme

`@svatah/yam-ui-tokens` gains a `hex` beside the existing `ansi` in `STATUS`, so the terminal reads the same table as the browser instead of a flattened copy of it. `theme.ts` resolves a tone to an escape sequence by terminal capability: `COLORTERM=truecolor|24bit` → 24-bit; `TERM` ending `-256color` → the nearest xterm-256 index; otherwise the current eight names. `NO_COLOR` and a non-TTY force the monochrome path, where every tone still carries its glyph — which is why the accessibility rule survives losing colour.

## Input

The key map is a table:

```ts
{ key: "r", when: "screen:flows", action: "flows.record", label: "record" }
{ key: "ctrl+k", when: "always", command: "palette.open" }
{ key: "/",      when: "region:list", command: "filter.open" }
```

Three consequences, all of them requirements: the footer is generated from it (so a key can never be advertised and unbound), `?` renders it, and `yam ui --keys --json` prints it for agents and for the reachability test. **Modes** — `normal`, `filter`, `palette`, `form` — decide which table is consulted, so a digit typed into a filter is a digit rather than a jump to pane 3.

Mouse is SGR 1006, decoded in `input.ts` and enabled only while the alternate screen is up.

## Liveness

The model already carries `applyEvent`, `applyRecordEvent` and `applyHealEvent`, and `@svatah/yam-sdk` already has `subscribe()` over SSE. The cockpit simply never called either. `store.ts` subscribes on mount, applies each event through the model's own reducer, and holds three connection states — `live`, `reconnecting`, `offline` — of which the last two are drawn in the status bar with the key that retries. No new model code and no polling.

## Palette, help, toasts

The palette becomes an `Overlay`: fuzzy scoring with the matched characters highlighted, `↑`/`↓`/`ctrl+n`/`ctrl+p` to move, recents first on an empty query, and unavailable actions listed greyed with the reason `availableWhen` implies rather than filtered out — an action that vanishes teaches nothing. `?` is the same overlay over the key map. Action results become toasts over the frame instead of a line under the footer that pushes the layout.

## What happens to `rows.ts`

It is not deleted on day one. Each screen's view is migrated to `views/<screen>.tsx`, and until the last one moves, an unmigrated screen falls back to the current `{title, lines, footer, empty}` renderer wrapped in a `List`. The suite stays green at every commit, and the golden frames make each migration a reviewable diff.

## Testing

1. **Property tests** for `solve()` and `budget()`: no overflow, exact fill, on generated trees and on the trees the views actually produce.
2. **Golden frames**: 12 screens × {80×24, 120×40, 200×50} × {empty project, fixture project}, rendered through `ink-testing-library` against the recorded fixtures and committed as text. This is what would have caught the phantom `1` row and the collapsed panes.
3. **Action reachability** (TV-02): for each screen, every action is bound in the key map or listed by the palette. Replaces the old "same keys as the app" claim and is stronger than it.
4. **`--json` equality** in a pseudo-terminal: `tools/repo-checks/test/tui-pty.test.ts`, unchanged. It is the contract that lets the view move freely.
5. **Restore** (TV-03): a cockpit killed by each signal and by an induced throw leaves the terminal's own buffer, cursor and mouse state.
6. **Boundary check** (TV-01): `packages/screens` matches no terminal vocabulary; `packages/tui` computes no status word.

## tmux

`REQ-TUI-2` drops from P0 to P2 (Draft 2.26). Once the cockpit fills the terminal and updates itself, the workspace adds a shell and an editor that a person's own tmux configuration already provides, and its three real faults — `kill-session` taking the user's shell with it, untitled panes, no mouse — are worth fixing only if it stays. `packages/cli/src/commands/workspace.ts` keeps working meanwhile; nothing is removed in this specification.

## Risks

* **Ink's layout is flexbox, not a terminal window manager.** The region solver computes boxes itself and hands Ink fixed `width`/`height`, rather than asking Ink to grow anything. Where that proves insufficient, the fallback is to render regions to strings and compose them — the solver's output is the same either way.
* **Terminal capability detection lies.** Hence `--color=auto|24bit|256|none` and a `yam ui --caps` line for a bug report.
* **Large logs.** The `Log` and `Table` widgets are virtualized from the start; a run with 50 000 events must not make a frame quadratic.
* **View and model drifting apart.** The reachability test and `--json` equality are the two ropes that stop it, and both fail loudly.

## The runtime the app is built on

Electron, and this specification assumes it stays. The question is worth asking and the answer is not sentiment:

* **One view layer, not three.** The renderer shares `@svatah/yam-screens`, `@svatah/yam-ui` and the generated SDK with the cockpit. A native client per platform is two or three reimplementations of the layer this document exists to define once — the parity problem, multiplied.
* **The app is a conformance target.** `REQ-ADE-6` and `REQ-ADP-6/7` make the packaged app the thing the AX and UIA adapters are proved against, and the desktop suite drives Chromium's accessibility tree. That claim is about *this* runtime; changing it re-opens every platform result.
* **A system-webview runtime is not a free swap.** Tauri and its relatives trade Chromium for the platform's webview, which means a different accessibility tree per platform — directly against the conformance argument above.

What is actually felt — no motion, fixed chrome, a stale rail, missing primitives — is view-layer work, and none of it is cheaper in Swift.

Three things would reopen the decision, and each is measurable rather than a matter of taste: a startup or memory budget the product sets and Electron fails; an operating-system integration the product needs and Electron cannot reach; or an accessibility conformance result that requires a real native tree. Until one of those is true, the runtime is not the problem.
