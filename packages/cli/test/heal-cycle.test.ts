/**
 * The heal cycle, end to end, through both command lines (P2-F1).
 *
 * Phase 2's verification found that healing a *run* did not work through either
 * command line, for two different reasons:
 *
 * - `yam heal --run` answered `not-found`. Its runtime replayer reported
 *   `reached` for a failure at a story's first step without opening the base URL
 *   first, so relocalization ran against `about:blank` and, correctly, found
 *   nothing there.
 * - `yam-bindings heal --run` answered `unreachable`. The executor recorded
 *   no session state with a failure, so module (a)'s session-state replayer had
 *   no page to restore.
 *
 * Draft 2.4 fixes both (LLD §3.4 `failure.session`, §10 flow-start navigation
 * and the URL check). This test is the thing that would have caught it: break a
 * binding, run, heal, apply, re-run, and require green. Not "the healer proposed
 * something" — the whole cycle, because every one of those steps was individually
 * fine while the cycle was broken.
 *
 * Both command lines and both shapes of failure are covered: one at a story's
 * first step (nothing to replay, the flow-start navigation is the whole answer)
 * and one at a later step behind a navigation (the login has to happen first).
 *
 * ## The inputs case (P4-F1, Draft 2.6, LLD §10)
 *
 * Phase 4's verification found the whole thing still broken for the flow the
 * repository actually ships. `evals/fixtures/flows/simple.flow` signs in with
 * `Type {input.email}` and `Type {input.password}`, and the runtime replayer ran
 * its prefix with an empty scope: the typed steps failed, the replay reported
 * `unreachable`, and the message blamed the page. The cycle above passed only
 * because its own flow hard-codes the credentials, which no real one does.
 *
 * So the third shape: a story *with a signature*, failing behind its login. It
 * is exercised through both command lines and both ways of supplying an input —
 * `--input` and `YAM_INPUT_<NAME>` — and the no-input case is asserted too,
 * because "unreachable" that does not name the missing input is the defect.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import type { StepResult } from "@svatah/yam-schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const YAM = join(ROOT, "packages", "cli", "dist", "bin.js");
const YAM_BINDINGS = join(ROOT, "packages", "bindings-cli", "dist", "bin.js");

let app: SampleServer;
const projects: string[] = [];

/**
 * The flow: sign in, then reach a page only the sign-in leads to.
 *
 * Two element ids in it break in interestingly different ways.
 * `home.sign-in-button` is the story's *first* step, so the only thing that puts
 * the session on its page is the flow-start navigation. `app.schedule-build-link`
 * is on `/dashboard`, four steps and one form submission later, so reaching it
 * means either replaying the story (module (b)) or restoring the URL the failure
 * recorded (module (a)) — which is the state that did not exist before.
 */
const FLOW = `story: Sign in and schedule
  Click the sign in button
  Type "connected2atul@gmail.com" into the username field
  Type "qwerty123" into the password field
  Click the login button
  Click the Schedule Build link

test: Sign in and schedule
`;

/**
 * The same journey, with the credentials as typed inputs.
 *
 * A copy of `evals/fixtures/flows/simple.flow`'s signature and first five steps:
 * the shape the shipped fixtures have, and the shape Phase 4 could not heal. The
 * outputs line is kept, because a prefix that stops before the capture is
 * exactly what the replayer has to tolerate.
 */
const FLOW_WITH_INPUTS = `story: Sign in and schedule
inputs: email: string, password: secret
outputs: enterprise: string
  Click the sign in button
  Type {input.email} into the username field
  Type {input.password} into the password field
  Click the login button
  Click the Schedule Build link
  Remember the text of the schedule heading as enterprise

test: Sign in and schedule
`;

const EMAIL = "connected2atul@gmail.com";
const PASSWORD = "qwerty123";

function scaffold(flow: string = FLOW): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-heal-cycle-"));
  projects.push(dir);
  cpSync(join(FIXTURES, "bindings"), join(dir, "bindings"), { recursive: true });
  mkdirSync(join(dir, "flows"), { recursive: true });
  writeFileSync(join(dir, "flows", "cycle.flow"), flow, "utf8");
  writeFileSync(
    join(dir, "yam.config.yaml"),
    `schemaVersion: "1.0.0"
project: "heal-cycle"
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
  checkpoints: false
  audit: true
compile: { confidenceThreshold: 0.8 }
record: { model: "none", maxSnapshotTokens: 4000, visionFallback: false }
heal: { onFail: false, relocalizeThreshold: 0.72, margin: 0.1, useModel: false }
`,
    "utf8",
  );
  return dir;
}

/**
 * Break every candidate of one binding, leaving the fingerprint alone.
 *
 * That is the shape of a real breakage — a class renamed, a test id dropped —
 * and it is the only shape relocalization is *supposed* to repair: the element
 * is still on the page and the fingerprint still describes it.
 */
function breakBinding(project: string, id: string): void {
  const path = join(project, "bindings", `${id.split(".").join("/")}.yaml`);
  const text = readFileSync(path, "utf8");

  // Only the candidates, which end where the first entry's `context:` begins:
  // a `name:` under `fingerprint.attrs` is what the element *is*, and moving it
  // would be breaking the fingerprint too, which is not the case being tested.
  const end = text.indexOf("    context:");
  const candidates = text
    .slice(0, end)
    .replace(/^(\s+(?:value|name): )"(.*)"$/gm, '$1"$2-GONE"');

  writeFileSync(path, candidates + text.slice(end), "utf8");
}

function cli(
  bin: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>> = {},
): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [bin, ...args], { cwd, env: { ...process.env, ...env } });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

function results(project: string, runId: string): StepResult[] {
  const text = readFileSync(join(project, "runs", runId, "results.jsonl"), "utf8").trim();
  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line) as StepResult);
}

async function runFlow(
  project: string,
  runId: string,
  inputs: readonly string[] = [],
): Promise<{ code: number; output: string }> {
  return await cli(
    YAM,
    ["run", ".", "--host", "none", "--run-id", runId, ...inputs.flatMap((i) => ["--input", i])],
    project,
  );
}

beforeAll(async () => {
  if (!existsSync(YAM) || !existsSync(YAM_BINDINGS)) {
    throw new Error("Run `pnpm -r build` first: this exercises the two installed command lines.");
  }
  app = await startSampleApp(0);
}, 120_000);

afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

/** break → run → heal → apply → re-run green. */
async function cycle(
  heal: (project: string) => Promise<{ code: number; output: string }>,
  id: string,
): Promise<void> {
  const project = scaffold();
  breakBinding(project, id);

  const broken = await runFlow(project, "broken");
  expect(broken.code, broken.output).toBe(1);

  const failure = results(project, "broken").find((r) => r.status === "failed");
  expect(failure?.failure?.class).toBe("locator");
  expect(failure?.failure?.message).toContain(id);

  // The state the healer needs, written by the executor (Draft 2.4, LLD §3.4).
  expect(failure?.failure?.session?.url).toBeTypeOf("string");

  const healed = await heal(project);
  expect(healed.code, healed.output).toBe(0);
  expect(healed.output).toMatch(/repaired/);

  // And the repair is in the store, not only in the report.
  const store = readFileSync(join(project, "bindings", `${id.split(".").join("/")}.yaml`), "utf8");
  expect(store).not.toContain("-GONE");

  const green = await runFlow(project, "healed");
  expect(green.code, green.output).toBe(0);
  expect(results(project, "healed").every((r) => r.status === "passed")).toBe(true);
}

describe("healing a run repairs it, through both command lines (P2-F1, LLD §10, §12)", () => {
  it("yam heal --run: a failure at a story's first step", async () => {
    await cycle(
      (project) => cli(YAM, ["heal", "--run", "broken", "--apply"], project),
      "home.sign-in-button",
    );
  }, 180_000);

  it("yam-bindings heal --run: a failure at a story's first step", async () => {
    await cycle(
      (project) =>
        cli(
          YAM_BINDINGS,
          ["heal", "--run", "broken", "--base-url", app.origin, "--apply"],
          project,
        ),
      "home.sign-in-button",
    );
  }, 180_000);

  it("yam heal --run: a failure at a later step, behind a navigation", async () => {
    await cycle(
      (project) => cli(YAM, ["heal", "--run", "broken", "--apply"], project),
      "app.schedule-build-link",
    );
  }, 180_000);

  it("yam-bindings heal --run: a failure at a later step, behind a navigation", async () => {
    await cycle(
      (project) =>
        cli(
          YAM_BINDINGS,
          ["heal", "--run", "broken", "--base-url", app.origin, "--apply"],
          project,
        ),
      "app.schedule-build-link",
    );
  }, 180_000);
});

/**
 * The same cycle for a story with a signature (P4-F1, Draft 2.6, LLD §10).
 *
 * The run is given its inputs, so it gets far enough to fail on the broken
 * binding; the heal has to be given them again, because the run recorded only
 * their *names* — a secret never reaches a run directory (REQ-NFR-6).
 */
async function cycleWithInputs(
  heal: (project: string) => Promise<{ code: number; output: string }>,
): Promise<void> {
  const project = scaffold(FLOW_WITH_INPUTS);
  breakBinding(project, "app.schedule-build-link");

  const broken = await runFlow(project, "broken", [`email=${EMAIL}`, `password=${PASSWORD}`]);
  expect(broken.code, broken.output).toBe(1);

  const failure = results(project, "broken").find((r) => r.status === "failed");
  expect(failure?.failure?.class).toBe("locator");
  expect(failure?.failure?.message).toContain("app.schedule-build-link");

  // The run says which inputs it was given, and never what they were.
  const summary = JSON.parse(
    readFileSync(join(project, "runs", "broken", "summary.json"), "utf8"),
  ) as { inputs?: string[] };
  expect(summary.inputs).toEqual(["email", "password"]);
  expect(readFileSync(join(project, "runs", "broken", "summary.json"), "utf8")).not.toContain(
    PASSWORD,
  );

  const healed = await heal(project);
  expect(healed.code, healed.output).toBe(0);
  expect(healed.output).toMatch(/repaired/);

  const store = readFileSync(
    join(project, "bindings", "app", "schedule-build-link.yaml"),
    "utf8",
  );
  expect(store).not.toContain("-GONE");

  const green = await runFlow(project, "healed", [`email=${EMAIL}`, `password=${PASSWORD}`]);
  expect(green.code, green.output).toBe(0);
  expect(results(project, "healed").every((r) => r.status === "passed")).toBe(true);
}

describe("healing a story with inputs, behind its login (P4-F1, LLD §10)", () => {
  it("yam heal --run --input: the replay is given the credentials", async () => {
    await cycleWithInputs((project) =>
      cli(
        YAM,
        [
          "heal",
          "--run",
          "broken",
          "--apply",
          "--input",
          `email=${EMAIL}`,
          "--input",
          `password=${PASSWORD}`,
        ],
        project,
      ),
    );
  }, 180_000);

  it("yam heal --run with YAM_INPUT_<NAME>: the same, from the environment", async () => {
    await cycleWithInputs((project) =>
      cli(YAM, ["heal", "--run", "broken", "--apply"], project, {
        YAM_INPUT_EMAIL: EMAIL,
        YAM_INPUT_PASSWORD: PASSWORD,
      }),
    );
  }, 180_000);

  it("yam-bindings heal --run: restores the recorded page, inputs or not", async () => {
    await cycleWithInputs((project) =>
      cli(
        YAM_BINDINGS,
        [
          "heal",
          "--run",
          "broken",
          "--base-url",
          app.origin,
          "--apply",
          "--input",
          `email=${EMAIL}`,
          "--input",
          `password=${PASSWORD}`,
        ],
        project,
      ),
    );
  }, 180_000);

  it("an unreachable for want of an input names the input", async () => {
    const project = scaffold(FLOW_WITH_INPUTS);
    breakBinding(project, "app.schedule-build-link");
    expect((await runFlow(project, "broken", [`email=${EMAIL}`, `password=${PASSWORD}`])).code).toBe(
      1,
    );

    const healed = await cli(YAM, ["heal", "--run", "broken", "--json"], project);
    expect(healed.code).toBe(7);

    const report = JSON.parse(healed.output.slice(healed.output.indexOf("{"))) as {
      results: Array<{ outcome: string; message?: string }>;
    };
    expect(report.results[0]?.outcome).toBe("unreachable");
    // The point of the fix: it says *which* input, not "did not reach the step".
    expect(report.results[0]?.message).toContain('"email"');
    expect(report.results[0]?.message).toContain('"password"');
    expect(report.results[0]?.message).toContain("YAM_INPUT_EMAIL");
  }, 180_000);
});

describe("the replayers say how they got there (LLD §10)", () => {
  it("yam heal --run replays the story; yam-bindings restores the recorded page", async () => {
    const project = scaffold();
    breakBinding(project, "app.schedule-build-link");
    expect((await runFlow(project, "broken")).code).toBe(1);

    const viaRuntime = await cli(YAM, ["heal", "--run", "broken", "--json"], project);
    expect(JSON.parse(viaRuntime.output.slice(viaRuntime.output.indexOf("{"))).replayer).toBe("runtime");

    const viaState = await cli(
      YAM_BINDINGS,
      ["heal", "--run", "broken", "--base-url", app.origin, "--json"],
      project,
    );
    expect(JSON.parse(viaState.output.slice(viaState.output.indexOf("{"))).replayer).toBe("session-state");
  }, 180_000);
});
