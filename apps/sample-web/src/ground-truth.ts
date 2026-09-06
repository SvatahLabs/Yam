import { parse, type HTMLElement } from "node-html-parser";

/**
 * Ground-truth keys for the healing eval (LLD §16, Draft 2.3).
 *
 * The healing eval has to answer a question the eval cannot ask the thing it is
 * measuring: *did relocalization find the element it was looking for, or did it
 * find a different one that happens to resolve?* Phase 1 answered it with
 * "a candidate re-synthesised from the proposal resolves uniquely", which proves
 * the proposal is findable — not that it is right. A confident wrong answer
 * passed.
 *
 * So the application labels every interactive element with a key that is
 * identical on every variant, the eval records the key of each binding at
 * variant 0, and after relocalization it compares the key of the proposed
 * element with the recorded one. Different key, `wrong-element`, however good
 * the score was.
 *
 * Two properties make the key trustworthy:
 *
 * * **It is stamped on the baseline, before a variant is applied.** The variants
 *   transform the already-stamped document, so an element that is retagged,
 *   wrapped, moved or restyled carries its key through the change by
 *   construction rather than by a rule someone has to remember. An element a
 *   variant *adds* has no key, which is exactly right: relocalizing onto it is a
 *   miss.
 * * **Nothing above the surface can see it.** `bindings.ignoreAttributes`
 *   defaults to `["data-yam-eval"]`, and the adapter strips the attribute
 *   from `describe()` and from `native` before anything else looks. The eval
 *   reads it with a page script instead, going around the surface rather than
 *   through it. Otherwise the label would be the best locator on the page and
 *   the eval would be measuring itself.
 */

/** The attribute LLD §16 names. Also `bindings.ignoreAttributes`' default. */
export const GROUND_TRUTH_ATTRIBUTE = "data-yam-eval";

/**
 * Elements that get a key: everything the surface reports as interactive
 * (`isInteractive` in the Playwright adapter's page script), by the tags and
 * roles that produce those roles in this application.
 */
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "option",
  "textarea",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="slider"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="textbox"]',
  '[role="searchbox"]',
].join(",");

/** `/schedule-build` → `schedule-build`; `/` → `home`. */
function slug(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "home" : trimmed.replace(/\//g, "-");
}

/**
 * A readable hint, so a failing case in the report names something a person can
 * find in the page source. It is only a hint: the index is what makes the key
 * unique, and the key never has to be parsed.
 */
function hint(element: HTMLElement): string {
  const raw =
    element.getAttribute("data-testid") ??
    element.getAttribute("name") ??
    element.getAttribute("id") ??
    element.getAttribute("aria-label") ??
    element.getAttribute("type") ??
    element.text.trim().slice(0, 24) ??
    "";
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned === "" ? element.tagName.toLowerCase() : cleaned;
}

/**
 * Stamp `data-yam-eval` on every interactive element of a baseline document.
 *
 * Idempotent: an element that already carries a key keeps it, so stamping twice
 * — or stamping a document a variant has already touched — cannot renumber
 * anything.
 */
export function stampGroundTruth(html: string, path: string): string {
  const root = parse(html, { comment: true, blockTextElements: { script: true, style: true } });
  if (!stampInto(root, path)) return html;
  return root.toString();
}

/** The same, on an already-parsed document. Returns whether anything changed. */
export function stampInto(root: HTMLElement, path: string): boolean {
  const page = slug(path);
  let index = 0;
  let changed = false;
  for (const element of root.querySelectorAll(INTERACTIVE_SELECTOR)) {
    index += 1;
    if (element.getAttribute(GROUND_TRUTH_ATTRIBUTE) !== undefined) continue;
    element.setAttribute(GROUND_TRUTH_ATTRIBUTE, `${page}/${String(index).padStart(2, "0")}-${hint(element)}`);
    changed = true;
  }
  return changed;
}
