/**
 * The scripts injected into the page (T1.1).
 *
 * Playwright serialises a function to its source before evaluating it, so each
 * function here must be self-contained: no imports, no references to anything
 * outside its own body. That is why the role table and the accessible-name rules
 * are repeated inside each one rather than shared — they run in the browser, not
 * in Node.
 *
 * Two functions are injected:
 *
 *   `walkDocument`   builds the normalised node list of LLD §2.2 and registers
 *                    each element in an in-page array, so a `Ref` can be turned
 *                    back into the element it came from.
 *   `describeElement` returns everything candidate synthesis and fingerprinting
 *                    read from one element (LLD §3.3, §7.4).
 *
 * Refs: LLD §2.2, §7.1, REQ-SURF-4.
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
 * The in-page registry name. `walkDocument` and `locate` push elements onto it;
 * `refToElement` reads it back. It is reset by every `walkDocument` call and lost
 * on navigation, which matches `Ref` being "stable within the snapshot".
 */
export const REGISTRY = "__svatahRefs__";

/* ────────────────────────────────────────────────────────────────────────────
 * walkDocument — evaluated in the page.
 * ──────────────────────────────────────────────────────────────────────────── */

export function walkDocument(options: {
  registry: string;
  maxNodes: number;
  interactiveOnly: boolean;
  testIdAttributes: string[];
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
    const native: Record<string, string> = {};
    for (const attribute of testIdAttributes) {
      const value = el.getAttribute(attribute);
      if (value !== null && value !== "") native[attribute] = value;
    }
    for (const attribute of ["id", "name", "type", "placeholder", "alt", "title", "href", "value"]) {
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
  options: { testIdAttributes: string[]; neighbourCount: number },
): RawDescription {
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
  for (const attribute of Array.from(el.attributes)) attrs[attribute.name] = attribute.value;

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
