/**
 * The pieces every rebuilt screen is made of (T10.1, T10.2, LLD §13.7).
 *
 * Ten screens arrived in one phase, and ten screens each inventing their own
 * toolbar would be ten toolbars that drift. These are the shapes the artboards
 * have in common — a toolbar, a filter chip, a list beside an editor, a code
 * block, an inspector's empty state — expressed once.
 *
 * Nothing here knows what a run, a binding or a tool is: the screens hand it
 * strings the model produced. That is the same rule `@svatah/yam-ui` keeps one layer
 * down, applied to this application's own layout.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { Button, Chip, InspectorSection } from "@svatah/yam-ui";
import type { Action, ScreenStateBase } from "@svatah/yam-screens";
import { acceleratorFor } from "./keys.js";

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
  /**
   * Run an action, with what this screen knows that the parameters do not (K6,
   * K7, T11.1).
   *
   * `flows.save` needs the text in the editor and `api.save` needs the request
   * in the form, and neither is a *screen parameter*: a parameter is what a
   * screen re-loads with, and a draft is what has not been saved yet. So a
   * screen may hand its action the argument only it has, and everything else
   * still comes from the parameters (LLD §13.7's one action registry).
   */
  readonly onAction: (id: string, args?: Readonly<Record<string, unknown>>) => void;
  /** The action drawn as the primary one, when the screen has a primary. */
  readonly primary?: string;
  /** The action drawn as dangerous, when it is live. */
  readonly danger?: string;
  /** Filter chips and the like, between the subtitle and the buttons. */
  readonly children?: React.ReactNode;
  /** A different title from the model's, when a screen has a subject. */
  readonly title?: React.ReactNode;
  /** A pill or a chip that belongs beside the title rather than at the end. */
  readonly beside?: React.ReactNode;
  /**
   * A label for an action, when the screen says it better than the registry.
   *
   * The Run screen's `heal.run` is "Heal run 01k4h9m2ptw3", which is the
   * registry's "Heal from this run" made specific. Returning `undefined` keeps
   * the registry's own label, which is what every other action wants.
   */
  readonly labelFor?: (action: Action) => string | undefined;
}

/**
 * The toolbar every screen has: title, subtitle, chips, buttons.
 *
 * One row, always. `ui.css` and `shell.css` make the buttons unshrinkable and
 * the title the thing that truncates (P9-F5); this is where that gets used.
 *
 * ## The title's floor, and what gives way instead (P10-F3, Draft 2.13)
 *
 * > a toolbar title keeps at least twelve characters and the toolbar sheds
 * > secondary controls into the palette before that
 *
 * Phase 10's toolbar truncated the title to two letters on the Record screen:
 * "Re…" is not a title, it is a bar that has run out of room and taken it from
 * the one element that says where you are. The floor is `min-width: 12ch` in
 * `shell.css`, so the title *cannot* shrink past it — and what a bar that no
 * longer fits does instead is drop its **secondary** buttons, right to left,
 * until it does.
 *
 * Nothing becomes unreachable: every action in the toolbar is in the command
 * palette by construction (`actionsForScreen` is the palette's list too), and
 * the bar says how many it has put there. The primary and the dangerous action
 * are never shed: those are the two a person came to this screen to press.
 *
 * The measurement is a `ResizeObserver` on the bar and one pass of hiding from
 * the end, because a shed button is still in the DOM — hidden, so it is out of
 * the accessibility tree and out of the tab order, and still measurable when the
 * window is widened again. The palette hint holds its space whether or not
 * anything is shed, so showing it can never be what makes the bar overflow.
 */
export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const bar = useRef<HTMLDivElement>(null);
  const [shed, setShed] = useState(0);

  useLayoutEffect(() => {
    const element = bar.current;
    if (element === null || typeof ResizeObserver === "undefined") return undefined;

    const recompute = (): void => {
      const buttons = [...element.querySelectorAll<HTMLElement>("[data-toolbar-action]")];
      for (const one of buttons) one.hidden = false;

      /*
       * Secondary first, right to left; then, if the bar still does not fit,
       * the primary and the dangerous one — because the title's twelve
       * characters are the floor and a button is never worth breaking it. On a
       * bar narrow enough for that to happen, every one of them is a `⌘K` away
       * and the bar says how many.
       */
      const order = [
        ...buttons.filter((one) => one.dataset["toolbarSecondary"] === "true").reverse(),
        ...buttons.filter((one) => one.dataset["toolbarSecondary"] !== "true").reverse(),
      ];
      let dropped = 0;
      for (const one of order) {
        if (element.scrollWidth <= element.clientWidth) break;
        one.hidden = true;
        dropped += 1;
      }
      setShed(dropped);
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.actions, props.state, props.children]);

  return (
    <div className="sv-toolbar" ref={bar}>
      {/*
        `id="toolbar-title"`, so a desktop flow can read where it is (T11.2).
        
        The self suite's first flow says "the toolbar title should contain
        Flows", and a heading with no id is a heading a desktop adapter can only
        find by its text — which is the one thing that changes when a screen is
        renamed. Not an interactive control, so the snapshot case's id rule does
        not reach it; it is here because something has to read it.
      */}
      <h1 className="sv-toolbar-title" id="toolbar-title" tabIndex={-1}>
        {props.title ?? props.state.title}
      </h1>
      {props.beside}
      <span className="sv-toolbar-sub">{props.state.subtitle}</span>
      <span className="sv-spacer" />
      {props.children}
      {props.actions.map((one) => (
        <Button
          key={one.id}
          id={actionId(one.id)}
          label={props.labelFor?.(one) ?? one.label}
          variant={
            one.id === props.danger
              ? "danger"
              : one.id === props.primary
                ? "primary"
                : "default"
          }
          {...(acceleratorFor(one.id) === undefined ? {} : { accelerator: acceleratorFor(one.id)! })}
          disabled={!one.availableWhen(props.state)}
          onPress={() => props.onAction(one.id)}
          data={{
            "toolbar-action": one.id,
            ...(one.id === props.primary || one.id === props.danger
              ? {}
              : { "toolbar-secondary": "true" }),
          }}
        />
      ))}
      {/*
        Reserved whether or not anything is shed: a hint that appeared only once
        the bar was full would widen the bar at the moment it was already too
        narrow, which is a loop rather than a layout.
      */}
      <span
        className="sv-toolbar-shed"
        id="toolbar-in-palette"
        {...(shed === 0 ? { "aria-hidden": true } : {})}
        style={shed === 0 ? { visibility: "hidden" } : undefined}
      >
        ⌘K +{shed}
      </span>
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
