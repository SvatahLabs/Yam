/**
 * An accessibility tree → the normalised snapshot of LLD §2.2 (T6.2, LLD §7.5).
 *
 * > Both: `state()` returns the focused window and title […] `AXRole` → role
 * > map; `AXIdentifier` → `automationId`; `controlPath` built from the ancestor
 * > chain with names and sibling indices.
 *
 * Pure: `AxNode[]` in, `SnapshotNode[]` out. No `osascript`, no process, no
 * permission — which is why every rule in this file is testable on a machine
 * that cannot reach the accessibility API at all, and why a recorded tree is a
 * complete test input rather than a stub.
 *
 * ## What a desktop tree has that a page does not
 *
 * Depth. A Chromium window under AX is roughly
 * `AXWindow → AXGroup → AXScrollArea → AXWebArea → …the document`, and every
 * one of those is a real element with a box. They are kept: `rolePath` is what
 * a `controlPath` candidate is built from and what relocalization scores
 * against (LLD §6.4), and a tree that skipped its own scaffolding would give
 * two different windows the same path.
 */
import { AX_ROLE_MAP, FALLBACK_ROLE, isInteractiveRole } from "@svatah/surface";
import type { NodeState, SnapshotNode } from "@svatah/schema";
import type { AxNode } from "./bridge.js";

/** A snapshot node, plus what only the walk knows. */
export interface AxSnapshotNode extends SnapshotNode {
  /** The child index at each level from the window down; the bridge's address. */
  readonly path: readonly number[];
  /** The node this was built from, for `describe()`. */
  readonly source: AxNode;
  /** `Window[Svatah ADE]/AXGroup[2]/AXButton[Run]` (LLD §3.3). */
  readonly controlPath: string;
}

/**
 * `AXRole` → an ARIA role, with the subrole consulted first.
 *
 * A subrole is macOS's way of saying "this button is a close button" or "this
 * text field is a search field", and it is closer to the ARIA role than the
 * role is. `AXTextField` + `AXSearchField` is a `searchbox`, not a `textbox`;
 * `AXGroup` + `AXTabGroup` is a `tablist`. Where there is no subrole mapping,
 * the role's own answer stands.
 */
export function roleOf(
  node: Pick<AxNode, "role" | "subrole">,
  context: { readonly insidePopUp?: boolean } = {},
): string {
  const bySubrole = node.subrole === undefined ? undefined : AX_SUBROLE_MAP[node.subrole];
  if (bySubrole !== undefined) return bySubrole;
  /*
   * A pop-up button's item is an `option`, not a menu bar command (REQ-SURF-4).
   *
   * Chromium publishes a `<select>`'s `<option>` on macOS as `AXMenuItem` — the
   * same role a menu bar's "Save As…" has — and on Windows as
   * `ControlType.ListItem`, which the UIA map sends to `option`. One element,
   * two roles, and `selectOption` looking for two different things depending on
   * the platform.
   *
   * The flat role map cannot tell them apart, because the difference is not in
   * the element: it is in the parent. This is the one place the AX adapter reads
   * an ancestor to decide a role, and it is why `roleOf` takes a context rather
   * than only a node. `packages/adapter-uia/test/parity.test.ts` is what found
   * it.
   */
  if (context.insidePopUp === true && (node.role === "AXMenuItem" || node.role === "AXStaticText")) {
    return "option";
  }
  return AX_ROLE_MAP[node.role] ?? FALLBACK_ROLE;
}

/** The AX roles whose descendants are a chooser's items rather than a menu's. */
const POP_UP_ROLES = new Set(["AXPopUpButton", "AXComboBox"]);

/** Whether this node is inside a pop-up button's menu (see `roleOf`). */
export function insidePopUp(nodes: readonly AxNode[], index: number): boolean {
  for (let at = nodes[index]?.parent ?? -1; at >= 0; at = nodes[at]!.parent) {
    if (POP_UP_ROLES.has(nodes[at]!.role)) return true;
  }
  return false;
}

/** The subroles that mean something different from their role (LLD §7.5). */
export const AX_SUBROLE_MAP: Readonly<Record<string, string>> = {
  AXCloseButton: "button",
  AXCollapseButton: "button",
  AXContentList: "list",
  AXDefinitionList: "list",
  AXDescriptionList: "list",
  AXFullScreenButton: "button",
  AXIncrementArrow: "button",
  AXDecrementArrow: "button",
  AXLandmarkBanner: "banner",
  AXLandmarkComplementary: "complementary",
  AXLandmarkContentInfo: "contentinfo",
  AXLandmarkMain: "main",
  AXLandmarkNavigation: "navigation",
  AXLandmarkRegion: "region",
  AXLandmarkSearch: "search",
  AXMinimizeButton: "button",
  AXSearchField: "searchbox",
  AXSecureTextField: "textbox",
  AXSortButton: "columnheader",
  AXStandardWindow: "window",
  AXSwitch: "switch",
  AXTabButton: "tab",
  AXTerminal: "log",
  AXToggle: "switch",
  AXZoomButton: "button",
};

/**
 * The `automationId` candidate's value (LLD §3.3, §7.5).
 *
 * > `automationId` is populated from `id` attributes on Windows and from
 * > `aria-label` or `AXIdentifier` on macOS.
 *
 * Three sources, most stable first:
 *
 * 1. **`AXIdentifier`** — what a native macOS application sets deliberately.
 *    Nothing else about the element has to stay the same for it to keep working.
 * 2. **`AXDOMIdentifier`** — the DOM `id`, which Chromium publishes. §7.5 does
 *    not name it; it is used because the conformance target is an Electron
 *    application (REQ-ADE-6) whose controls have `id` attributes and no
 *    `AXIdentifier`, and an `id` is an identity where a label is a label.
 * 3. **`AXDescription`** — the `aria-label`, which is §7.5's other source. Last,
 *    because it is the element's *wording*: it changes when someone rewrites the
 *    interface, which is exactly what the candidates below it already handle.
 *
 * `undefined` rather than the empty string when there is none, so a binding
 * never carries an `automationId` candidate that matches every unidentified
 * element in the window.
 */
export function automationIdOf(node: AxNode): string | undefined {
  for (const candidate of [node.identifier, node.domIdentifier, node.description]) {
    const trimmed = (candidate ?? "").trim();
    if (trimmed !== "") return trimmed;
  }
  return undefined;
}

/**
 * The accessible name (REQ-SURF-4).
 *
 * Order matters and follows what Chromium puts where: an `aria-label` arrives
 * as `AXDescription`, a `<button>Run</button>`'s text arrives as `AXTitle`, and
 * a `title` attribute arrives as `AXHelp`. `AXValue` is deliberately *not* a
 * name — a text field's contents are its value, and a snapshot that named a
 * field after whatever had been typed into it would change identity on every
 * keystroke.
 */
export function nameOf(node: AxNode): string {
  for (const candidate of [node.title, node.description, node.help, node.placeholder]) {
    const trimmed = (candidate ?? "").replace(/\s+/g, " ").trim();
    if (trimmed !== "") return trimmed;
  }
  return "";
}

/** The states LLD §2.2 lists, from the attributes macOS exposes. */
export function statesOf(node: AxNode): NodeState[] {
  const states: NodeState[] = [];
  if (node.enabled === false) states.push("disabled");
  if (node.checked === true) states.push("checked");
  else if (node.checked === false && isCheckable(node)) states.push("unchecked");
  if (node.selected === true) states.push("selected");
  if (node.expanded === true) states.push("expanded");
  else if (node.expanded === false) states.push("collapsed");
  if (node.focused === true) states.push("focused");
  /*
   * `hidden` is a box, not an attribute. AX simply does not publish elements
   * that are `display: none`, and Chromium reports an `aria-hidden` subtree by
   * omitting it — so the only hidden thing that reaches here is one with no
   * area, which is what a zero-size box means.
   */
  if (node.box !== undefined && (node.box[2] <= 0 || node.box[3] <= 0)) states.push("hidden");
  /*
   * No `readonly` and no `required`. macOS carries both, on the settable-ness
   * of `AXValue` and on `AXRequired`, and System Events exposes neither — so
   * the honest snapshot omits them rather than guessing from the action list.
   * A predicate about either is reported as unsupported by `check()` instead of
   * being answered wrongly.
   */
  return states;
}

function isCheckable(node: AxNode): boolean {
  return node.role === "AXCheckBox" || node.role === "AXRadioButton" || node.subrole === "AXSwitch";
}

export function isTextual(node: AxNode): boolean {
  return node.role === "AXTextField" || node.role === "AXTextArea" || node.role === "AXSecureTextField";
}

/**
 * The value a `read("value")` and a `value` predicate see.
 *
 * A checkbox's `AXValue` is a number that `checked` already carries, and
 * repeating it as the string `"1"` would make `the checkbox should have the
 * value "1"` a sentence someone writes. Only textual controls and controls with
 * a genuine text value get one.
 */
export function valueOf(node: AxNode): string | undefined {
  if (isCheckable(node)) return undefined;
  return node.value;
}

export interface ConvertOptions {
  readonly maxNodes: number;
  readonly interactiveOnly: boolean;
  /** The window title, which the root of a `controlPath` is addressed by. */
  readonly windowTitle: string;
}

/**
 * Flatten one window's tree into snapshot nodes.
 *
 * `interactiveOnly` keeps a node when its own role is interactive **or** when it
 * is an ancestor of one. The Appium adapter keeps only the controls; a desktop
 * tree cannot, because a snapshot of eleven buttons and nothing else has no
 * structure for a model to say "the second tab in the header" about, and no
 * `rolePath` for relocalization to score (LLD §6.4). Static text that is not on
 * the way to a control *is* dropped, which is the whole saving: a Chromium
 * window publishes an `AXStaticText` and an inline run for every word on the
 * screen.
 */
export function convertTree(nodes: readonly AxNode[], options: ConvertOptions): AxSnapshotNode[] {
  if (nodes.length === 0) return [];

  const children = new Map<number, number[]>();
  nodes.forEach((node, index) => {
    if (node.parent < 0) return;
    const list = children.get(node.parent) ?? [];
    list.push(index);
    children.set(node.parent, list);
  });

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
      if (!isInteractiveRole(roleOf(nodes[index]!, { insidePopUp: insidePopUp(nodes, index) }))) {
        continue;
      }
      // Keep the element and every ancestor, so the structure survives.
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
    const description = (node.description ?? "").trim();
    const native: Record<string, string> = { axRole: node.role };
    if (node.subrole !== undefined) native["axSubrole"] = node.subrole;
    const automationId = automationIdOf(node);
    if (automationId !== undefined) native["automationId"] = automationId;

    return {
      ref: refOf.get(index)!,
      role: roleOf(node, { insidePopUp: insidePopUp(nodes, index) }),
      ...(name === "" ? {} : { name }),
      ...(value === undefined ? {} : { value }),
      ...(description === "" || description === name ? {} : { description }),
      states: statesOf(node),
      ...(node.box === undefined ? {} : { box: [...node.box] as [number, number, number, number] }),
      depth: depth[index]!,
      ...(parentRef === undefined ? {} : { parent: parentRef }),
      native,
      path: path[index]!,
      source: node,
      controlPath: controlPathOf(nodes, index, children, options.windowTitle),
    } satisfies AxSnapshotNode;
  });
}

/**
 * `Window[Svatah ADE]/AXGroup[2]/AXButton[Run]` (LLD §3.3, §7.5).
 *
 * > `controlPath` built from the ancestor chain with names and sibling indices
 * > […] `controlPath` starts at the top-level window title.
 *
 * A named element is addressed by its name and an unnamed one by its index
 * among same-role siblings, because a name is stable across a re-layout and an
 * index is not — but an index is all there is for the anonymous groups
 * Chromium nests a page in. Mixing the two gives the shortest path that still
 * identifies the element, which is what makes a `controlPath` candidate worth
 * having beside an `automationId` one.
 */
export function controlPathOf(
  nodes: readonly AxNode[],
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
      segments.unshift(`${node.role}[${name}]`);
      continue;
    }
    const siblings = (children.get(node.parent) ?? []).filter(
      (sibling) => nodes[sibling]!.role === node.role,
    );
    segments.unshift(`${node.role}[${siblings.indexOf(at)}]`);
  }
  return segments.join("/");
}

/** The `children` index `controlPathOf` needs, for callers that have only nodes. */
export function childIndex(nodes: readonly AxNode[]): Map<number, number[]> {
  const children = new Map<number, number[]>();
  nodes.forEach((node, index) => {
    if (node.parent < 0) return;
    const list = children.get(node.parent) ?? [];
    list.push(index);
    children.set(node.parent, list);
  });
  return children;
}
