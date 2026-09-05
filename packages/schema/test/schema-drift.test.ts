/**
 * T0.3 Validate — "committed generated schemas with a drift test" and
 * "`schemaVersion` constant `1.0.0`".
 *
 * Refs: REQ-STD-1.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SCHEMA_VERSION, PUBLISHED_SCHEMAS, generateJsonSchemas, schemaFileName } from "../src/index.js";

const JSON_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "json");

const generated = generateJsonSchemas();
const committed = readdirSync(JSON_DIR).filter((f) => f.endsWith(".schema.json")).sort();

describe("published JSON Schemas (REQ-STD-1)", () => {
  it("the schemaVersion constant is 1.0.0", () => {
    expect(SCHEMA_VERSION).toBe("1.0.0");
  });

  it("every registered schema is committed, and nothing else is", () => {
    expect(committed).toEqual(Object.keys(generated).sort());
    expect(committed.length).toBe(PUBLISHED_SCHEMAS.length);
  });

  it.each(PUBLISHED_SCHEMAS.map((s) => s.name))(
    "%s.schema.json on disk matches what the generator produces",
    (name) => {
      const file = schemaFileName(name);
      const onDisk = readFileSync(join(JSON_DIR, file), "utf8");
      expect(
        onDisk,
        `packages/schema/json/${file} is stale. Run: pnpm --filter @svatah/schema build`,
      ).toBe(generated[file]);
    },
  );

  it("generation is deterministic", () => {
    expect(generateJsonSchemas()).toEqual(generated);
  });

  it("every published schema carries the contract version", () => {
    for (const file of committed) {
      const doc = JSON.parse(readFileSync(join(JSON_DIR, file), "utf8")) as Record<string, unknown>;
      expect(doc["x-svatah-schema-version"]).toBe(SCHEMA_VERSION);
      expect(doc["$id"]).toBe(`https://svatah.dev/schema/${SCHEMA_VERSION}/${file}`);
      expect(doc["$schema"]).toBe("http://json-schema.org/draft-07/schema#");
    }
  });

  it("the artifacts REQ-STD-1 names are all published", () => {
    for (const required of [
      "ir",
      "plan",
      "bindings",
      "results",
      "audit",
      "checkpoint",
      "config",
      "surface.snapshot",
      "surface.act",
      "surface.check",
    ]) {
      expect(committed).toContain(schemaFileName(required));
    }
  });
});

describe("the automation fields Draft 2 added survive generation", () => {
  const read = (name: string) => readFileSync(join(JSON_DIR, schemaFileName(name)), "utf8");

  it("the step schema carries guard, custom, invoke and sideEffect", () => {
    const ir = read("ir");
    for (const field of ["guard", "custom", "invoke", "sideEffect", "onlyIf", "unless"]) {
      expect(ir, `ir.schema.json is missing ${field}`).toContain(field);
    }
  });

  it("the story schema carries signatures, onFailure and idempotent", () => {
    const story = read("story");
    for (const field of ["signature", "onFailure", "compensate", "idempotent", "secret"]) {
      expect(story, `story.schema.json is missing ${field}`).toContain(field);
    }
  });

  it("the results schema carries the aborted status and the guard failure class", () => {
    const results = read("results");
    expect(results).toContain("aborted");
    expect(results).toContain("guard");
  });

  it("the candidate schema carries the mobile, desktop and webmcp kinds", () => {
    const candidate = read("candidate");
    for (const kind of ["accessibilityId", "resourceId", "automationId", "controlPath", "webmcp", "coords"]) {
      expect(candidate, `candidate.schema.json is missing ${kind}`).toContain(kind);
    }
  });

  it("the target scope covers desktop and window", () => {
    const target = read("target-ref");
    expect(target).toContain("desktop");
    expect(target).toContain("window");
  });
});
