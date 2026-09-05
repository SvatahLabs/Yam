/**
 * T0.3 Validate — "Round-trip tests per schema".
 *
 * Every artifact in LLD §3 parses, survives a canonical-JSON round trip byte for
 * byte, and survives a canonical-YAML round trip. Round-tripping through the
 * canonical form is what makes `plan.json` byte-stable (REQ-COMP-7) and the
 * bindings store reviewable.
 */
import { describe, expect, it } from "vitest";
import { parse as yamlParse } from "yaml";
import type { z } from "zod";

import {
  auditLineSchema,
  bindingEntrySchema,
  bindingFileSchema,
  canonicalJson,
  canonicalYaml,
  checkpointSchema,
  configSchema,
  planSchema,
  proposalSchema,
  provenanceSchema,
  stepResultSchema,
  stepSchema,
  storySchema,
  summarySchema,
} from "../src/index.js";
import * as fixture from "./fixtures.js";

const cases: Array<{ name: string; schema: z.ZodTypeAny; value: unknown }> = [
  { name: "provenance (human)", schema: provenanceSchema, value: fixture.humanProvenance },
  { name: "provenance (model)", schema: provenanceSchema, value: fixture.modelProvenance },
  { name: "ir — Tier 1 step", schema: stepSchema, value: fixture.tier1Step },
  { name: "ir — guarded step", schema: stepSchema, value: fixture.guardedStep },
  { name: "ir — custom step", schema: stepSchema, value: fixture.customStep },
  { name: "ir — invoke step", schema: stepSchema, value: fixture.invokeStep },
  { name: "ir — Tier 2 step", schema: stepSchema, value: fixture.tier2Step },
  { name: "story", schema: storySchema, value: fixture.story },
  { name: "plan", schema: planSchema, value: fixture.plan },
  { name: "binding-entry (web)", schema: bindingEntrySchema, value: fixture.bindingEntry },
  { name: "binding-entry (desktop)", schema: bindingEntrySchema, value: fixture.desktopBindingEntry },
  { name: "bindings", schema: bindingFileSchema, value: fixture.bindingFile },
  { name: "results", schema: stepResultSchema, value: fixture.stepResult },
  { name: "results (aborted)", schema: stepResultSchema, value: fixture.abortedStepResult },
  { name: "summary", schema: summarySchema, value: fixture.summary },
  { name: "audit", schema: auditLineSchema, value: fixture.auditLine },
  { name: "checkpoint", schema: checkpointSchema, value: fixture.checkpoint },
  { name: "config", schema: configSchema, value: fixture.config },
  { name: "proposal", schema: proposalSchema, value: fixture.proposal },
];

describe.each(cases)("$name", ({ schema, value }) => {
  it("parses", () => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  it("round-trips through canonical JSON, byte for byte", () => {
    const parsed = schema.parse(value);
    const once = canonicalJson(parsed);
    const twice = canonicalJson(schema.parse(JSON.parse(once)));
    expect(twice).toBe(once);
  });

  it("round-trips through canonical YAML", () => {
    const parsed = schema.parse(value);
    const yaml = canonicalYaml(parsed);
    const back = schema.parse(yamlParse(yaml));
    expect(canonicalJson(back)).toBe(canonicalJson(parsed));
  });

  it("rejects an unknown field", () => {
    const polluted = { ...(value as Record<string, unknown>), __unexpected__: true };
    expect(schema.safeParse(polluted).success).toBe(false);
  });
});

describe("canonical serialisation", () => {
  it("is insensitive to key order", () => {
    const a = { b: 1, a: { d: 2, c: [3, 4] } };
    const b = { a: { c: [3, 4], d: 2 }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toContain("[\n  3,\n  1,\n  2\n]");
  });

  it("drops undefined members rather than emitting null", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{\n  "a": 1\n}\n');
  });
});
