/**
 * `@svatah/yam-ui` — the design system (T9.2, REQ-ADE-12, LLD §13.7).
 *
 * > `@svatah/yam-ui` (React components on Radix primitives: button, field, select,
 * > pill, chip, table, tabs, rail item, inspector sections, alert, palette,
 * > kbd), every component requiring a visible label and an id.
 *
 * Two rules hold the whole package together, and both are in the code rather
 * than in a review:
 *
 * 1. **Every interactive control has a visible label that is its accessible
 *    name, and an id in the `automationId` form.** `requireNamed` throws in
 *    development when either is missing (`named.ts`), and
 *    `test/named.test.ts` renders every component without one to show it.
 * 2. **A status colour never appears without a word.** `Pill` refuses an empty
 *    label; there is no way through this package to draw a bare coloured dot.
 *
 * The package knows nothing about Yam. It has no idea what a plan, a run or a
 * binding is — `eslint.config.js` forbids it importing anything but
 * `@svatah/yam-ui-tokens` — so a screen's meaning lives in `@svatah/yam-screens` and its
 * appearance lives here, and neither can quietly acquire the other's job.
 */
export { requireNamed, UnnamedControlError, AUTOMATION_ID_FORM, type Named } from "./named.js";

export { Button, Field, Chooser, Kbd } from "./components/controls.js";
export type { ButtonProps, FieldProps, SelectProps, SelectOption } from "./components/controls.js";

export {
  Alert,
  Chip,
  InspectorSection,
  KeyValues,
  Pill,
  RailItem,
  TabStrip,
  Table,
} from "./components/display.js";
export type {
  AlertProps,
  Column,
  PillProps,
  RailItemProps,
  TableProps,
  TabsProps,
} from "./components/display.js";

export { CommandPalette } from "./components/palette.js";
export { PORTAL_HOST_ID, portalHost } from "./components/portal.js";
export type { PaletteProps, PaletteRow } from "./components/palette.js";

export { ComponentSheet } from "./sheet.js";

/**
 * Every component that takes a `label` and an `id`, by name.
 *
 * `test/named.test.ts` walks this list rather than a hand-written one, so a
 * component added without the rule is a failing test rather than an omission
 * nobody noticed — which is exactly how the app's Project screen ended up with
 * three unnamed buttons (P8-F3).
 */
export const NAMED_COMPONENTS = [
  "Button",
  "Field",
  "Chooser",
  "Table",
  "RailItem",
  "TabStrip",
] as const;
