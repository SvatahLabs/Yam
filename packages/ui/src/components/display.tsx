/**
 * The things that show rather than do (T9.2, REQ-ADE-12, LLD §13.7).
 *
 * Pills, chips, tables, alerts, inspector sections, rail items and tabs — the
 * `Tokens` artboard's second half, and the parts of the ADE's chrome that are
 * the same on every screen.
 *
 * ## The rule these exist to keep
 *
 * > five status colours […] that never appear without a word or glyph beside
 * > them
 *
 * `Pill` takes a `label` and refuses an empty one. There is no way to render a
 * coloured dot with nothing beside it through this package, which is the point:
 * the rule is in the component rather than in a review comment.
 */
import * as Tabs from "@radix-ui/react-tabs";
import { STATUS, type StatusTone } from "@svatah/ui-tokens";
import type { ReactNode } from "react";
import { requireNamed, type Named } from "../named.js";

export interface PillProps {
  readonly tone: StatusTone;
  /** The word. Never optional, and never the empty string. */
  readonly label: string;
  /** Draw the tone's glyph before the word, for the editor gutter and the TUI. */
  readonly glyph?: boolean;
}

/**
 * A status pill: a word, in a colour, with the colour's glyph if asked.
 *
 * The `label` is checked the same way a control's is, because the rule it keeps
 * is the same one: a status that is only a colour is unreadable to a third of
 * the people who will look at it and to every accessibility adapter.
 */
export function Pill(props: PillProps): React.JSX.Element {
  if (props.label.trim() === "") {
    throw new Error(
      "<Pill> has no label. A status colour never appears without a word or a glyph beside it " +
        "(LLD §13.7); a bare coloured dot is unreadable to a screen reader and to anyone who " +
        "does not see the difference between the pass green and the healed cyan.",
    );
  }
  const style = STATUS[props.tone];
  return (
    <span className={`sv-pill sv-tone-${props.tone}`}>
      {props.glyph === true ? (
        <span className="sv-pill-glyph" aria-hidden="true">
          {style.glyph}
        </span>
      ) : null}
      {props.label}
    </span>
  );
}

/** A neutral chip: a fact, not a status. "page: all", "step 5 only". */
export function Chip({
  children,
  tone,
}: {
  readonly children: ReactNode;
  readonly tone?: StatusTone;
}): React.JSX.Element {
  return <span className={tone === undefined ? "sv-chip" : `sv-chip sv-tone-${tone}`}>{children}</span>;
}

export interface AlertProps {
  readonly tone: "fail" | "abort";
  /** What happened, written for a screen: never a stack, never a flag. */
  readonly children: ReactNode;
  /** So the desktop suite can find it and a test can name it. */
  readonly id: string;
}

/**
 * The alert the mockups draw for a failed load or a missing runtime.
 *
 * `role="alert"`, so a screen reader says it when it appears — the ADE's
 * "could not find a Node 22" message is one of these, and a person who cannot
 * see the screen has the same three places to look.
 */
export function Alert(props: AlertProps): React.JSX.Element {
  return (
    <div id={props.id} role="alert" className={`sv-alert sv-tone-${props.tone}`}>
      <span className="sv-alert-glyph" aria-hidden="true">
        {props.tone === "fail" ? "✗" : "!"}
      </span>
      <span>{props.children}</span>
    </div>
  );
}

export interface Column<Row> {
  readonly key: string;
  readonly header: string;
  readonly align?: "left" | "right";
  readonly monospace?: boolean;
  readonly cell: (row: Row) => ReactNode;
}

export interface TableProps<Row> extends Named {
  readonly columns: ReadonlyArray<Column<Row>>;
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly selected?: string;
  readonly onSelect?: (key: string) => void;
  /** What the table says when it has no rows, and what writes one. */
  readonly empty?: ReactNode;
}

/**
 * A table with a caption that is its accessible name.
 *
 * `<caption>` rather than `aria-label`: it is visible, it is the name, and it is
 * the one place a table can carry both. The mockups hide it visually on screens
 * whose heading already says what the table is, which is a stylesheet's job.
 */
export function Table<Row>(props: TableProps<Row>): React.JSX.Element {
  const label = requireNamed("Table", props);
  return (
    <table id={props.id} className="sv-table">
      <caption className="sv-table-caption">{label}</caption>
      <thead>
        <tr>
          {props.columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={column.align === "right" ? "sv-num" : undefined}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.length === 0 ? (
          <tr>
            <td colSpan={props.columns.length} className="sv-empty">
              {props.empty ?? "Nothing here yet."}
            </td>
          </tr>
        ) : (
          props.rows.map((row) => {
            const key = props.rowKey(row);
            return (
              <tr
                key={key}
                className={key === props.selected ? "sv-row sv-row-selected" : "sv-row"}
                {...(props.onSelect === undefined
                  ? {}
                  : {
                      onClick: () => props.onSelect!(key),
                      "aria-selected": key === props.selected,
                    })}
              >
                {props.columns.map((column) => (
                  <td
                    key={column.key}
                    className={[
                      column.monospace === true ? "sv-mono" : "",
                      column.align === "right" ? "sv-num" : "",
                    ]
                      .filter((one) => one !== "")
                      .join(" ")}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

export interface RailItemProps extends Named {
  readonly active?: boolean;
  /** The count on the right of the row: "7", "41". */
  readonly count?: number | string;
  readonly onPress?: () => void;
  readonly icon?: ReactNode;
}

/**
 * One row of the left rail.
 *
 * A real `<button>` with `aria-current`, not a link: nothing navigates, and a
 * link that goes nowhere is a promise a screen reader repeats.
 */
export function RailItem(props: RailItemProps): React.JSX.Element {
  const label = requireNamed("RailItem", props);
  return (
    <button
      id={props.id}
      type="button"
      className={props.active === true ? "sv-rail-item sv-rail-active" : "sv-rail-item"}
      {...(props.active === true ? { "aria-current": "page" as const } : {})}
      onClick={props.onPress}
    >
      {props.icon === undefined ? null : (
        <span className="sv-rail-icon" aria-hidden="true">
          {props.icon}
        </span>
      )}
      <span className="sv-rail-label">{label}</span>
      {props.count === undefined ? null : <span className="sv-rail-count">{props.count}</span>}
    </button>
  );
}

export interface TabsProps extends Named {
  readonly tabs: ReadonlyArray<{ id: string; label: string; content: ReactNode }>;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/** A tab strip, on Radix's `Tabs`: roving focus, arrow keys, the right roles. */
export function TabStrip(props: TabsProps): React.JSX.Element {
  const label = requireNamed("TabStrip", props);
  return (
    <Tabs.Root value={props.value} onValueChange={props.onChange} className="sv-tabs">
      <Tabs.List aria-label={label} id={props.id} className="sv-tab-list">
        {props.tabs.map((tab) => (
          <Tabs.Trigger key={tab.id} id={tab.id} value={tab.id} className="sv-tab">
            {tab.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {props.tabs.map((tab) => (
        <Tabs.Content key={tab.id} value={tab.id} className="sv-tab-panel">
          {tab.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

/**
 * One section of the right inspector: a heading and its rows.
 *
 * The heading is a real `<h3>` inside a `<section aria-labelledby>`, so the
 * inspector is a list of landmarks a screen reader can jump between — which is
 * also what gives the desktop adapters short, stable `controlPath` candidates
 * (LLD §13.6: "screen containers carry landmark roles").
 */
export function InspectorSection({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    /*
     * The `id` goes on the *section*, and the heading gets `-heading`.
     *
     * A caller passing `id="inspector-step"` means "this section is
     * `inspector-step`" — that is what a desktop adapter binds to and what a
     * test addresses. Putting the id only on the heading made
     * `#inspector-step` a selector that matched nothing, which is the same
     * defect as an unnamed control from the other end.
     */
    <section id={id} className="sv-inspector-section" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className="sv-inspector-heading">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The inspector's key–value grid: `Compiles at`, `Target`, `Binding`. */
export function KeyValues({
  rows,
}: {
  readonly rows: ReadonlyArray<{ key: string; value: ReactNode }>;
}): React.JSX.Element {
  return (
    <dl className="sv-kv">
      {rows.map((row) => (
        <div key={row.key} className="sv-kv-row">
          <dt className="sv-kv-key">{row.key}</dt>
          <dd className="sv-kv-value">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
