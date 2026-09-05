/**
 * The scripts the BiDi adapter injects into the page (T4.1, LLD §7.3).
 *
 * > `snapshot()`: injected script computing roles and names from the DOM (a port
 * > of the accessible-name algorithm used by the Playwright fallback) and
 * > assigning refs; same shape as §2.2.
 *
 * This is that port, and it is a *copy* rather than an import for the reason the
 * adapter exists at all. REQ-ADP-4 asks BiDi to prove the surface boundary; an
 * adapter that reached into `@svatah/adapter-playwright` for the thing it is
 * meant to be an independent implementation of would prove the opposite, and
 * would put Playwright in the dependency tree of the adapter whose whole claim is
 * that it does not need one.
 *
 * What keeps the copy honest is not that it stays byte-identical — it is free to
 * diverge where BiDi needs it to — but that `test/snapshot-parity.test.ts` drives
 * both adapters over the same pages and requires the same roles, names and
 * states out of each. That is REQ-SURF-4 ("snapshot output is normalised across
 * adapters") as a test rather than as an intention.
 *
 * Every function here is serialised to its source and evaluated in the page, so
 * each must be self-contained: no imports, no references to anything outside its
 * own body. That is why the role table and the accessible-name rules are
 * repeated inside each one.
 *
 * Four functions are injected:
 *
 *   `walkDocument`    builds the normalised node list of LLD §2.2 and registers
 *                     each element in an in-page array, so a `Ref` can be turned
 *                     back into the element it came from.
 *   `describeElement` returns everything candidate synthesis and fingerprinting
 *                     read from one element (LLD §3.3, §7.4).
 *   `locateInPage`    turns a stored `Candidate` into refs, using the same role
 *                     and name rules the walker uses, so `snapshot` and `locate`
 *                     cannot disagree about what a "button named Sign In" is.
 *   `actionabilityOf` reports the visibility, enabledness and box a step's
 *                     actionability wait is decided from (LLD §7.3).
 *
 * Refs: LLD §2.2, §7.3, REQ-SURF-4, REQ-ADP-4.
 */

/** The shape `walkDocument` returns for one node. Mirrors `SnapshotNode`. */
export interface RawNode {
  ref: string;
  role: string;
  name?: string;
  value?: string;
  description?: string;
  states: string[];
  box?: [number, number, number, number];
  depth: number;
  parent?: string;
  native?: Record<string, string>;
}

/** The shape `describeElement` returns. Mirrors `ElementDescription` minus `ref`. */
export interface RawDescription {
  role: string;
  name?: string;
  value?: string;
  tag: string;
  attrs: Record<string, string>;
  text: string;
  neighbours: { before: string[]; after: string[] };
  rolePath: string[];
  box: [number, number, number, number];
  index: number;
  states: string[];
  native?: Record<string, string>;
}

/**
 * The in-page array `walkDocument` fills. Reset by every walk and lost on
 * navigation, which is what "stable within the snapshot" means (LLD §2.2).
 */
export const REGISTRY = "__svatahRefs__";

/**
 * The in-page array `locate()` fills, for refs minted from a stored candidate.
 *
 * Separate from `REGISTRY` on purpose. A caller that resolves a binding and then
 * takes a snapshot before acting would otherwise find its reference silently
 * pointing at whatever the walk put at that index — the resolver does exactly
 * that, and the bug it produces is an action on the wrong element rather than an
 * error. Handles live until the session navigates.
 */
export const HANDLES = "__svatahHandles__";

/* ────────────────────────────────────────────────────────────────────────────
 * walkDocument — evaluated in the page.
 * ──────────────────────────────────────────────────────────────────────────── */

export function walkDocument(options: {
  registry: string;
  maxNodes: number;
  interactiveOnly: boolean;
  testIdAttributes: string[];
  /** `config.bindings.ignoreAttributes` — never reported in `native` (LLD §3.5). */
  ignoreAttributes: string[];
  /** Index into the registry of a previous walk, to snapshot one subtree. */
  rootIndex: number | null;
}): RawNode[] {
  /* ── role mapping (HTML → ARIA), the subset REQ-SURF-4 normalises on ────── */
  function roleOf(el: Element): string | null {
    const explicit = el.getAttribute("role");
    if (explicit !== null && explicit.trim() !== "") return explicit.trim().split(/\s+/)[0]!;
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case "a":
        return el.hasAttribute("href") ? "link" : null;
      case "button":
        return "button";
      case "input": {
        const type = (el.getAttribute("type") ?? "text").toLowerCase();
        if (type === "button" || type === "submit" || type === "reset" || type === "image")
          return "button";
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "range") return "slider";
        if (type === "number") return "spinbutton";
        if (type === "file") return "button";
        if (type === "hidden") return null;
        // A text or search input bound to a <datalist> is a combobox in ARIA in
        // HTML, which is what an accessibility tree reports.
        const hasList = el.hasAttribute("list");
        if (type === "search") return hasList ? "combobox" : "searchbox";
        return hasList ? "combobox" : "textbox";
      }
      case "select":
        return el.hasAttribute("multiple") || Number(el.getAttribute("size") ?? "0") > 1
          ? "listbox"
          : "combobox";
      case "option":
        return "option";
      case "textarea":
        return "textbox";
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return "heading";
      case "img":
        return el.getAttribute("alt") === "" ? null : "img";
      case "nav":
        return "navigation";
      case "main":
        return "main";
      case "aside":
        return "complementary";
      case "header":
        return "banner";
      case "footer":
        return "contentinfo";
      case "form":
        // ARIA in HTML: a <form> is a `form` landmark only when it has an
        // accessible name; without one it is generic, which is what both
        // Playwright's snapshot and a screen reader report.
        return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")
          ? "form"
          : null;
      case "section":
        return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")
          ? "region"
          : null;
      case "dialog":
        return "dialog";
      case "table":
        return "table";
      case "tr":
        return "row";
      case "td":
        return "cell";
      case "th":
        return "columnheader";
      case "ul":
      case "ol":
        return "list";
      case "li":
        return "listitem";
      case "iframe":
        return "iframe";
      case "canvas":
        return "canvas";
      case "output":
        return "status";
      case "label":
        return null;
      case "p":
      case "span":
      case "div":
      case "strong":
      case "em":
      case "code":
        return null;
      default:
        return null;
    }
  }

  /** A compact accessible-name computation: the rules the sample pages exercise. */
  function nameOf(el: Element): string {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy !== null) {
      const parts: string[] = [];
      for (const id of labelledBy.split(/\s+/)) {
        const target = el.ownerDocument.getElementById(id);
        if (target !== null) parts.push((target.textContent ?? "").replace(/\s+/g, " ").trim());
      }
      const joined = parts.filter((p) => p !== "").join(" ");
      if (joined !== "") return joined;
    }
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel !== null && ariaLabel.trim() !== "") return ariaLabel.trim();

    const tag = el.tagName.toLowerCase();

    if (tag === "input" || tag === "select" || tag === "textarea") {
      const id = el.getAttribute("id");
      if (id !== null && id !== "") {
        const label = el.ownerDocument.querySelector(
          `label[for="${id.replace(/"/g, '\\"')}"]`,
        );
        if (label !== null) return (label.textContent ?? "").replace(/\s+/g, " ").trim();
      }
      const wrapping = el.closest("label");
      if (wrapping !== null) return (wrapping.textContent ?? "").replace(/\s+/g, " ").trim();
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      if (tag === "input" && (type === "submit" || type === "button" || type === "reset")) {
        const value = el.getAttribute("value");
        if (value !== null && value !== "") return value;
      }
      const placeholder = el.getAttribute("placeholder");
      if (placeholder !== null && placeholder !== "") return placeholder;
      const title = el.getAttribute("title");
      if (title !== null && title !== "") return title;
      return "";
    }

    if (tag === "img") return el.getAttribute("alt") ?? "";
    if (tag === "iframe") return el.getAttribute("title") ?? "";

    // Only roles that support "name from content" take their text as their name.
    // A landmark or a region does not, or every container would be named with
    // the whole page (ARIA: accname computation, step 2F).
    const NAME_FROM_CONTENT = [
      "button",
      "link",
      "heading",
      "option",
      "cell",
      "columnheader",
      "rowheader",
      "listitem",
      "menuitem",
      "tab",
      "checkbox",
      "radio",
      "switch",
      "status",
      "tooltip",
    ];
    const role = roleOf(el);
    if (role !== null && NAME_FROM_CONTENT.includes(role)) {
      const text = visibleText(el);
      if (text !== "") return text;
    }
    return el.getAttribute("title") ?? "";
  }

  /** Text content with hidden subtrees left out, as an accessible name is. */
  function visibleText(el: Element): string {
    let out = "";
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) {
        out += child.nodeValue ?? "";
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") continue;
      out += ` ${visibleText(element)}`;
    }
    return out.replace(/\s+/g, " ").trim();
  }

  function valueOf(el: Element): string | undefined {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      // A submit or button input's `value` *is* its label, and it is already the
      // accessible name; repeating it as a value would say the same thing twice.
      if (
        type === "checkbox" ||
        type === "radio" ||
        type === "submit" ||
        type === "button" ||
        type === "reset" ||
        type === "image" ||
        type === "file"
      ) {
        return undefined;
      }
      return (el as HTMLInputElement).value;
    }
    if (tag === "textarea") return (el as HTMLTextAreaElement).value;
    if (tag === "select") {
      const select = el as HTMLSelectElement;
      const selected = Array.from(select.selectedOptions).map((o) => o.value);
      return selected.join(", ");
    }
    if (tag === "output") return (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return undefined;
  }

  function statesOf(el: Element): string[] {
    const states: string[] = [];
    const tag = el.tagName.toLowerCase();
    const style = el.ownerDocument.defaultView!.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const hidden =
      el.hasAttribute("hidden") ||
      el.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      (rect.width === 0 && rect.height === 0);
    if (hidden) states.push("hidden");

    if ("disabled" in el && (el as HTMLInputElement).disabled) states.push("disabled");
    else if (el.getAttribute("aria-disabled") === "true") states.push("disabled");

    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      if (type === "checkbox" || type === "radio") {
        states.push((el as HTMLInputElement).checked ? "checked" : "unchecked");
      }
    } else if (el.getAttribute("aria-checked") === "true") states.push("checked");
    else if (el.getAttribute("aria-checked") === "false") states.push("unchecked");

    if (tag === "option" && (el as HTMLOptionElement).selected) states.push("selected");
    if (el.getAttribute("aria-selected") === "true") states.push("selected");

    const expanded = el.getAttribute("aria-expanded");
    if (expanded === "true") states.push("expanded");
    if (expanded === "false") states.push("collapsed");

    if (el.ownerDocument.activeElement === el) states.push("focused");

    if (el.hasAttribute("required") || el.getAttribute("aria-required") === "true")
      states.push("required");
    if (el.hasAttribute("readonly") || el.getAttribute("aria-readonly") === "true")
      states.push("readonly");

    return states;
  }

  function nativeOf(el: Element, testIdAttributes: string[]): Record<string, string> | undefined {
    const ignored = new Set(options.ignoreAttributes.map((a) => a.toLowerCase()));
    const native: Record<string, string> = {};
    for (const attribute of [
      ...testIdAttributes,
      "id",
      "name",
      "type",
      "placeholder",
      "alt",
      "title",
      "href",
      "value",
    ]) {
      if (ignored.has(attribute.toLowerCase())) continue;
      const value = el.getAttribute(attribute);
      if (value !== null && value !== "") native[attribute] = value;
    }
    const tag = el.tagName.toLowerCase();
    native["tag"] = tag;
    if (tag.startsWith("h") && tag.length === 2 && tag >= "h1" && tag <= "h6") {
      native["level"] = tag.slice(1);
    }
    return Object.keys(native).length > 0 ? native : undefined;
  }

  /** Interactive in the sense that acting on it is meaningful. */
  function isInteractive(role: string): boolean {
    return [
      "button",
      "link",
      "textbox",
      "searchbox",
      "spinbutton",
      "checkbox",
      "radio",
      "combobox",
      "listbox",
      "option",
      "slider",
      "menuitem",
      "tab",
      "switch",
    ].includes(role);
  }

  const doc = document;
  const win = doc.defaultView as unknown as Record<string, unknown>;

  // A rooted walk reads the previous registry before replacing it, so
  // `snapshot({ root })` can narrow to a subtree of the snapshot just taken.
  const previous = (win[options.registry] as Element[] | undefined) ?? [];
  const root: Element =
    options.rootIndex === null ? doc.body : (previous[options.rootIndex] ?? doc.body);

  const registry: Element[] = [];
  win[options.registry] = registry;

  const nodes: RawNode[] = [];

  /** Depth-first, document order. `depth` counts only ancestors that are nodes. */
  function visit(el: Element, depth: number, parentRef: string | undefined): void {
    if (nodes.length >= options.maxNodes) return;

    const role = roleOf(el);
    let ref: string | undefined;
    let nextDepth = depth;
    let nextParent = parentRef;

    if (role !== null && (!options.interactiveOnly || isInteractive(role))) {
      const index = registry.length;
      registry.push(el);
      ref = `r${index}`;
      const rect = el.getBoundingClientRect();
      const name = nameOf(el);
      const value = valueOf(el);
      const description = el.getAttribute("aria-description") ?? undefined;
      const node: RawNode = {
        ref,
        role,
        states: statesOf(el),
        box: [
          Math.round(rect.x * 100) / 100,
          Math.round(rect.y * 100) / 100,
          Math.round(rect.width * 100) / 100,
          Math.round(rect.height * 100) / 100,
        ],
        depth,
        native: nativeOf(el, options.testIdAttributes),
      };
      if (name !== "") node.name = name;
      if (value !== undefined && value !== "") node.value = value;
      if (description !== undefined && description !== "") node.description = description;
      if (parentRef !== undefined) node.parent = parentRef;
      nodes.push(node);
      nextDepth = depth + 1;
      nextParent = ref;
    }

    for (const child of Array.from(el.children)) visit(child, nextDepth, nextParent);
  }

  visit(root, 0, undefined);
  return nodes;
}

/* ────────────────────────────────────────────────────────────────────────────
 * describeElement — evaluated in the page against one element.
 * ──────────────────────────────────────────────────────────────────────────── */

export function describeElement(
  el: Element,
  options: { testIdAttributes: string[]; neighbourCount: number; ignoreAttributes: string[] },
): RawDescription {
  /*
   * `config.bindings.ignoreAttributes` (LLD §3.5, Draft 2.3) is enforced here,
   * at the point the surface first sees the DOM, rather than above it: an
   * attribute stripped before `describe()` returns cannot reach a candidate, a
   * fingerprint, a score, or a `native` extra, whatever any caller does next.
   * The healing eval's ground-truth label is the reason the option exists, and a
   * label that leaked into synthesis would be the best candidate on the page.
   */
  const ignored = new Set(options.ignoreAttributes.map((a) => a.toLowerCase()));
  function roleOf(node: Element): string {
    const explicit = node.getAttribute("role");
    if (explicit !== null && explicit.trim() !== "") return explicit.trim().split(/\s+/)[0]!;
    const tag = node.tagName.toLowerCase();
    const map: Record<string, string> = {
      button: "button",
      select: "combobox",
      option: "option",
      textarea: "textbox",
      h1: "heading",
      h2: "heading",
      h3: "heading",
      h4: "heading",
      h5: "heading",
      h6: "heading",
      nav: "navigation",
      main: "main",
      aside: "complementary",
      header: "banner",
      footer: "contentinfo",
      form: "form",
      dialog: "dialog",
      table: "table",
      tr: "row",
      td: "cell",
      th: "columnheader",
      ul: "list",
      ol: "list",
      li: "listitem",
      iframe: "iframe",
      canvas: "canvas",
      output: "status",
      img: "img",
    };
    if (tag === "a") return node.hasAttribute("href") ? "link" : "generic";
    if (tag === "select") {
      return node.hasAttribute("multiple") || Number(node.getAttribute("size") ?? "0") > 1
        ? "listbox"
        : "combobox";
    }
    if (tag === "input") {
      const type = (node.getAttribute("type") ?? "text").toLowerCase();
      if (type === "button" || type === "submit" || type === "reset" || type === "image")
        return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "file") return "button";
      const hasList = node.hasAttribute("list");
      if (type === "search") return hasList ? "combobox" : "searchbox";
      return hasList ? "combobox" : "textbox";
    }
    // A <form> or <section> is a landmark only when it has an accessible name.
    if (tag === "form" || tag === "section") {
      const named =
        node.hasAttribute("aria-label") || node.hasAttribute("aria-labelledby");
      if (!named) return "generic";
      return tag === "form" ? "form" : "region";
    }
    return map[tag] ?? "generic";
  }

  function normalise(text: string | null | undefined): string {
    return (text ?? "").replace(/\s+/g, " ").trim();
  }

  function nameOf(node: Element): string {
    const labelledBy = node.getAttribute("aria-labelledby");
    if (labelledBy !== null) {
      const parts: string[] = [];
      for (const id of labelledBy.split(/\s+/)) {
        const target = node.ownerDocument.getElementById(id);
        if (target !== null) parts.push(normalise(target.textContent));
      }
      const joined = parts.filter((p) => p !== "").join(" ");
      if (joined !== "") return joined;
    }
    const ariaLabel = node.getAttribute("aria-label");
    if (ariaLabel !== null && ariaLabel.trim() !== "") return ariaLabel.trim();

    const tag = node.tagName.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") {
      const id = node.getAttribute("id");
      if (id !== null && id !== "") {
        const label = node.ownerDocument.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
        if (label !== null) return normalise(label.textContent);
      }
      const wrapping = node.closest("label");
      if (wrapping !== null) return normalise(wrapping.textContent);
      const type = (node.getAttribute("type") ?? "").toLowerCase();
      if (tag === "input" && (type === "submit" || type === "button" || type === "reset")) {
        const value = node.getAttribute("value");
        if (value !== null && value !== "") return value;
      }
      return node.getAttribute("placeholder") ?? node.getAttribute("title") ?? "";
    }
    if (tag === "img") return node.getAttribute("alt") ?? "";
    if (tag === "iframe") return node.getAttribute("title") ?? "";
    const NAME_FROM_CONTENT = [
      "button",
      "link",
      "heading",
      "option",
      "cell",
      "columnheader",
      "rowheader",
      "listitem",
      "menuitem",
      "tab",
      "checkbox",
      "radio",
      "switch",
      "status",
      "tooltip",
    ];
    if (NAME_FROM_CONTENT.includes(roleOf(node))) {
      const text = normalise(node.textContent);
      if (text !== "") return text;
    }
    return node.getAttribute("title") ?? "";
  }

  const tag = el.tagName.toLowerCase();

  const attrs: Record<string, string> = {};
  for (const attribute of Array.from(el.attributes)) {
    if (ignored.has(attribute.name.toLowerCase())) continue;
    attrs[attribute.name] = attribute.value;
  }

  let own = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) own += child.nodeValue ?? "";
  }
  own = normalise(own);
  if (own === "") own = normalise(el.textContent);

  /* Neighbour text: the nearest preceding and following siblings' text, walking
     up while a level has nothing to say (LLD §3.3). */
  const before: string[] = [];
  const after: string[] = [];
  let cursor: Element | null = el;
  while (cursor !== null && (before.length < options.neighbourCount || after.length < options.neighbourCount)) {
    let previous = cursor.previousElementSibling;
    while (previous !== null && before.length < options.neighbourCount) {
      const text = normalise(previous.textContent);
      if (text !== "") before.unshift(text);
      previous = previous.previousElementSibling;
    }
    let next = cursor.nextElementSibling;
    while (next !== null && after.length < options.neighbourCount) {
      const text = normalise(next.textContent);
      if (text !== "") after.push(text);
      next = next.nextElementSibling;
    }
    cursor = cursor.parentElement;
    if (cursor === null || cursor.tagName.toLowerCase() === "body") break;
  }

  const rolePath: string[] = [];
  let ancestor: Element | null = el.parentElement;
  while (ancestor !== null && ancestor.tagName.toLowerCase() !== "html") {
    const role = roleOf(ancestor);
    if (role !== "generic") rolePath.unshift(role);
    ancestor = ancestor.parentElement;
  }

  const role = roleOf(el);
  let index = 0;
  const parent = el.parentElement;
  if (parent !== null) {
    for (const sibling of Array.from(parent.children)) {
      if (sibling === el) break;
      if (roleOf(sibling) === role) index += 1;
    }
  }

  const states: string[] = [];
  const style = el.ownerDocument.defaultView!.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  if (
    el.hasAttribute("hidden") ||
    el.getAttribute("aria-hidden") === "true" ||
    style.display === "none" ||
    style.visibility === "hidden" ||
    (rect.width === 0 && rect.height === 0)
  )
    states.push("hidden");
  if ("disabled" in el && (el as HTMLInputElement).disabled) states.push("disabled");
  if (tag === "input") {
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (type === "checkbox" || type === "radio")
      states.push((el as HTMLInputElement).checked ? "checked" : "unchecked");
  }
  if (tag === "option" && (el as HTMLOptionElement).selected) states.push("selected");
  const expanded = el.getAttribute("aria-expanded");
  if (expanded === "true") states.push("expanded");
  if (expanded === "false") states.push("collapsed");
  if (el.ownerDocument.activeElement === el) states.push("focused");
  if (el.hasAttribute("required")) states.push("required");
  if (el.hasAttribute("readonly")) states.push("readonly");

  const native: Record<string, string> = { tag };
  for (const attribute of options.testIdAttributes) {
    if (ignored.has(attribute.toLowerCase())) continue;
    const value = el.getAttribute(attribute);
    if (value !== null && value !== "") native[attribute] = value;
  }

  /* ── stable paths for candidate synthesis ──────────────────────────────────
   *
   * `native` is documented as "adapter-specific extras … never used above the
   * surface except by synthesis" (LLD §2.2), and this is that use. A CSS path
   * and a relative XPath need the ancestor chain, which only the adapter can
   * see; synthesis above the surface then ranks and filters them like any other
   * candidate without knowing what a DOM is.
   *
   * Both are anchored at the nearest ancestor that has a stable identity, so
   * they say "the second row of the bookings table" rather than
   * "body > div:nth-child(3) > div > div > table > tbody > tr:nth-child(2)":
   * the second is longer and breaks the moment anything above it moves.
   */
  const generated = (value: string): boolean =>
    // React's useId (`:r3:`), Ember (`ember42`), MUI (`mui-1234`), Radix
    // (`radix-:r1:`), styled-components (`sc-hAxLzW`), CSS-modules hashes
    // (`css-1x2y3z`, `_3fF4aQ`), and anything that is mostly hex.
    /^:r[0-9a-z]+:$/i.test(value) ||
    /^ember\d+$/i.test(value) ||
    /^(mui|radix|headlessui|reach|aria)[-_][:a-z0-9]+$/i.test(value) ||
    /^sc-[a-zA-Z]{6,}$/.test(value) ||
    /^(css|jsx|emotion)-[a-z0-9]{5,}$/i.test(value) ||
    /^_[a-zA-Z0-9]{5,}$/.test(value) ||
    /^[0-9a-f]{8,}$/i.test(value) ||
    /\d{5,}$/.test(value);

  const cssEscape = (value: string): string => value.replace(/(["\\])/g, "\\$1");

  /** A selector for one element that does not depend on where it sits. */
  const ownSelector = (node: Element): string | null => {
    for (const attribute of options.testIdAttributes) {
      if (ignored.has(attribute.toLowerCase())) continue;
      const value = node.getAttribute(attribute);
      if (value !== null && value !== "" && !generated(value)) {
        return `[${attribute}="${cssEscape(value)}"]`;
      }
    }
    const id = node.getAttribute("id");
    if (id !== null && id !== "" && !generated(id)) return `[id="${cssEscape(id)}"]`;
    const name = node.getAttribute("name");
    if (name !== null && name !== "") {
      return `${node.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
    }
    return null;
  };

  /** The element's position among siblings of the same tag, 1-based. */
  const nthOfType = (node: Element): number => {
    let n = 1;
    let sibling = node.previousElementSibling;
    while (sibling !== null) {
      if (sibling.tagName === node.tagName) n += 1;
      sibling = sibling.previousElementSibling;
    }
    return n;
  };

  const stableClasses = (node: Element): string[] =>
    Array.from(node.classList).filter((c) => !generated(c) && c.length > 1);

  /** Walk up until something has a stable identity, then come back down. */
  const buildPaths = (node: Element): { css: string; xpath: string } => {
    const cssParts: string[] = [];
    const xpathParts: string[] = [];
    let cursor: Element | null = node;
    let depth = 0;

    while (cursor !== null && depth < 8) {
      const anchor = ownSelector(cursor);
      const tag = cursor.tagName.toLowerCase();

      if (anchor !== null) {
        cssParts.unshift(anchor);
        const attributeMatch = /^\[?([a-z-]+)?\[?([a-zA-Z-]+)="(.*)"\]$/.exec(anchor);
        void attributeMatch;
        const id = cursor.getAttribute("id");
        const testId = options.testIdAttributes
          .map((a) => [a, cursor!.getAttribute(a)] as const)
          .find(([, v]) => v !== null && v !== "" && !generated(v));
        if (testId !== undefined) {
          xpathParts.unshift(`//*[@${testId[0]}='${testId[1]}']`);
        } else if (id !== null && id !== "" && !generated(id)) {
          xpathParts.unshift(`//*[@id='${id}']`);
        } else {
          xpathParts.unshift(`//${tag}[@name='${cursor.getAttribute("name") ?? ""}']`);
        }
        break;
      }

      const classes = stableClasses(cursor);
      const own =
        classes.length > 0
          ? `${tag}.${classes.slice(0, 2).join(".")}`
          : `${tag}:nth-of-type(${nthOfType(cursor)})`;
      cssParts.unshift(own);
      xpathParts.unshift(`${tag}[${nthOfType(cursor)}]`);

      cursor = cursor.parentElement;
      depth += 1;
      if (cursor !== null && cursor.tagName.toLowerCase() === "body") {
        cssParts.unshift("body");
        xpathParts.unshift("//body");
        break;
      }
    }

    const css = cssParts.join(" > ");
    const first = xpathParts[0] ?? "";
    const xpath = first.startsWith("//")
      ? [first, ...xpathParts.slice(1)].join("/")
      : `//${xpathParts.join("/")}`;
    return { css, xpath };
  };

  const paths = buildPaths(el);
  if (paths.css !== "") native["cssPath"] = paths.css;
  if (paths.xpath !== "") native["xpath"] = paths.xpath;
  if (attrs["id"] !== undefined && generated(attrs["id"])) native["idIsGenerated"] = "true";
  const generatedClasses = Array.from(el.classList).filter((c) => generated(c));
  if (generatedClasses.length > 0) native["generatedClasses"] = generatedClasses.join(" ");
  const stable = stableClasses(el);
  if (stable.length > 0) native["stableClasses"] = stable.join(" ");

  let value: string | undefined;
  const inputType = (el.getAttribute("type") ?? "").toLowerCase();
  const buttonLike = ["submit", "button", "reset", "image", "file"].includes(inputType);
  if ((tag === "input" && !buttonLike) || tag === "textarea")
    value = (el as HTMLInputElement).value;
  else if (tag === "select")
    value = Array.from((el as HTMLSelectElement).selectedOptions)
      .map((o) => o.value)
      .join(", ");

  const description: RawDescription = {
    role,
    tag,
    attrs,
    text: own,
    neighbours: { before, after },
    rolePath,
    box: [
      Math.round(rect.x * 100) / 100,
      Math.round(rect.y * 100) / 100,
      Math.round(rect.width * 100) / 100,
      Math.round(rect.height * 100) / 100,
    ],
    index,
    states,
    native,
  };
  const name = nameOf(el);
  if (name !== "") description.name = name;
  if (value !== undefined && value !== "") description.value = value;
  return description;
}

/* ────────────────────────────────────────────────────────────────────────────
 * locateInPage — evaluated in the page, turns a stored Candidate into refs.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The subset of `Candidate` a web adapter can honour, flattened for the wire. */
export interface RawCandidate {
  by: string;
  role?: string;
  name?: string;
  exact?: boolean;
  value?: string;
  attribute?: string;
  nth?: number;
}

/**
 * `Candidate` → indices into the handle registry (LLD §6.3, REQ-RUN-5).
 *
 * Every candidate kind is answered by the *same* role and accessible-name rules
 * `walkDocument` uses, rather than by a protocol-level locator. BiDi does offer
 * `browsingContext.locateNodes` with `css`, `xpath` and `accessibility`
 * locators, and using it for `role` would have been less code — but then the
 * roles a snapshot reports and the roles a candidate matches would come from two
 * different computations, and a binding recorded from a snapshot could fail to
 * resolve against the page it was recorded on. One computation, one answer.
 *
 * Returns indices rather than nodes because BiDi serialises a returned element
 * as a whole DOM description; an array of matches would be kilobytes of JSON per
 * call. The adapter turns each index into an `hN` reference.
 */
export function locateInPage(options: {
  handles: string;
  candidate: RawCandidate;
  testIdAttributes: string[];
}): number[] {
  const { candidate } = options;
  const doc = document;
  const win = doc.defaultView as unknown as Record<string, unknown>;
  const handles = ((win[options.handles] as Element[] | undefined) ??= []);

  const normalise = (text: string | null | undefined): string =>
    (text ?? "").replace(/\s+/g, " ").trim();

  function roleOf(el: Element): string {
    const explicit = el.getAttribute("role");
    if (explicit !== null && explicit.trim() !== "") return explicit.trim().split(/\s+/)[0]!;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : "generic";
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (type === "button" || type === "submit" || type === "reset" || type === "image")
        return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "file") return "button";
      if (type === "hidden") return "generic";
      const hasList = el.hasAttribute("list");
      if (type === "search") return hasList ? "combobox" : "searchbox";
      return hasList ? "combobox" : "textbox";
    }
    if (tag === "select") {
      return el.hasAttribute("multiple") || Number(el.getAttribute("size") ?? "0") > 1
        ? "listbox"
        : "combobox";
    }
    if (tag === "img") return el.getAttribute("alt") === "" ? "generic" : "img";
    if (tag === "form" || tag === "section") {
      const named = el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby");
      if (!named) return "generic";
      return tag === "form" ? "form" : "region";
    }
    const map: Record<string, string> = {
      button: "button",
      option: "option",
      textarea: "textbox",
      h1: "heading",
      h2: "heading",
      h3: "heading",
      h4: "heading",
      h5: "heading",
      h6: "heading",
      nav: "navigation",
      main: "main",
      aside: "complementary",
      header: "banner",
      footer: "contentinfo",
      dialog: "dialog",
      table: "table",
      tr: "row",
      td: "cell",
      th: "columnheader",
      ul: "list",
      ol: "list",
      li: "listitem",
      iframe: "iframe",
      canvas: "canvas",
      output: "status",
    };
    return map[tag] ?? "generic";
  }

  function visibleText(el: Element): string {
    let out = "";
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) {
        out += child.nodeValue ?? "";
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") continue;
      out += ` ${visibleText(element)}`;
    }
    return out.replace(/\s+/g, " ").trim();
  }

  function nameOf(el: Element): string {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy !== null) {
      const parts: string[] = [];
      for (const id of labelledBy.split(/\s+/)) {
        const target = el.ownerDocument.getElementById(id);
        if (target !== null) parts.push(normalise(target.textContent));
      }
      const joined = parts.filter((p) => p !== "").join(" ");
      if (joined !== "") return joined;
    }
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel !== null && ariaLabel.trim() !== "") return ariaLabel.trim();

    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") {
      const id = el.getAttribute("id");
      if (id !== null && id !== "") {
        const label = el.ownerDocument.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
        if (label !== null) return normalise(label.textContent);
      }
      const wrapping = el.closest("label");
      if (wrapping !== null) return normalise(wrapping.textContent);
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      if (tag === "input" && (type === "submit" || type === "button" || type === "reset")) {
        const value = el.getAttribute("value");
        if (value !== null && value !== "") return value;
      }
      const placeholder = el.getAttribute("placeholder");
      if (placeholder !== null && placeholder !== "") return placeholder;
      return el.getAttribute("title") ?? "";
    }
    if (tag === "img") return el.getAttribute("alt") ?? "";
    if (tag === "iframe") return el.getAttribute("title") ?? "";

    const NAME_FROM_CONTENT = [
      "button",
      "link",
      "heading",
      "option",
      "cell",
      "columnheader",
      "rowheader",
      "listitem",
      "menuitem",
      "tab",
      "checkbox",
      "radio",
      "switch",
      "status",
      "tooltip",
    ];
    if (NAME_FROM_CONTENT.includes(roleOf(el))) {
      const text = visibleText(el);
      if (text !== "") return text;
    }
    return el.getAttribute("title") ?? "";
  }

  /** The label text associated with a form control, for the `label` kind. */
  function labelOf(el: Element): string {
    const id = el.getAttribute("id");
    if (id !== null && id !== "") {
      const label = el.ownerDocument.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
      if (label !== null) return normalise(label.textContent);
    }
    const wrapping = el.closest("label");
    if (wrapping !== null) return normalise(wrapping.textContent);
    const ariaLabel = el.getAttribute("aria-label");
    return ariaLabel === null ? "" : ariaLabel.trim();
  }

  const exact = candidate.exact ?? true;
  const matchesText = (actual: string, wanted: string | undefined): boolean => {
    if (wanted === undefined) return true;
    return exact ? actual === wanted : actual.toLowerCase().includes(wanted.toLowerCase());
  };

  const all = (): Element[] => Array.from(doc.querySelectorAll("*"));
  const escape = (value: string): string => value.replace(/(["\\])/g, "\\$1");

  let found: Element[];
  switch (candidate.by) {
    case "role": {
      const role = candidate.role;
      if (role === undefined) return [];
      found = all().filter((el) => roleOf(el) === role && matchesText(nameOf(el), candidate.name));
      break;
    }
    case "label":
      found = all().filter(
        (el) =>
          ["input", "select", "textarea", "button"].includes(el.tagName.toLowerCase()) &&
          matchesText(labelOf(el), candidate.value),
      );
      break;
    case "placeholder":
      found = all().filter((el) => matchesText(el.getAttribute("placeholder") ?? "", candidate.value));
      break;
    case "testid": {
      const attribute = candidate.attribute ?? options.testIdAttributes[0] ?? "data-testid";
      found =
        candidate.value === undefined
          ? []
          : Array.from(doc.querySelectorAll(`[${attribute}="${escape(candidate.value)}"]`));
      break;
    }
    case "text":
      /*
       * The *deepest* element whose text matches, matching how `getByText`
       * behaves. Without that, "Sign in" on a link inside a nav inside a body
       * matches all three and the resolver's exactly-one rule rejects a
       * candidate that names exactly one thing to a reader.
       */
      found = all().filter(
        (el) =>
          matchesText(visibleText(el), candidate.value) &&
          !Array.from(el.children).some((child) => matchesText(visibleText(child), candidate.value)),
      );
      break;
    case "altText":
      found = all().filter((el) => matchesText(el.getAttribute("alt") ?? "", candidate.value));
      break;
    case "title":
      found = all().filter((el) => matchesText(el.getAttribute("title") ?? "", candidate.value));
      break;
    case "css":
      found = candidate.value === undefined ? [] : Array.from(doc.querySelectorAll(candidate.value));
      break;
    case "xpath": {
      if (candidate.value === undefined) {
        found = [];
        break;
      }
      const result = doc.evaluate(
        candidate.value,
        doc,
        null,
        7 /* ORDERED_NODE_SNAPSHOT_TYPE */,
        null,
      );
      const nodes: Element[] = [];
      for (let i = 0; i < result.snapshotLength; i += 1) {
        const node = result.snapshotItem(i);
        if (node !== null && node.nodeType === 1) nodes.push(node as Element);
      }
      found = nodes;
      break;
    }
    case "id":
      found =
        candidate.value === undefined
          ? []
          : Array.from(doc.querySelectorAll(`[id="${escape(candidate.value)}"]`));
      break;
    case "name":
      found =
        candidate.value === undefined
          ? []
          : Array.from(doc.querySelectorAll(`[name="${escape(candidate.value)}"]`));
      break;
    case "coords": {
      /*
       * A point, not an element (LLD §7.1). It is how the canvas-only control of
       * LLD §16 is reachable at all: it has no accessibility node, so nothing
       * else can name it.
       */
      const parts = (candidate.value ?? "").split(",").map((p) => Number(p.trim()));
      if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return [];
      // Viewport coordinates, the same ones `describe()` reports: a `coords`
      // candidate is recorded from a box read at the moment of recording and is
      // resolved against a box read the same way (LLD §7.1).
      const at = doc.elementFromPoint(parts[0]!, parts[1]!);
      found = at === null ? [] : [at];
      break;
    }
    default:
      return [];
  }

  const chosen = candidate.nth === undefined ? found : found.slice(candidate.nth, candidate.nth + 1);
  return chosen.map((el) => {
    const index = handles.length;
    handles.push(el);
    return index;
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * actionabilityOf — evaluated in the page, one element at a time.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface Actionability {
  /** The element is still in the document. */
  attached: boolean;
  /** Rendered, not `display: none`, not `visibility: hidden`, non-zero box. */
  visible: boolean;
  /** Not `disabled`, not `aria-disabled`. */
  enabled: boolean;
  /** Viewport coordinates: `[x, y, width, height]`. */
  box: [number, number, number, number];
  /** The element the box's centre actually hits, as a rough occlusion check. */
  hitsSelf: boolean;
}

/**
 * The actionability facts for one element (LLD §7.3).
 *
 * > Actionability: implemented in the adapter: wait for
 * > `visible && enabled && stable(box unchanged over two frames)` before `act`,
 * > with the configured timeout.
 *
 * The waiting and the two-frame comparison are the adapter's, in Node; this only
 * reports what is true right now, because the alternative — a polling loop
 * inside the page — would hold the JavaScript thread the page needs in order to
 * become actionable.
 */
export function actionabilityOf(options: { handles: string; registry: string; index: number; from: "handle" | "registry" }): Actionability | null {
  const win = document.defaultView as unknown as Record<string, unknown>;
  const source = (win[options.from === "handle" ? options.handles : options.registry] ??
    []) as Element[];
  const el = source[options.index];
  if (el === undefined) return null;

  const attached = el.isConnected;
  const rect = el.getBoundingClientRect();
  const style = document.defaultView!.getComputedStyle(el);
  const visible =
    attached &&
    !el.hasAttribute("hidden") &&
    el.getAttribute("aria-hidden") !== "true" &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0 &&
    rect.width > 0 &&
    rect.height > 0;
  const enabled =
    !("disabled" in el && (el as HTMLInputElement).disabled) &&
    el.getAttribute("aria-disabled") !== "true";

  const centre = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  return {
    attached,
    visible,
    enabled,
    box: [
      Math.round(rect.x * 100) / 100,
      Math.round(rect.y * 100) / 100,
      Math.round(rect.width * 100) / 100,
      Math.round(rect.height * 100) / 100,
    ],
    // `contains` rather than identity: a click on a button lands on the span
    // inside it, and refusing that would make every styled control unclickable.
    hitsSelf: centre !== null && (centre === el || el.contains(centre) || centre.contains(el)),
  };
}
