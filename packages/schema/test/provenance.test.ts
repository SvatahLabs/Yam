/**
 * T0.3 Validate — "a binding without provenance is rejected; a Tier 2 step without
 * provenance is rejected".
 *
 * Refs: REQ-AGT-3, REQ-STD-4.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  bindingEntrySchema,
  isHumanProvenance,
  MODEL_TIERS,
  proposalSchema,
  stepSchema,
  type Step,
} from "../src/index.js";
import * as fixture from "./fixtures.js";

/** Drop a key without leaving `undefined` behind, so `.strict()` sees a missing field. */
function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const clone = { ...value };
  delete clone[key];
  return clone;
}

describe("provenance is mandatory where REQ-STD-4 says so", () => {
  it("rejects a binding entry with no provenance", () => {
    const result = bindingEntrySchema.safeParse(without(fixture.bindingEntry, "provenance"));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("provenance");
  });

  it("rejects a heal entry (binding lineage) whose previous record has no provenance", () => {
    const healed = {
      ...fixture.bindingEntry,
      previous: [{ fingerprint: fixture.bindingEntry.fingerprint }],
    };
    expect(bindingEntrySchema.safeParse(healed).success).toBe(false);
  });

  it.each(MODEL_TIERS)("rejects a Tier %i step with no provenance", (tier) => {
    const step: Step = {
      ...fixture.tier2Step,
      origin: { tier, confidence: 0.8 },
    };
    const result = stepSchema.safeParse(step);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain(
      `A Tier ${tier} step is model output and must carry provenance`,
    );
  });

  it("accepts a Tier 2 step that carries provenance", () => {
    expect(stepSchema.safeParse(fixture.tier2Step).success).toBe(true);
  });

  it.each([0, 1] as const)("accepts a Tier %i step with no provenance (not model output)", (tier) => {
    const step: Step = { ...fixture.tier1Step, origin: { tier, confidence: 1 } };
    expect(stepSchema.safeParse(step).success).toBe(true);
  });

  it("rejects a proposal with no provenance", () => {
    expect(proposalSchema.safeParse(without(fixture.proposal, "provenance")).success).toBe(false);
  });

  it("rejects a proposal whose bindings claim to be verified", () => {
    const bad = structuredClone(fixture.proposal);
    bad.bindings[0]!.entries[0]!.verified = true;
    const result = proposalSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("verified: false");
  });

  it("records a human decision as provenance rather than by omitting it", () => {
    expect(isHumanProvenance(fixture.humanProvenance)).toBe(true);
    expect(isHumanProvenance(fixture.modelProvenance)).toBe(false);
    expect(bindingEntrySchema.safeParse(fixture.bindingEntry).success).toBe(true);
  });
});

describe("IR block/action consistency", () => {
  it('rejects action "custom" with no custom block', () => {
    expect(stepSchema.safeParse(without(fixture.customStep, "custom")).success).toBe(false);
  });

  it('rejects a custom block on a non-custom action', () => {
    const bad = { ...fixture.tier1Step, custom: fixture.customStep.custom };
    expect(stepSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects action "invoke" with no invoke block', () => {
    expect(stepSchema.safeParse(without(fixture.invokeStep, "invoke")).success).toBe(false);
  });

  it('rejects an invoke block on a non-invoke action', () => {
    const bad = { ...fixture.tier1Step, invoke: fixture.invokeStep.invoke };
    expect(stepSchema.safeParse(bad).success).toBe(false);
  });
});

/**
 * P0-F3 — Draft 2.2 gives Tier 0 `target` placeholders their own map so the
 * recorder can ground them and the resolver can resolve them. The two encodings
 * a compiler could produce by mistake are rejected here.
 */
describe("custom step targets (LLD §3.2, §5, Draft 2.2)", () => {
  it("accepts target placeholders as TargetRefs under custom.targets", () => {
    const parsed = stepSchema.safeParse(fixture.customStep);
    expect(parsed.success).toBe(true);
    expect(fixture.customStep.custom?.targets?.from).toEqual({
      ref: "accounts.current",
      phrase: "the current account",
      status: "unbound",
    });
  });

  it("accepts a custom step with no target placeholders at all", () => {
    const noTargets = {
      ...fixture.customStep,
      custom: { id: "steps/seed.ts#seedDatabase", params: { fixture: { kind: "literal" as const, value: "bookings-fixture" } } },
    };
    expect(stepSchema.safeParse(noTargets).success).toBe(true);
  });

  it("rejects the same placeholder name in both params and targets", () => {
    const bad = {
      ...fixture.customStep,
      custom: {
        ...fixture.customStep.custom!,
        params: {
          ...fixture.customStep.custom!.params,
          from: { kind: "literal" as const, value: "accounts.current" },
        },
      },
    };
    const parsed = stepSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("belongs in `targets` only");
  });

  it("rejects a params literal that repeats an element id the step already grounds", () => {
    const bad = {
      ...fixture.customStep,
      custom: {
        ...fixture.customStep.custom!,
        params: {
          ...fixture.customStep.custom!.params,
          source: { kind: "literal" as const, value: "accounts.current" },
        },
      },
    };
    const parsed = stepSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("never a literal in");
  });

  it("rejects a params literal that repeats a target phrase the step already grounds", () => {
    const bad = {
      ...fixture.customStep,
      custom: {
        ...fixture.customStep.custom!,
        params: {
          ...fixture.customStep.custom!.params,
          source: { kind: "literal" as const, value: "the current account" },
        },
      },
    };
    expect(stepSchema.safeParse(bad).success).toBe(false);
  });

  it("leaves ordinary literal params alone", () => {
    for (const value of ["250", "bookings-fixture", "2026-09-03", "fixture.json", "example.com"]) {
      const step = {
        ...fixture.customStep,
        custom: { id: "steps/seed.ts#seedDatabase", params: { fixture: { kind: "literal" as const, value } } },
      };
      expect(stepSchema.safeParse(step).success, `rejected the literal "${value}"`).toBe(true);
    }
  });

  it("publishes custom.targets in the generated ir.schema.json", () => {
    const generated = JSON.parse(
      readFileSync(new URL("../json/ir.schema.json", import.meta.url), "utf8"),
    ) as { definitions: { ir: { properties: { custom: { properties: Record<string, unknown> } } } } };
    expect(Object.keys(generated.definitions.ir.properties.custom.properties)).toContain("targets");
  });
});
