/**
 * What `yam ui` holds while it is running (T9.4, REQ-TUI-1, LLD §13.7).
 *
 * The cockpit is a *renderer*: it owns which pane has focus, which row the
 * cursor is on, and whether the palette is open — and nothing else. Everything
 * a person reads on it is a `ScreenState` from `@svatah/yam-screens`, loaded by the
 * same `load()` the app calls.
 *
 * That separation is what `--json` is: printing this object's `state` prints
 * the model, and `tools/repo-checks/test/tui-pty.test.ts` compares it with what
 * the model produces on its own. A cockpit that had massaged a number for the
 * terminal would fail that comparison, which is the point of making it.
 */
import { screenById, type ScreenId, type ScreenParams, type ScreenStateBase } from "@svatah/yam-screens";
import type { ScreenService } from "@svatah/yam-screens";
import { layoutFor, type Layout } from "./layout.js";

/** The four numbered panes of the `TUI` artboard. */
export const PANES = ["tree", "main", "inspector", "audit"] as const;
export type Pane = (typeof PANES)[number];

export interface UiState {
  readonly screen: ScreenId;
  readonly params: ScreenParams;
  readonly state: ScreenStateBase;
  readonly focus: Pane;
  /** The row the cursor is on, per pane. `j`/`k` move it. */
  readonly cursor: Readonly<Record<Pane, number>>;
  readonly paletteOpen: boolean;
  readonly paletteQuery: string;
  /** What the last action said, shown on the footer until the next one. */
  readonly message?: string;
  /** The project and service, for the header. */
  readonly connection: { readonly url: string; readonly project: string };
  /**
   * The terminal's size and the widths that follow from it (T10.4, P9-F4).
   *
   * A renderer's concern and nothing the model knows about, which is why it is
   * here and not in `state` — and why `asJson` leaves it out: `--json` prints
   * the model's state, and a terminal's width is not part of it.
   */
  readonly layout: Layout;
}

/** Load a screen and build the state around it. */
export async function loadUi(
  service: ScreenService,
  screen: ScreenId,
  params: ScreenParams,
  connection: UiState["connection"],
  size: { columns: number; rows: number } = { columns: 100, rows: 30 },
): Promise<UiState> {
  const state = await screenById(screen).load(service, params);
  return {
    screen,
    params,
    state,
    focus: "main",
    cursor: { tree: 0, main: 0, inspector: 0, audit: 0 },
    paletteOpen: false,
    paletteQuery: "",
    connection,
    layout: layoutFor(size.columns, size.rows),
  };
}

/** The terminal was resized: the panes follow it (T10.4). */
export function resize(ui: UiState, columns: number, rows: number): UiState {
  return { ...ui, layout: layoutFor(columns, rows) };
}

/** `1`–`4` and `Tab`: which pane the keys go to (LLD §13.7). */
export function focusPane(ui: UiState, pane: Pane): UiState {
  return { ...ui, focus: pane };
}

export function nextPane(ui: UiState): UiState {
  const at = PANES.indexOf(ui.focus);
  return { ...ui, focus: PANES[(at + 1) % PANES.length]! };
}

/** `j`/`k` and the arrows, clamped to what the focused pane actually has. */
export function moveCursor(ui: UiState, by: number, rows: number): UiState {
  const at = ui.cursor[ui.focus];
  const next = Math.max(0, Math.min(rows - 1, at + by));
  return { ...ui, cursor: { ...ui.cursor, [ui.focus]: next } };
}

/**
 * What `--json` prints, and what the model produces on its own.
 *
 * The screen's state, plus where the cockpit is looking. Nothing computed: a
 * field here that the model does not have would be a field the app cannot show,
 * and REQ-ADE-13 is that every screen's state is available as JSON.
 */
export function asJson(ui: UiState): Record<string, unknown> {
  return {
    screen: ui.screen,
    params: ui.params,
    focus: ui.focus,
    state: ui.state,
  };
}
