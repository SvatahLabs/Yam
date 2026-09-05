/**
 * The heal cycle, end to end, through both command lines (P2-F1).
 *
 * Phase 2's verification found that healing a *run* did not work through either
 * command line, for two different reasons:
 *
 * - `svatah heal --run` answered `not-found`. Its runtime replayer reported
 *   `reached` for a failure at a story's first step without opening the base URL
 *   first, so relocalization ran against `about:blank` and, correctly, found
 *   nothing there.
 * - `svatah-bindings heal --run` answered `unreachable`. The executor recorded
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
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import type { StepResult } from "@svatah/schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const SVATAH = join(ROOT, "packages", "cli", "dist", "bin.js");
const SVATAH_BINDINGS = join(ROOT, "packages", "bindings-cli", "dist", "bin.js");

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

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), "svatah-heal-cycle-"));
  projects.push(dir);
  cpSync(join(FIXTURES, "bindings"), join(dir, "bindings"), { recursive: true });
  mkdirSync(join(dir, "flows"), { recursive: true });
  writeFileSync(join(dir, "flows", "cycle.flow"), FLOW, "utf8");
  writeFileSync(
    join(dir, "svatah.config.yaml"),
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

function cli(bin: string, args: readonly string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [bin, ...args], { cwd, env: process.env });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

function results(project: string, runId: string): StepResult[] {
  const text = readFileSync(join(project, "runs", runId, "results.jsonl"), "utf8").trim();
  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line) as StepResult);
}

async function runFlow(project: string, runId: string): Promise<{ code: number; output: string }> {
  return await cli(SVATAH, ["run", ".", "--host", "none", "--run-id", runId], project);
}

beforeAll(async () => {
  if (!existsSync(SVATAH) || !existsSync(SVATAH_BINDINGS)) {
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
  it("svatah heal --run: a failure at a story's first step", async () => {
    await cycle(
      (project) => cli(SVATAH, ["heal", "--run", "broken", "--apply"], project),
      "home.sign-in-button",
    );
  }, 180_000);

  it("svatah-bindings heal --run: a failure at a story's first step", async () => {
    await cycle(
      (project) =>
        cli(
          SVATAH_BINDINGS,
          ["heal", "--run", "broken", "--base-url", app.origin, "--apply"],
          project,
        ),
      "home.sign-in-button",
    );
  }, 180_000);

  it("svatah heal --run: a failure at a later step, behind a navigation", async () => {
    await cycle(
      (project) => cli(SVATAH, ["heal", "--run", "broken", "--apply"], project),
      "app.schedule-build-link",
    );
  }, 180_000);

  it("svatah-bindings heal --run: a failure at a later step, behind a navigation", async () => {
    await cycle(
      (project) =>
        cli(
          SVATAH_BINDINGS,
          ["heal", "--run", "broken", "--base-url", app.origin, "--apply"],
          project,
        ),
      "app.schedule-build-link",
    );
  }, 180_000);
});

describe("the replayers say how they got there (LLD §10)", () => {
  it("svatah heal --run replays the story; svatah-bindings restores the recorded page", async () => {
    const project = scaffold();
    breakBinding(project, "app.schedule-build-link");
    expect((await runFlow(project, "broken")).code).toBe(1);

    const viaRuntime = await cli(SVATAH, ["heal", "--run", "broken", "--json"], project);
    expect(JSON.parse(viaRuntime.output.slice(viaRuntime.output.indexOf("{"))).replayer).toBe("runtime");

    const viaState = await cli(
      SVATAH_BINDINGS,
      ["heal", "--run", "broken", "--base-url", app.origin, "--json"],
      project,
    );
    expect(JSON.parse(viaState.output.slice(viaState.output.indexOf("{"))).replayer).toBe("session-state");
  }, 180_000);
});
