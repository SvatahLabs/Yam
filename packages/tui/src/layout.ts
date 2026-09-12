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
 * `yam ui --json` carries the inspector's contents whatever the width,
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

/* ────────────────────────────────────────────────────────────────────────────
 * The width budget, applied to every cell (P10-F9, Draft 2.12 §13.7).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * What `budget` needs to know about a cell. `rows.ts`'s `Cell` satisfies it.
 *
 * Deliberately not `Cell` itself: this file is arithmetic with no Ink and no
 * screen model in it, which is what lets `test/layout.test.ts` check every
 * width on a machine with no terminal.
 */
export interface Sized {
  readonly text: string;
  /** A fixed width in characters; `grow` when it should take the rest. */
  readonly width?: number;
  readonly grow?: boolean;
}

/** The narrowest a cell is squeezed to before it is dropped from the line. */
const MIN_CELL = 3;

/**
 * How wide each cell of one line may be drawn, inside `width` characters.
 *
 * P10-F9: the Phase 10 cockpit drew a 104-character line on a 100-column
 * terminal. The cause was that a cell with neither a `width` nor `grow` was
 * given `text.length` — *whatever the text happened to be* — so a row's width
 * was a property of its content rather than of the terminal, and a long enough
 * project path or step name pushed the pane's own border past the right edge.
 * That is why the same test passed in one checkout and failed in another.
 *
 * The contract this function keeps, and `test/layout.test.ts` asserts for
 * thousands of generated lines: **`sum(sizes) + gaps <= width`**, always, for
 * any cells and any width, where `gaps` is the single space the renderer puts
 * between cells. A caller that lays a line out with these numbers cannot
 * overflow.
 *
 * The arithmetic, in three steps:
 *
 * 1. Fixed cells ask for `width ?? text.length`; growers ask for nothing yet.
 * 2. Whatever is left over is shared equally between the growers.
 * 3. If the total still exceeds the budget — which is the whole of the defect —
 *    the widest cells are capped until it fits (a water-fill, so the columns
 *    that are already short are not the ones that pay), and a cell squeezed
 *    below `MIN_CELL` is dropped to zero rather than drawn as an ellipsis on
 *    its own.
 */
export function budget(cells: readonly Sized[], width: number): number[] {
  if (cells.length === 0) return [];
  const gaps = cells.length - 1;
  const available = Math.max(0, Math.floor(width) - gaps);
  if (available <= 0) return cells.map(() => 0);

  const sizes = cells.map((one) =>
    one.grow === true ? 0 : Math.max(0, Math.floor(one.width ?? one.text.length)),
  );

  const growers = cells.reduce((n, one) => n + (one.grow === true ? 1 : 0), 0);
  if (growers > 0) {
    const spare = Math.max(0, available - sizes.reduce((sum, one) => sum + one, 0));
    const each = Math.floor(spare / growers);
    let extra = spare - each * growers;
    for (let at = 0; at < cells.length; at += 1) {
      if (cells[at]!.grow !== true) continue;
      sizes[at] = each + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
    }
  }

  const total = sizes.reduce((sum, one) => sum + one, 0);
  if (total <= available) return sizes;

  /*
   * Cap the widest cells until the line fits.
   *
   * Binary search for the cap rather than a decrement loop: a pane can be given
   * a cell whose text is a whole file path, and shrinking it a character at a
   * time is arithmetic nobody needs to do ten thousand times per frame.
   */
  const capFor = (room: number): number => {
    let low = 0;
    let high = Math.max(...sizes);
    const under = (cap: number): number =>
      sizes.reduce((sum, one) => sum + Math.min(one, cap), 0);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (under(middle) <= room) low = middle;
      else high = middle - 1;
    }
    return low;
  };

  const capped = sizes.map((one) => Math.min(one, capFor(available)));

  /*
   * A column the cap cut to one or two characters is an ellipsis and nothing
   * else, so it is dropped and its space goes to the column beside it. Only a
   * column the cap actually *bit*: a two-character `ok` that asked for two is
   * whole, and dropping it would lose the one word the row is about.
   */
  for (let at = capped.length - 1; at >= 0; at -= 1) {
    const now = capped[at] ?? 0;
    if (now < (sizes[at] ?? 0) && now < MIN_CELL) capped[at] = 0;
  }

  /*
   * What the drops and the integer cap left unspent goes to the cells the cap
   * bit, left to right — the first columns of a row are the ones a reader needs
   * whole. A dropped column stays dropped: giving it back three characters
   * would only produce the ellipsis it was dropped for.
   */
  let left = available - capped.reduce((sum, one) => sum + one, 0);
  while (left > 0) {
    let spent = false;
    for (let at = 0; at < capped.length && left > 0; at += 1) {
      const now = capped[at] ?? 0;
      if (now === 0 || now >= (sizes[at] ?? 0)) continue;
      capped[at] = now + 1;
      left -= 1;
      spent = true;
    }
    if (!spent) break;
  }

  const drawn = capped.reduce((sum, one) => sum + one, 0);
  if (drawn > available) throw new Error(`budget produced ${drawn} for ${available}`);
  return capped;
}

/**
 * How many characters a line of these cells will draw, gaps included.
 *
 * The renderer's own arithmetic, exported so a test can state the invariant in
 * the renderer's terms rather than in the budget's. A column of zero width
 * draws nothing *and no separator*: on a terminal narrow enough that the gaps
 * alone would not fit, a line of spaces standing in for columns that were
 * dropped is exactly the overflow this is about.
 */
export const drawnWidth = (sizes: readonly number[]): number => {
  const drawn = sizes.filter((one) => one > 0);
  return drawn.reduce((sum, one) => sum + one, 0) + Math.max(0, drawn.length - 1);
};

/** One entry of the cockpit's footer: the key, and what it does. */
export interface FooterKey {
  readonly key: string;
  readonly label: string;
}

/**
 * The six keys that reach everything, in the order the `TUI` artboard prints
 * them. Always drawn: a cockpit whose `q` scrolled off is a cockpit a person
 * cannot leave.
 */
const CORE_KEYS: readonly FooterKey[] = [
  { key: "^K", label: "commands" },
  { key: "1-4", label: "pane" },
  { key: "Tab", label: "next" },
  { key: "j k", label: "move" },
  { key: "Enter", label: "open" },
  { key: "[ ]", label: "screen" },
];

const QUIT_KEY: FooterKey = { key: "q", label: "quit" };

/** `^K commands` is four characters plus the two that separate it from the next. */
const widthOf = (one: FooterKey): number => one.key.length + 1 + one.label.length;

/**
 * The footer's keys for a terminal this wide (P10-F9).
 *
 * The core six and `q` always; then as many of the screen's own single-letter
 * keys as still fit, in the cockpit's own table's order (TV-M03: the registry
 * has no accelerators; `keys.ts` is where a keystroke is decided). A screen with eight
 * actions on a hundred-column terminal used to wrap its footer onto a second
 * line and push a pane off the top of the terminal, which is the same defect as
 * the 104-character row one line lower down.
 */
export function footerFor(
  columns: number,
  bound: ReadonlyArray<{ key: string; label: string }>,
): FooterKey[] {
  const gap = 2;
  const fixed = [...CORE_KEYS, QUIT_KEY].reduce(
    (sum, one) => sum + widthOf(one) + gap,
    -gap,
  );
  let left = Math.max(0, Math.floor(columns) - fixed);

  const extra: FooterKey[] = [];
  for (const action of bound) {
    if (action.key.length !== 1) continue;
    const one: FooterKey = {
      key: action.key.toLowerCase(),
      label: action.label.toLowerCase(),
    };
    const cost = widthOf(one) + gap;
    if (cost > left) continue;
    left -= cost;
    extra.push(one);
  }
  return [...CORE_KEYS, ...extra, QUIT_KEY];
}
