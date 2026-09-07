/**
 * T0.4 Validate — "the doc lists every method and every capability flag (test greps)".
 *
 * It also asserts the three role tables in the document are exactly what
 * `src/roles.ts` produces, so the contract adapter implementers read cannot drift
 * from the code every adapter runs.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CANDIDATE_KINDS, SURFACE_ACTIONS } from "@svatah/yam-schema";
import {
  CAPABILITY_FLAGS,
  ROLE_MAPS,
  SURFACE_ERRORS,
  SURFACE_METHODS,
  type RoleMapName,
} from "../src/index.js";

const DOC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "docs",
  "agent-surface.md",
);
const doc = readFileSync(DOC_PATH, "utf8");

describe("docs/agent-surface.md (REQ-SURF-1)", () => {
  it.each(SURFACE_METHODS)("names the `%s` method", (method) => {
    expect(doc).toContain(`\`${method}\``);
  });

  it("has a row in the method table for every method", () => {
    for (const method of SURFACE_METHODS) {
      expect(doc, `no method-table row for ${method}`).toMatch(
        new RegExp(`^\\| \`${method}\` \\|`, "m"),
      );
    }
  });

  it.each(CAPABILITY_FLAGS)("names the `%s` capability flag", (flag) => {
    expect(doc).toMatch(new RegExp(`^\\| \`${flag}\` \\|`, "m"));
  });

  it("states how many capability flags there are, and that is how many exist", () => {
    expect(CAPABILITY_FLAGS).toHaveLength(11);
    expect(doc).toContain("exactly these eleven booleans");
  });

  it.each(SURFACE_ACTIONS)("names the `%s` action", (action) => {
    expect(doc).toContain(`\`${action}\``);
  });

  it.each(CANDIDATE_KINDS)("names the `%s` candidate kind", (kind) => {
    expect(doc).toContain(`\`${kind}\``);
  });

  it.each(SURFACE_ERRORS.map((e) => e.name))("has a row for the `%s` error", (name) => {
    expect(doc).toMatch(new RegExp(`^\\| \`${name}\` \\|`, "m"));
  });

  it("links the wire schemas and the requirements it implements", () => {
    expect(doc).toContain("packages/schema/json/");
    for (const req of ["REQ-SURF-1", "REQ-SURF-2", "REQ-SURF-3", "REQ-SURF-4", "REQ-SURF-5"]) {
      expect(doc).toContain(req);
    }
  });
});

/** Render one role table the way the document holds it. */
function renderRoleTable(header: string, map: Readonly<Record<string, string>>): string {
  const rows = Object.entries(map).sort(([a], [b]) => (a < b ? -1 : 1));
  return [
    `| ${header} | Surface role |`,
    "|---|---|",
    ...rows.map(([source, role]) => `| \`${source}\` | \`${role}\` |`),
  ].join("\n");
}

/** The text between `<!-- generated:<name> -->` and its closing marker. */
function generatedBlock(name: string): string {
  const open = `<!-- generated:${name} -->\n`;
  const close = `\n<!-- /generated:${name} -->`;
  const start = doc.indexOf(open);
  const end = doc.indexOf(close);
  expect(start, `docs/agent-surface.md has no generated:${name} block`).toBeGreaterThan(-1);
  expect(end, `docs/agent-surface.md has no /generated:${name} marker`).toBeGreaterThan(start);
  return doc.slice(start + open.length, end);
}

const TABLE_HEADERS: Record<RoleMapName, string> = {
  uia: "UIA `ControlType`",
  ax: "macOS `AXRole`",
  appium: "Android class",
  atspi: "AT-SPI role name",
};

describe("the role tables in the doc match src/roles.ts (REQ-SURF-4)", () => {
  it.each(Object.keys(ROLE_MAPS) as RoleMapName[])(
    "the %s table is exactly what the code maps",
    (name) => {
      expect(
        generatedBlock(name),
        `The ${name} table in docs/agent-surface.md is stale. Regenerate it from packages/surface/src/roles.ts.`,
      ).toBe(renderRoleTable(TABLE_HEADERS[name], ROLE_MAPS[name]));
    },
  );

  it("says what happens to an unmapped role", () => {
    expect(doc).toContain("maps to `generic`");
  });
});
