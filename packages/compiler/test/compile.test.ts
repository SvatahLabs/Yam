/**
 * T2.5 — the pipeline, validation, the plan and lint (REQ-COMP-1, 5..9,
 * REQ-AUTO-5, LLD §4).
 *
 * Validate: "Byte-stability; error matrix; fixtures compile clean; a story
 * exposing outputs not captured fails."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatDiagnostic,
  readProject,
  readProjectFrom,
  type Diagnostic,
  type Project,
} from "@svatah/spec";
import { defineStep, loadSteps, StepRegistry } from "@svatah/steps";
import { compile, lintPlan, renderPlan, STABLE_TIMESTAMP } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const GOLDEN_PROJECT = join(ROOT, "evals", "compiler", "project");

/** A one-file project, for the error matrix. */
function project(flow: string, extra: Partial<Parameters<typeof readProject>[0]> = {}): Project {
  const { project: read } = readProject({
    flows: [{ file: "flows/a.flow", text: flow }],
    env: {},
    ...extra,
  });
  return read;
}

function compileFlow(flow: string, extra?: Partial<Parameters<typeof readProject>[0]>) {
  return compile({ project: project(flow, extra), projectName: "test", stable: true });
}

const codes = (diagnostics: readonly Diagnostic[]): string[] => diagnostics.map((d) => d.code);
const errors = (diagnostics: readonly Diagnostic[]): Diagnostic[] =>
  diagnostics.filter((d) => d.severity === "error");

describe("compiling a story (REQ-COMP-1)", () => {
  const { plan, diagnostics, ok } = compileFlow(`story: Validate login
  Click the sign in button
  Type "atul" into the username field
`);

  it("compiles clean", () => {
    expect(errors(diagnostics).map(formatDiagnostic)).toEqual([]);
    expect(ok).toBe(true);
  });

  it("yields exactly one step per sentence", () => {
    expect(plan.stories[0]!.steps).toHaveLength(2);
  });

  it("gives every step a positional id, so fixing a typo does not move it", () => {
    // Step ids go into results, checkpoints and the plan hash, and `--resume`
    // compares plan hashes (REQ-AUTO-3). An id derived from the text would
    // change when the text was corrected.
    expect(plan.stories[0]!.steps.map((s) => s.id)).toEqual([
      "Validate login#1",
      "Validate login#2",
    ]);
  });

  it("records the story's metadata and the file it came from", () => {
    expect(plan.stories[0]!.file).toBe("flows/a.flow");
    expect(plan.stories[0]!.meta).toEqual({ enabled: true, onFailure: "stop", tags: [] });
  });
});

describe("byte-stability (REQ-COMP-7, `--stable`)", () => {
  const flow = readFileSync(join(FIXTURES, "flows", "simple.flow"), "utf8");

  it("two compiles of one input are the same bytes", () => {
    const first = renderPlan(compileFlow(flow).plan);
    const second = renderPlan(compileFlow(flow).plan);
    expect(first).toBe(second);
  });

  it("`--stable` fixes the one field that would otherwise differ", () => {
    expect(compileFlow(flow).plan.generatedAt).toBe(STABLE_TIMESTAMP);
  });

  it("without `--stable`, only the timestamp differs", () => {
    // Which is the claim worth making: the plan's *content* is a function of its
    // input, and the timestamp is the single exception.
    const a = compile({ project: project(flow), projectName: "test" }).plan;
    const b = compile({ project: project(flow), projectName: "test" }).plan;
    expect({ ...a, generatedAt: "" }).toEqual({ ...b, generatedAt: "" });
    expect(a.hash).toBe(b.hash);
  });

  it("hashes the plan's content, not its timestamp", () => {
    // `--resume` refuses a run whose plan hash changed (REQ-AUTO-3). If the
    // timestamp counted, recompiling the same flows would make every in-flight
    // run unresumable — the check firing on the one case it exists to allow.
    const stable = compileFlow(flow).plan;
    const live = compile({ project: project(flow), projectName: "test" }).plan;
    expect(live.hash).toBe(stable.hash);
    expect(live.generatedAt).not.toBe(stable.generatedAt);
  });

  it("a changed step changes the hash", () => {
    const changed = compileFlow(flow.replace("Click the sign in button", "Click the login button"));
    expect(changed.plan.hash).not.toBe(compileFlow(flow).plan.hash);
  });
});

describe("the error matrix (REQ-COMP-6)", () => {
  it("E_VAR_UNDEFINED: a capture read before anything makes it", () => {
    const { diagnostics } = compileFlow(`story: One
  Type {enterprise} into the username field
  Remember the text of the heading as enterprise
`);
    expect(codes(errors(diagnostics))).toEqual(["E_VAR_UNDEFINED"]);
    expect(errors(diagnostics)[0]!.message).toContain("before anything captures it");
  });

  it("accepts the same reference once the capture is earlier", () => {
    const { ok } = compileFlow(`story: One
  Remember the text of the heading as enterprise
  Type {enterprise} into the username field
`);
    expect(ok).toBe(true);
  });

  it("E_VAR_UNDEFINED: an input the story does not declare", () => {
    const { diagnostics } = compileFlow(`story: One
inputs: email: string
  Type {input.password} into the password field
`);
    expect(codes(errors(diagnostics))).toEqual(["E_VAR_UNDEFINED"]);
    expect(errors(diagnostics)[0]!.message).toContain("It declares: email");
  });

  it("E_VAR_REDEFINED: a name captured twice", () => {
    const { diagnostics } = compileFlow(`story: One
  Remember the text of the heading as x
  Remember the text of the other heading as x
  Type {x} into the username field
`);
    expect(codes(errors(diagnostics))).toEqual(["E_VAR_REDEFINED"]);
  });

  it("E_OUTPUT_UNCAPTURED: a story exposing an output nothing captures", () => {
    // T2.5 Validate names this one specifically. A signature that promises an
    // output the story never produces is a function that returns undefined, and
    // a caller has no way to find that out except by running it.
    const { diagnostics, ok } = compileFlow(`story: One
outputs: bookingId: string
  Click the Book now button
`);
    expect(codes(errors(diagnostics))).toEqual(["E_OUTPUT_UNCAPTURED"]);
    expect(ok).toBe(false);
  });

  it("E_UNKNOWN_STORY: an invoke of a story that does not exist", () => {
    const { diagnostics } = compileFlow(`story: One
  Run the "Nowhere" story
`);
    expect(codes(errors(diagnostics))).toContain("E_UNKNOWN_STORY");
  });

  it("E_INPUT_REQUIRED: an invoke that omits an input with no default", () => {
    const { diagnostics } = compileFlow(`story: Book
inputs: date: string
  Click the Book now button

story: One
  Run the "Book" story
`);
    expect(codes(errors(diagnostics))).toContain("E_INPUT_REQUIRED");
  });

  it("accepts an omitted input that has a default", () => {
    const { ok } = compileFlow(`story: Book
inputs: date: string = "2026-09-03"
  Click the Book now button

story: One
  Run the "Book" story
`);
    expect(ok).toBe(true);
  });

  it("E_VAR_UNDEFINED: an invoke passing an input the story does not declare", () => {
    const { diagnostics } = compileFlow(`story: Book
  Click the Book now button

story: One
  Run the "Book" story with date={data.date}
`);
    expect(codes(errors(diagnostics))).toContain("E_VAR_UNDEFINED");
  });

  it("E_UNKNOWN_STORY: a compensating story that does not exist", () => {
    // Named in metadata rather than by a step, so nothing else would notice.
    const { diagnostics } = compileFlow(`story (onFailure=compensate:Clean up): One
  Click the Book now button
`);
    expect(codes(errors(diagnostics))).toContain("E_UNKNOWN_STORY");
  });

  it("E_UNKNOWN_API: a request the project does not have", () => {
    const { diagnostics } = compileFlow(
      `story: One\n  Call the "nowhere" API and remember the response as n\n  Type {n} into the field\n`,
      { apis: [{ file: "api/count.yaml", text: 'name: "active count"\nmethod: GET\nurl: "/x"\n' }] },
    );
    expect(codes(errors(diagnostics))).toContain("E_UNKNOWN_API");
    expect(errors(diagnostics)[0]!.message).toContain('"active count"');
  });

  it("E_VAR_UNDEFINED: a data path the run data does not have", () => {
    const { diagnostics } = compileFlow(
      `story: One\n  Type {data.nope} into the username field\n`,
      { data: { file: "data.yaml", text: "user:\n  email: \"a@b.c\"\n" } },
    );
    expect(codes(errors(diagnostics))).toContain("E_VAR_UNDEFINED");
  });

  it("says nothing about data paths when the project has no data file", () => {
    // A project with no `data.yaml` is not a project where every reference is
    // wrong; it is a project that supplies data another way (SVATAH_DATA_*).
    const { ok } = compileFlow(`story: One\n  Type {data.anything} into the username field\n`);
    expect(ok).toBe(true);
  });
});

/** The golden project's `steps/`, loaded once. */
const STEPS = (await loadSteps(GOLDEN_PROJECT, "steps")).registry;

describe("Tier 0 ahead of Tier 1 (REQ-LANG-16)", () => {

  it("compiles a custom step, with targets in `targets` and values in `params`", () => {
    const { plan, diagnostics } = compile({
      project: project(
        "story: One\n  Transfer 250 from the current account to the savings account\n",
      ),
      steps: STEPS,
      projectName: "test",
      stable: true,
    });
    expect(errors(diagnostics)).toEqual([]);

    const step = plan.stories[0]!.steps[0]!;
    expect(step.action).toBe("custom");
    expect(step.custom?.id).toBe("steps/transfer.ts#default");
    expect(step.custom?.params).toEqual({ amount: { kind: "literal", value: "250" } });
    expect(Object.keys(step.custom?.targets ?? {})).toEqual(["from", "to"]);
    expect(step.origin).toEqual({ tier: 0, rule: "steps/transfer.ts#default", confidence: 1 });
  });

  it("copies sideEffect from the definition (REQ-AUTO-8)", () => {
    const { plan } = compile({
      project: project("story: One\n  Seed the database with \"bookings\"\n"),
      steps: STEPS,
      projectName: "test",
      stable: true,
    });
    expect(plan.stories[0]!.steps[0]!.sideEffect).toBe(true);
  });

  it("records the custom step ids the plan uses", () => {
    const { plan } = compile({
      project: project("story: One\n  Seed the database with \"bookings\"\n"),
      steps: STEPS,
      projectName: "test",
      stable: true,
    });
    expect(plan.customSteps).toEqual(["steps/seed.ts#seedDatabase"]);
  });

  it("E_STEP_AMBIGUOUS when a sentence matches a custom step and the grammar", () => {
    // Which one ran would otherwise depend on the order the tiers happen to be
    // tried, which is nothing a reader can see.
    const clash = new StepRegistry([
      defineStep("Click {what:target}", () => {}).withId("steps/click.ts#default"),
    ]);

    const { diagnostics } = compile({
      project: project("story: One\n  Click the sign in button\n"),
      steps: clash,
      projectName: "test",
      stable: true,
    });
    expect(codes(errors(diagnostics))).toEqual(["E_STEP_AMBIGUOUS"]);
    expect(errors(diagnostics)[0]!.message).toContain("steps/click.ts#default");
    expect(errors(diagnostics)[0]!.message).toContain("grammar pattern");
  });
});

describe("lint (REQ-COMP-8)", () => {
  it("W_LONG_SLEEP over five seconds, and nothing at five", () => {
    const long = compileFlow("story: One\n  Wait 8 seconds\n");
    expect(codes(lintPlan(long.plan))).toEqual(["W_LONG_SLEEP"]);
    const short = compileFlow("story: One\n  Wait 5 seconds\n");
    expect(codes(lintPlan(short.plan))).toEqual([]);
  });

  it("W_CUSTOM for every Tier 0 step, so project code stays visible", () => {
    const { plan } = compile({
      project: project('story: One\n  Seed the database with "bookings"\n'),
      steps: STEPS,
      projectName: "test",
      stable: true,
    });
    expect(codes(lintPlan(plan))).toEqual(["W_CUSTOM"]);
  });

  it("W_UNUSED_CAPTURE for a name nothing reads", () => {
    const { diagnostics } = compileFlow(
      "story: One\n  Remember the text of the heading as unused\n",
    );
    expect(codes(diagnostics)).toEqual(["W_UNUSED_CAPTURE"]);
  });

  it("does not warn about a capture that is a declared output", () => {
    const { diagnostics } = compileFlow(
      "story: One\noutputs: heading: string\n  Remember the text of the heading as heading\n",
    );
    expect(codes(diagnostics)).toEqual([]);
  });

  it("W_SIDE_EFFECT_TOOL for a non-idempotent story exposed as a tool (REQ-AUTO-8)", () => {
    const { plan } = compileFlow("story: Pay\n  Click the pay button\n");
    expect(codes(lintPlan(plan, { exposedAsTools: ["Pay"] }))).toEqual(["W_SIDE_EFFECT_TOOL"]);
  });

  it("says nothing when the story declares itself idempotent", () => {
    const { plan } = compileFlow("story (idempotent): Pay\n  Click the pay button\n");
    expect(codes(lintPlan(plan, { exposedAsTools: ["Pay"] }))).toEqual([]);
  });

  it("says nothing about a story nobody exposes", () => {
    const { plan } = compileFlow("story: Pay\n  Click the pay button\n");
    expect(codes(lintPlan(plan))).toEqual([]);
  });

  it("W_LOW_CONFIDENCE only below the configured threshold", () => {
    // Tier 1 is deterministic and always 1.0, so nothing fires unless a
    // threshold above 1 is configured — which is the honest state until the
    // model tiers arrive.
    const { plan } = compileFlow("story: One\n  Click the sign in button\n");
    expect(codes(lintPlan(plan, { confidenceThreshold: 0.9 }))).toEqual([]);
    expect(codes(lintPlan(plan, { confidenceThreshold: 1.5 }))).toEqual(["W_LOW_CONFIDENCE"]);
  });
});

describe("the fixture flows compile clean (REQ-NFR-8, T2.5 Validate)", () => {
  const { project: fixtures, diagnostics: read } = readProjectFrom({
    root: FIXTURES,
    flowsDir: "flows",
    apiDir: "api",
    dataFile: "data.yaml",
    env: {},
  });
  const { plan, diagnostics, ok } = compile({
    project: fixtures,
    projectName: "svatah-fixtures",
    stable: true,
  });

  it("reads with no errors", () => {
    expect(errors(read).map(formatDiagnostic)).toEqual([]);
  });

  it("compiles with no errors", () => {
    expect(errors(diagnostics).map(formatDiagnostic)).toEqual([]);
    expect(ok).toBe(true);
  });

  it("produces every story", () => {
    expect(plan.stories.map((s) => s.name).sort()).toEqual(
      [...fixtures.stories.keys()].sort(),
    );
  });

  it("compiles every step of every story", () => {
    for (const story of plan.stories) {
      const block = fixtures.stories.get(story.name)!.story;
      expect(story.steps.length, `${story.name}`).toBe(block.steps.length);
    }
  });

  it("carries the run blocks and the compositions", () => {
    expect(plan.runs["flows/execution.flow"]).toHaveLength(7);
    expect(plan.compositions["I want to validate stories"]).toHaveLength(3);
  });

  it("names the API request the flows call", () => {
    expect(plan.apis).toEqual(["active count"]);
  });

  it("marks the secrets the data file declares (REQ-NFR-6)", () => {
    const step = plan.stories
      .flatMap((s) => s.steps)
      .find((s) => s.text.includes("{data.card.number}"))!;
    expect(step.args?.["value"]).toEqual({ kind: "data", path: "card.number", secret: true });
  });

  it("is byte-stable across two compiles", () => {
    const again = compile({ project: fixtures, projectName: "svatah-fixtures", stable: true });
    expect(renderPlan(again.plan)).toBe(renderPlan(plan));
  });
});
