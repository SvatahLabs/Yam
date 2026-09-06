/**
 * The four panes (T9.4, T10.1, T10.2, REQ-TUI-1, LLD §13.7; the `TUI` artboard).
 *
 * > four numbered panes (tree, main, inspector, audit), `1–4` focus a pane,
 * > `Tab` cycles, `j/k` move, the same actions and keys as the ADE, the same
 * > palette.
 *
 * Each pane draws one `PaneContent` from `rows.ts` — a title, a list of lines,
 * and a footer — and knows nothing about which screen it is showing. That is
 * what makes twelve screens twelve entries in one table rather than twelve arms
 * of four switches: this file is *how a terminal draws a row*, and `rows.ts` is
 * *which rows a screen has*.
 *
 * There is no fetching here, no formatting decision and no arithmetic the ADE
 * does differently — the numbers, the words and the status labels are the
 * model's. Colour comes from `@svatah/ui-tokens`'s `STATUS` table, by the same
 * names the browser uses: a terminal has no CSS variables; it has the same seven
 * tones.
 */
import { Box, Text } from "ink";
import { STATUS, type StatusTone } from "@svatah/ui-tokens";
import type { Pane, UiState } from "./model.js";
import { paneModel, type Cell, type Line, type PaneContent } from "./rows.js";

export { paneModel, GLYPH } from "./rows.js";
export type { Cell, Line, PaneContent, PaneModel } from "./rows.js";

/** A tone's ANSI colour, from the one table both renderers read. */
export const colourOf = (tone: StatusTone): string => STATUS[tone].ansi;
export const glyphOf = (tone: StatusTone): string => STATUS[tone].glyph;

/** A bordered pane with its number in the title, as the artboard draws it. */
export function Panel({
  number,
  title,
  focused,
  children,
  grow,
}: {
  readonly number: number;
  readonly title: string;
  readonly focused: boolean;
  readonly children: React.ReactNode;
  readonly grow?: boolean;
}): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? "magenta" : "gray"}
      paddingX={1}
      flexGrow={grow === true ? 1 : 0}
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
  text.length <= width ? text.padEnd(width) : `${text.slice(0, Math.max(0, width - 1))}…`;

/**
 * One line's cells, laid out inside `width` characters.
 *
 * Fixed-width cells take what they asked for; the `grow` cells share what is
 * left. Cut rather than wrapped: a wrapped table row is a row that has stopped
 * being a table, and the pane it is in would push the pane beside it off the
 * screen (P9-F4).
 */
function draw(cells: readonly Cell[], width: number): React.JSX.Element[] {
  const gaps = Math.max(0, cells.length - 1);
  const fixed = cells.reduce((sum, one) => sum + (one.grow === true ? 0 : (one.width ?? one.text.length)), 0);
  const growers = cells.filter((one) => one.grow === true).length;
  const spare = Math.max(0, width - fixed - gaps);
  const each = growers === 0 ? 0 : Math.max(4, Math.floor(spare / growers));

  return cells.map((cell, at) => {
    const size = cell.grow === true ? each : (cell.width ?? cell.text.length);
    const body = fit(cell.text, size);
    return (
      <Text
        key={at}
        {...(cell.tone !== undefined
          ? { color: colourOf(cell.tone) }
          : cell.dim === true
            ? { color: "gray" }
            : {})}
      >
        {at === 0 ? body : ` ${body}`}
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
  grow,
}: {
  readonly number: number;
  readonly content: PaneContent;
  readonly width: number;
  readonly height: number;
  readonly cursor: number;
  readonly focused: boolean;
  readonly grow?: boolean;
}): React.JSX.Element {
  const inner = Math.max(8, width - 4);
  const rows = content.footer === undefined ? height : Math.max(1, height - 1);
  const start = window(cursor, content.lines.length, rows);
  return (
    <Panel number={number} title={fit(content.title, inner).trimEnd()} focused={focused} grow={grow}>
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
      grow
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
