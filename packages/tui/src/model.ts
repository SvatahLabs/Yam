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
import {
  applyEvent,
  applyHealEvent,
  applyRecordEvent,
  screenById,
  type HealState,
  type RunState,
  type ScreenId,
  type ScreenParams,
  type ScreenStateBase,
  type ServiceEventLike,
  type SessionState,
} from "@svatah/yam-screens";
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
  /**
   * What is being typed, when something is (TV-07's modes).
   *
   * A cockpit whose keys are single letters cannot also accept a sentence
   * without saying which it is doing. `typing` is that mode: while it holds a
   * string, letters are letters and `esc` gives them back.
   */
  readonly typing?: {
    /**
     * `say` is the sentence line; an action id is that action asking for what it
     * declared it `needs`.
     *
     * The line was say-mode's alone, which is why `surface.connect` refused with
     * "Enter a URL to connect to" and gave nobody anywhere to enter one.
     */
    readonly where: "say" | { readonly action: string; readonly field: string };
    readonly label: string;
    readonly text: string;
  };
  /** Which row the palette's selection is on. It moves (TV-08). */
  readonly paletteAt: number;
  /** Action ids, most recently run first: what the palette offers on no query. */
  readonly recents: readonly string[];
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
    paletteAt: 0,
    recents: [],
    connection,
    layout: layoutFor(size.columns, size.rows),
  };
}

/** The terminal was resized: the panes follow it (T10.4). */
export function resize(ui: UiState, columns: number, rows: number): UiState {
  return { ...ui, layout: layoutFor(columns, rows) };
}

/**
 * Fold one event into the screen showing it (TV-09).
 *
 * The model's own reducers — `applyEvent` for a run, `applyRecordEvent` for a
 * capture, `applyHealEvent` for a proposal — because a cockpit that folded an
 * event its own way would be a cockpit showing a state the app cannot reach.
 * An event for a screen that is not open is not an error: it is an event for a
 * screen that is not open.
 */
export function applyToScreen(ui: UiState, event: ServiceEventLike): UiState {
  if (ui.screen === "run") return { ...ui, state: applyEvent(ui.state as RunState, event) };
  if (ui.screen === "heal") return { ...ui, state: applyHealEvent(ui.state as HealState, event) };
  if (ui.screen === "session") {
    const session = ui.state as SessionState;
    const folded: SessionState = { ...session, record: applyRecordEvent(session.record, event) };
    return { ...ui, state: folded as ScreenStateBase };
  }
  return ui;
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
