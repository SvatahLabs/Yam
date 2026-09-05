/**
 * Tier 3 — the frontier model, for Tier 2's residue (T4.4, REQ-COMP-4).
 *
 * No credential was available to this phase, so nothing here measures a frontier
 * model's accuracy and nothing here claims to. What it does check is everything
 * that is true of a Tier 3 step whichever model produced it: that it is only
 * asked about what Tier 2 declined, that its provenance is mandatory and carries
 * the prompt version, and that `svatah lint` reports it.
 *
 * The real-model run is blocked and the command is recorded in
 * `docs/spec/progress/phase-4.md`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { clearTiers, compileWithModelTiers, lintPlan, registerTier } from "@svatah/compiler";
import { fakeGateway } from "@svatah/gateway";
import { readProject } from "@svatah/spec";
import { tier2 } from "../src/tiers/tier2.js";
import { tier3, TIER3_MAX_CONFIDENCE, TIER3_PROMPT_VERSION } from "../src/tiers/tier3.js";

afterEach(() => clearTiers());

const FLOW = `story: Loose
  Tap the sign in button
  Hang about until the dashboard heading turns up

test: Loose
`;

const read = (): ReturnType<typeof readProject>["project"] =>
  readProject({ flows: [{ file: "loose.flow", text: FLOW }] }).project;

/** Answers whatever it is asked about, so "did it get asked" is the question. */
function recording(label: string, answers: Record<string, unknown>) {
  const asked: string[] = [];
  const gateway = fakeGateway({
    label,
    answer: (request) => {
      asked.push(request.user);
      return answers[request.user] ?? null;
    },
  });
  return { gateway, asked };
}

describe("Tier 3 sees only Tier 2's residue (REQ-COMP-4)", () => {
  it("is not asked about a sentence Tier 2 placed", async () => {
    /*
     * REQ-NFR-2 confines model usage, and this is where that is decided: the
     * tiers are asked in order and the first that answers wins. A frontier call
     * for a sentence a local model already handled is money spent on nothing.
     */
    const two = recording("two", {
      "Tap the sign in button": { action: "click", target: { phrase: "the sign in button" } },
    });
    const three = recording("three", {
      "Hang about until the dashboard heading turns up": {
        action: "waitFor",
        target: { phrase: "the dashboard heading" },
        expect: { subject: "target", predicate: { kind: "visible" } },
      },
    });
    registerTier(tier2({ provider: "ollama", endpoint: "http://x", model: "f", gateway: two.gateway }));
    registerTier(tier3({ model: "claude-opus-5", gateway: three.gateway }));

    const result = await compileWithModelTiers(
      { project: read(), projectName: "t", stable: true },
      { tier2: true, tier3: true },
    );

    expect(result.ok).toBe(true);
    // Both sentences reached Tier 2; only the one it declined reached Tier 3.
    expect(two.asked).toEqual([
      "Tap the sign in button",
      "Hang about until the dashboard heading turns up",
    ]);
    expect(three.asked).toEqual(["Hang about until the dashboard heading turns up"]);

    const steps = result.plan.stories[0]!.steps;
    expect(steps.map((s) => s.origin.tier)).toEqual([2, 3]);
  });

  it("is never asked at all when --tier3 was not given", async () => {
    const three = recording("three", {});
    registerTier(tier3({ model: "claude-opus-5", gateway: three.gateway }));

    await compileWithModelTiers(
      { project: read(), projectName: "t", stable: true },
      { tier2: true },
    );
    expect(three.asked).toEqual([]);
  });
});

describe("provenance on every Tier 3 step (T4.4's Validate, REQ-AGT-3, REQ-STD-4)", () => {
  it("carries the model and the prompt version", async () => {
    const three = recording("three", {
      "Tap the sign in button": { action: "click", target: { phrase: "the sign in button" } },
      "Hang about until the dashboard heading turns up": {
        action: "waitFor",
        target: { phrase: "the dashboard heading" },
        expect: { subject: "target", predicate: { kind: "visible" } },
      },
    });
    registerTier(tier3({ model: "claude-opus-5", gateway: three.gateway }));

    const result = await compileWithModelTiers(
      { project: read(), projectName: "t", stable: true },
      { tier3: true },
    );

    expect(result.ok).toBe(true);
    for (const step of result.plan.stories[0]!.steps) {
      expect(step.origin.tier).toBe(3);
      // The schema *refuses* a tier 3 step without provenance, so a plan that
      // parsed is already a plan where this holds; asserting it here says which
      // fields a reviewer can rely on.
      expect(step.origin.provenance).toBeDefined();
      expect(step.origin.provenance!.model).toBe("fake:three");
      expect(step.origin.provenance!.promptVersion).toBe(TIER3_PROMPT_VERSION);
      expect(step.origin.confidence).toBe(TIER3_MAX_CONFIDENCE);
    }
  });

  it("uses prompt version c3-1, which T4.4 names", () => {
    expect(TIER3_PROMPT_VERSION).toBe("c3-1");
  });

  it("stays below the default confidence threshold, so lint flags it", () => {
    // Better than a 3B model at reading one sentence out of context, and still a
    // guess about what a person meant (REQ-COMP-8).
    expect(TIER3_MAX_CONFIDENCE).toBeGreaterThan(0.6);
    expect(TIER3_MAX_CONFIDENCE).toBeLessThan(0.8);
  });
});

describe("lint reports both model tiers (REQ-COMP-8)", () => {
  it("emits W_TIER3 and W_LOW_CONFIDENCE for a Tier 3 step", async () => {
    const three = recording("three", {
      "Tap the sign in button": { action: "click", target: { phrase: "the sign in button" } },
    });
    registerTier(tier3({ model: "claude-opus-5", gateway: three.gateway }));

    const result = await compileWithModelTiers(
      { project: read(), projectName: "t", stable: true },
      { tier3: true },
    );
    const warnings = lintPlan(result.plan, { confidenceThreshold: 0.8 }).map((d) => d.code);
    expect(warnings).toContain("W_TIER3");
    expect(warnings).toContain("W_LOW_CONFIDENCE");
    expect(warnings).not.toContain("W_TIER2");
  });

  it("emits W_TIER2 for a Tier 2 step and not W_TIER3", async () => {
    const two = recording("two", {
      "Tap the sign in button": { action: "click", target: { phrase: "the sign in button" } },
    });
    registerTier(tier2({ provider: "ollama", endpoint: "http://x", model: "f", gateway: two.gateway }));

    const result = await compileWithModelTiers(
      { project: read(), projectName: "t", stable: true },
      { tier2: true },
    );
    const warnings = lintPlan(result.plan, { confidenceThreshold: 0.8 }).map((d) => d.code);
    expect(warnings).toContain("W_TIER2");
    expect(warnings).not.toContain("W_TIER3");
  });
});

describe("a Tier 3 failure leaves a compile error, not a missing step", () => {
  it("falls through to E_NO_MATCH when nothing could place the sentence", async () => {
    const three = recording("three", {});
    registerTier(tier3({ model: "claude-opus-5", gateway: three.gateway }));

    const result = await compileWithModelTiers(
      { project: read(), projectName: "t", stable: true },
      { tier3: true },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.filter((d) => d.code === "E_NO_MATCH")).toHaveLength(2);
  });
});
