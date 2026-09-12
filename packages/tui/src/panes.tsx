/**
 * The four panes (T9.4, T10.1, T10.2, REQ-TUI-1, LLD §13.7; the `TUI` artboard).
 *
 * > four numbered panes (tree, main, inspector, audit), `1–4` focus a pane,
 * > `Tab` cycles, `j/k` move, the same actions and keys as the app, the same
 * > palette.
 *
 * Each pane draws one `PaneContent` from `rows.ts` — a title, a list of lines,
 * and a footer — and knows nothing about which screen it is showing. That is
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
import { Box, Text } from "ink";
import { STATUS, type StatusTone } from "@svatah/yam-ui-tokens";
import { capabilitiesOf } from "./terminal.js";
import { depthFor, inkColour, type ColourDepth } from "./theme.js";
import { budget } from "./layout.js";
import type { Pane, UiState } from "./model.js";
import { paneModel, type Cell, type Line, type PaneContent } from "./rows.js";

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

/** A bordered pane with its number in the title, as the artboard draws it. */
export function Panel({
  number,
  title,
  focused,
  children,
  width,
}: {
  readonly number: number;
  readonly title: string;
  readonly focused: boolean;
  readonly children: React.ReactNode;
  /**
   * The pane's whole width, border and padding included (P10-F9).
   *
   * Stated rather than grown into. A box that sized itself to its content was
   * the outer half of the 104-character line: the rows inside were over budget,
   * the border went round them, and the pane came out wider than the terminal
   * however narrow the column it was given.
   */
  readonly width: number;
}): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? "magenta" : "gray"}
      paddingX={1}
      width={width}
      flexGrow={0}
      flexShrink={0}
      overflow="hidden"
    >
      <Text color="gray">
        <Text color="magenta">{number}</Text> {title}
      </Text>
      {children}
    </Box>
  );
}

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
 * One line's cells, laid out inside `width` characters.
 *
 * Fixed-width cells take what they asked for; the `grow` cells share what is
 * left. Cut rather than wrapped: a wrapped table row is a row that has stopped
 * being a table, and the pane it is in would push the pane beside it off the
 * screen (P9-F4).
 */
function draw(cells: readonly Cell[], width: number): React.JSX.Element[] {
  /*
   * Every cell, not only the growers (P10-F9).
   *
   * The Phase 10 arithmetic gave a cell with neither a `width` nor `grow`
   * whatever `text.length` happened to be and then handed each grower a floor
   * of four columns on top, so a long step name or a long project path drew a
   * line wider than the pane — 104 characters on a 100-column terminal. The
   * budget is `layout.ts`'s now, it covers every cell, and
   * `test/layout.test.ts` holds it to `sum(sizes) + gaps <= width`.
   */
  const sizes = budget(cells, width);

  /*
   * A dropped column draws nothing *and no separator*. On a pane narrow enough
   * that the separators alone would not fit, a row of spaces standing in for
   * columns that are not there is exactly the overflow this is about; it is
   * also the arithmetic `drawnWidth` states.
   */
  let drawnAlready = false;
  return cells.map((cell, at) => {
    const size = sizes[at] ?? 0;
    if (size === 0) return <Text key={at} />;
    const body = fit(cell.text, size);
    const separator = drawnAlready;
    drawnAlready = true;
    return (
      <Text
        key={at}
        {...(cell.tone !== undefined
          ? { color: colourOf(cell.tone) }
          : cell.dim === true
            ? { color: "gray" }
            : {})}
      >
        {separator ? ` ${body}` : body}
      </Text>
    );
  });
}

/** One row, highlighted when the cursor is on it and the pane has focus. */
function Row({
  line,
  width,
  current,
}: {
  readonly line: Line;
  readonly width: number;
  readonly current: boolean;
}): React.JSX.Element {
  return <Text inverse={current}>{draw(line.cells, width)}</Text>;
}

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

/** One pane: its title, the slice of its lines the terminal has room for. */
function PaneBox({
  number,
  content,
  width,
  height,
  cursor,
  focused,
}: {
  readonly number: number;
  readonly content: PaneContent;
  readonly width: number;
  readonly height: number;
  readonly cursor: number;
  readonly focused: boolean;
}): React.JSX.Element {
  /*
   * The border takes two columns and `paddingX={1}` two more, so the rows have
   * four fewer than the pane (P10-F9). `Math.max(1, …)` and not `Math.max(8, …)`:
   * a floor of eight on a pane of ten was four characters of overflow written
   * into the arithmetic itself.
   */
  const inner = Math.max(1, width - 4);
  const rows = content.footer === undefined ? height : Math.max(1, height - 1);
  const start = window(cursor, content.lines.length, rows);
  return (
    <Panel number={number} title={fit(content.title, inner).trimEnd()} focused={focused} width={width}>
      {content.lines.length === 0 ? (
        <Text color="gray">{fit(content.empty, inner)}</Text>
      ) : (
        content.lines
          .slice(start, start + rows)
          .map((line, at) => (
            <Row
              key={line.key}
              line={line}
              width={inner}
              current={focused && start + at === cursor}
            />
          ))
      )}
      {content.footer === undefined ? null : (
        <Text
          {...(content.footer.tone === undefined
            ? { color: "gray" }
            : { color: colourOf(content.footer.tone) })}
        >
          {fit(content.footer.text, inner)}
        </Text>
      )}
    </Panel>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1 · tree   2 · main   3 · inspector   4 · audit
 * ──────────────────────────────────────────────────────────────────────────── */

export function TreePane({ ui }: { readonly ui: UiState }): React.JSX.Element {
  return (
    <PaneBox
      number={1}
      content={paneModel(ui.state).tree}
      width={ui.layout.tree}
      height={ui.layout.listRows}
      cursor={ui.cursor.tree}
      focused={ui.focus === "tree"}
    />
  );
}

export function MainPane({ ui }: { readonly ui: UiState }): React.JSX.Element {
  return (
    <PaneBox
      number={2}
      content={paneModel(ui.state).main}
      width={ui.layout.main}
      height={ui.layout.listRows}
      cursor={ui.cursor.main}
      focused={ui.focus === "main"}
    />
  );
}

export function InspectorPane({ ui }: { readonly ui: UiState }): React.JSX.Element {
  /*
   * Beside the others when there is room, full width under them when there is
   * not (T10.4, P9-F4). Either way it is drawn whole: the defect this replaces
   * was a forty-column pane on a hundred-column terminal, half of it past the
   * right edge.
   */
  return (
    <PaneBox
      number={3}
      content={paneModel(ui.state).inspector}
      width={ui.layout.inspector ?? ui.layout.columns}
      height={ui.layout.inspector === undefined ? ui.layout.auditRows : ui.layout.listRows}
      cursor={ui.cursor.inspector}
      focused={ui.focus === "inspector"}
    />
  );
}

export function AuditPane({ ui }: { readonly ui: UiState }): React.JSX.Element {
  return (
    <PaneBox
      number={4}
      content={paneModel(ui.state).audit}
      width={ui.layout.columns}
      height={ui.layout.auditRows}
      cursor={ui.cursor.audit}
      focused={ui.focus === "audit"}
    />
  );
}

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
