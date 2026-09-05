/**
 * T2.8 — `svatah host generate` and the retry policy (REQ-RUN-12, LLD §9.1).
 *
 * The generated spec is what makes a flow a thing Playwright Test can discover,
 * so what it says matters as much as that it exists: a serial describe, one test
 * per story in the run block's order, and compositions expanded.
 */
import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSpecs, renderSpec, retriesAllowed, specName } from "../src/index.js";
import { compiledPlan } from "./compile.js";

const plan = await compiledPlan();

test.describe("host generate", () => {
  test("writes one spec per flow, with one test per story in order", async () => {
    const out = mkdtempSync(join(tmpdir(), "svatah-specs-"));
    const specs = generateSpecs({ plan, outDir: out, importFrom: "../../src/index.js" });

    expect(specs).toHaveLength(1);
    expect(readdirSync(out)).toEqual(["host.spec.ts"]);

    const text = readFileSync(specs[0]!.path, "utf8");
    // Compositions expand in place (REQ-LANG-10): the run block names
    // "sign in and check", and the spec names the two stories it holds.
    expect(specs[0]!.stories).toEqual(["Sign in", "Check the heading"]);
    expect(text).toContain('test("Sign in"');
    expect(text).toContain('test("Check the heading"');
    expect(text.indexOf('test("Sign in"')).toBeLessThan(text.indexOf('test("Check the heading"'));
  });

  test("configures the describe as serial, because a flow is one conversation", async () => {
    // The second story reads what the first captured. Parallel tests would each
    // get their own worker and the capture would read nothing.
    expect(renderSpec("flows/a.flow", ["A", "B"])).toContain('mode: "serial"');
  });

  test("says it is generated and names the flow it came from", async () => {
    const text = renderSpec("flows/simple.flow", ["One"]);
    expect(text).toContain("GENERATED from flows/simple.flow");
    expect(text).toContain("do not edit");
  });

  test("names the spec after the flow", async () => {
    expect(specName("flows/natural_language_login.flow")).toBe("natural_language_login");
  });

  test("writes no file for a flow whose run block is empty", async () => {
    // An empty spec is a test file Playwright reports as having no tests, which
    // reads like a configuration problem rather than an empty flow.
    const out = mkdtempSync(join(tmpdir(), "svatah-specs-"));
    generateSpecs({ plan: { ...plan, runs: { "flows/empty.flow": [] } }, outDir: out });
    expect(readdirSync(out)).toEqual([]);
  });
});

test.describe("retry policy gating (LLD §9.1)", () => {
  test("retries are off for an ordinary story", async () => {
    // A retry re-runs a story from the top. For a story that books a slot that
    // is a second booking, so the default has to be off.
    expect(retriesAllowed(plan, "Sign in")).toBe(false);
  });

  test("retries are allowed for a story marked idempotent", async () => {
    expect(retriesAllowed(plan, "Check the heading")).toBe(true);
  });

  test("retries are allowed when the flow's policy is continue", async () => {
    const withPolicy = {
      ...plan,
      stories: plan.stories.map((story) =>
        story.name === "Sign in"
          ? { ...story, meta: { ...story.meta, onFailure: "continue" as const } }
          : story,
      ),
    };
    expect(retriesAllowed(withPolicy, "Sign in")).toBe(true);
  });

  test("a story the plan does not have gets no retries", async () => {
    expect(retriesAllowed(plan, "Nowhere")).toBe(false);
  });
});
