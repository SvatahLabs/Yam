/**
 * T0.5 Validate — the twenty variants are "documented in `VARIANTS.md`".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES, VARIANTS, DEFAULT_PORT } from "../src/index.js";

const doc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "VARIANTS.md"),
  "utf8",
);

describe("apps/sample-web/VARIANTS.md", () => {
  it.each(VARIANTS.map((v) => [v.id, v.title] as const))(
    "documents variant %i (%s) with its own section",
    (id, title) => {
      expect(doc).toContain(`### Variant ${id} — ${title}`);
    },
  );

  it.each(VARIANTS.map((v) => [v.id, v.summary] as const))(
    "carries variant %i's summary verbatim",
    (_id, summary) => {
      expect(doc).toContain(summary);
    },
  );

  it("has a table row per variant", () => {
    for (const variant of VARIANTS) {
      expect(doc, `no table row for variant ${variant.id}`).toMatch(
        new RegExp(`^\\| ${variant.id} \\| ${variant.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`, "m"),
      );
    }
  });

  it("names every kind that is in use", () => {
    for (const kind of new Set(VARIANTS.map((v) => v.kind))) {
      expect(doc, `VARIANTS.md does not explain the \`${kind}\` kind`).toMatch(
        new RegExp(`^\\| \`${kind}\` \\|`, "m"),
      );
    }
  });

  it("lists every page the application serves", () => {
    for (const page of PAGES) {
      expect(doc, `VARIANTS.md does not list ${page.path}`).toContain(`| \`${page.path}\` |`);
    }
  });

  it("says how to start the app and on which port", () => {
    expect(doc).toContain("pnpm --filter sample-web start");
    expect(doc).toContain(String(DEFAULT_PORT));
  });

  it("states the healing thresholds the variants exist to measure", () => {
    expect(doc).toContain("REQ-HEAL-5");
    expect(doc).toContain("0.60");
    expect(doc).toContain("0.85");
  });

  it("calls out the duplicate-element variant as the negative case", () => {
    const ambiguity = VARIANTS.find((v) => v.kind === "ambiguity");
    expect(ambiguity).toBeDefined();
    expect(doc).toContain(`Variant ${ambiguity!.id} is the negative case`);
  });
});
