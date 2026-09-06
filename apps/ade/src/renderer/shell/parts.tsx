/**
 * The pieces every rebuilt screen is made of (T10.1, T10.2, LLD §13.7).
 *
 * Ten screens arrived in one phase, and ten screens each inventing their own
 * toolbar would be ten toolbars that drift. These are the shapes the artboards
 * have in common — a toolbar, a filter chip, a list beside an editor, a code
 * block, an inspector's empty state — expressed once.
 *
 * Nothing here knows what a run, a binding or a tool is: the screens hand it
 * strings the model produced. That is the same rule `@svatah/ui` keeps one layer
 * down, applied to this application's own layout.
 */
import { Button, Chip, InspectorSection } from "@svatah/ui";
import type { Action, ScreenStateBase } from "@svatah/screens";

/** `run.stop` → `action-run-stop`: the id a desktop adapter binds to. */
export const actionId = (id: string): string => `action-${id.replace(/[^a-zA-Z0-9]+/g, "-")}`;

/** `flows/guards-and-compensation.flow` → `flow-guards-and-compensation-flow`. */
export const rowId = (prefix: string, value: string): string =>
  `${prefix}-${value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}`;

/** The gutter and status glyph per tone. The word is the title; colour is never alone. */
export const GLYPH: Record<string, string> = {
  pass: "✓",
  fail: "✗",
  skip: "–",
  healed: "~",
  abort: "!",
  info: "•",
  neutral: "·",
};

export interface ToolbarProps {
  readonly state: ScreenStateBase;
  /** The screen's own actions, already filtered and in the order it wants them. */
  readonly actions: readonly Action[];
  readonly onAction: (id: string) => void;
  /** The action drawn as the primary one, when the screen has a primary. */
  readonly primary?: string;
  /** The action drawn as dangerous, when it is live. */
  readonly danger?: string;
  /** Filter chips and the like, between the subtitle and the buttons. */
  readonly children?: React.ReactNode;
  /** A different title from the model's, when a screen has a subject. */
  readonly title?: React.ReactNode;
}

/**
 * The toolbar every screen has: title, subtitle, chips, buttons.
 *
 * One row, always. `ui.css` and `shell.css` make the buttons unshrinkable and
 * the title the thing that truncates (P9-F5); this is where that gets used.
 */
export function Toolbar(props: ToolbarProps): React.JSX.Element {
  return (
    <div className="sv-toolbar">
      <h1 className="sv-toolbar-title">{props.title ?? props.state.title}</h1>
      <span className="sv-toolbar-sub">{props.state.subtitle}</span>
      <span className="sv-spacer" />
      {props.children}
      {props.actions.map((one) => (
        <Button
          key={one.id}
          id={actionId(one.id)}
          label={one.label}
          variant={
            one.id === props.danger
              ? "danger"
              : one.id === props.primary
                ? "primary"
                : "default"
          }
          {...(one.key === undefined ? {} : { accelerator: one.key })}
          disabled={!one.availableWhen(props.state)}
          onPress={() => props.onAction(one.id)}
        />
      ))}
    </div>
  );
}

/**
 * A filter chip that is a real button (the `Results` artboard's `behavior: all`).
 *
 * A chip a person can click has to be a control with a name and an id, or the
 * desktop suite's snapshot case is right to fail it — so it is a `<button>`
 * whose accessible name says both what it filters and what it is set to.
 */
export function FilterChip({
  id,
  label,
  value,
  choices,
  onChoose,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly choices: readonly string[];
  readonly onChoose: (value: string) => void;
}): React.JSX.Element {
  const at = choices.indexOf(value);
  const next = choices[(at + 1) % Math.max(1, choices.length)] ?? value;
  return (
    <Button
      id={id}
      label={`${label}: ${value}`}
      variant="ghost"
      title={`Cycle the ${label} filter (next: ${next})`}
      onPress={() => onChoose(next)}
    />
  );
}

/** An inspector with nothing to describe yet. Every screen has this state. */
export function EmptyInspector({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <InspectorSection id={id} title={title}>
      <p className="sv-empty">{children}</p>
    </InspectorSection>
  );
}

/** A monospace block: a snapshot excerpt, a response body, a file. */
export function Code({
  label,
  lines,
  highlight,
}: {
  readonly label: string;
  readonly lines: readonly string[];
  /** The index of the line the model chose, when one is. */
  readonly highlight?: number;
}): React.JSX.Element {
  return (
    <pre className="sv-block" aria-label={label}>
      {lines.map((line, at) => (
        <span key={at} className={at === highlight ? "sv-block-hit" : undefined}>
          {line || " "}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

/** The chips the artboards put in a panel head: `3 lines`, `41 ms`. */
export function Counts({ items }: { readonly items: readonly string[] }): React.JSX.Element {
  return (
    <>
      {items.map((one) => (
        <Chip key={one}>{one}</Chip>
      ))}
    </>
  );
}
