/**
 * T0.5 Validate — "each variant changes at least one binding-relevant property
 * (DOM diff test)".
 *
 * A variant that changes nothing a binding reads is worthless as a healing case
 * (REQ-HEAL-5), and a variant that changes a page it does not claim to touch would
 * corrupt the eval's attribution. Both are asserted here.
 */
import { describe, expect, it } from "vitest";
import { applyVariant, PAGES, VARIANTS } from "../src/index.js";
import { bindingSignatures, diffSignatures, type SignatureDiff } from "./binding-signature.js";

/** Every binding-relevant difference a variant makes, across all pages. */
function diffsFor(variantId: number): Map<string, SignatureDiff[]> {
  const byPage = new Map<string, SignatureDiff[]>();
  for (const page of PAGES) {
    const before = bindingSignatures(page.html);
    const after = bindingSignatures(applyVariant(page.html, page.path, variantId));
    const diffs = diffSignatures(before, after);
    if (diffs.length > 0) byPage.set(page.path, diffs);
  }
  return byPage;
}

describe("the DOM diff of every variant", () => {
  it.each(VARIANTS.map((v) => [v.id, v.title] as const))(
    "variant %i (%s) changes at least one binding-relevant property",
    (id) => {
      const byPage = diffsFor(id);
      const total = [...byPage.values()].flat();
      expect(
        total.length,
        `variant ${id} changed nothing a binding reads, so it is useless as a healing case`,
      ).toBeGreaterThan(0);
    },
  );

  it.each(VARIANTS.map((v) => [v.id, v.title] as const))(
    "variant %i (%s) changes only the pages it declares",
    (id) => {
      const variant = VARIANTS.find((v) => v.id === id)!;
      const changed = [...diffsFor(id).keys()].sort();
      const declared = [...variant.pages].sort();
      expect(changed).toEqual(declared.filter((p) => changed.includes(p)));
      for (const path of changed) {
        expect(
          declared,
          `variant ${id} changed ${path} but does not list it in \`pages\``,
        ).toContain(path);
      }
    },
  );

  it.each(VARIANTS.map((v) => [v.id, v.title] as const))(
    "variant %i (%s) changes every page it declares",
    (id) => {
      const variant = VARIANTS.find((v) => v.id === id)!;
      const changed = new Set(diffsFor(id).keys());
      for (const path of variant.pages) {
        expect(changed, `variant ${id} declares ${path} but changes nothing on it`).toContain(path);
      }
    },
  );

  it("variant 0 changes nothing", () => {
    expect([...diffsFor(0).keys()]).toEqual([]);
  });

  it("no two variants make the same set of changes", () => {
    const fingerprints = new Map<string, number>();
    for (const variant of VARIANTS) {
      const key = JSON.stringify(
        [...diffsFor(variant.id).entries()].map(([path, diffs]) => [
          path,
          diffs.map((d) => `${d.key}:${d.field}:${String(d.before)}→${String(d.after)}`).sort(),
        ]),
      );
      const seen = fingerprints.get(key);
      expect(seen, `variants ${String(seen)} and ${variant.id} are the same change`).toBeUndefined();
      fingerprints.set(key, variant.id);
    }
  });
});

describe("the variants cover the kinds of change healing must survive", () => {
  it("touches every field group a candidate is built from", () => {
    const fields = new Set<string>();
    for (const variant of VARIANTS) {
      for (const diffs of diffsFor(variant.id).values()) {
        for (const d of diffs) fields.add(d.field);
      }
    }
    // Identity, naming, structure and presence must all be represented.
    for (const field of [
      "id",
      "testid",
      "ownText",
      "classes",
      "placeholder",
      "labelFor",
      "type",
      "value",
      "tag",
      "ancestorPath",
      "siblingIndex",
      "presence",
    ]) {
      expect(fields, `no variant changes \`${field}\``).toContain(field);
    }
  });

  it("covers every declared variant kind", () => {
    const kinds = new Set(VARIANTS.map((v) => v.kind));
    for (const kind of [
      "text",
      "attribute",
      "identifier",
      "structure",
      "ordering",
      "ambiguity",
      "tag",
      "context",
    ]) {
      expect(kinds, `no variant is of kind ${kind}`).toContain(kind);
    }
  });

  it("every variant names what it breaks", () => {
    for (const variant of VARIANTS) {
      expect(variant.breaks.length, `variant ${variant.id} names nothing it breaks`).toBeGreaterThan(0);
      expect(variant.summary.length).toBeGreaterThan(10);
    }
  });
});
