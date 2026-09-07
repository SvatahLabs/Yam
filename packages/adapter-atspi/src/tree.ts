/**
 * An AT-SPI tree, as the semantic snapshot every other adapter produces
 * (T23, SF-23, SF-10).
 *
 * Pure functions of an `AtspiNode[]`, which is what makes this file testable on
 * a machine with no accessibility bus — and it is tested there, which is the
 * only claim about AT-SPI this wave can honestly make. Nothing here spawns
 * anything.
 *
 * The point of the mapping is that a binding does not know which platform it is
 * on. `ATSPI_ROLE_MAP` lands `push button` on `button`, exactly as the macOS
 * table lands `AXButton` and the Windows table lands `Button`, so an element id
 * recorded once resolves on all three.
 */
import { FALLBACK_ROLE, isInteractiveRole, normaliseRole } from "@svatah/yam-surface";
import type { NodeState, Ref, SnapshotNode } from "@svatah/yam-schema";
import type { AtspiNode } from "./bridge.js";

/** The ARIA role an AT-SPI role name means. */
export function roleOf(node: AtspiNode): string {
  const mapped = normaliseRole("atspi", node.role.toLowerCase());
  if (mapped !== FALLBACK_ROLE) return mapped;
  /*
   * A role AT-SPI publishes with a hyphen or an underscore is the same role.
   * `getRoleName()` gives spaces, but the enumeration names — which some
   * toolkits pass through — give `PUSH_BUTTON`, and a table that missed those
   * would report a window full of `generic`.
   */
  return normaliseRole("atspi", node.role.toLowerCase().replace(/[_-]+/gu, " "));
}

/**
 * The application's own id for an element (LLD §3.3).
 *
 * GTK publishes it as the `accessible-id` object attribute; Qt as `id`. Both are
 * read by the walker into one field, because what a binding needs is the fact,
 * not which toolkit published it.
 */
export function automationIdOf(node: AtspiNode): string | undefined {
  const id = node.automationId?.trim();
  return id === undefined || id === "" ? undefined : id;
}

/** What the element is called, in the order a screen reader would say it. */
export function nameOf(node: AtspiNode): string {
  for (const candidate of [node.name, node.description, node.text]) {
    const said = candidate?.replace(/\s+/gu, " ").trim();
    if (said !== undefined && said !== "") return said;
  }
  return "";
}

/**
 * The AT-SPI state names this vocabulary has a word for.
 *
 * A closed map on purpose: AT-SPI publishes forty-odd states and the snapshot
 * vocabulary has ten, and inventing a mapping for the rest would put words in a
 * snapshot that no predicate can ask about.
 */
const STATES: Readonly<Record<string, NodeState>> = {
  checked: "checked",
  collapsed: "collapsed",
  expanded: "expanded",
  focused: "focused",
  required: "required",
  selected: "selected",
};

export function statesOf(node: AtspiNode): NodeState[] {
  const has = new Set((node.states ?? []).map((one) => one.toLowerCase()));
  const states: NodeState[] = [];
  for (const [name, state] of Object.entries(STATES)) {
    if (has.has(name)) states.push(state);
  }
  /*
   * AT-SPI says what *is* rather than what is not: there is an `enabled` state
   * and no `disabled` one, and a `showing` state and no `hidden` one. The
   * snapshot vocabulary is the other way round for both, so the absence is what
   * is reported — which is the same inversion the UIA adapter performs.
   */
  if (!has.has("enabled") || has.has("defunct")) states.push("disabled");
  if (!has.has("showing")) states.push("hidden");
  if (has.has("checkable") && !has.has("checked")) states.push("unchecked");
  if (has.has("read only")) states.push("readonly");
  return states;
}

/** The value a `read` of kind `value` answers with. */
export function valueOf(node: AtspiNode): string {
  return node.value ?? node.text ?? "";
}

/** Whether a node is worth showing when the caller asked for controls only. */
export function isInteractive(node: AtspiNode): boolean {
  if ((node.actions ?? []).length > 0) return true;
  return isInteractiveRole(roleOf(node));
}

export interface BuiltNode {
  readonly node: SnapshotNode;
  /** The index path from the window down, which is how a command addresses it. */
  readonly path: readonly number[];
  readonly source: AtspiNode;
}

/**
 * Turn a flattened AT-SPI tree into snapshot nodes with stable references.
 *
 * A reference is `a<generation>_<index>`: opaque above the surface, and unique
 * to the snapshot that issued it, so a reference from an earlier snapshot
 * cannot address whatever holds its index now (SF-10).
 */
export function buildNodes(
  nodes: readonly AtspiNode[],
  generation: number,
  options: { interactiveOnly?: boolean; maxNodes?: number } = {},
): BuiltNode[] {
  const depths = new Map<number, number>();
  const paths = new Map<number, number[]>();
  const built: BuiltNode[] = [];
  const max = options.maxNodes ?? 1_000;

  for (const [index, source] of nodes.entries()) {
    const depth = source.parent < 0 ? 0 : (depths.get(source.parent) ?? 0) + 1;
    depths.set(index, depth);
    const siblingsBefore = nodes
      .slice(0, index)
      .filter((one) => one.parent === source.parent).length;
    const path =
      source.parent < 0 ? [] : [...(paths.get(source.parent) ?? []), siblingsBefore];
    paths.set(index, path);

    if (built.length >= max) break;
    if (options.interactiveOnly === true && depth > 0 && !isInteractive(source)) continue;

    const name = nameOf(source);
    const value = valueOf(source);
    const automationId = automationIdOf(source);
    built.push({
      path,
      source,
      node: {
        ref: `a${generation}_${index}` as Ref,
        role: roleOf(source),
        ...(name === "" ? {} : { name }),
        ...(value === "" ? {} : { value }),
        ...(source.box === undefined ? {} : { box: [...source.box] as [number, number, number, number] }),
        states: statesOf(source),
        depth,
        /*
         * Adapter-specific extras go in `native`, where every other adapter
         * puts them and where the resolver looks for an `automationId`. A
         * top-level field would be a shape only this adapter has, which is the
         * thing the shared snapshot exists to prevent.
         */
        native: {
          atspiRole: source.role,
          ...(automationId === undefined ? {} : { automationId }),
        },
      } as SnapshotNode,
    });
  }
  return built;
}

/**
 * Which AT-SPI action performs a gesture.
 *
 * AT-SPI names actions per toolkit — GTK's button offers `click`, its menu item
 * offers `click` too, and older toolkits offer `press`. So the adapter asks for
 * the first of a preference list the element actually declares, and refuses by
 * name when it declares none of them, rather than picking whatever is first and
 * hoping.
 */
export const ACTION_PREFERENCE: Readonly<Record<string, readonly string[]>> = {
  click: ["click", "press", "activate", "jump"],
  doubleClick: ["click", "press"],
  press: ["press", "click"],
  setChecked: ["click", "press", "toggle"],
  selectOption: ["click", "press"],
  hover: ["mouse over", "hover"],
  scrollIntoView: ["scroll to", "show"],
};

export function actionFor(kind: string, node: AtspiNode): string | undefined {
  const wanted = ACTION_PREFERENCE[kind];
  if (wanted === undefined) return undefined;
  const declared = (node.actions ?? []).map((one) => one.toLowerCase());
  return wanted.find((one) => declared.includes(one));
}
