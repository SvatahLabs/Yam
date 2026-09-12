/**
 * The four panes (T9.4, T10.1, T10.2, REQ-TUI-1, LLD §13.7; the `TUI` artboard).
 *
 * > four numbered panes (tree, main, inspector, audit), `1–4` focus a pane,
 * > `Tab` cycles, `j/k` move, the same actions and keys as the app, the same
 * > palette.
 *
 * What is left here after TV-T09 is the colour and the two readers of the pane
 * model that the cockpit's keys use. The four pane components and the box they
 * shared were the renderer the region tree replaced; `widgets.tsx` draws a
 * frame that fills its box, and `views.tsx` says which boxes there are. That is
 * what makes twelve screens twelve entries in one table rather than twelve arms
 * of four switches: this file is *how a terminal draws a row*, and `rows.ts` is
 * *which rows a screen has*.
 *
 * There is no fetching here, no formatting decision and no arithmetic the app
 * does differently — the numbers, the words and the status labels are the
 * model's. Colour comes from `@svatah/yam-ui-tokens`'s `STATUS` table, by the same
 * names the browser uses: a terminal has no CSS variables; it has the same seven
 * tones.
 */
import { STATUS, type StatusTone } from "@svatah/yam-ui-tokens";
import { capabilitiesOf } from "./terminal.js";
import { depthFor, inkColour, type ColourDepth } from "./theme.js";
import type { Pane, UiState } from "./model.js";
import { paneModel, type Line } from "./rows.js";

export { paneModel, GLYPH } from "./rows.js";
export type { Cell, Line, PaneContent, PaneModel } from "./rows.js";

/**
 * A tone's colour, at the depth this terminal admits to (TV-05, TV-T04).
 *
 * It was `STATUS[tone].ansi` — one of eight names — while the app drew the same
 * tone from a hexadecimal. Both read the one table now, and the cockpit sends
 * the token where the terminal can take it.
 */
export const colourOf = (tone: StatusTone, depth: ColourDepth = DEPTH): string =>
  inkColour(tone, depth) ?? STATUS[tone].ansi;

/**
 * The depth, measured once.
 *
 * A module-level constant rather than a prop threaded through every pane: the
 * terminal does not change its mind about 24-bit colour while the cockpit is
 * running, and a colour argument on every cell would be a colour argument
 * somebody forgets.
 */
const DEPTH: ColourDepth = depthFor(capabilitiesOf(), process.env["YAM_COLOR"]);
export const glyphOf = (tone: StatusTone): string => STATUS[tone].glyph;


/** `"a string"` cut to `width`, so a narrow terminal does not wrap a table. */
export const fit = (text: string, width: number): string =>
  // A column the budget squeezed to nothing draws nothing: an ellipsis on its
  // own is one character of overflow and no information (P10-F9).
  width <= 0
    ? ""
    : text.length <= width
      ? text.padEnd(width)
      : `${text.slice(0, Math.max(0, width - 1))}…`;



/**
 * Which slice of a list to draw so the cursor is on screen.
 *
 * In one place because all four panes scroll the same way, and a pane that
 * scrolled differently would be a pane where `j` did something else.
 */
export function window(cursor: number, total: number, height: number): number {
  if (total <= height) return 0;
  return Math.max(0, Math.min(cursor - Math.floor(height / 2), total - height));
}


/* ────────────────────────────────────────────────────────────────────────────
 * 1 · tree   2 · main   3 · inspector   4 · audit
 * ──────────────────────────────────────────────────────────────────────────── */





/** How many rows the focused pane has, so `j`/`k` can be clamped. */
export function rowsIn(ui: UiState, pane: Pane): number {
  return paneModel(ui.state)[pane].lines.length;
}

/** What `Enter` on the focused pane's current row re-loads with, if anything. */
export function selectionAt(ui: UiState, pane: Pane): Line["select"] {
  return paneModel(ui.state)[pane].lines[ui.cursor[pane]]?.select;
}

/** The rows the tree pane lists, kept for the tests that read them directly. */
export const treeRows = (state: UiState["state"], now?: number): readonly Line[] =>
  paneModel(state, now).tree.lines;

/** How many rows the main pane has. */
export const mainRows = (state: UiState["state"], now?: number): number =>
  paneModel(state, now).main.lines.length;
