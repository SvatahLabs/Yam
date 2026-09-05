import { parse, type HTMLElement } from "node-html-parser";
import { stampInto } from "./ground-truth.js";

/**
 * The twenty deliberate UI changes (`?variant=1..20`, T0.5, LLD §16).
 *
 * Each one is a change a real front-end change would produce, and each one breaks
 * at least one class of locator candidate. They are the eval set for relocalization
 * (REQ-HEAL-5): record on variant 0, replay on 1..20, and measure how many bindings
 * survive without a model.
 *
 * `kind` groups them by what the healer has to cope with, and `breaks` names the
 * candidate kinds the change invalidates. Both appear in VARIANTS.md.
 */

export type VariantKind =
  | "text"
  | "attribute"
  | "identifier"
  | "structure"
  | "ordering"
  | "ambiguity"
  | "tag"
  | "context";

export interface Variant {
  /** 1..20; `?variant=<id>`. */
  readonly id: number;
  readonly title: string;
  readonly kind: VariantKind;
  /** What a person would say changed in the product. */
  readonly summary: string;
  /** Which candidate kinds this invalidates (LLD §3.3). */
  readonly breaks: readonly string[];
  /** Routes the change is visible on. */
  readonly pages: readonly string[];
  /** Applied to the parsed document of an affected page. */
  readonly apply: (root: HTMLElement, path: string) => void;
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

const byTestId = (root: HTMLElement, id: string): HTMLElement | null =>
  root.querySelector(`[data-testid="${id}"]`);

/** Replace an element's tag, keeping its attributes and children. */
function retag(element: HTMLElement, tag: string): void {
  const attrs = Object.entries(element.attributes)
    .map(([k, v]) => `${k}="${v.replace(/"/g, "&quot;")}"`)
    .join(" ");
  element.replaceWith(parse(`<${tag}${attrs ? ` ${attrs}` : ""}>${element.innerHTML}</${tag}>`));
}

/** Wrap an element in a new parent, so its ancestor path and sibling index shift. */
function wrap(element: HTMLElement, openTag: string, closeTag: string): void {
  element.replaceWith(parse(`${openTag}${element.outerHTML}${closeTag}`));
}

/* ── the twenty variants ──────────────────────────────────────────────────── */

export const VARIANTS: readonly Variant[] = [
  {
    id: 1,
    title: "Sign-in call to action renamed",
    kind: "text",
    summary: 'The home page button reads "Log in" instead of "Sign in".',
    breaks: ["text", "role (by accessible name)"],
    pages: ["/"],
    apply: (root) => {
      const el = byTestId(root, "sign-in");
      if (el) el.set_content("Log in");
    },
  },
  {
    id: 2,
    title: "Test id dropped from the username field",
    kind: "attribute",
    summary: "A refactor removed `data-testid` from the login username input.",
    breaks: ["testid"],
    pages: ["/login"],
    apply: (root) => {
      root.querySelector("#username")?.removeAttribute("data-testid");
    },
  },
  {
    id: 3,
    title: "Login fields wrapped in an extra layout div",
    kind: "structure",
    summary: "Each login field gained a wrapper element, deepening the tree.",
    breaks: ["xpath", "css (descendant paths)"],
    pages: ["/login"],
    apply: (root) => {
      for (const field of root.querySelectorAll("#login .field")) {
        wrap(field, '<div class="field-wrap">', "</div>");
      }
    },
  },
  {
    id: 4,
    title: "Submit button value changed",
    kind: "text",
    summary: 'The login submit reads "Submit" instead of "Sign In".',
    breaks: ["text", "css (attribute value)", "xpath (value predicate)"],
    pages: ["/login"],
    apply: (root) => {
      root.querySelector("#login input[type=submit]")?.setAttribute("value", "Submit");
    },
  },
  {
    id: 5,
    title: "Password field id renamed",
    kind: "identifier",
    summary: "`#password` became `#user-password`; the label's `for` moved with it.",
    breaks: ["id", "css (#id)", "xpath (@id)"],
    pages: ["/login"],
    apply: (root) => {
      const input = root.querySelector("#password");
      if (input) input.setAttribute("id", "user-password");
      const label = root.querySelector('label[for="password"]');
      if (label) label.setAttribute("for", "user-password");
    },
  },
  {
    id: 6,
    title: "Sidebar items reordered",
    kind: "ordering",
    summary: "Schedule Build moved from second to last in the sidebar.",
    breaks: ["xpath (positional)", "css (:nth-child)", "candidate nth"],
    pages: ["/dashboard", "/schedule-build", "/booking", "/checkout"],
    apply: (root) => {
      const list = root.querySelector(".sidebar-list");
      const item = root.querySelector('.sidebar-list li:has([data-testid="nav-schedule-build"])')
        ?? root.querySelectorAll(".sidebar-list li").find((li) => li.innerHTML.includes("nav-schedule-build"));
      if (list && item) {
        item.remove();
        list.appendChild(item);
      }
    },
  },
  {
    id: 7,
    title: "Logout became an icon-only button",
    kind: "text",
    summary: "The sidebar logout link lost its visible text and kept only an aria-label.",
    breaks: ["text", "link text"],
    pages: ["/dashboard", "/schedule-build", "/booking", "/checkout"],
    apply: (root) => {
      const el = byTestId(root, "nav-logout");
      if (el) {
        el.setAttribute("aria-label", "Logout");
        el.set_content("⎋");
      }
    },
  },
  {
    id: 8,
    title: "Dashboard heading rewritten",
    kind: "text",
    summary: '"Welcome back, Enterprise" became "Your builds".',
    breaks: ["text", "role (by accessible name)"],
    pages: ["/dashboard"],
    apply: (root) => {
      const el = byTestId(root, "dashboard-heading");
      if (el) el.set_content("Your builds");
    },
  },
  {
    id: 9,
    title: "A second Book button appears",
    kind: "ambiguity",
    summary: 'The booking page gained a duplicate "Book now" button in a sticky footer.',
    breaks: ["text", "role (now matches two elements)"],
    pages: ["/booking"],
    apply: (root) => {
      const main = root.querySelector("main.page");
      if (main) {
        main.appendChild(
          parse(
            '<div class="sticky-footer"><button type="button" class="btn btn-primary" data-testid="book-now-sticky">Book now</button></div>',
          ),
        );
      }
    },
  },
  {
    id: 10,
    title: "CSS classes hashed by the build",
    kind: "attribute",
    summary: "A CSS-modules migration replaced every `btn*` class with a hashed name.",
    breaks: ["css (class selectors)"],
    pages: ["/", "/login", "/dashboard", "/schedule-build", "/booking", "/checkout", "/widgets", "/logout"],
    apply: (root) => {
      for (const el of root.querySelectorAll("[class]")) {
        const hashed = (el.getAttribute("class") ?? "")
          .split(/\s+/)
          .map((c) => (c.startsWith("btn") ? `${c}_x7f3a2` : c))
          .join(" ");
        el.setAttribute("class", hashed);
      }
    },
  },
  {
    id: 11,
    title: "Search field became a search input",
    kind: "attribute",
    summary: "The booking location field's `type` changed from `text` to `search`.",
    breaks: ["css (attribute selectors)", "role (textbox → searchbox)"],
    pages: ["/booking"],
    apply: (root) => {
      root.querySelector("#location")?.setAttribute("type", "search");
    },
  },
  {
    id: 12,
    title: "Schedule Build heading demoted to h2",
    kind: "tag",
    summary: "The page heading became an `h2` under a new section title.",
    breaks: ["xpath (//h1)", "css (h1)", "role (heading level)"],
    pages: ["/schedule-build"],
    apply: (root) => {
      const el = byTestId(root, "schedule-heading");
      if (el) retag(el, "h2");
    },
  },
  {
    id: 13,
    title: "Nav toggle text moved into a child span",
    kind: "structure",
    summary: "The navbar toggle wraps its label in a span for icon alignment.",
    breaks: ["xpath (text())", "css (:has-text)"],
    pages: ["/", "/login", "/dashboard", "/schedule-build", "/booking", "/checkout", "/widgets", "/logout"],
    apply: (root) => {
      const el = byTestId(root, "nav-toggle");
      if (el) el.set_content('<span class="label">Menu</span>');
    },
  },
  {
    id: 14,
    title: "Placeholders removed from the login form",
    kind: "attribute",
    summary: "A design review removed placeholder text in favour of labels alone.",
    breaks: ["placeholder"],
    pages: ["/login"],
    apply: (root) => {
      for (const input of root.querySelectorAll("#login input[placeholder]")) {
        input.removeAttribute("placeholder");
      }
    },
  },
  {
    id: 15,
    title: "Labels detached from their inputs",
    kind: "attribute",
    summary: "The `for` attributes were dropped, so labels no longer name their controls.",
    breaks: ["label", "role (by accessible name)"],
    pages: ["/login", "/checkout"],
    apply: (root) => {
      for (const label of root.querySelectorAll("label[for]")) label.removeAttribute("for");
    },
  },
  {
    id: 16,
    title: "CVV field keeps only its name",
    kind: "identifier",
    summary: "`#cvv` lost its `id` and its `data-testid`; only `name=\"cvv\"` remains.",
    breaks: ["id", "testid", "css (#id)"],
    pages: ["/checkout"],
    apply: (root) => {
      const input = root.querySelector("#cvv");
      if (input) {
        input.removeAttribute("id");
        input.removeAttribute("data-testid");
      }
      root.querySelector('label[for="cvv"]')?.removeAttribute("for");
    },
  },
  {
    id: 17,
    title: "A banner was added above the main content",
    kind: "ordering",
    summary: "A dismissible announcement bar shifted every sibling index below it.",
    breaks: ["xpath (positional)", "css (:nth-child)", "candidate nth"],
    pages: ["/", "/login", "/dashboard", "/schedule-build", "/booking", "/checkout", "/widgets"],
    apply: (root) => {
      const body = root.querySelector("body");
      const nav = root.querySelector("nav.navbar");
      if (body && nav) {
        nav.insertAdjacentHTML(
          "beforebegin",
          '<div class="announcement" role="status" data-testid="announcement">Scheduled maintenance on Sunday.</div>',
        );
      }
    },
  },
  {
    id: 18,
    title: "An extra first option in every select",
    kind: "ordering",
    summary: 'Selects gained a "Choose…" placeholder option, shifting option indices.',
    breaks: ["xpath (positional)", "candidate nth", "selectOption by index"],
    pages: ["/schedule-build", "/booking", "/checkout", "/widgets"],
    apply: (root) => {
      for (const select of root.querySelectorAll("select")) {
        select.insertAdjacentHTML(
          "afterbegin",
          '<option value="" disabled selected>Choose…</option>',
        );
      }
    },
  },
  {
    id: 19,
    title: "Next button moved into a toolbar",
    kind: "structure",
    summary: "The booking Next button moved out of the form and into a toolbar above it.",
    breaks: ["xpath", "css (descendant paths)", "ancestor role path"],
    pages: ["/booking"],
    apply: (root) => {
      const next = byTestId(root, "booking-next");
      const form = root.querySelector("#booking");
      if (next && form) {
        next.remove();
        form.insertAdjacentHTML(
          "beforebegin",
          `<div class="toolbar" role="toolbar" aria-label="Booking actions">${next.outerHTML}</div>`,
        );
      }
    },
  },
  {
    id: 20,
    title: "Login moved into a modal dialog",
    kind: "context",
    summary: "Signing in happens in a modal, so the whole form sits under a dialog.",
    breaks: ["context hash", "xpath", "ancestor role path", "scope (page → dialog)"],
    pages: ["/login"],
    apply: (root) => {
      const form = root.querySelector("#login");
      if (form) {
        wrap(
          form,
          '<div class="modal" role="dialog" aria-modal="true" aria-label="Sign in" data-testid="login-modal">',
          "</div>",
        );
      }
    },
  },
];

/** 0 is the baseline; 1..20 are the deliberate changes. */
export const VARIANT_IDS: readonly number[] = VARIANTS.map((v) => v.id);

export function variantById(id: number): Variant | undefined {
  return VARIANTS.find((v) => v.id === id);
}

/**
 * Apply a variant to a page. Variant 0, an unknown id, or a page the variant does
 * not affect all return the HTML unchanged.
 */
export function applyVariant(html: string, path: string, variant: number): string {
  const root = parse(html, { comment: true, blockTextElements: { script: true, style: true } });

  /*
   * Ground-truth keys are stamped on the baseline, before the variant runs, and
   * every variant transform then carries them along with the element it moves,
   * retags or restyles (LLD §16, Draft 2.3). Stamping after the transform would
   * renumber whatever the variant added or removed and the key would mean
   * nothing across variants, which is the one property the eval needs from it.
   */
  stampInto(root, path);

  const spec = variantById(variant);
  if (variant !== 0 && spec !== undefined && spec.pages.includes(path)) spec.apply(root, path);

  return root.toString();
}
