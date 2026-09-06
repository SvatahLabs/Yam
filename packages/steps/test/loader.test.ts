/**
 * T2.3 — the loader, the registry and IR emission (REQ-LANG-15, 16, LLD §5).
 *
 * Validate: "Example step with a `target` placeholder compiles, records
 * (Phase 3) and runs; ambiguity test; handler cannot reach the adapter (type
 * test)."
 *
 * The example is loaded from a real `steps/` directory rather than constructed
 * inline, so the loader, the id scheme and the documented example are all
 * exercised by the same test.
 */
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TargetRef, ValueRef } from "@svatah/yam-schema";
import { defineStep, emitCustom, loadSteps, StepRegistry } from "../src/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const loaded = await loadSteps(FIXTURES, "steps");

describe("loading steps/ (REQ-LANG-15)", () => {
  it("loads every custom step in the directory", () => {
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.registry.ids()).toEqual([
      "steps/transfer.ts#default",
      "steps/transfer.ts#seed",
    ]);
  });

  it("ids a step by file and export name, with posix separators", () => {
    // `custom.id` goes into the plan, and a plan compiled on Windows has to
    // match one compiled on Linux (REQ-COMP-7).
    for (const id of loaded.registry.ids()) expect(id).not.toContain("\\");
    expect(loaded.registry.ids()[0]).toMatch(/^steps\/transfer\.ts#/);
  });

  it("carries the meta the author declared", () => {
    const step = loaded.registry.all().find((s) => s.id.endsWith("#default"))!;
    expect(step.meta).toEqual({
      sideEffect: true,
      description: "Moves funds between two accounts",
    });
  });

  it("reports a file under steps/ that exports no step, rather than skipping it", async () => {
    // Silently skipping it would mean a step someone wrote never runs and never
    // says why.
    const broken = await loadSteps(join(FIXTURES, "broken"), "steps");
    expect(broken.diagnostics.map((d) => d.code)).toEqual(["E_STEP_LOAD"]);
    expect(broken.diagnostics[0]!.message).toContain("exports no custom step");
  });

  it("is empty and quiet when the project has no steps/ directory", async () => {
    const none = await loadSteps(FIXTURES, "does-not-exist");
    expect(none.registry.all()).toEqual([]);
    expect(none.diagnostics).toEqual([]);
  });
});

describe("matching ahead of the grammar (REQ-LANG-16)", () => {
  it("claims a sentence its template covers", () => {
    const result = loaded.registry.match(
      "Transfer 250 from the current account to the savings account",
    );
    expect(result.outcome).toBe("one");
  });

  it("claims nothing it does not cover", () => {
    expect(loaded.registry.match("Click the sign in button").outcome).toBe("none");
  });

  it("reports every claimant when two templates match one sentence", () => {
    // Which one ran would otherwise depend on file order.
    const registry = new StepRegistry([
      defineStep("Do {a:target} now", () => {}).withId("steps/a.ts#default"),
      defineStep("Do {b:target} at {when:string}", () => {}).withId("steps/b.ts#default"),
      defineStep("Do the {what:string} now", () => {}).withId("steps/c.ts#default"),
    ]);
    const result = registry.match("Do the thing now");
    expect(result.outcome).toBe("ambiguous");
    expect(result.outcome === "ambiguous" ? result.matches.map((m) => m.step.id) : []).toEqual([
      "steps/a.ts#default",
      "steps/c.ts#default",
    ]);
  });

  it("reports two definitions of one template as E_STEP_AMBIGUOUS", () => {
    const registry = new StepRegistry();
    registry.add(defineStep("Reset the fixtures", () => {}).withId("steps/a.ts#default"));
    const clash = registry.add(
      defineStep("Reset the fixtures", () => {}).withId("steps/b.ts#default"),
    );
    expect(clash?.code).toBe("E_STEP_AMBIGUOUS");
    expect(clash?.message).toContain("steps/a.ts#default");
    expect(clash?.message).toContain("steps/b.ts#default");
  });
});

describe("emitting the IR (LLD §3.2, §5, Draft 2.2)", () => {
  const options = {
    parseValue: (raw: string): ValueRef =>
      raw.startsWith("{")
        ? { kind: "data", path: raw.slice(1, -1).replace(/^data\./, "") }
        : { kind: "literal", value: raw.replace(/^"|"$/g, "") },
    resolveTarget: (phrase: string): TargetRef => ({
      ref: phrase.replace(/^the /, "").replace(/\s+/g, "-"),
      phrase,
      status: "unbound",
    }),
  };

  it("puts targets in `targets` and everything else in `params`", () => {
    // A target written as a literal in `params` is invisible to the recorder,
    // which grounds targets, and to the resolver, which resolves them — the step
    // would compile, record clean, and act on nothing. Draft 2.2 added
    // `custom.targets` for exactly this.
    const step = loaded.registry.all().find((s) => s.id.endsWith("#default"))!;
    const match = loaded.registry.matchAll(
      "Transfer 250 from the current account to the savings account",
    )[0]!.match;

    expect(emitCustom(step.placeholders, match, options)).toEqual({
      params: { amount: { kind: "literal", value: "250" } },
      targets: {
        from: { ref: "current-account", phrase: "the current account", status: "unbound" },
        to: { ref: "savings-account", phrase: "the savings account", status: "unbound" },
      },
    });
  });

  it("sends a `value` placeholder through the caller's parser", () => {
    const step = defineStep("Enter {v:value} into {field:target}", () => {});
    const match = new StepRegistry([step.withId("x")]).matchAll(
      "Enter {data.user.email} into the username field",
    )[0]!.match;
    expect(emitCustom(step.placeholders, match, options).params).toEqual({
      v: { kind: "data", path: "user.email" },
    });
  });
});
