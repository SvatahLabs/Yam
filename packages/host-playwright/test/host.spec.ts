/**
 * T2.8 Validate, the end-to-end half.
 *
 * "Generated specs for the fixtures run under Playwright Test with two shards
 * and the HTML reporter; Svatah `results.jsonl` produced alongside; retries
 * disabled unless permitted (test)."
 *
 * The generated spec is run in a *child* Playwright Test process, because that
 * is the claim: a flow runs inside the runner, with the runner's own sharding
 * and reporters. Asserting it from inside this process would prove something
 * weaker — that the fixture works when called directly.
 */
import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, type StepResult } from "@svatah/schema";
import { startSampleApp, type SampleServer } from "sample-web";
import { generateSpecs } from "../src/index.js";
import { compiledPlan, PROJECT } from "./compile.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, "..");

let app: SampleServer;
const scaffolded: string[] = [];

test.beforeAll(async () => {
  app = await startSampleApp(0);
});
test.afterAll(async () => {
  await app.close();
  for (const dir of scaffolded) rmSync(dir, { recursive: true, force: true });
});

/** Playwright's own CLI, run directly: a temp project has no pnpm workspace. */
const PLAYWRIGHT_CLI = join(PACKAGE, "node_modules", "@playwright", "test", "cli.js");

/**
 * A throwaway Playwright project holding the generated spec.
 *
 * It lives under `.host-tests/` *inside this package* rather than in the system
 * temp directory, because a project outside the workspace cannot resolve
 * `@playwright/test` — Node walks up looking for `node_modules` and finds none
 * above `/tmp`. Here it walks up into this package, which is what a real
 * project's own `node_modules` would give it. `.gitignore` covers the directory,
 * and each test removes its own.
 */
function scaffold(options: { runsDir: string }): string {
  mkdirSync(join(PACKAGE, ".host-tests"), { recursive: true });
  const dir = mkdtempSync(join(PACKAGE, ".host-tests", "project-"));
  scaffolded.push(dir);
  mkdirSync(join(dir, "specs"), { recursive: true });

  writeFileSync(
    join(dir, "playwright.config.ts"),
    `import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: [
    ["html", { outputFolder: ${JSON.stringify(join(dir, "html"))}, open: "never" }],
    [${JSON.stringify(join(PACKAGE, "dist", "reporter.js"))}, { outputDir: ${JSON.stringify(options.runsDir)}, runId: "host-run" }],
  ],
  use: { baseURL: ${JSON.stringify(app.origin)}, headless: true },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
`,
    "utf8",
  );
  return dir;
}

async function writePlan(dir: string): Promise<string> {
  const plan = await compiledPlan();
  const path = join(dir, "plan.json");
  writeFileSync(path, canonicalJson(plan), "utf8");

  generateSpecs({
    plan,
    outDir: join(dir, "specs"),
    importFrom: join(PACKAGE, "dist", "index.js"),
    planPath: path,
  });
  return path;
}

/**
 * Run the child, without blocking this process.
 *
 * `spawnSync` would block the event loop, and the sample application this test
 * started is served *from* this process — so the child's very first `page.goto`
 * would hang until the child gave up. An async spawn is not a style preference
 * here; it is the difference between the test working and not.
 */
async function runPlaywright(
  dir: string,
  args: string[] = [],
  env: Record<string, string> = {},
): Promise<{ status: number; output: string }> {
  /*
   * `CI` is cleared for the child (P3 note).
   *
   * Playwright picks its default reporter from the environment: `list` normally,
   * `dot` when `CI` is set. `dot` prints `··` instead of test titles, so an
   * assertion on the child's output passed locally and failed on a CI runner —
   * a test measuring its own environment, which LLD §16 (Draft 2.4) says is a
   * defect in the test. What is under test here is the *host*, and the host does
   * not change with `CI`.
   */
  const { CI, ...environment } = process.env;
  void CI;

  const child = spawn(process.execPath, [PLAYWRIGHT_CLI, "test", ...args], {
    cwd: dir,
    env: { ...environment, SVATAH_BINDINGS: join(PROJECT, "bindings"), ...env },
  });

  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));

  const status = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });
  return { status, output };
}

test("a generated spec runs under Playwright Test and writes Svatah results", async () => {
  test.setTimeout(180_000);

  const runs = mkdtempSync(join(tmpdir(), "svatah-runs-"));
  const dir = scaffold({ runsDir: runs });
  await writePlan(dir);

  const { status, output } = await runPlaywright(dir);
  expect(status, output).toBe(0);
  expect(output, "the runner named the story it ran").toContain("Sign in");

  /* The runner's own report is produced, unchanged. */
  expect(existsSync(join(dir, "html", "index.html"))).toBe(true);

  /* And the Svatah results alongside it (REQ-RUN-12). */
  const runDir = join(runs, "host-run");
  const results = readFileSync(join(runDir, "results.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as StepResult);

  expect(results.length).toBeGreaterThan(5);
  expect(results.every((r) => r.status === "passed")).toBe(true);
  expect(results.map((r) => r.story)).toContain("Sign in");
  expect(results.map((r) => r.story)).toContain("Check the heading");

  // Every step records which candidate resolved it, which is what a foreign
  // runtime's conformance run is compared on (REQ-STD-2).
  const clicked = results.find((r) => r.text.includes("sign in button"))!;
  expect(clicked.matched?.by).toBe("testid");

  const summary = JSON.parse(readFileSync(join(runDir, "summary.json"), "utf8"));
  expect(summary.totals.failed).toBe(0);
  expect(summary.exitCode).toBe(0);
  expect(summary.planHash).toMatch(/^[0-9a-f]{64}$/);
});

test("the second story reads what the first captured, because the worker owns the scope", async () => {
  test.setTimeout(180_000);
  // `Check the heading` asserts on `{Sign in.heading}`. If the fixture were
  // test-scoped rather than worker-scoped, that reference would read nothing and
  // the second story would fail.
  const runs = mkdtempSync(join(tmpdir(), "svatah-runs-"));
  const dir = scaffold({ runsDir: runs });
  await writePlan(dir);

  const { status, output } = await runPlaywright(dir);
  expect(status, output).toBe(0);

  const results = readFileSync(join(runs, "host-run", "results.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as StepResult);
  const check = results.filter((r) => r.story === "Check the heading");
  expect(check).toHaveLength(1);
  expect(check[0]!.status).toBe("passed");
});

test("runs under two shards, and the two halves together are the whole run", async () => {
  test.setTimeout(240_000);

  const dir = scaffold({ runsDir: mkdtempSync(join(tmpdir(), "svatah-runs-")) });
  await writePlan(dir);

  // Sharding is per *file*, and this flow is one file, so one shard runs it and
  // the other runs nothing. That is the correct behaviour for a flow — its
  // stories are serial and share a scope — and the thing worth asserting is that
  // both shards succeed rather than one erroring on an empty selection.
  const first = await runPlaywright(dir, ["--shard=1/2"]);
  const second = await runPlaywright(dir, ["--shard=2/2"]);

  expect(first.status, first.output).toBe(0);
  expect(second.status, second.output).toBe(0);

  const ran = [first.output, second.output].filter((out) => out.includes("Sign in")).length;
  expect(
    ran,
    `exactly one shard should have run the flow\n--- shard 1\n${first.output}\n--- shard 2\n${second.output}`,
  ).toBe(1);
});

test("a failing step fails the Playwright test, with the failure class in the message", async () => {
  test.setTimeout(180_000);

  const runs = mkdtempSync(join(tmpdir(), "svatah-runs-"));
  const dir = scaffold({ runsDir: runs });
  const planPath = await writePlan(dir);

  // Point one binding at an element that is not there. The step then fails the
  // way a real locator failure does, which is the path worth testing.
  const broken = mkdtempSync(join(tmpdir(), "svatah-bindings-"));
  mkdirSync(join(broken, "login"), { recursive: true });
  for (const name of readdirSync(join(PROJECT, "bindings", "login"))) {
    const text = readFileSync(join(PROJECT, "bindings", "login", name), "utf8");
    writeFileSync(
      join(broken, "login", name),
      name === "sign-in-button.yaml" ? text.replace('"sign-in"', '"gone-away"') : text,
      "utf8",
    );
  }

  const result = await runPlaywright(dir, [], { SVATAH_BINDINGS: broken, SVATAH_PLAN: planPath });
  const output = result.output;

  expect(result.status).not.toBe(0);
  expect(output).toContain("[locator]");

  const results = readFileSync(join(runs, "host-run", "results.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as StepResult);
  const failed = results.find((r) => r.status === "failed")!;
  expect(failed.failure?.class).toBe("locator");
  // REQ-RUN-5: every candidate tried is reported, so the healer has input.
  expect(failed.failure?.candidatesTried?.length).toBeGreaterThan(0);
});
