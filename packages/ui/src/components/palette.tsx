/**
 * The command palette (T9.2, T9.4, REQ-ADE-11, LLD §13.7; the `Palette` artboard).
 *
 * > `⌘K` (`^K` in the terminal) over the action list, grouped Actions then Go
 * > to, each row showing the action's key and, for CLI-backed actions, the CLI
 * > command.
 *
 * The rows come from `@svatah/screens`'s registry — this component takes them as
 * props and knows nothing about what an action does. That is the boundary the
 * design system keeps: `@svatah/ui` may not import the screen model
 * (`eslint.config.js`), so the palette cannot grow an opinion about which
 * actions exist.
 *
 * On Radix's `Dialog`, which brings the focus trap, the `Escape`, the scroll
 * lock and `role="dialog"` with a name — four things that are individually
 * simple and collectively a week of bugs.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import { Kbd } from "./controls.js";

/** One row of the palette, as the ADE and `svatah ui` both build it. */
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
      <Dialog.Portal>
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

          <div className="sv-palette-rows" role="listbox" aria-label="Commands">
            {groups.length === 0 ? (
              <p className="sv-empty">No command matches “{query}”.</p>
            ) : (
              groups.map(([group, rows]) => (
                <div key={group}>
                  <p className="sv-palette-group">{group}</p>
                  {rows.map((row) => (
                    <button
                      key={row.id}
                      id={`palette-${row.id.replace(/\./g, "-")}`}
                      type="button"
                      role="option"
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
