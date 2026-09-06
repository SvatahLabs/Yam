/**
 * Buttons, fields, selects and keys (T9.2, REQ-ADE-12, LLD §13.7).
 *
 * The controls of the `Tokens` artboard: 28 px high, 4 px radius, 1 px lines,
 * a primary in the accent, a danger in the fail colour, a ghost with no chrome.
 * Every one of them takes a `label` and an `id` and refuses to render without
 * both (see `named.ts`).
 *
 * ## Radix, and where it is and is not
 *
 * `Select` is Radix's: a native `<select>` cannot be styled to the mockup and a
 * hand-rolled listbox is a keyboard-navigation bug waiting to happen. `Button`,
 * `Field` and `Kbd` are not: a `<button>` and an `<input>` already have the
 * roles, the names and the keyboard behaviour, and wrapping them would add a
 * layer for nothing. LLD §13.7 says "Radix primitives beneath every control" —
 * beneath the ones that need a primitive.
 */
import * as Select from "@radix-ui/react-select";
import type { ReactNode } from "react";
import { requireNamed, type Named } from "../named.js";

export interface ButtonProps extends Named {
  readonly variant?: "default" | "primary" | "danger" | "ghost";
  /** The accelerator drawn on the button: `⌘↵`, `R`. Shown, not bound. */
  readonly accelerator?: string;
  readonly disabled?: boolean;
  readonly onPress?: () => void;
  /** An icon before the label. Decorative: the label is the name. */
  readonly icon?: ReactNode;
  readonly title?: string;
  /**
   * `data-*` attributes the caller needs on the element itself.
   *
   * One caller and one reason: the ADE's toolbar marks its secondary buttons so
   * it can shed them into the palette when the bar runs out of room before the
   * title's twelve-character floor does (P10-F3). A `data-` attribute rather
   * than a class, because a class is a styling hook and something would style
   * it; and named `data`, not spread props, so this component still cannot be
   * handed arbitrary DOM attributes.
   */
  readonly data?: Readonly<Record<string, string>>;
}

/**
 * A button.
 *
 * `type="button"`, always: a button inside a form with no type submits it, and
 * every screen in this application has fields on it.
 */
export function Button(props: ButtonProps): React.JSX.Element {
  const label = requireNamed("Button", props);
  return (
    <button
      id={props.id}
      type="button"
      className={`sv-btn sv-btn-${props.variant ?? "default"}`}
      disabled={props.disabled === true}
      onClick={props.onPress}
      {...(props.title === undefined ? {} : { title: props.title })}
      {...Object.fromEntries(
        Object.entries(props.data ?? {}).map(([name, value]) => [`data-${name}`, value]),
      )}
    >
      {props.icon === undefined ? null : (
        <span className="sv-btn-icon" aria-hidden="true">
          {props.icon}
        </span>
      )}
      <span className="sv-btn-label">{label}</span>
      {props.accelerator === undefined ? null : (
        // `aria-hidden`, because a screen reader announcing "Run command enter"
        // reads the shortcut as part of the name. The keys sheet (`?`) is where
        // they are announced.
        <Kbd aria-hidden>{props.accelerator}</Kbd>
      )}
    </button>
  );
}

export interface FieldProps extends Named {
  readonly value?: string;
  readonly placeholder?: string;
  readonly type?: "text" | "search" | "password";
  readonly monospace?: boolean;
  readonly disabled?: boolean;
  readonly onChange?: (value: string) => void;
  readonly onSubmit?: () => void;
  /**
   * Draw the label to a screen reader only, not on the screen (K7).
   *
   * For a *row* of fields under one heading — the API screen's headers, where
   * the columns are labelled once and printing "Header 4" above the fourth row
   * would be noise. The name is still there and is still the visible column
   * heading's word, so the accessibility contract of LLD §13.7 holds: every
   * field has a name a flow sentence can address. A field with no label at all
   * would fail the desktop snapshot case, and rightly.
   */
  readonly hideLabel?: boolean;
}

/**
 * A labelled text field.
 *
 * The label is a real `<label for>`, so the accessible name is the visible text
 * and clicking the words focuses the field. A placeholder is not a label: it
 * disappears on the first keystroke, and a control whose name vanishes when you
 * use it is one a flow sentence cannot address.
 */
export function Field(props: FieldProps): React.JSX.Element {
  const label = requireNamed("Field", props);
  return (
    <div className="sv-field">
      <label
        className={
          props.hideLabel === true ? "sv-field-label sv-visually-hidden" : "sv-field-label"
        }
        htmlFor={props.id}
      >
        {label}
      </label>
      <input
        id={props.id}
        className={props.monospace === true ? "sv-input sv-mono" : "sv-input"}
        type={props.type ?? "text"}
        value={props.value ?? ""}
        disabled={props.disabled === true}
        {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
        onChange={(event) => props.onChange?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") props.onSubmit?.();
        }}
      />
    </div>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps extends Named {
  readonly value?: string;
  readonly options: readonly SelectOption[];
  readonly onChange?: (value: string) => void;
  readonly disabled?: boolean;
}

/**
 * A chooser, on Radix's `Select`.
 *
 * The Record screen's gateway control is one of these, and it is the control the
 * desktop healing case at variant 2 moves between panels — so its `id` is the
 * thing that has to survive, and the label beside it is the thing that
 * deliberately does not.
 */
export function Chooser(props: SelectProps): React.JSX.Element {
  const label = requireNamed("Chooser", props);
  const current = props.options.find((one) => one.value === props.value);
  return (
    <div className="sv-field">
      <label className="sv-field-label" htmlFor={props.id}>
        {label}
      </label>
      <Select.Root
        value={props.value ?? ""}
        onValueChange={(value) => props.onChange?.(value)}
        disabled={props.disabled === true}
      >
        {/*
          `aria-label` *as well as* the `<label for>`: Radix renders the trigger
          as a `<button role="combobox">`, and a `<label for>` names a form
          control by its `id`, which a button is. Both are the same string, so
          the accessible name is the visible label either way — and a desktop
          adapter that reads `AXDescription` before `AXTitle` (LLD §7.5) finds
          it.
        */}
        <Select.Trigger id={props.id} className="sv-select" aria-label={label}>
          <Select.Value placeholder="Choose…">{current?.label ?? ""}</Select.Value>
          <Select.Icon className="sv-select-arrow" aria-hidden="true">
            ▾
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="sv-select-menu" position="popper">
            <Select.Viewport>
              {props.options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled === true}
                  className="sv-select-item"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

/** A key, drawn the way the mockups draw one. Decorative by default. */
export function Kbd({
  children,
  "aria-hidden": ariaHidden,
}: {
  readonly children: ReactNode;
  readonly "aria-hidden"?: boolean;
}): React.JSX.Element {
  return (
    <kbd className="sv-kbd" {...(ariaHidden === true ? { "aria-hidden": true } : {})}>
      {children}
    </kbd>
  );
}
