/**
 * `yam run --resume <runId> --from <stepId>` (T5.1, REQ-AUTO-3, LLD §8.1, §15).
 *
 * T5.1's Validate list, as one file:
 *
 * 1. **A run interrupted at step 5 and resumed produces results identical to a
 *    full run from step 5 onward.** Not "the resumed run passes" — identical, on
 *    status and matched candidate and captured value, because a resume that
 *    quietly re-resolved a binding differently or lost a capture would still
 *    pass while producing a different run.
 * 2. **A hash mismatch exits 12.** Both hashes, separately: recompiling the flow
 *    and re-recording a binding are different mistakes with the same
 *    consequence, and the message has to say which one happened.
 *
 * The interruption is a real one: the flow is run with `--story` so it stops
 * after the first story, which leaves a run directory with checkpoints for the
 * steps that completed and nothing for the rest — exactly what a killed run
 * leaves.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import type { Checkpoint, StepResult } from "@svatah/yam-schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const YAM = join(ROOT, "packages", "cli", "dist", "bin.js");

const EMAIL = "connected2atul@gmail.com";
const PASSWORD = "qwerty123";
const INPUTS = ["--input", `email=${EMAIL}`, "--input", `password=${PASSWORD}`];

let app: SampleServer;
const projects: string[] = [];

/**
 * `simple.flow`'s first story alone, so the whole run is one story.
 *
 * The fixture's third story cannot pass against the sample application (Phase 4's
 * K8) and its failure is not what this measures. One story keeps the comparison
 * about resume.
 */
const FLOW = `story: I want to validate login
inputs: email: string, password: secret
  Click the sign in button
  Type {input.email} into the username field
  Type {input.password} into the password field
  Click the login button
  Click the Schedule Build link
  Remember the text of the schedule heading as enterprise
  The schedule heading should say {enterprise}

test: I want to validate login
`;

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-resume-"));
  projects.push(dir);
  cpSync(join(FIXTURES, "bindings"), join(dir, "bindings"), { recursive: true });
  cpSync(join(FIXTURES, "data.yaml"), join(dir, "data.yaml"));
  cpSync(join(FIXTURES, "api"), join(dir, "api"), { recursive: true });
  writeFileSync(join(dir, "yam.config.yaml"), config(), "utf8");
  mkdirSync(join(dir, "flows"), { recursive: true });
  writeFileSync(join(dir, "flows", "resume.flow"), FLOW, "utf8");
  return dir;
}

function config(): string {
  return `schemaVersion: "1.0.0"
project: "resume"
environment: test
adapter: playwright
app: { baseUrl: "${app.origin}" }
flows: { dir: flows }
steps: { dir: steps }
bindings: { dir: bindings, testIdAttributes: ["data-testid"] }
data: { file: data.yaml }
api: { dir: api }
run:
  workers: 1
  headless: true
  stepTimeoutMs: 10000
  candidateTimeoutMs: 2000
  screenshots: never
  trace: false
  outputDir: runs
  checkpoints: true
  audit: true
compile: { confidenceThreshold: 0.8 }
record: { model: "none", maxSnapshotTokens: 4000, visionFallback: false }
heal: { onFail: false, relocalizeThreshold: 0.72, margin: 0.1, useModel: false }
`;
}

function cli(args: readonly string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [YAM, ...args], {
      cwd,
      env: { ...process.env, YAM_SAMPLE_PASSWORD: PASSWORD },
    });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

function results(project: string, runId: string): StepResult[] {
  const text = readFileSync(join(project, "runs", runId, "results.jsonl"), "utf8").trim();
  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line) as StepResult);
}

/** The part of a result the plan determines. Times and ids belong to the run. */
const comparable = (r: StepResult): Record<string, unknown> => ({
  story: r.story,
  stepId: r.stepId,
  text: r.text,
  status: r.status,
  by: r.matched?.by ?? null,
  captured: r.captured ?? null,
});

beforeAll(async () => {
  if (!existsSync(YAM)) throw new Error("Run `pnpm -r build` first.");
  app = await startSampleApp(0);
}, 120_000);

afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("resume from a checkpoint (T5.1, REQ-AUTO-3)", () => {
  it("produces results identical to a full run from the resume point onward", async () => {
    const project = scaffold();

    const full = await cli(["run", ".", "--host", "none", "--run-id", "full", ...INPUTS], project);
    expect(full.code, full.output).toBe(0);

    const whole = results(project, "full");
    expect(whole).toHaveLength(7);
    const fifth = whole[4]!.stepId;

    // The checkpoints a real interruption leaves: one per completed step.
    expect(existsSync(join(project, "runs", "full", "checkpoints"))).toBe(true);

    const resumed = await cli(
      ["run", ".", "--host", "none", "--run-id", "resumed", "--resume", "full", "--from", fifth, ...INPUTS],
      project,
    );
    expect(resumed.code, resumed.output).toBe(0);

    expect(results(project, "resumed").map(comparable)).toEqual(whole.slice(4).map(comparable));
  }, 240_000);

  it("carries the captures the interrupted run made", async () => {
    /*
     * The load-bearing half. `The schedule heading should say {enterprise}` is
     * step 7 and `enterprise` is captured at step 6 — a resume that restored the
     * page but not the scope would fail there, and one that restored neither
     * would fail earlier and look like a broken application.
     *
     * Resuming at the *last* step exercises it with nothing but the checkpoint:
     * every value the step reads came out of the run directory.
     */
    const project = scaffold();
    const full = await cli(["run", ".", "--host", "none", "--run-id", "full", ...INPUTS], project);
    expect(full.code, full.output).toBe(0);

    const whole = results(project, "full");
    const last = whole[whole.length - 1]!;
    expect(last.text).toContain("{enterprise}");

    const resumed = await cli(
      ["run", ".", "--host", "none", "--run-id", "one-step", "--resume", "full", "--from", last.stepId, ...INPUTS],
      project,
    );
    expect(resumed.code, resumed.output).toBe(0);

    const only = results(project, "one-step");
    expect(only).toHaveLength(1);
    expect(only[0]!.stepId).toBe(last.stepId);
    expect(only[0]!.status).toBe("passed");
  }, 240_000);

  it("records the checkpoint's hashes, so a resume has something to verify", async () => {
    const project = scaffold();
    await cli(["run", ".", "--host", "none", "--run-id", "full", ...INPUTS], project);

    const whole = results(project, "full");
    const file = join(
      project,
      "runs",
      "full",
      "checkpoints",
      `${whole[0]!.stepId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")}.json`,
    );
    const checkpoint = JSON.parse(readFileSync(file, "utf8")) as Checkpoint;

    expect(checkpoint.planHash).toMatch(/^[0-9a-f]{16,}$/);
    // Not `"none"`: a store with no hash makes the bindings check pass for every
    // store, which is the same as not having one.
    expect(checkpoint.bindingsHash).toMatch(/^[0-9a-f]{16,}$/);
    expect(checkpoint.session.url).toContain(app.origin);
    // Run data is never in a checkpoint (LLD §3.4), so a secret cannot be.
    expect(readFileSync(file, "utf8")).not.toContain(PASSWORD);
  }, 240_000);
});

describe("a resume whose artifacts moved is refused (LLD §15, exit 12)", () => {
  it("exits 12 when the plan has changed, naming the plan", async () => {
    const project = scaffold();
    await cli(["run", ".", "--host", "none", "--run-id", "full", ...INPUTS], project);
    const fifth = results(project, "full")[4]!.stepId;

    // One more step: the flow still compiles, and every step id after the
    // insertion point now means something else.
    writeFileSync(
      join(project, "flows", "resume.flow"),
      FLOW.replace("  Click the login button", "  Click the login button\n  Click the login button"),
      "utf8",
    );

    const refused = await cli(
      ["run", ".", "--host", "none", "--run-id", "no", "--resume", "full", "--from", fifth, ...INPUTS],
      project,
    );
    expect(refused.code).toBe(12);
    expect(refused.output).toContain("plan has changed");
    // And nothing was run: a refused resume leaves no results behind.
    expect(existsSync(join(project, "runs", "no", "results.jsonl"))).toBe(false);
  }, 240_000);

  it("exits 12 when a binding has changed, naming the bindings", async () => {
    const project = scaffold();
    await cli(["run", ".", "--host", "none", "--run-id", "full", ...INPUTS], project);
    const fifth = results(project, "full")[4]!.stepId;

    const binding = join(project, "bindings", "app", "schedule-build-link.yaml");
    writeFileSync(
      binding,
      readFileSync(binding, "utf8").replace('score: 0.98', 'score: 0.97'),
      "utf8",
    );

    const refused = await cli(
      ["run", ".", "--host", "none", "--run-id", "no", "--resume", "full", "--from", fifth, ...INPUTS],
      project,
    );
    expect(refused.code).toBe(12);
    expect(refused.output).toContain("bindings have changed");
  }, 240_000);

  it("says so plainly when there is no checkpoint to resume from", async () => {
    const project = scaffold();
    await cli(["run", ".", "--host", "none", "--run-id", "full", ...INPUTS], project);
    const first = results(project, "full")[0]!.stepId;

    // The first step has nothing before it, so there is nothing to resume out of.
    const refused = await cli(
      ["run", ".", "--host", "none", "--run-id", "no", "--resume", "full", "--from", first, ...INPUTS],
      project,
    );
    expect(refused.code).toBe(64);
    expect(refused.output).toContain("first step");

    const unknown = await cli(
      ["run", ".", "--host", "none", "--run-id", "no", "--resume", "full", "--from", "nope#3", ...INPUTS],
      project,
    );
    expect(unknown.code).toBe(64);
    expect(unknown.output).toContain('no flow in the plan has a step "nope#3"'.replace("no", "No"));
  }, 240_000);

  it("refuses --resume without --from, and --from without --resume", async () => {
    const project = scaffold();
    expect((await cli(["run", ".", "--resume", "full"], project)).code).toBe(64);
    expect((await cli(["run", ".", "--from", "x#1"], project)).code).toBe(64);
  }, 120_000);
});
