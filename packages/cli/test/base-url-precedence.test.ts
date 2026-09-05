/**
 * P3-F2 — one base-URL and storage-state precedence, for every command that
 * opens a session (LLD §15, Draft 2.5).
 *
 * > the `--base-url` / `--storage-state` flag, then the `SVATAH_BASE_URL` /
 * > `SVATAH_STORAGE_STATE` environment variable, then `config.app`. A command
 * > that opens a session and ignores any of the three is a defect.
 *
 * Phase 3 had three different answers. `run` and `record` read the environment
 * and the config and had no flag; `heal --run` read the flag and the config and
 * ignored the environment, which is the failure the verifier hit — a run started
 * against an ephemeral port could not be healed without repeating the flag; and
 * `surface conform`, `bindings verify` and `eval` read the flag and a hard-coded
 * default and neither of the others.
 *
 * The method is the same for every command, and it is deliberately not a unit
 * test of the resolver: the config points at a **dead** port, so a command that
 * ignores the override cannot accidentally pass. Two cases per command —
 * environment only, and flag beating environment — with the flag or variable
 * pointing at the one port a sample application is actually listening on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import { EXIT } from "@svatah/bindings-cli";
import type { Summary } from "@svatah/schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const SVATAH = join(ROOT, "packages", "cli", "dist", "bin.js");
const SVATAH_BINDINGS = join(ROOT, "packages", "bindings-cli", "dist", "bin.js");

let app: SampleServer;
/** A port nothing is listening on, so `config.app` cannot answer for anything. */
let dead: string;
const projects: string[] = [];

/** Bind a port, learn its number, and give it straight back. */
async function closedPort(): Promise<string> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  await new Promise<void>((done) => server.close(() => done()));
  return `http://127.0.0.1:${port}`;
}

/** A flow that touches two pages, so a wrong base URL cannot pass by luck. */
const FLOW = `story: Sign in
  Click the sign in button
  Type "connected2atul@gmail.com" into the username field
  Type "qwerty123" into the password field
  Click the login button

test: Sign in
`;

/** A fixture project whose config points at the dead port and nothing else. */
function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), "svatah-baseurl-"));
  projects.push(dir);
  cpSync(join(FIXTURES, "bindings"), join(dir, "bindings"), { recursive: true });
  cpSync(join(FIXTURES, "api"), join(dir, "api"), { recursive: true });
  cpSync(join(FIXTURES, "data.yaml"), join(dir, "data.yaml"));
  mkdirSync(join(dir, "flows"), { recursive: true });
  writeFileSync(join(dir, "flows", "sign-in.flow"), FLOW, "utf8");

  writeFileSync(
    join(dir, "svatah.config.yaml"),
    `schemaVersion: "1.0.0"
project: "base-url-precedence"
environment: test
adapter: playwright
app: { baseUrl: "${dead}" }
flows: { dir: flows }
steps: { dir: steps }
bindings: { dir: bindings, testIdAttributes: ["data-testid"] }
data: { file: data.yaml }
api: { dir: api }
run:
  workers: 1
  headless: true
  stepTimeoutMs: 8000
  candidateTimeoutMs: 2000
  screenshots: never
  trace: false
  outputDir: runs
  checkpoints: false
  audit: true
compile: { confidenceThreshold: 0.8 }
record: { model: "claude-opus-5", maxSnapshotTokens: 4000, visionFallback: false }
heal: { onFail: false, relocalizeThreshold: 0.72, margin: 0.1, useModel: false }
`,
    "utf8",
  );
  return dir;
}

function cli(
  bin: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ code: number; output: string; json: string }> {
  return new Promise((done) => {
    let output = "";
    let json = "";
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      env: {
        ...process.env,
        SVATAH_SAMPLE_PASSWORD: "qwerty123",
        SVATAH_SAMPLE_CARD_NUMBER: "5123456789012346",
        SVATAH_SAMPLE_CARD_CVV: "123",
        // Never inherited: the gateway and the base URL are both chosen here.
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
        SVATAH_BASE_URL: "",
        SVATAH_STORAGE_STATE: "",
        ...env,
      },
    });
    // `--json` goes to stdout and progress to stderr; a test that parsed both
    // together would be reading the progress lines as JSON.
    child.stdout.on("data", (chunk) => {
      json += String(chunk);
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output, json }));
  });
}

beforeAll(async () => {
  if (!existsSync(SVATAH)) throw new Error("Run `pnpm -r build` first.");
  app = await startSampleApp(0);
  dead = await closedPort();
}, 120_000);

afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

/* ── run ──────────────────────────────────────────────────────────────────── */

describe("svatah run", () => {
  const summaryOf = (project: string, runId: string): Summary =>
    JSON.parse(readFileSync(join(project, "runs", runId, "summary.json"), "utf8")) as Summary;

  it("honours SVATAH_BASE_URL when only the environment says where", async () => {
    const project = scaffold();
    const result = await cli(SVATAH, ["run", ".", "--run-id", "env-only"], project, {
      SVATAH_BASE_URL: app.origin,
    });
    expect(result.code, result.output).toBe(EXIT.ok);
    expect(summaryOf(project, "env-only").totals.passed).toBe(4);
  }, 180_000);

  it("prefers --base-url to SVATAH_BASE_URL", async () => {
    const project = scaffold();
    const result = await cli(
      SVATAH,
      ["run", ".", "--run-id", "flag-wins", "--base-url", app.origin],
      project,
      // The environment names the dead port. Only the flag can save this run.
      { SVATAH_BASE_URL: dead },
    );
    expect(result.code, result.output).toBe(EXIT.ok);
    expect(summaryOf(project, "flag-wins").totals.passed).toBe(4);
  }, 180_000);
});

/* ── record ───────────────────────────────────────────────────────────────── */

describe("svatah record", () => {
  const recorded = (project: string): { complete: boolean; written: string[] } =>
    JSON.parse(readFileSync(join(project, "record-report.json"), "utf8")) as never;

  it("honours SVATAH_BASE_URL when only the environment says where", async () => {
    const project = scaffold();
    const result = await cli(
      SVATAH,
      ["record", ".", "--gateway", "fake", "--rebind", "--story", "Sign in"],
      project,
      { SVATAH_BASE_URL: app.origin },
    );
    expect(result.code, result.output).toBe(EXIT.ok);
    expect(recorded(project).written).toContain("home.sign-in-button");
  }, 300_000);

  it("prefers --base-url to SVATAH_BASE_URL", async () => {
    const project = scaffold();
    const result = await cli(
      SVATAH,
      [
        "record",
        ".",
        "--gateway",
        "fake",
        "--rebind",
        "--story",
        "Sign in",
        "--base-url",
        app.origin,
      ],
      project,
      { SVATAH_BASE_URL: dead },
    );
    expect(result.code, result.output).toBe(EXIT.ok);
    expect(recorded(project).written).toContain("home.sign-in-button");
  }, 300_000);
});

/* ── heal ─────────────────────────────────────────────────────────────────── */

/**
 * A project with one binding broken, and a run that failed on it.
 *
 * This is the shape the verifier's F2 came from: the run is started against an
 * ephemeral port through the environment, and the heal that follows has to reach
 * the same place without being told twice.
 */
async function brokenRun(env: Record<string, string>): Promise<string> {
  const project = scaffold();
  /*
   * Every candidate value renamed, and nothing else: the element is still on the
   * page and the fingerprint still describes it, which is the shape of breakage
   * relocalization is supposed to repair. The candidates end where the first
   * entry's `context:` begins — a `name:` under `fingerprint.attrs` is what the
   * element *is*, and moving it would break the fingerprint too.
   */
  const path = join(project, "bindings", "login", "login-button.yaml");
  const text = readFileSync(path, "utf8");
  const end = text.indexOf("    context:");
  writeFileSync(
    path,
    text.slice(0, end).replace(/^(\s+(?:value|name): )"(.*)"$/gm, '$1"$2-GONE"') + text.slice(end),
    "utf8",
  );
  const result = await cli(SVATAH, ["run", ".", "--run-id", "broken"], project, env);
  // A failed run is the input to healing; anything else means the fixture is
  // wrong rather than the precedence.
  expect(result.code, result.output).toBe(EXIT.failed);
  return project;
}

describe("svatah heal --run", () => {
  it("honours SVATAH_BASE_URL when only the environment says where", async () => {
    const env = { SVATAH_BASE_URL: app.origin };
    const project = await brokenRun(env);
    const result = await cli(SVATAH, ["heal", "--run", "broken", "--json"], project, env);
    expect(result.code, result.output).toBe(EXIT.ok);
    const report = JSON.parse(result.json) as { totals: { repaired: number } };
    expect(report.totals.repaired).toBeGreaterThan(0);
  }, 240_000);

  it("prefers --base-url to SVATAH_BASE_URL", async () => {
    const project = await brokenRun({ SVATAH_BASE_URL: app.origin });
    const result = await cli(
      SVATAH,
      ["heal", "--run", "broken", "--base-url", app.origin, "--json"],
      project,
      { SVATAH_BASE_URL: dead },
    );
    expect(result.code, result.output).toBe(EXIT.ok);
    const report = JSON.parse(result.json) as { totals: { repaired: number } };
    expect(report.totals.repaired).toBeGreaterThan(0);
  }, 240_000);

  it("reaches the same page through `svatah-bindings heal`", async () => {
    // Module (a)'s command line applies the same precedence, from the same
    // function: one implementation behind two executables (LLD §1).
    const env = { SVATAH_BASE_URL: app.origin };
    const project = await brokenRun(env);
    const result = await cli(
      SVATAH_BINDINGS,
      ["heal", "--run", "broken", "--json"],
      project,
      env,
    );
    expect(result.code, result.output).toBe(EXIT.ok);
    const report = JSON.parse(result.json) as { totals: { repaired: number } };
    expect(report.totals.repaired).toBeGreaterThan(0);
  }, 240_000);
});

/* ── bindings verify ──────────────────────────────────────────────────────── */

describe("svatah bindings verify", () => {
  it("honours SVATAH_BASE_URL when only the environment says where", async () => {
    const project = scaffold();
    const result = await cli(
      SVATAH,
      ["bindings", "verify", "--id", "home.sign-in-button", "--json"],
      project,
      { SVATAH_BASE_URL: app.origin },
    );
    expect(result.code, result.output).toBe(EXIT.ok);
    const report = JSON.parse(result.json) as { baseUrl: string; results: Array<{ ok: boolean }> };
    expect(report.baseUrl).toBe(app.origin);
    expect(report.results[0]!.ok).toBe(true);
  }, 120_000);

  it("prefers --base-url to SVATAH_BASE_URL", async () => {
    const project = scaffold();
    const result = await cli(
      SVATAH,
      ["bindings", "verify", "--id", "home.sign-in-button", "--base-url", app.origin, "--json"],
      project,
      { SVATAH_BASE_URL: dead },
    );
    expect(result.code, result.output).toBe(EXIT.ok);
    const report = JSON.parse(result.json) as { baseUrl: string; results: Array<{ ok: boolean }> };
    expect(report.baseUrl).toBe(app.origin);
    expect(report.results[0]!.ok).toBe(true);
  }, 120_000);
});

/* ── surface conform ──────────────────────────────────────────────────────── */

describe("svatah surface conform", () => {
  // One case, because what is under test is where the session opened, not the
  // suite; the whole suite runs in its own test (T1.2).
  const only = ["--only", "home.snapshot"];

  it("honours SVATAH_BASE_URL when only the environment says where", async () => {
    const project = scaffold();
    const result = await cli(
      SVATAH,
      ["surface", "conform", "--adapter", "playwright", ...only, "--json"],
      project,
      { SVATAH_BASE_URL: app.origin },
    );
    expect(result.code, result.output).toBe(EXIT.ok);
    expect(JSON.parse(result.json).conformant).toBe(true);
  }, 120_000);

  it("prefers --base-url to SVATAH_BASE_URL", async () => {
    const project = scaffold();
    const result = await cli(
      SVATAH,
      ["surface", "conform", "--adapter", "playwright", ...only, "--base-url", app.origin, "--json"],
      project,
      { SVATAH_BASE_URL: dead },
    );
    expect(result.code, result.output).toBe(EXIT.ok);
    expect(JSON.parse(result.json).conformant).toBe(true);
  }, 120_000);
});

/* ── eval ─────────────────────────────────────────────────────────────────── */

describe("svatah eval", () => {
  it("grounding honours SVATAH_BASE_URL when only the environment says where", async () => {
    const project = scaffold();
    const result = await cli(
      SVATAH,
      ["eval", "grounding", "--gateway", "fake", "--limit", "1", "--json"],
      project,
      { SVATAH_BASE_URL: app.origin },
    );
    expect(result.code, result.output).toBe(EXIT.ok);
    expect(JSON.parse(result.json).totals.correct).toBe(1);
  }, 180_000);

  it("grounding prefers --base-url to SVATAH_BASE_URL", async () => {
    const project = scaffold();
    const result = await cli(
      SVATAH,
      ["eval", "grounding", "--gateway", "fake", "--limit", "1", "--base-url", app.origin, "--json"],
      project,
      { SVATAH_BASE_URL: dead },
    );
    expect(result.code, result.output).toBe(EXIT.ok);
    expect(JSON.parse(result.json).totals.correct).toBe(1);
  }, 180_000);

  /*
   * `eval healing` walks every page and every variant, which is minutes rather
   * than seconds, so what is checked is the first thing it does with the base
   * URL: read `/api/variants` from it. A run that reaches for the dead port
   * names the dead port, and that is the whole of the question here.
   */
  it("healing honours SVATAH_BASE_URL when only the environment says where", async () => {
    const project = scaffold();
    const result = await cli(SVATAH, ["eval", "healing", "--population", "no-test-ids"], project, {
      SVATAH_BASE_URL: dead,
    });
    expect(result.code).toBe(EXIT.failed);
    expect(result.output).toContain(`${dead}/api/variants`);
  }, 120_000);

  it("healing prefers --base-url to SVATAH_BASE_URL", async () => {
    const project = scaffold();
    const other = await closedPort();
    const result = await cli(
      SVATAH,
      ["eval", "healing", "--population", "no-test-ids", "--base-url", other],
      project,
      { SVATAH_BASE_URL: dead },
    );
    expect(result.code).toBe(EXIT.failed);
    expect(result.output).toContain(`${other}/api/variants`);
    expect(result.output).not.toContain(`${dead}/api/variants`);
  }, 120_000);
});
