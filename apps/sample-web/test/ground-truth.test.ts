/**
 * LLD §16 (Draft 2.3): "`apps/sample-web` stamps every interactive element with
 * `data-svatah-eval="<stable key>"`, identical across all variants."
 *
 * Two claims, and the eval's correctness rests on both: every interactive
 * element has a key, and a key means the same element on every variant. The
 * second is the one that could rot silently — a variant that rebuilt an element
 * from scratch instead of transforming it would quietly mint a new key, and the
 * eval would start reporting `wrong-element` for repairs that were right.
 */
import { describe, expect, it } from "vitest";
import { parse } from "node-html-parser";
import { PAGES } from "../src/pages.js";
import { applyVariant, VARIANTS } from "../src/variants.js";
import { GROUND_TRUTH_ATTRIBUTE } from "../src/ground-truth.js";

const INTERACTIVE = "a[href],button,input,select,option,textarea,summary";

const keysOf = (html: string): string[] =>
  [...html.matchAll(new RegExp(`${GROUND_TRUTH_ATTRIBUTE}="([^"]+)"`, "g"))].map((m) => m[1]!);

describe("ground-truth keys (LLD §16)", () => {
  it.each(PAGES.map((p) => p.path))("every interactive element on %s carries a key", (path) => {
    const page = PAGES.find((p) => p.path === path)!;
    const root = parse(applyVariant(page.html, path, 0));
    const interactive = root.querySelectorAll(INTERACTIVE);
    expect(interactive.length, `${path} has no interactive elements`).toBeGreaterThan(0);
    for (const element of interactive) {
      expect(
        element.getAttribute(GROUND_TRUTH_ATTRIBUTE),
        `${path}: <${element.tagName.toLowerCase()}> has no ${GROUND_TRUTH_ATTRIBUTE}`,
      ).toBeDefined();
    }
  });

  it("keys are unique within a page", () => {
    for (const page of PAGES) {
      const keys = keysOf(applyVariant(page.html, page.path, 0));
      expect(new Set(keys).size, `${page.path} has duplicate keys`).toBe(keys.length);
    }
  });

  it("keys are unique across the whole application", () => {
    const all = PAGES.flatMap((p) => keysOf(applyVariant(p.html, p.path, 0)));
    expect(new Set(all).size).toBe(all.length);
  });

  /*
   * The point of the whole mechanism. A variant may remove an element — variant
   * 7 replaces Logout's text with an icon, variant 2 drops a test id — so a key
   * present at variant 0 need not survive. What must never happen is a key
   * *changing meaning*: the same key naming a different element, or an element
   * that existed at variant 0 coming back under a new key.
   */
  it.each(VARIANTS.map((v) => [v.id, v.title] as const))(
    "variant %i (%s) mints no new key on an element that already had one",
    (id) => {
      const variant = VARIANTS.find((v) => v.id === id)!;
      for (const path of variant.pages) {
        const page = PAGES.find((p) => p.path === path)!;
        const before = new Set(keysOf(applyVariant(page.html, path, 0)));
        const after = keysOf(applyVariant(page.html, path, id));

        expect(new Set(after).size, `${path}@${id}: duplicate keys`).toBe(after.length);
        for (const key of after) {
          expect(before.has(key), `${path}@${id}: key "${key}" did not exist at variant 0`).toBe(true);
        }
      }
    },
  );

  it("stamps the baseline, so a variant cannot renumber what it did not touch", () => {
    // Variant 17 adds a banner above the main content: new interactive elements
    // appear *before* existing ones in document order. If stamping ran after the
    // variant, every key on the page would shift by one and every comparison the
    // eval makes would be against the wrong element.
    const page = PAGES.find((p) => p.path === "/booking")!;
    const before = keysOf(applyVariant(page.html, page.path, 0));
    const after = keysOf(applyVariant(page.html, page.path, 17));
    expect(after).toEqual(before);
  });
});
