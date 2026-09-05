import { parse, type HTMLElement } from "node-html-parser";

/**
 * A "binding-relevant" description of every element on a page.
 *
 * The fields are exactly what candidate synthesis and fingerprinting read
 * (LLD §3.3): the tag and identity attributes candidates are built from, the
 * accessible-name sources, the element's own text, its position among siblings,
 * and its ancestor path. A variant is only useful as a healing case if it changes
 * at least one of these for at least one element — which is what
 * `variant-diff.test.ts` asserts.
 */
export interface BindingSignature {
  /** Stable key for the element across variants: its path from the root. */
  key: string;
  tag: string;
  id: string | null;
  name: string | null;
  testid: string | null;
  role: string | null;
  ariaLabel: string | null;
  placeholder: string | null;
  alt: string | null;
  title: string | null;
  type: string | null;
  value: string | null;
  labelFor: string | null;
  classes: string;
  /** The element's own text, excluding descendants' element text. */
  ownText: string;
  /** Index among siblings with the same tag. */
  siblingIndex: number;
  /** Ancestor tags from the root down, e.g. `html/body/main/form`. */
  ancestorPath: string;
}

const ATTR = (el: HTMLElement, name: string): string | null => el.getAttribute(name) ?? null;

function signatureOf(
  el: HTMLElement,
  tagPath: string[],
  positionalPath: string[],
  siblingIndex: number,
): BindingSignature {
  const ancestorPath = tagPath.join("/");
  return {
    // Positional and tag-free, so two `input`s in different wrappers are
    // different elements and a retagged element stays the same element.
    key: positionalPath.join("/"),
    tag: el.rawTagName ?? "",
    id: ATTR(el, "id"),
    name: ATTR(el, "name"),
    testid: ATTR(el, "data-testid"),
    role: ATTR(el, "role"),
    ariaLabel: ATTR(el, "aria-label"),
    placeholder: ATTR(el, "placeholder"),
    alt: ATTR(el, "alt"),
    title: ATTR(el, "title"),
    type: ATTR(el, "type"),
    value: ATTR(el, "value"),
    labelFor: ATTR(el, "for"),
    classes: (ATTR(el, "class") ?? "").split(/\s+/).filter(Boolean).sort().join(" "),
    ownText: el.childNodes
      .filter((n) => n.nodeType === 3)
      .map((n) => n.rawText.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
    siblingIndex,
    ancestorPath,
  };
}

/** Every element on a page, in document order, described the way a binding sees it. */
export function bindingSignatures(html: string): BindingSignature[] {
  const root = parse(html, { blockTextElements: { script: true, style: true } });
  const out: BindingSignature[] = [];

  const walk = (element: HTMLElement, tagPath: string[], positionalPath: string[]): void => {
    // Index among siblings of the same tag — what an xpath positional predicate uses.
    const perTag = new Map<string, number>();
    let childIndex = 0;
    // NodeType.ELEMENT_NODE — text and comment nodes carry no binding-relevant attributes.
    for (const el of element.childNodes.filter((n): n is HTMLElement => n.nodeType === 1)) {
      const tag = el.rawTagName ?? "";
      const index = perTag.get(tag) ?? 0;
      perTag.set(tag, index + 1);
      const here = [...positionalPath, String(childIndex)];
      out.push(signatureOf(el, tagPath, here, index));
      walk(el, [...tagPath, tag], here);
      childIndex += 1;
    }
  };

  walk(root, [], []);
  return out;
}

/** One difference between two renderings of the same page. */
export interface SignatureDiff {
  key: string;
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * Every binding-relevant difference between two renderings. An element that only
 * exists on one side counts as a `presence` difference.
 */
export function diffSignatures(
  before: BindingSignature[],
  after: BindingSignature[],
): SignatureDiff[] {
  const diffs: SignatureDiff[] = [];
  const beforeByKey = new Map(before.map((s) => [s.key, s]));
  const afterByKey = new Map(after.map((s) => [s.key, s]));

  for (const [key, b] of beforeByKey) {
    const a = afterByKey.get(key);
    if (a === undefined) {
      diffs.push({ key, field: "presence", before: "present", after: "absent" });
      continue;
    }
    for (const field of Object.keys(b) as Array<keyof BindingSignature>) {
      if (field === "key") continue;
      if (b[field] !== a[field]) diffs.push({ key, field, before: b[field], after: a[field] });
    }
  }
  for (const key of afterByKey.keys()) {
    if (!beforeByKey.has(key)) {
      diffs.push({ key, field: "presence", before: "absent", after: "present" });
    }
  }
  return diffs;
}
