/**
 * Appium page source → the normalised snapshot of LLD §2.2 (T4.2, LLD §7.4).
 *
 * > `snapshot()` converts page source (`class` → role map, `content-desc`/`text`
 * > → name, `bounds` → box).
 *
 * A native app has no DOM and no accessibility *tree with references* — what
 * Appium gives you is one XML document per query, a snapshot in the literal
 * sense. Converting it is therefore the whole of `snapshot()`, `describe()` and
 * `locate()` for a native context, and it is pure: XML in, nodes out, no
 * session, no device. That is why the emulator gate can be blocked and this can
 * still be tested.
 *
 * Android (`uiautomator2`) and iOS (`XCUITest`) emit different attribute names
 * for the same ideas, so both spellings are read and the adapter above does not
 * have to know which platform it is on.
 */
import { APPIUM_ANDROID_ROLE_MAP, FALLBACK_ROLE, isInteractiveRole } from "@svatah/surface";
import type { SnapshotNode } from "@svatah/schema";

/** One element as the page source describes it, before any normalisation. */
export interface SourceNode {
  /** The XML tag: `android.widget.Button`, `XCUIElementTypeButton`, `hierarchy`. */
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly SourceNode[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * A scanner for the XML Appium emits.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Parse a page source into a tree.
 *
 * A dedicated scanner rather than an HTML parser, because the two disagree in
 * exactly the places that matter here. Android class names are case-sensitive
 * (`android.widget.TextView`), an HTML parser lowercases them; and every element
 * here is either self-closing or properly closed, so none of the recovery an
 * HTML parser does for unclosed tags is wanted — a page source that will not
 * parse is a bug worth seeing, not one to paper over.
 *
 * The format has no CDATA, no processing instructions beyond the declaration,
 * no DTD and no namespaces, which is why this fits on a page.
 */
export function parsePageSource(xml: string): SourceNode {
  const root: SourceNode = { tag: "hierarchy", attrs: {}, children: [] };
  const stack: Array<{ node: SourceNode; children: SourceNode[] }> = [
    { node: root, children: root.children as SourceNode[] },
  ];
  let at = 0;

  const skipTo = (needle: string): void => {
    const found = xml.indexOf(needle, at);
    at = found < 0 ? xml.length : found + needle.length;
  };

  while (at < xml.length) {
    const open = xml.indexOf("<", at);
    if (open < 0) break;
    at = open + 1;

    // `<?xml …?>`, `<!-- … -->`, `<!DOCTYPE …>`: nothing to build from.
    if (xml[at] === "?") {
      skipTo("?>");
      continue;
    }
    if (xml.startsWith("!--", at)) {
      skipTo("-->");
      continue;
    }
    if (xml[at] === "!") {
      skipTo(">");
      continue;
    }

    if (xml[at] === "/") {
      // A close tag. The scanner does not check that it matches: a page source
      // is machine-written and well-formed, and inventing a recovery for a case
      // that means "the device sent nonsense" would hide it.
      skipTo(">");
      if (stack.length > 1) stack.pop();
      continue;
    }

    const tagEnd = readName(xml, at);
    const tag = xml.slice(at, tagEnd);
    at = tagEnd;

    const { attrs, selfClosing, next } = readAttributes(xml, at);
    at = next;

    const node: SourceNode = { tag, attrs, children: [] };
    stack[stack.length - 1]!.children.push(node);
    if (!selfClosing) stack.push({ node, children: node.children as SourceNode[] });
  }

  /*
   * Android wraps everything in `<hierarchy>`, iOS in `<AppiumAUT>`, and the
   * scanner adds one more of its own so a document with several top-level
   * elements still parses. None of the three is a control, so the caller gets
   * the outermost thing that is — unwrapping by *name* rather than by "has one
   * child", so an application whose own root happens to be an only child is not
   * skipped past.
   */
  const WRAPPERS = new Set(["hierarchy", "AppiumAUT", "XCUIElementTypeApplication:none"]);
  let node: SourceNode = root;
  while (WRAPPERS.has(node.tag) && node.children.length === 1) node = node.children[0]!;
  return node;
}

function readName(xml: string, from: number): number {
  let at = from;
  while (at < xml.length && !/[\s/>]/.test(xml[at]!)) at += 1;
  return at;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#10;": "\n",
  "&#13;": "\r",
  "&#9;": "\t",
};

/** The five XML entities, plus the numeric escapes a label can contain. */
export function unescapeXml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+);/g, (found) => {
    const known = ENTITIES[found];
    if (known !== undefined) return known;
    const code = Number(found.slice(2, -1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : found;
  });
}

function readAttributes(
  xml: string,
  from: number,
): { attrs: Record<string, string>; selfClosing: boolean; next: number } {
  const attrs: Record<string, string> = {};
  let at = from;

  for (;;) {
    while (at < xml.length && /\s/.test(xml[at]!)) at += 1;
    if (at >= xml.length) return { attrs, selfClosing: true, next: at };

    if (xml[at] === "/") {
      const close = xml.indexOf(">", at);
      return { attrs, selfClosing: true, next: close < 0 ? xml.length : close + 1 };
    }
    if (xml[at] === ">") return { attrs, selfClosing: false, next: at + 1 };

    const nameEnd = (() => {
      let cursor = at;
      while (cursor < xml.length && !/[\s=/>]/.test(xml[cursor]!)) cursor += 1;
      return cursor;
    })();
    const name = xml.slice(at, nameEnd);
    at = nameEnd;

    while (at < xml.length && /\s/.test(xml[at]!)) at += 1;
    if (xml[at] !== "=") {
      // A bare attribute. Not something Appium emits, but reading it as `""` is
      // better than losing the rest of the element to a parse that gave up.
      attrs[name] = "";
      continue;
    }
    at += 1;
    while (at < xml.length && /\s/.test(xml[at]!)) at += 1;

    const quote = xml[at];
    if (quote !== '"' && quote !== "'") {
      attrs[name] = "";
      continue;
    }
    at += 1;
    const valueEnd = xml.indexOf(quote, at);
    attrs[name] = unescapeXml(xml.slice(at, valueEnd < 0 ? xml.length : valueEnd));
    at = valueEnd < 0 ? xml.length : valueEnd + 1;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Page source → the surface's snapshot shape.
 * ──────────────────────────────────────────────────────────────────────────── */

/** `[x, y, width, height]` from Android's `[left,top][right,bottom]`. */
export function parseBounds(bounds: string | undefined): [number, number, number, number] | undefined {
  if (bounds === undefined) return undefined;
  const found = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(bounds);
  if (found === null) return undefined;
  const [left, top, right, bottom] = found.slice(1).map(Number) as [number, number, number, number];
  return [left, top, right - left, bottom - top];
}

/** iOS reports geometry as four separate attributes rather than as a string. */
function iosBox(attrs: Readonly<Record<string, string>>): [number, number, number, number] | undefined {
  const numbers = ["x", "y", "width", "height"].map((key) => Number(attrs[key]));
  return numbers.every((n) => Number.isFinite(n))
    ? (numbers as [number, number, number, number])
    : undefined;
}

export function boxOf(node: SourceNode): [number, number, number, number] | undefined {
  return parseBounds(node.attrs["bounds"]) ?? iosBox(node.attrs);
}

/**
 * The role a native class means, in the ARIA vocabulary (REQ-SURF-4).
 *
 * Android goes through the published table in `@svatah/surface`, so the mapping
 * the documentation prints and the mapping the adapter applies are one thing.
 * iOS's `XCUIElementType*` names are regular enough to derive from, which is
 * better than a second table that would fall behind the first.
 */
export function roleOf(node: SourceNode): string {
  const declared = APPIUM_ANDROID_ROLE_MAP[node.tag];
  if (declared !== undefined) return declared;

  if (node.tag.startsWith("XCUIElementType")) {
    const kind = node.tag.slice("XCUIElementType".length);
    const IOS: Record<string, string> = {
      Application: "application",
      Button: "button",
      Cell: "listitem",
      CheckBox: "checkbox",
      CollectionView: "list",
      Image: "img",
      Link: "link",
      NavigationBar: "navigation",
      Other: "generic",
      PageIndicator: "tablist",
      PickerWheel: "combobox",
      ScrollView: "group",
      SearchField: "searchbox",
      SecureTextField: "textbox",
      SegmentedControl: "tablist",
      Slider: "slider",
      StaticText: "text",
      StatusBar: "status",
      Switch: "switch",
      Table: "list",
      TabBar: "tablist",
      TextField: "textbox",
      TextView: "textbox",
      Toolbar: "toolbar",
      Window: "window",
    };
    return IOS[kind] ?? FALLBACK_ROLE;
  }

  /*
   * A class the table does not name still gets a role from what it *is*: an
   * app's own `com.acme.FancyButton` is a button to anyone reading the screen,
   * and a node that vanished into `generic` would be one the recorder cannot
   * describe and a person cannot name (LLD §2.2's fallback rule).
   */
  const leaf = node.tag.split(".").pop() ?? node.tag;
  if (/Button$/.test(leaf)) return "button";
  if (/EditText$|TextField$/.test(leaf)) return "textbox";
  if (/CheckBox$/.test(leaf)) return "checkbox";
  if (/RadioButton$/.test(leaf)) return "radio";
  if (/Switch$/.test(leaf)) return "switch";
  if (/ImageView$|Image$/.test(leaf)) return "img";
  if (/TextView$|Label$/.test(leaf)) return "text";
  if (/ListView$|RecyclerView$/.test(leaf)) return "list";
  return FALLBACK_ROLE;
}

/**
 * The accessible name: `content-desc`, then `text`, then iOS's `label` or `name`.
 *
 * That order is the platform's own. Android's `content-desc` is what a screen
 * reader announces and is set deliberately; `text` is what happens to be
 * rendered. A control with both means the first.
 */
export function nameOf(node: SourceNode): string {
  const { attrs } = node;
  for (const key of ["content-desc", "label", "name", "text", "value"]) {
    const value = attrs[key];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return "";
}

/** The value a control holds, as distinct from what it is called. */
export function valueOf(node: SourceNode): string | undefined {
  const role = roleOf(node);
  if (role !== "textbox" && role !== "searchbox" && role !== "combobox") return undefined;
  const value = node.attrs["text"] ?? node.attrs["value"];
  // A field whose `text` *is* its name is showing a hint, not holding a value.
  if (value === undefined || value === "" || value === node.attrs["content-desc"]) return undefined;
  return value;
}

const TRUE = (value: string | undefined): boolean => value === "true";

/** The states LLD §2.2 publishes, read from the platform's boolean attributes. */
export function statesOf(node: SourceNode): SnapshotNode["states"] {
  const { attrs } = node;
  const states: SnapshotNode["states"] = [];
  const role = roleOf(node);

  if (attrs["enabled"] !== undefined && !TRUE(attrs["enabled"])) states.push("disabled");
  if (attrs["checkable"] !== undefined && TRUE(attrs["checkable"])) {
    states.push(TRUE(attrs["checked"]) ? "checked" : "unchecked");
  } else if (role === "checkbox" || role === "radio" || role === "switch") {
    // iOS says `value="1"` rather than `checked="true"`, and a checkbox with
    // neither must still report one of the two: "unchecked" is a fact about the
    // control, and leaving it out would make `check("unchecked")` unanswerable.
    const on = TRUE(attrs["checked"]) || attrs["value"] === "1";
    states.push(on ? "checked" : "unchecked");
  }
  if (TRUE(attrs["selected"])) states.push("selected");
  if (TRUE(attrs["focused"])) states.push("focused");
  if (attrs["displayed"] !== undefined && !TRUE(attrs["displayed"])) states.push("hidden");
  if (attrs["visible"] !== undefined && !TRUE(attrs["visible"])) states.push("hidden");

  const box = boxOf(node);
  // A control with no area is not on the screen, whatever the tree says.
  if (box !== undefined && box[2] === 0 && box[3] === 0 && !states.includes("hidden")) {
    states.push("hidden");
  }
  if (attrs["password"] !== undefined && TRUE(attrs["password"])) states.push("required");
  return states;
}

/**
 * The XPath that names one node from the root, by class and sibling index.
 *
 * The `xpath` candidate kind LLD §7.4 lists for native contexts, and the last
 * resort of the three: it says *where* an element is rather than what it is, so
 * it breaks when the screen is rearranged. Synthesis ranks it below
 * `accessibilityId` and `resourceId` for that reason.
 */
export function xpathOf(path: readonly SourceNode[]): string {
  const parts: string[] = [];
  for (let depth = 1; depth < path.length; depth += 1) {
    const node = path[depth]!;
    const siblings = path[depth - 1]!.children.filter((c) => c.tag === node.tag);
    const index = siblings.indexOf(node) + 1;
    parts.push(siblings.length > 1 ? `${node.tag}[${index}]` : node.tag);
  }
  return `//${parts.join("/")}`;
}

export interface ConvertOptions {
  readonly maxNodes?: number;
  readonly interactiveOnly?: boolean;
  /** Attribute names the surface never reports (LLD §3.5). */
  readonly ignoreAttributes?: readonly string[];
}

export interface ConvertedNode extends SnapshotNode {
  /** The path from the root, kept beside the node for `describe` and `locate`. */
  readonly path: readonly SourceNode[];
}

/**
 * A page source, as the normalised node list of LLD §2.2.
 *
 * Depth counts only nodes that made it into the list, so the tree a caller sees
 * is the tree of *meaningful* controls rather than of layout containers — the
 * same rule the web walker follows.
 */
export function convertPageSource(
  root: SourceNode,
  options: ConvertOptions = {},
): ConvertedNode[] {
  const maxNodes = options.maxNodes ?? 1_000;
  const ignored = new Set((options.ignoreAttributes ?? []).map((a) => a.toLowerCase()));
  const out: ConvertedNode[] = [];

  const visit = (node: SourceNode, path: SourceNode[], depth: number, parent?: string): void => {
    if (out.length >= maxNodes) return;
    const here = [...path, node];
    const role = roleOf(node);
    const keep = !(options.interactiveOnly === true) || isInteractiveRole(role);

    let ref: string | undefined;
    let nextDepth = depth;
    if (keep) {
      ref = `r${out.length}`;
      const name = nameOf(node);
      const value = valueOf(node);
      const box = boxOf(node);
      const native: Record<string, string> = {};
      for (const [key, raw] of Object.entries(node.attrs)) {
        if (ignored.has(key.toLowerCase()) || raw === "") continue;
        if (["bounds", "x", "y", "width", "height", "index"].includes(key)) continue;
        native[key] = raw;
      }
      native["class"] = node.tag;
      native["xpath"] = xpathOf(here);

      out.push({
        ref,
        role,
        ...(name === "" ? {} : { name }),
        ...(value === undefined ? {} : { value }),
        states: statesOf(node),
        ...(box === undefined ? {} : { box }),
        depth,
        ...(parent === undefined ? {} : { parent }),
        native,
        path: here,
      });
      nextDepth = depth + 1;
    }

    for (const child of node.children) visit(child, here, nextDepth, ref ?? parent);
  };

  visit(root, [], 0, undefined);
  return out;
}
