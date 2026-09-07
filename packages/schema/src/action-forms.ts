/**
 * What each action needs, as data (T15, SF-09, SF-11, SF-16).
 *
 * The catalogue says an action is `{ action, ref?, ref2?, args? }` and validates
 * it; it did not say *which* arguments each action takes. A client that wants to
 * offer a person a form therefore had to know — and "if a screen knows something
 * about an operation that the catalogue does not, that is the defect".
 *
 * So the answer lives here, beside the operation catalogue, and the desktop's
 * action inspector renders whatever this table says. Adding an argument to an
 * action is one entry, and every client that draws a form gains the field.
 *
 * Two rules hold it together:
 *
 * 1. **Only offer what can be completed.** `offeredActions` filters by the
 *    surface's kind and the adapter's own capability flags, so an action a
 *    person is shown is one the adapter accepts and this table can collect
 *    every argument for. "Choose an action" can never be a dead end again.
 * 2. **Never guess an argument.** A field is either required — and the caller
 *    must fill it — or optional, and omitted when empty. Nothing is defaulted
 *    into a mutation.
 */
import { CAPABILITY_FLAGS, type CapabilityFlag, type SurfaceKind } from "./surface.js";

/** How a field is collected, and how it is typed on the way to `args`. */
export type ActionFieldType = "string" | "number" | "boolean" | "url" | "key";

export interface ActionField {
  /** The key in `args`. */
  readonly name: string;
  readonly type: ActionFieldType;
  readonly required: boolean;
  /** What a person reads beside the input. */
  readonly label: string;
  readonly placeholder?: string;
}

export interface ActionForm {
  /** The catalogue's action name. */
  readonly action: string;
  /** What a person calls it: "Fill field", not "type". */
  readonly label: string;
  /** Whether the action acts on the selected element. */
  readonly needsRef: boolean;
  /** Whether it needs a *second* element, as `dragTo` does. */
  readonly needsRef2: boolean;
  readonly fields: readonly ActionField[];
  /** The adapter capability this action requires, when it requires one. */
  readonly capability?: CapabilityFlag;
  /** The surface kinds that can perform it; every kind when omitted. */
  readonly kinds?: readonly SurfaceKind[];
}

const ELEMENT_KINDS: readonly SurfaceKind[] = ["web", "mobile", "desktop"];
const BROWSING_KINDS: readonly SurfaceKind[] = ["web"];

/**
 * The forms, in the order an inspector offers them: the common ones first.
 *
 * This is deliberately a subset of `SURFACE_ACTIONS`. An action is here when a
 * person can complete it from a form — which is the promise `offeredActions`
 * makes. `back`, `forward` and the scroll actions take no argument at all and
 * are here; `custom` and `invoke` are executor concerns and are not surface
 * actions; `read`, `expect` and `screenshot` have operations of their own.
 */
export const ACTION_FORMS: readonly ActionForm[] = [
  {
    action: "click",
    label: "Click",
    needsRef: true,
    needsRef2: false,
    fields: [],
    kinds: ELEMENT_KINDS,
  },
  {
    action: "type",
    label: "Fill field",
    needsRef: true,
    needsRef2: false,
    fields: [
      { name: "value", type: "string", required: true, label: "Value", placeholder: "what to type" },
    ],
    kinds: ELEMENT_KINDS,
  },
  {
    action: "navigate",
    label: "Go to URL",
    needsRef: false,
    needsRef2: false,
    fields: [
      { name: "url", type: "url", required: true, label: "URL", placeholder: "https://example.com/page" },
    ],
    kinds: BROWSING_KINDS,
  },
  {
    action: "dragTo",
    label: "Drag onto",
    needsRef: true,
    needsRef2: true,
    fields: [],
    capability: "drag",
    kinds: ELEMENT_KINDS,
  },
  {
    action: "setChecked",
    label: "Set checked",
    needsRef: true,
    needsRef2: false,
    fields: [{ name: "checked", type: "boolean", required: true, label: "Checked" }],
    kinds: ELEMENT_KINDS,
  },
  {
    action: "selectOption",
    label: "Choose option",
    needsRef: true,
    needsRef2: false,
    fields: [
      { name: "value", type: "string", required: true, label: "Option", placeholder: "the option's value or label" },
    ],
    kinds: ELEMENT_KINDS,
  },
  {
    action: "press",
    label: "Press a key",
    needsRef: false,
    needsRef2: false,
    fields: [{ name: "key", type: "key", required: true, label: "Key", placeholder: "Enter, Tab, Escape" }],
    kinds: ELEMENT_KINDS,
  },
  {
    action: "clear",
    label: "Clear field",
    needsRef: true,
    needsRef2: false,
    fields: [],
    kinds: ELEMENT_KINDS,
  },
  {
    action: "submit",
    label: "Submit",
    needsRef: true,
    needsRef2: false,
    fields: [],
    kinds: ELEMENT_KINDS,
  },
  {
    action: "hover",
    label: "Hover",
    needsRef: true,
    needsRef2: false,
    fields: [],
    kinds: ELEMENT_KINDS,
  },
  {
    action: "doubleClick",
    label: "Double-click",
    needsRef: true,
    needsRef2: false,
    fields: [],
    kinds: ELEMENT_KINDS,
  },
  {
    action: "rightClick",
    label: "Right-click",
    needsRef: true,
    needsRef2: false,
    fields: [],
    kinds: ELEMENT_KINDS,
  },
  {
    action: "scrollIntoView",
    label: "Scroll into view",
    needsRef: true,
    needsRef2: false,
    fields: [],
    kinds: ELEMENT_KINDS,
  },
  {
    action: "upload",
    label: "Upload a file",
    needsRef: true,
    needsRef2: false,
    fields: [
      { name: "files", type: "string", required: true, label: "File path", placeholder: "/path/to/file" },
    ],
    capability: "upload",
    kinds: ELEMENT_KINDS,
  },
  {
    action: "back",
    label: "Go back",
    needsRef: false,
    needsRef2: false,
    fields: [],
    kinds: BROWSING_KINDS,
  },
  {
    action: "forward",
    label: "Go forward",
    needsRef: false,
    needsRef2: false,
    fields: [],
    kinds: BROWSING_KINDS,
  },
  {
    action: "refresh",
    label: "Reload the page",
    needsRef: false,
    needsRef2: false,
    fields: [],
    kinds: BROWSING_KINDS,
  },
  {
    action: "resizeWindow",
    label: "Resize the window",
    needsRef: false,
    needsRef2: false,
    fields: [
      { name: "width", type: "number", required: true, label: "Width" },
      { name: "height", type: "number", required: true, label: "Height" },
    ],
    capability: "windows",
    kinds: ELEMENT_KINDS,
  },
  {
    action: "switchFrame",
    label: "Switch frame",
    needsRef: false,
    needsRef2: false,
    fields: [
      { name: "frame", type: "string", required: true, label: "Frame", placeholder: "name or index" },
    ],
    capability: "frames",
    kinds: BROWSING_KINDS,
  },
  {
    action: "dialog",
    label: "Answer the dialog",
    needsRef: false,
    needsRef2: false,
    fields: [
      { name: "accept", type: "boolean", required: true, label: "Accept" },
      { name: "text", type: "string", required: false, label: "Text", placeholder: "for a prompt" },
    ],
    capability: "dialogs",
    kinds: BROWSING_KINDS,
  },
];

/** One form by action name. */
export function actionFormFor(action: string): ActionForm | undefined {
  return ACTION_FORMS.find((one) => one.action === action);
}

/**
 * The actions this surface can actually perform, in offer order (SF-09).
 *
 * Filtered by kind and by the adapter's own capability flags, so every action
 * offered is one the adapter accepts and this table can collect the arguments
 * for. An HTTP surface is not an element surface and answers with none — its
 * form is the `request` operation, not `act`.
 */
export function offeredActions(
  kind: SurfaceKind,
  capabilities: Partial<Record<CapabilityFlag, boolean>> = {},
): readonly ActionForm[] {
  return ACTION_FORMS.filter((form) => {
    if (form.kinds !== undefined && !form.kinds.includes(kind)) return false;
    if (form.capability !== undefined && capabilities[form.capability] !== true) return false;
    return true;
  });
}

/**
 * The action an inspector opens on for an element of this role.
 *
 * A default, never a decision: the form still shows the action and a person can
 * change it before anything is dispatched. It exists so that selecting a text
 * field offers to fill it rather than making "Choose an action" the first
 * obstacle — the dead end T15 exists to remove.
 */
export function defaultActionForRole(role: string | undefined): string {
  switch ((role ?? "").toLowerCase()) {
    case "textbox":
    case "searchbox":
    case "combobox":
    case "spinbutton":
      return "type";
    case "checkbox":
    case "radio":
    case "switch":
      return "setChecked";
    case "option":
      return "selectOption";
    default:
      return "click";
  }
}

/** Every capability flag, so a client can render a readiness list. */
export const CAPABILITIES: readonly CapabilityFlag[] = CAPABILITY_FLAGS;
