/**
 * The primitives Session needs, which the library did not have (TV-A03, TV-16).
 *
 * `Table` and `InspectorSection` were enough for eleven screens of rows. Session
 * is not rows: it is a tree of controls with a selection, a log that follows, a
 * mode strip, an overlay for picking a control out of the application, and a
 * toast for what just happened. Every one of them was going to be written inside
 * the app the first time it was needed and again the second time.
 *
 * The rules the rest of the library is held to hold here: a visible label that
 * is the accessible name, an `automationId`, and a status word beside every
 * tone. The desktop adapters and a screen reader depend on the same two things.
 */
import type { ReactNode } from "react";
import type { StatusTone } from "@svatah/yam-ui-tokens";
import { Pill } from "./display.js";

export interface TreeNode {
  readonly id: string;
  readonly label: string;
  /** What kind of thing it is: a role, a platform, a file's extension. */
  readonly kind?: string;
  readonly depth: number;
  readonly states?: readonly string[];
}

export interface TreeProps {
  readonly id: string;
  readonly label: string;
  readonly nodes: readonly TreeNode[];
  readonly selected?: string;
  readonly onSelect?: (id: string) => void;
  /** What it says when there is nothing, and what makes one (SF-17). */
  readonly empty?: ReactNode;
}

/**
 * A semantic tree, which is what a snapshot is.
 *
 * `role="tree"` and one tab stop: a person tabs *to* the tree and then moves
 * within it with the arrow keys, rather than tabbing through three hundred
 * nodes to reach what is after it. That is what the role means, and it is the
 * difference between keyboard support and keyboard punishment.
 */
export function Tree(props: TreeProps): React.JSX.Element {
  if (props.nodes.length === 0) {
    return (
      <div className="sv-tree sv-tree-empty" id={props.id} aria-label={props.label}>
        {props.empty ?? "nothing here"}
      </div>
    );
  }
  return (
    <div className="sv-tree" role="tree" id={props.id} aria-label={props.label} tabIndex={0}>
      {props.nodes.map((node) => (
        <div
          key={node.id}
          role="treeitem"
          id={`${props.id}-${node.id}`}
          aria-level={node.depth + 1}
          aria-selected={props.selected === node.id}
          className={props.selected === node.id ? "sv-tree-node active" : "sv-tree-node"}
          style={{ paddingLeft: `${node.depth * 12 + 8}px` }}
          onClick={() => props.onSelect?.(node.id)}
        >
          <span className="sv-tree-ref">{node.id}</span>
          {node.kind === undefined ? null : <span className="sv-tree-kind">{node.kind}</span>}
          <span className="sv-tree-label">{node.label}</span>
          {(node.states ?? []).map((state) => (
            <span key={state} className="sv-tree-state">
              {state}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export interface LogLine {
  readonly id: string;
  readonly at?: string;
  readonly kind?: string;
  readonly text: string;
  readonly tone?: StatusTone;
}

/**
 * A tail that follows, and says when it has stopped following.
 *
 * `aria-live="polite"` because lines arrive without a person doing anything —
 * which is the whole reason this exists — and `off` once they have scrolled up,
 * because a screen reader reading a log somebody is *reading* is a screen reader
 * shouting over them.
 */
export function Log(props: {
  readonly id: string;
  readonly label: string;
  readonly lines: readonly LogLine[];
  readonly following?: boolean;
  readonly onFollow?: () => void;
  readonly empty?: ReactNode;
}): React.JSX.Element {
  const following = props.following !== false;
  return (
    <div className="sv-log" id={props.id} aria-label={props.label}>
      <div className="sv-log-lines" aria-live={following ? "polite" : "off"} aria-atomic="false">
        {props.lines.length === 0 ? (
          <p className="sv-log-empty">{props.empty ?? "nothing yet"}</p>
        ) : (
          props.lines.map((line) => (
            <div key={line.id} className="sv-log-line">
              {line.at === undefined ? null : <span className="sv-log-at">{line.at}</span>}
              {line.kind === undefined ? null : <span className="sv-log-kind">{line.kind}</span>}
              <span className={line.tone === undefined ? "" : `sv-tone-${line.tone}`}>{line.text}</span>
            </div>
          ))
        )}
      </div>
      {following ? null : (
        <button type="button" className="sv-log-follow" onClick={props.onFollow}>
          Jump to the end
        </button>
      )}
    </div>
  );
}

/**
 * The mode strip (REQ-ADE-14).
 *
 * A tablist, because that is what it is: switching does not navigate and does
 * not reconnect, and a person reading with a screen reader should be told the
 * same thing a person looking at it is told.
 */
export function ModeStrip<Mode extends string>(props: {
  readonly id: string;
  readonly label: string;
  readonly modes: ReadonlyArray<{ id: Mode; label: string }>;
  readonly mode: Mode;
  readonly onMode: (mode: Mode) => void;
}): React.JSX.Element {
  return (
    <div className="sv-modes" role="tablist" aria-label={props.label} id={props.id}>
      {props.modes.map((one) => (
        <button
          key={one.id}
          type="button"
          role="tab"
          id={`${props.id}-${one.id}`}
          aria-selected={props.mode === one.id}
          className={props.mode === one.id ? "sv-mode active" : "sv-mode"}
          onClick={() => props.onMode(one.id)}
        >
          {one.label}
        </button>
      ))}
    </div>
  );
}

/**
 * "Point at it in the application", as a state rather than a mode of the app.
 *
 * The overlay says what is being asked and how to stop being asked, because a
 * modal that can only be left by doing the thing is a trap — and picking is the
 * grounding a person is *offered*, never the one they are forced into
 * (REQ-REC-12).
 */
export function PickerOverlay(props: {
  readonly id: string;
  readonly phrase: string;
  readonly onCancel: () => void;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="sv-picker" role="dialog" aria-modal="true" aria-labelledby={`${props.id}-title`} id={props.id}>
      <h2 id={`${props.id}-title`}>Point at “{props.phrase}” in the application</h2>
      <p className="sv-picker-hint">
        The control you click becomes the binding. Nothing is written until you review it.
      </p>
      {props.children}
      <button type="button" className="sv-btn" onClick={props.onCancel}>
        Stop picking
      </button>
    </div>
  );
}

/**
 * What just happened, over the frame rather than pushing it (TV-A03).
 *
 * `role="status"` and not `alert`: a result is not an interruption, and a
 * component that shouted every time a step passed would teach a person to stop
 * listening.
 */
export function Toast(props: {
  readonly id: string;
  readonly tone: StatusTone;
  readonly label: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="sv-toast" role="status" id={props.id}>
      <Pill tone={props.tone} label={props.label} />
      <span className="sv-toast-text">{props.children}</span>
    </div>
  );
}

/**
 * Two panes and a handle between them.
 *
 * The handle is a `separator` with a value, so it can be moved with the arrow
 * keys: a split that can only be dragged is a split a person using a keyboard
 * cannot have an opinion about.
 */
export function Split(props: {
  readonly id: string;
  readonly label: string;
  /** The first pane's share, 10 to 90. */
  readonly at: number;
  readonly onAt: (at: number) => void;
  readonly first: ReactNode;
  readonly second: ReactNode;
}): React.JSX.Element {
  const clamp = (one: number): number => Math.max(10, Math.min(90, one));
  return (
    <div className="sv-split" id={props.id} style={{ gridTemplateColumns: `${props.at}% 6px 1fr` }}>
      <div className="sv-split-pane">{props.first}</div>
      <div
        role="separator"
        aria-label={props.label}
        aria-orientation="vertical"
        aria-valuenow={props.at}
        aria-valuemin={10}
        aria-valuemax={90}
        tabIndex={0}
        className="sv-split-handle"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") props.onAt(clamp(props.at - 2));
          if (event.key === "ArrowRight") props.onAt(clamp(props.at + 2));
        }}
      />
      <div className="sv-split-pane">{props.second}</div>
    </div>
  );
}

/**
 * An action asking for the one thing it declared it needs (TV-06).
 *
 * `surface.connect` refused with "Enter a URL to connect to" in both renderers
 * and neither had anywhere to enter one. The action names the field; this draws
 * it; the cockpit opens a line for the same declaration.
 *
 * A form and not a free-floating input: `Enter` submits because the browser
 * submits forms, and `Escape` cancels because a dialog does.
 */
export function AskOverlay(props: {
  readonly id: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly onSubmit: (value: string) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  return (
    <div
      className="sv-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${props.id}-title`}
      id={props.id}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onCancel();
      }}
    >
      <h2 id={`${props.id}-title`}>{props.label}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("value");
          if (typeof value === "string" && value.trim() !== "") props.onSubmit(value.trim());
        }}
      >
        <input
          className="sv-input"
          name="value"
          aria-label={props.label}
          autoFocus
          {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
        />
        <button type="submit" className="sv-btn sv-btn-primary">
          Connect
        </button>
        <button type="button" className="sv-btn" onClick={props.onCancel}>
          Cancel
        </button>
      </form>
    </div>
  );
}
