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

/** What `findAgain` could say about an element it was asked to find in a fresh read. */
export type FoundAgain =
  | { readonly kind: "found"; readonly node: BuiltNode }
  | { readonly kind: "gone" }
  /** Nothing in the two trees can tell it from another element; `why` says what. */
  | { readonly kind: "ambiguous"; readonly why: string };

const samePath = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((step, at) => step === b[at]);

/** How many children the node at `parent` has in a tree. */
const childrenAt = (tree: readonly BuiltNode[], parent: readonly number[]): number =>
  tree.filter(
    (one) => one.path.length === parent.length + 1 && parent.every((step, at) => one.path[at] === step),
  ).length;

/**
 * What an element is, without its address: its role with the application's
 * id when it has one, and with what it is called when it does not.
 */
function keyOf(node: BuiltNode): string {
  const id = automationIdOf(node.source);
  return id === undefined
    ? `name\u0000${node.source.role}\u0000${nameOf(node.source)}`
    : `id\u0000${node.source.role}\u0000${id}`;
}

/**
 * Whether nothing moved on the way down to `was`: at every level from the
 * window to its parent, the children are the same elements in the same order.
 *
 * When that holds, the index path still names the element it named, because
 * nothing was inserted or removed ahead of it at any level — which is the only
 * way a path comes to name something else.
 */
function unchangedAround(
  was: BuiltNode,
  then: readonly BuiltNode[],
  now: readonly BuiltNode[],
): boolean {
  const children = (tree: readonly BuiltNode[], parent: readonly number[]): string =>
    tree
      .filter(
        (one) =>
          one.path.length === parent.length + 1 && parent.every((step, at) => one.path[at] === step),
      )
      .map(keyOf)
      .join("\u0001");
  for (let depth = 0; depth < was.path.length; depth += 1) {
    const parent = was.path.slice(0, depth);
    if (children(then, parent) !== children(now, parent)) return false;
  }
  return true;
}

/**
 * The element a reference was issued for, in a fresh read of the window
 * (SF-10, SF-16).
 *
 * `then` is the whole tree of the snapshot that issued the reference and `was`
 * its node there; `now` is the whole tree as it is now.
 *
 * ## The defect this replaces
 *
 * Identity was the D-Bus address, then the automation id, then role and name
 * — each of those preferring whichever candidate sat at the old index path.
 * The walker never published an address, so the first rule never ran; and the
 * path tie-break is exactly wrong for a list. Delete the first of two unnamed
 * rows, or of two rows that share an automation id, and the second moves into
 * the first one's path: `absent` on the deleted row answered `false`, and a
 * `text` check on it answered with its neighbour's words.
 *
 * ## The rules now
 *
 * 1. **The address**, when the walker publishes one: it is the object. A
 *    different role at the same address is a recycled address (Qt publishes
 *    object pointers), and the element that had it is gone.
 * 2. **A key** — role and automation id, or role and name — only when the key
 *    was **unique in the tree that issued the reference**. Two rows with the
 *    same key cannot be told apart by anything but position, and position is
 *    the thing that moves; the answer is `ambiguous`, which the surface refuses
 *    as a `LocateError`, rather than a confident answer about the wrong row.
 *    The same when the key now matches more than one element.
 *
 *    The one exception is a position that cannot have moved: when every level
 *    from the window down to the element's parent holds the same children in
 *    the same order as it did (`unchangedAround`), the element at the same path
 *    with the same key is the same element. Without it, a check on one of five
 *    unnamed rows would be refused even on a window nobody touched. A deleted
 *    row changes its parent's children, so this never answers finding 1's
 *    deleted row with its neighbour.
 * 3. **An element with neither id nor name** has only its role for a key. That
 *    is accepted only where it was — unique then, unique now, at the same path —
 *    and is ambiguous anywhere else, because "the only unnamed list item" at a
 *    new position is as likely a new one as the old one moved.
 * 4. **A rename** (SF-16). A label that goes from "3 items" to "4 items" has no
 *    id and a new name, so no key finds it, and it used to read as gone. When
 *    nothing matches, the element at the same path is accepted as the same one
 *    renamed only if it has the same role, no automation id, a key that nowhere
 *    in the old tree had — so it is not an element that moved there — and its
 *    parent has as many children as before, so nothing was removed ahead of it.
 *    A removal changes the count, which is why rule 4 cannot answer finding 1's
 *    deleted row with its neighbour.
 */
export function findAgain(
  was: BuiltNode,
  then: readonly BuiltNode[],
  now: readonly BuiltNode[],
): FoundAgain {
  const address = was.source.address;
  if (address !== undefined && now.some((one) => one.source.address !== undefined)) {
    const at = now.find(
      (one) => one.source.address?.bus === address.bus && one.source.address.path === address.path,
    );
    return at !== undefined && at.source.role === was.source.role
      ? { kind: "found", node: at }
      : { kind: "gone" };
  }

  const key = keyOf(was);
  const id = automationIdOf(was.source);
  const said = nameOf(was.source);
  const what =
    id !== undefined
      ? `the automation id "${id}"`
      : said !== ""
        ? `the name "${said}"`
        : "no name and no automation id";
  const role = was.source.role;

  const inPlace = (): BuiltNode | undefined =>
    unchangedAround(was, then, now)
      ? now.find((one) => samePath(one.path, was.path) && keyOf(one) === key)
      : undefined;

  const twins = then.filter((one) => keyOf(one) === key).length;
  if (twins > 1) {
    const kept = inPlace();
    if (kept !== undefined) return { kind: "found", node: kept };
    return {
      kind: "ambiguous",
      why:
        `${twins} ${role} elements had ${what} when the reference was issued, and the bus ` +
        "published no object address to tell them apart",
    };
  }

  const matches = now.filter((one) => keyOf(one) === key);
  if (matches.length > 1) {
    const kept = inPlace();
    if (kept !== undefined) return { kind: "found", node: kept };
    return {
      kind: "ambiguous",
      why: `${matches.length} ${role} elements now have ${what}, and nothing says which one it is`,
    };
  }
  const match = matches[0];
  if (match !== undefined) {
    if (id !== undefined || said !== "" || samePath(match.path, was.path)) {
      return { kind: "found", node: match };
    }
    return {
      kind: "ambiguous",
      why:
        `it has ${what}, and the one ${role} like it is now somewhere else in the window, which ` +
        "a new element would be too",
    };
  }

  if (id === undefined) {
    const candidate = now.find((one) => samePath(one.path, was.path));
    const parent = was.path.slice(0, -1);
    if (
      candidate !== undefined &&
      candidate.source.role === role &&
      automationIdOf(candidate.source) === undefined &&
      !then.some((one) => keyOf(one) === keyOf(candidate)) &&
      (was.path.length === 0 || childrenAt(then, parent) === childrenAt(now, parent))
    ) {
      return { kind: "found", node: candidate };
    }
  }
  return { kind: "gone" };
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
