/**
 * A UI Automation tree → the normalised snapshot of LLD §2.2 (T6.1, LLD §7.5).
 *
 * Pure: `UiaNode[]` in, `SnapshotNode[]` out. No PowerShell, no process, no
 * Windows — which is why every rule here is testable on the machine this was
 * written on, and why a recorded tree is a complete test input.
 *
 * The sibling of `@svatah/yam-adapter-ax`'s `tree.ts`, deliberately: the two files
 * do the same job from two vocabularies, and REQ-SURF-4's claim — "roles, names,
 * states, and a reference scheme with the same shape whether the source is ARIA,
 * UIA, AX, AT-SPI, or Appium page source" — is only true if they arrive at the
 * same answers. `packages/adapter-uia/test/parity.test.ts` checks that against
 * the same window recorded in both shapes.
 */
import { FALLBACK_ROLE, isInteractiveRole, UIA_ROLE_MAP } from "@svatah/yam-surface";
import type { NodeState, SnapshotNode } from "@svatah/yam-schema";
import type { UiaNode } from "./bridge.js";

/** A snapshot node, plus what only the walk knows. */
export interface UiaSnapshotNode extends SnapshotNode {
  /** The child index at each level from the window down; the bridge's address. */
  readonly path: readonly number[];
  /** The node this was built from, for `describe()`. */
  readonly source: UiaNode;
  /** `Window[Yam]/Group[2]/Button[Run]` (LLD §3.3). */
  readonly controlPath: string;
}

/**
 * `ControlType` → an ARIA role, with `LocalizedControlType` consulted first.
 *
 * UIA has no subrole. What it has instead is a *localised* control type — a
 * string the provider sets to say what the control really is when the control
 * type is too coarse. Chromium uses it heavily: an ARIA `heading` is
 * `ControlType.Text` with `LocalizedControlType` "heading", and a `tab` inside
 * a `Tab` is a `TabItem`. Reading it first is what stops every heading in the
 * APP_DIR being reported as text.
 *
 * Only values that are ARIA roles are honoured. `LocalizedControlType` is
 * localised — on a German Windows a button says "Schaltfläche" — so a table
 * lookup that accepted anything would put a German string in `role` and break
 * every binding recorded on an English machine.
 */
export function roleOf(
  node: Pick<UiaNode, "controlType" | "localizedControlType">,
  context: { readonly insideRow?: boolean; readonly insideChooser?: boolean } = {},
): string {
  const localized = (node.localizedControlType ?? "").trim().toLowerCase();
  if (localized !== "" && ARIA_ROLES.has(localized)) return localized;
  /*
   * A `DataItem` inside a `DataItem` is a cell (REQ-SURF-4).
   *
   * UI Automation has one control type for a table's row and its cells:
   * Chromium publishes both `<tr>` and `<td>` as `ControlType.DataItem`, and
   * `UIA_ROLE_MAP` has to choose one name for it. macOS has two roles — `AXRow`
   * and `AXCell` — so without this a `<td>` is a `cell` on one platform and a
   * `row` on the other, and a flow that says "the second cell" means two
   * different things.
   *
   * The difference is not in the element; it is in the parent, which is why
   * `roleOf` takes a context. This and the AX adapter's pop-up rule are the two
   * places a desktop adapter reads an ancestor to decide a role, and
   * `test/parity.test.ts` is what found both.
   */
  if (context.insideRow === true && node.controlType === "DataItem") return "cell";
  /*
   * A text run inside a chooser is that chooser's option (T10.3).
   *
   * The mirror of the AX adapter's pop-up rule: Chromium wraps a `<select>`'s
   * option label in a text node, and macOS publishes it as `AXStaticText`
   * inside the pop-up — which the AX adapter promotes to `option`. Windows
   * leaves it `ControlType.Text`, so without this the same element was `option`
   * on one platform and `text` on the other, and `selectOption` looked for two
   * different things.
   */
  if (context.insideChooser === true && node.controlType === "Text") return "option";
  return UIA_ROLE_MAP[node.controlType] ?? FALLBACK_ROLE;
}

/**
 * The control types whose descendants are a chooser's items (see `roleOf`).
 *
 * `ComboBox` only. A `List` is not a chooser: its text runs are its text, and
 * promoting those made every line of the Settings screen's diagnostics an
 * `option` (T10.3). A listbox's *rows* arrive as `ListItem`, which
 * `UIA_ROLE_MAP` already sends to `option`.
 */
const CHOOSER_TYPES = new Set(["ComboBox"]);

/** Whether this node is inside a chooser (see `roleOf`). */
export function insideChooser(nodes: readonly UiaNode[], index: number): boolean {
  for (let at = nodes[index]?.parent ?? -1; at >= 0; at = nodes[at]?.parent ?? -1) {
    if (CHOOSER_TYPES.has(nodes[at]!.controlType)) return true;
  }
  return false;
}

/** Whether this node is inside a table row (see `roleOf`). */
export function insideRow(nodes: readonly UiaNode[], index: number): boolean {
  const parent = nodes[index]?.parent ?? -1;
  return parent >= 0 && nodes[parent]!.controlType === "DataItem";
}

/**
 * The ARIA roles a `LocalizedControlType` is allowed to name.
 *
 * Deliberately the roles Chromium actually publishes there, and not every ARIA
 * role: this is a filter against localisation, so a short list that is checked
 * is worth more than a long one that is not.
 */
const ARIA_ROLES = new Set([
  "heading",
  "tab",
  "link",
  "button",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "textbox",
  "searchbox",
  "switch",
  "menuitem",
  "banner",
  "navigation",
  "main",
  "complementary",
  "contentinfo",
  "region",
  "article",
  "form",
  "search",
  "status",
  "alert",
  "log",
]);

/**
 * The accessible name (REQ-SURF-4).
 *
 * UIA has one `Name`, wherever it came from — there is no `AXTitle` /
 * `AXDescription` split to resolve. `HelpText` is the fallback, which is a
 * `title` attribute on the web, and `Value` is deliberately not a name for the
 * same reason it is not one on macOS: a field named after its contents changes
 * identity on every keystroke.
 */
export function nameOf(node: UiaNode): string {
  for (const candidate of [node.name, node.helpText]) {
    const trimmed = (candidate ?? "").replace(/\s+/g, " ").trim();
    if (trimmed !== "") return trimmed;
  }
  return "";
}

/** The states LLD §2.2 lists, from the properties UIA exposes. */
export function statesOf(node: UiaNode): NodeState[] {
  const states: NodeState[] = [];
  if (node.isEnabled === false) states.push("disabled");
  if (node.toggleState === "On") states.push("checked");
  else if (node.toggleState === "Off") states.push("unchecked");
  if (node.isSelected === true) states.push("selected");
  if (node.expandCollapseState === "Expanded" || node.expandCollapseState === "PartiallyExpanded") {
    states.push("expanded");
  } else if (node.expandCollapseState === "Collapsed") states.push("collapsed");
  if (node.hasKeyboardFocus === true) states.push("focused");
  /*
   * `IsOffscreen` is UIA's own answer to "can this be seen", and it is better
   * than the box: it is true for an element that is scrolled out of a container
   * as well as for one with no area. Both are checked, because a provider that
   * does not set `IsOffscreen` still gives a zero rectangle.
   */
  if (node.isOffscreen === true) states.push("hidden");
  else if (node.box !== undefined && (node.box[2] <= 0 || node.box[3] <= 0)) states.push("hidden");
  /*
   * No `readonly` and no `required`. UIA carries the first on
   * `ValuePattern.IsReadOnly` and the second on `IsRequiredForForm`, and both
   * are per-pattern reads that would double the cost of the walk for a state
   * nothing in the IR asks about yet. Omitted rather than guessed.
   */
  return states;
}

/** Whether the element takes text, for `type` and for `value`. */
export function isTextual(node: UiaNode): boolean {
  return node.controlType === "Edit" || node.controlType === "Document";
}

/**
 * The words an element itself puts on the screen (native-feedback D3).
 *
 * The AX adapter's `saidBy`, for the same reason and with the same rule: a
 * `read("text")` asks what an element *says*, which is its name for a button
 * and its value for an edit — where the name is the label beside the box
 * rather than the words inside it. Kept in step with `adapter-ax/src/tree.ts`
 * because `test/parity.test.ts` compares the two answers, and a fix on one
 * platform only would move the disagreement rather than close it.
 */
export function saidBy(node: {
  readonly name?: string;
  readonly value?: string;
  readonly source: UiaNode;
}): string {
  const [first, second] = isTextual(node.source)
    ? [node.value, node.name]
    : [node.name, node.value];
  return first ?? second ?? "";
}

/**
 * The value a `read("value")` and a `value` predicate see.
 *
 * A checkbox's state is in `toggleState` and is already a state; repeating it
 * as a value would make `the checkbox should have the value "On"` a sentence
 * someone writes.
 */
export function valueOf(node: UiaNode): string | undefined {
  if (node.toggleState !== undefined) return undefined;
  return node.value === "" ? undefined : node.value;
}

/**
 * The `automationId` candidate's value (LLD §3.3, §7.5).
 *
 * > `automationId` is populated from `id` attributes on Windows […]
 *
 * One source, unlike macOS: `AutomationId` *is* the DOM `id` for Chromium
 * content and the developer's own identifier for a native control. There is no
 * fallback to the name, because on Windows the name has its own candidate and a
 * second one carrying the same string would be a duplicate the resolver has to
 * drop.
 */
export function automationIdOf(node: UiaNode): string | undefined {
  const trimmed = (node.automationId ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

export interface ConvertOptions {
  readonly maxNodes: number;
  readonly interactiveOnly: boolean;
  /** The window title, which the root of a `controlPath` is addressed by. */
  readonly windowTitle: string;
}

/** Flatten one window's tree into snapshot nodes. See the AX sibling for the rule. */
export function convertTree(nodes: readonly UiaNode[], options: ConvertOptions): UiaSnapshotNode[] {
  if (nodes.length === 0) return [];

  const children = childIndex(nodes);

  const depth = nodes.map(() => 0);
  const path: Array<readonly number[]> = nodes.map(() => []);
  for (let index = 0; index < nodes.length; index += 1) {
    const parent = nodes[index]!.parent;
    if (parent < 0) continue;
    depth[index] = depth[parent]! + 1;
    const among = children.get(parent) ?? [];
    path[index] = [...path[parent]!, among.indexOf(index)];
  }

  const keep = new Set<number>();
  if (options.interactiveOnly) {
    for (let index = 0; index < nodes.length; index += 1) {
      if (
        !isInteractiveRole(
          roleOf(nodes[index]!, {
            insideRow: insideRow(nodes, index),
            insideChooser: insideChooser(nodes, index),
          }),
        )
      ) {
        continue;
      }
      for (let at = index; at >= 0; at = nodes[at]!.parent) keep.add(at);
    }
  } else {
    for (let index = 0; index < nodes.length; index += 1) keep.add(index);
  }

  const kept = [...keep].sort((a, b) => a - b).slice(0, options.maxNodes);
  const refOf = new Map<number, string>();
  kept.forEach((index, at) => refOf.set(index, `r${at}`));

  return kept.map((index) => {
    const node = nodes[index]!;
    const parentRef = refOf.get(node.parent);
    const name = nameOf(node);
    const value = valueOf(node);
    const help = (node.helpText ?? "").trim();
    const native: Record<string, string> = { controlType: node.controlType };
    if (node.className !== undefined) native["className"] = node.className;
    const automationId = automationIdOf(node);
    if (automationId !== undefined) native["automationId"] = automationId;

    return {
      ref: refOf.get(index)!,
      role: roleOf(node, {
        insideRow: insideRow(nodes, index),
        insideChooser: insideChooser(nodes, index),
      }),
      ...(name === "" ? {} : { name }),
      ...(value === undefined ? {} : { value }),
      ...(help === "" || help === name ? {} : { description: help }),
      states: statesOf(node),
      ...(node.box === undefined ? {} : { box: [...node.box] as [number, number, number, number] }),
      depth: depth[index]!,
      ...(parentRef === undefined ? {} : { parent: parentRef }),
      native,
      path: path[index]!,
      source: node,
      controlPath: controlPathOf(nodes, index, children, options.windowTitle),
    } satisfies UiaSnapshotNode;
  });
}

/**
 * `Window[Yam]/Group[2]/Button[Run]` (LLD §3.3, §7.5).
 *
 * > `controlPath` built from ancestor chain with names and sibling indices […]
 * > `controlPath` starts at the top-level window title.
 *
 * The segments use the **UIA control type**, not the ARIA role, so a path reads
 * against the tree a Windows developer would see in Inspect or Accessibility
 * Insights. That is the point of a `controlPath` candidate: it is the address a
 * person can check by hand.
 */
export function controlPathOf(
  nodes: readonly UiaNode[],
  index: number,
  children: ReadonlyMap<number, number[]>,
  windowTitle: string,
): string {
  const segments: string[] = [];
  for (let at = index; at >= 0; at = nodes[at]!.parent) {
    const node = nodes[at]!;
    if (node.parent < 0) {
      segments.unshift(`Window[${windowTitle}]`);
      continue;
    }
    const name = nameOf(node);
    if (name !== "") {
      segments.unshift(`${node.controlType}[${name}]`);
      continue;
    }
    const siblings = (children.get(node.parent) ?? []).filter(
      (sibling) => nodes[sibling]!.controlType === node.controlType,
    );
    segments.unshift(`${node.controlType}[${siblings.indexOf(at)}]`);
  }
  return segments.join("/");
}

/** Every node's children, by parent index. */
export function childIndex(nodes: readonly UiaNode[]): Map<number, number[]> {
  const children = new Map<number, number[]>();
  nodes.forEach((node, index) => {
    if (node.parent < 0) return;
    const list = children.get(node.parent) ?? [];
    list.push(index);
    children.set(node.parent, list);
  });
  return children;
}
