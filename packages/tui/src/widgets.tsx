/**
 * The widgets (TV-T05, TV-04, TV-06).
 *
 * One rule, and everything else follows from it: **a widget given a height draws
 * exactly that many lines.** The old cockpit's panes were as tall as their
 * contents, so an empty project drew ten rows and left thirty of black, and a
 * pane with more rows than the terminal pushed the pane below it off the bottom.
 * A widget here is handed a `Box` by `solve()` and fills it — padding when it
 * has too little, windowing when it has too much, and saying so either way.
 *
 * The rows themselves are `rows.ts`'s `PaneContent`, unchanged: what a screen
 * shows is still the view's business and the cells still go through `budget()`.
 */
import { Box as InkBox, Text } from "ink";
import { budget } from "./layout.js";
import type { Box } from "./regions.js";
import type { Cell, Line, PaneContent } from "./rows.js";
import type { RailEntry } from "./rail.js";
import { colourOf } from "./panes.js";
import { CHROME, ink, inkBg } from "./theme.js";

/** `"a string"` cut to `width`, padded to it, so a line is exactly as wide as it claims. */
export const fit = (text: string, width: number): string =>
  width <= 0
    ? ""
    : text.length <= width
      ? text.padEnd(width)
      : `${text.slice(0, Math.max(0, width - 1))}…`;

/** One line's cells, laid out inside `width`. Nothing may draw past it. */
function cells(line: readonly Cell[], width: number): React.JSX.Element[] {
  const sizes = budget(line, width);
  let drawn = false;
  return line.map((cell, at) => {
    const size = sizes[at] ?? 0;
    if (size === 0) return <Text key={at} />;
    const body = fit(cell.text, size);
    const separator = drawn;
    drawn = true;
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

/**
 * Which slice of a list to draw so the cursor is on screen.
 *
 * One implementation for every widget that scrolls, because a pane that scrolled
 * differently would be a pane where `j` did something else.
 */
export function window(cursor: number, total: number, height: number): number {
  if (total <= height) return 0;
  return Math.max(0, Math.min(cursor - Math.floor(height / 2), total - height));
}

/** Where the view is, in a list too long to draw: `▓` over `░`, one column wide. */
export function scrollbar(start: number, shown: number, total: number, height: number): string[] {
  if (total <= shown || height <= 0) return Array.from({ length: height }, () => " ");
  const thumb = Math.max(1, Math.round((shown / total) * height));
  const top = Math.min(height - thumb, Math.round((start / total) * height));
  return Array.from({ length: height }, (_, at) => (at >= top && at < top + thumb ? "▓" : "░"));
}

export interface FrameProps {
  readonly box: Box;
  /** What a zero state offers, already resolved to a key and a word. */
  readonly next?: ReadonlyArray<{ key: string; label: string }>;
  readonly number?: number;
  readonly title: string;
  readonly focused: boolean;
  readonly content: PaneContent;
  readonly cursor: number;
  /** Draw the cursor row highlighted; false while another region has focus. */
  readonly showCursor?: boolean;
}

/**
 * A bordered region that fills its box exactly.
 *
 * The border takes two columns and two rows, and `paddingX` two more columns; a
 * footer takes one row when there is one. Everything else is the list, padded
 * with blank lines to the bottom of the box — which is the whole of TV-04, and
 * the reason `height` is a number here rather than something Ink decides.
 */
export function Frame(props: FrameProps): React.JSX.Element {
  const { box, content } = props;
  const inner = Math.max(1, box.width - 4);
  const footerRows = content.footer === undefined ? 0 : 1;
  const rows = Math.max(1, box.height - 2 - footerRows);

  const total = content.lines.length;
  const start = window(props.cursor, total, rows);
  const shown = content.lines.slice(start, start + rows);
  const bar = scrollbar(start, rows, total, rows);
  const gutter = total > rows;
  const body = Math.max(1, inner - (gutter ? 1 : 0));

  const drawn: React.JSX.Element[] = [];
  if (total === 0) {
    /*
     * A zero state says what is not here *and what changes it* (TV-06). An empty
     * box that says "no bindings yet" and stops is the dead end SF-17 removes
     * from the app; the cockpit is held to the same rule.
     */
    drawn.push(
      <Text key="empty" {...ink(CHROME.dim)}>
        {fit(content.empty, inner)}
      </Text>,
    );
    for (const one of props.next ?? []) {
      drawn.push(
        <Text key={`next-${one.key}`}>
          <Text
            {...inkBg(CHROME.accent)}
            {...ink(CHROME.accentInk)}
          >{` ${one.key} `}</Text>
          <Text {...(CHROME.fg2 === undefined ? {} : { color: CHROME.fg2 })}>
            {fit(`  ${one.label}`, Math.max(0, inner - one.key.length - 2))}
          </Text>
        </Text>,
      );
    }
  } else {
    shown.forEach((line: Line, at) => {
      const current = props.showCursor !== false && props.focused && start + at === props.cursor;
      drawn.push(
        <Text key={line.key} {...(current ? { backgroundColor: "#231d3a", bold: true } : {})}>
          {current ? "▌" : gutter ? "" : ""}
          {cells(line.cells, body - (current ? 1 : 0))}
          {gutter ? <Text {...ink(CHROME.dim)}>{bar[at] ?? " "}</Text> : null}
        </Text>,
      );
    });
  }
  /* Pad to the bottom: this is the line that stops the black rectangle. */
  for (let at = drawn.length; at < rows; at += 1) {
    drawn.push(<Text key={`pad-${at}`}>{" ".repeat(inner)}</Text>);
  }

  return (
    <InkBox
      flexDirection="column"
      borderStyle={props.focused ? "bold" : "single"}
      {...(CHROME.accent === undefined
        ? {}
        : { borderColor: props.focused ? CHROME.accent : CHROME.line })}
      paddingX={1}
      width={box.width}
      height={box.height}
      flexGrow={0}
      flexShrink={0}
      overflow="hidden"
    >
      <Text {...ink(CHROME.dim)}>
        {props.number === undefined ? null : (
          <Text {...ink(CHROME.accent)}>{props.number} </Text>
        )}
        {fit(props.title, inner - (props.number === undefined ? 0 : 2)).trimEnd()}
      </Text>
      {drawn.slice(0, Math.max(0, rows - 1))}
      {content.footer === undefined ? null : (
        <Text
          {...(content.footer.tone === undefined
            ? { color: "gray" }
            : { color: colourOf(content.footer.tone) })}
        >
          {fit(content.footer.text, inner)}
        </Text>
      )}
    </InkBox>
  );
}

/**
 * One line: what this is, where, and what it is doing.
 *
 * The right-hand side is never what gets cut. It carries the size the frame was
 * drawn at, and T10.4 wants a capture to say that whatever else is on the line —
 * the old header put the size after the name for the same reason, and then let a
 * long project path push it off the end anyway. So the right is measured first
 * and the left takes what is left over.
 */
export function StatusBar(props: {
  readonly width: number;
  readonly left: readonly string[];
  readonly right: readonly string[];
}): React.JSX.Element {
  const right = props.right.join("  ");
  const name = props.left[0] ?? "";
  const rest = props.left.slice(1).join("  ");
  /* One space each side, two between the halves, and one after the name. */
  const room = Math.max(0, props.width - right.length - name.length - 4);
  const shown = rest.length <= room ? rest : `${rest.slice(0, Math.max(0, room - 1))}…`;
  const gap = Math.max(1, props.width - name.length - shown.length - right.length - 3);
  return (
    <Text
      {...inkBg(CHROME.barBg)}
      {...ink(CHROME.barFg)}
    >
      {" "}
      <Text {...ink(CHROME.accent)}>{name}</Text>
      {shown === "" ? "" : ` ${shown}`}
      {" ".repeat(gap)}
      {right}{" "}
    </Text>
  );
}

/**
 * A zero state that names its next action (TV-06).
 *
 * Never an empty box: every one of these says what is not here, why that is
 * fine, and which key changes it. `SF-17` requires this of the app; the cockpit
 * is held to it by `test/widgets.test.ts` and by the golden frames.
 */
export function Empty(props: {
  readonly box: Box;
  readonly headline: string;
  readonly sentences: readonly string[];
  readonly actions: ReadonlyArray<{ key: string; label: string; hint?: string }>;
}): React.JSX.Element {
  const inner = Math.max(1, props.box.width - 4);
  const lines: React.JSX.Element[] = [
    <Text key="h" bold>
      {fit(props.headline, inner)}
    </Text>,
    <Text key="h-gap"> </Text>,
    ...props.sentences.map((one, at) => (
      <Text key={`s${at}`} {...ink(CHROME.dim)}>
        {fit(one, inner)}
      </Text>
    )),
    <Text key="s-gap"> </Text>,
    ...props.actions.map((one) => (
      <Text key={one.key}>
        <Text
          {...inkBg(CHROME.accent)}
          {...ink(CHROME.accentInk)}
        >
          {` ${one.key} `}
        </Text>
        <Text {...(CHROME.fg2 === undefined ? {} : { color: CHROME.fg2 })}>{`  ${one.label}`}</Text>
        {one.hint === undefined ? null : (
          <Text {...ink(CHROME.dim)}>{`  ${one.hint}`}</Text>
        )}
      </Text>
    )),
  ];
  return (
    <InkBox flexDirection="column" width={props.box.width} height={props.box.height} paddingX={2}>
      {lines}
    </InkBox>
  );
}

/**
 * The rail, on one row (TV-14).
 *
 * The current screen is the accent and bold; the rest are dim. Bold as well as
 * coloured, because `chrome()` returns nothing at all in monochrome and "where
 * am I" may not depend on colour (`REQ-ADE-12`).
 */
export function RailStrip(props: {
  readonly width: number;
  readonly entries: readonly RailEntry[];
  readonly more: { left: boolean; right: boolean };
}): React.JSX.Element {
  return (
    <Text>
      {props.more.left ? (
        <Text {...ink(CHROME.dim)}>‹</Text>
      ) : (
        " "
      )}
      {props.entries.map((one) => (
        <Text key={one.screen}>
          <Text
            bold={one.current}
            {...(one.current
              ? CHROME.brand === undefined
                ? {}
                : { color: CHROME.brand }
              : CHROME.dim === undefined
                ? {}
                : { color: CHROME.dim })}
          >
            {one.key}
          </Text>
          <Text
            bold={one.current}
            {...(one.current
              ? CHROME.brand === undefined
                ? {}
                : { color: CHROME.brand }
              : CHROME.dim === undefined
                ? {}
                : { color: CHROME.dim })}
          >
            {one.shut ? ` (${one.label})  ` : ` ${one.label}  `}
          </Text>
        </Text>
      ))}
      {props.more.right ? <Text {...ink(CHROME.dim)}>›</Text> : ""}
    </Text>
  );
}
