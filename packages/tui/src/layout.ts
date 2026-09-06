/**
 * How the cockpit fits itself to the terminal it is in (T10.4, P9-F4,
 * Draft 2.12 §13.7).
 *
 * > The cockpit sizes its panes to the terminal and collapses the inspector
 * > below 120 columns rather than clipping it; a capture records the size it was
 * > taken at.
 *
 * Phase 9 gave the tree 34 columns and the inspector 40 and let the main pane
 * grow. Those numbers add up to 74 before the main pane has drawn a character,
 * so on any terminal narrower than about 130 columns the inspector was pushed
 * past the right edge and the capture in the progress record shows it cut in
 * half. A pane that is on screen but unreadable is worse than a pane that says
 * it is not there.
 *
 * So the widths are computed from the terminal's, and below 120 columns the
 * inspector is **collapsed**: three panes — tree, main, audit — all of them
 * whole. It is still reachable, by focusing pane `3`, where it is drawn full
 * width under the main pane instead of squeezed beside it; and
 * `svatah ui --json` carries the inspector's contents whatever the width,
 * because that is the model's and not the terminal's.
 *
 * No Ink here and no `process`: this is arithmetic, so
 * `packages/tui/test/layout.test.ts` can check every width without a terminal.
 */

/**
 * The width at which the inspector still has room to be read (Draft 2.12 §13.7).
 *
 * Below it the three columns would each be under forty characters, which is
 * narrower than a single candidate row (`testid  booking.book-now-button`).
 */
export const INSPECTOR_MIN_COLUMNS = 120;

/** The smallest terminal the cockpit will pretend to fit into. */
const MIN_COLUMNS = 60;
const MIN_ROWS = 16;

export interface Layout {
  /** The terminal, as the cockpit measured it. Drawn in the header. */
  readonly columns: number;
  readonly rows: number;
  /** Pane 1, the tree. */
  readonly tree: number;
  /** Pane 2, the main pane. */
  readonly main: number;
  /** Pane 3 beside the others; `undefined` when it is collapsed. */
  readonly inspector?: number;
  /**
   * True when the terminal is under `INSPECTOR_MIN_COLUMNS` and the inspector
   * is not drawn as a column. Focusing pane 3 opens it full width instead.
   */
  readonly inspectorCollapsed: boolean;
  /** How many rows a top pane may draw before the terminal runs out. */
  readonly listRows: number;
  /** How many audit lines pane 4 may draw. */
  readonly auditRows: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

/**
 * The panes' sizes for a terminal of this size.
 *
 * Widths first: the tree takes a quarter, between 20 and 34 columns; the
 * inspector takes a third, between 32 and 46; the main pane takes what is left,
 * and is never allowed under 24 — if it would be, the inspector collapses even
 * on a wide terminal, because the pane a person is reading matters more than the
 * pane describing it.
 */
export function layoutFor(columns: number, rows: number): Layout {
  const width = Math.max(MIN_COLUMNS, Math.floor(columns) || MIN_COLUMNS);
  const height = Math.max(MIN_ROWS, Math.floor(rows) || MIN_ROWS);

  const tree = clamp(Math.round(width * 0.25), 20, 34);
  const wanted = clamp(Math.round(width * 0.32), 32, 46);
  const collapsed = width < INSPECTOR_MIN_COLUMNS || width - tree - wanted < 24;
  const inspector = collapsed ? undefined : wanted;
  const main = width - tree - (inspector ?? 0);

  /*
   * Rows: one line of header, one of footer, one for the action's message, and
   * each pane's own border and title. The audit takes about a third of what is
   * left, between 4 and 10 lines, because it is a tail and the panes above it
   * are the subject.
   */
  const available = Math.max(8, height - 3);
  const auditHeight = clamp(Math.round(available * 0.3), 6, 12);
  const topHeight = Math.max(6, available - auditHeight);

  return {
    columns: width,
    rows: height,
    tree,
    main,
    ...(inspector === undefined ? {} : { inspector }),
    inspectorCollapsed: collapsed,
    // Two border lines and a title, and one row kept back for a pane's own
    // footer (the lint line, the exit-code line).
    listRows: Math.max(1, topHeight - 4),
    auditRows: Math.max(1, auditHeight - 4),
  };
}

/** `100×40`, as the header prints it and a capture therefore records. */
export const sizeOf = (layout: Layout): string => `${layout.columns}×${layout.rows}`;
