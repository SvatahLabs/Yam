/**
 * The command palette (T9.2, T9.4, REQ-ADE-11, LLD §13.7; the `Palette` artboard).
 *
 * > `⌘K` (`^K` in the terminal) over the action list, grouped Actions then Go
 * > to, each row showing the action's key and, for CLI-backed actions, the CLI
 * > command.
 *
 * The rows come from `@svatah/yam-screens`'s registry — this component takes them as
 * props and knows nothing about what an action does. That is the boundary the
 * design system keeps: `@svatah/yam-ui` may not import the screen model
 * (`eslint.config.js`), so the palette cannot grow an opinion about which
 * actions exist.
 *
 * On Radix's `Dialog`, which brings the focus trap, the `Escape`, the scroll
 * lock and `role="dialog"` with a name — four things that are individually
 * simple and collectively a week of bugs.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";
import { Kbd } from "./controls.js";
import { portalHost } from "./portal.js";

/** One row of the palette, as the app and `yam ui` both build it. */
export interface PaletteRow {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  /** The area shown in the mockup's left column: `run`, `heal`, `bindings`. */
  readonly area: string;
  readonly key?: string;
  readonly cli?: string;
  /** Greyed and unselectable when the action cannot run against this state. */
  readonly available: boolean;
  /** A second line under the label: "aborted 4 min ago". */
  readonly detail?: string;
}

export interface PaletteProps {
  readonly open: boolean;
  readonly rows: readonly PaletteRow[];
  readonly onClose: () => void;
  readonly onChoose: (id: string) => void;
  /** The id the desktop adapters address the dialog by. */
  readonly id?: string;
}

/** Case-insensitive substring over the label, the area and the CLI command. */
function matches(row: PaletteRow, query: string): boolean {
  if (query.trim() === "") return true;
  const needle = query.toLowerCase();
  return [row.label, row.area, row.cli ?? "", row.detail ?? ""].some((one) =>
    one.toLowerCase().includes(needle),
  );
}

export function CommandPalette(props: PaletteProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const id = props.id ?? "command-palette";

  /*
   * The host exists from the first render, not from the first open — which is
   * the whole point: a tree whose shape changes when a dialog is first opened
   * is a tree every recorded `controlPath` disagrees with afterwards
   * (`portal.ts`).
   */
  const [host, setHost] = useState<HTMLElement | undefined>(() => portalHost());
  useEffect(() => {
    setHost((one) => one ?? portalHost());
  }, []);

  const groups = useMemo(() => {
    const shown = props.rows.filter((row) => matches(row, query));
    const order = ["Actions", "Go to"];
    const byGroup = new Map<string, PaletteRow[]>();
    for (const row of shown) {
      const list = byGroup.get(row.group) ?? [];
      list.push(row);
      byGroup.set(row.group, list);
    }
    return [...byGroup.entries()].sort(
      (a, b) => (order.indexOf(a[0]) + 100) - (order.indexOf(b[0]) + 100),
    );
  }, [props.rows, query]);

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          setQuery("");
          props.onClose();
        }
      }}
    >
      <Dialog.Portal {...(host === undefined ? {} : { container: host })}>
        <Dialog.Overlay className="sv-palette-overlay" />
        <Dialog.Content className="sv-palette" id={id} aria-describedby={undefined}>
          {/*
            A dialog needs a name, and the mockup draws no heading inside the
            box — the field is the first thing. So the title is there and hidden
            visually, which is a different thing from being absent: the desktop
            snapshot case reads it, and a screen reader announces "Command
            palette dialog" on open.
          */}
          <Dialog.Title className="sv-visually-hidden">Command palette</Dialog.Title>
          <div className="sv-palette-field">
            <span className="sv-palette-icon" aria-hidden="true">
              ⌕
            </span>
            <label className="sv-visually-hidden" htmlFor={`${id}-query`}>
              Search or run a command
            </label>
            <input
              id={`${id}-query`}
              className="sv-palette-input"
              value={query}
              placeholder="Search or run a command"
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
            <Kbd aria-hidden>Esc</Kbd>
          </div>

          <div
            className="sv-palette-rows"
            id={`${id}-rows`}
            role="listbox"
            aria-label="Commands"
          >
            {groups.length === 0 ? (
              <p className="sv-empty">No command matches “{query}”.</p>
            ) : (
              groups.map(([group, rows]) => (
                /*
                 * A `group`, said rather than implied (T12.3).
                 *
                 * A `listbox`'s children must be `option`s or `group`s of them.
                 * These rows sat in a bare `<div>`, which breaks the ownership
                 * — and Chromium then declines to publish them as options at
                 * all: the macOS accessibility tree read forty rows as
                 * `AXStaticText` with no name, so a screen reader announces
                 * nothing and a flow cannot address one by name. The heading is
                 * the group's own label, so it is not read twice.
                 */
                <div key={group} role="group" aria-labelledby={`${id}-group-${group.replace(/\s+/g, "-").toLowerCase()}`}>
                  <p
                    className="sv-palette-group"
                    id={`${id}-group-${group.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    {group}
                  </p>
                  {rows.map((row) => (
                    <button
                      key={row.id}
                      id={`palette-${row.id.replace(/\./g, "-")}`}
                      type="button"
                      role="option"
                      /*
                       * The row's name, said rather than computed (T12.3).
                       *
                       * A row's contents are an area chip, a label, a CLI
                       * command and a `Kbd` marked `aria-hidden`, and macOS
                       * published the whole thing as an `option` with **no
                       * accessible name at all**: the desktop snapshot read
                       * forty rows that a screen reader announces as nothing
                       * and a flow cannot address by name. `aria-label` is the
                       * label a person reads on the row, which is also what
                       * makes "Go to Run" and "Go to Runs" two different names
                       * rather than one being a substring of the other.
                       */
                      aria-label={row.label}
                      aria-selected={false}
                      className="sv-palette-row"
                      disabled={!row.available}
                      onClick={() => {
                        setQuery("");
                        props.onChoose(row.id);
                      }}
                    >
                      <span className="sv-palette-area sv-mono">{row.area}</span>
                      <span className="sv-palette-label">
                        {row.label}
                        {row.detail === undefined ? null : (
                          <span className="sv-palette-detail"> {row.detail}</span>
                        )}
                      </span>
                      {row.cli === undefined ? null : (
                        <span className="sv-palette-cli sv-mono">{row.cli}</span>
                      )}
                      {row.key === undefined ? null : <Kbd aria-hidden>{row.key}</Kbd>}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
