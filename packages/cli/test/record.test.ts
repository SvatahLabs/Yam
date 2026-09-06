/**
 * T3.3's Validate list, against a real browser and the real command line.
 *
 * "Recording `simple.flow` with a fake gateway produces verified bindings;
 * impossible expectation stops without writing."
 *
 * `packages/recorder`'s own tests replay a recorded page, because that is where
 * the grounding decisions live and `recorder` may not import an adapter (LLD §1).
 * These are the other half: a real Chromium, the real `yam record`, and the
 * store on disk afterwards.
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
import { parse as parseYaml } from "yaml";
import { startSampleApp, type SampleServer } from "sample-web";
import { EXIT } from "@svatah/yam-bindings-cli";
import type { BindingFile } from "@svatah/yam-schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const YAM = join(ROOT, "packages", "cli", "dist", "bin.js");

let app: SampleServer;
const projects: string[] = [];

/** A copy of the fixture project, so a recording can write to it. */
function scaffold(overrides: { flows?: Record<string, string>; environment?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-record-"));
  projects.push(dir);
  cpSync(join(FIXTURES, "bindings"), join(dir, "bindings"), { recursive: true });
  cpSync(join(FIXTURES, "flows"), join(dir, "flows"), { recursive: true });
  cpSync(join(FIXTURES, "api"), join(dir, "api"), { recursive: true });
  cpSync(join(FIXTURES, "data.yaml"), join(dir, "data.yaml"));

  if (overrides.flows !== undefined) {
    rmSync(join(dir, "flows"), { recursive: true, force: true });
    mkdirSync(join(dir, "flows"), { recursive: true });
    for (const [name, text] of Object.entries(overrides.flows)) {
      writeFileSync(join(dir, "flows", name), text, "utf8");
    }
  }

  writeFileSync(
    join(dir, "yam.config.yaml"),
    `schemaVersion: "1.0.0"
project: "record-test"
environment: ${overrides.environment ?? "test"}
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
record: { model: "claude-opus-5", maxSnapshotTokens: 4000, visionFallback: false }
heal: { onFail: false, relocalizeThreshold: 0.72, margin: 0.1, useModel: false }
`,
    "utf8",
  );
  return dir;
}

function cli(
  args: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [YAM, ...args], {
      cwd,
      env: {
        ...process.env,
        YAM_SAMPLE_PASSWORD: "qwerty123",
        YAM_SAMPLE_CARD_NUMBER: "5123456789012346",
        YAM_SAMPLE_CARD_CVV: "123",
        // The gateway must be chosen deliberately, never inherited from whoever
        // ran the suite.
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
        ...env,
      },
    });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

function binding(project: string, id: string): BindingFile {
  const path = join(project, "bindings", `${id.split(".").join("/")}.yaml`);
  return parseYaml(readFileSync(path, "utf8")) as BindingFile;
}

function report(project: string): {
  complete: boolean;
  gateway: { name: string; real: boolean };
  written: string[];
  steps: Array<{
    text: string;
    status: string;
    elementId?: string;
    decision?: { outcome: string };
  }>;
  totals: Record<string, number>;
} {
  return JSON.parse(readFileSync(join(project, "record-report.json"), "utf8")) as never;
}

beforeAll(async () => {
  if (!existsSync(YAM)) throw new Error("Run `pnpm -r build` first.");
  app = await startSampleApp(0);
}, 120_000);

afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("yam record (REQ-REC-1, 5, 8, 9, LLD §11, §15)", () => {
  it("records simple.flow's login story and writes verified bindings", async () => {
    const project = scaffold();
    const result = await cli(
      [
        "record",
        ".",
        "--gateway",
        "fake",
        "--rebind",
        "--story",
        "I want to validate login",
        "--input",
        "email=connected2atul@gmail.com",
        "--input",
        "password=qwerty123",
      ],
      project,
    );

    expect(result.code, result.output).toBe(EXIT.ok);

    const written = report(project);
    expect(written.complete).toBe(true);
    expect(written.written).toContain("home.sign-in-button");
    expect(written.written).toContain("login.username-field");
    expect(written.written).toContain("app.schedule-build-link");

    /*
     * Verified means a step performed through it (REQ-REC-5). Every binding this
     * session wrote was used by a step that passed, so every one of them says so.
     */
    for (const id of written.written) {
      const file = binding(project, id);
      expect(file.entries.some((entry) => entry.verified), id).toBe(true);
    }

    // And the provenance names what produced it (REQ-AGT-3, REQ-STD-4).
    const entry = binding(project, "home.sign-in-button").entries.find((e) => e.verified)!;
    expect(entry.provenance.promptVersion).toBe("g-1");
    expect(entry.provenance.model).toBe("fake:grounding-cases");
  }, 300_000);

  it("grounds the element a guard names, not only the one the step acts on", async () => {
    /*
     * `Step.guard.target` through the recorder (P5-F3, LLD §3.2, §11, Draft
     * 2.7). "Only if the Remember me checkbox is checked, type … into the
     * username field" addresses *two* elements, and a recorder that grounded
     * only the step's would leave the guard unresolvable at replay — a flow
     * that recorded clean and then failed on its first run.
     *
     * The guard's element is grounded first, because that is the order the
     * executor resolves them in: a step whose guard is false never resolves
     * the element it would have acted on.
     */
    const project = scaffold({
      flows: {
        "guarded.flow": `story: Guarded
  Click the sign in button
  Only if the Remember me checkbox is checked, Type "atul" into the username field

test: Guarded
`,
      },
    });
    const result = await cli(["record", ".", "--gateway", "fake", "--rebind"], project);
    expect(result.code, result.output).toBe(EXIT.ok);

    /*
     * Three bindings from two steps: the sign in button, the guard's checkbox
     * and the step's username field — and in that order, the guard's before
     * the step's. (`remember-me-checkbox` is unprefixed because the fixture
     * store has no entry for it yet, so the dictionary has no page to namespace
     * it under.)
     */
    const written = report(project).written;
    expect(written).toEqual([
      "home.sign-in-button",
      "remember-me-checkbox",
      "login.username-field",
    ]);

    // Both are verified: a guard's element is dry-checked like any other.
    expect(binding(project, "remember-me-checkbox").entries.some((e) => e.verified)).toBe(true);
    expect(binding(project, "login.username-field").entries.some((e) => e.verified)).toBe(true);

    /*
     * And the guard was *false* — the checkbox is not checked — so the step was
     * skipped. The binding for the element it would have acted on exists
     * anyway, which is the point: a recording session grounds what the plan
     * addresses, not only what this particular run happened to reach.
     */
    expect(report(project).steps.at(-1)?.status).toBe("skipped");
  }, 300_000);

  it("says which gateway produced the report, in the report and on the terminal", async () => {
    const project = scaffold({
      flows: { "one.flow": "story: One\n  Click the sign in button\n\ntest: One\n" },
    });
    const result = await cli(["record", ".", "--gateway", "fake", "--rebind"], project);
    expect(result.code, result.output).toBe(EXIT.ok);
    expect(report(project).gateway.real).toBe(false);
    expect(result.output).toContain("not a model");
  }, 300_000);

  /*
   * The Validate item, and the reason the rollback exists (REQ-REC-5).
   *
   * The step's target grounds fine — the sign-in link is on the page — and then
   * the expectation cannot hold. A recorder that wrote the binding anyway would
   * be saying "this element is what the phrase means, and I checked", having
   * checked and found otherwise.
   */
  it("an impossible expectation stops the session and writes nothing", async () => {
    const project = scaffold({
      flows: {
        "impossible.flow": `story: Impossible
  The sign in button should be hidden

test: Impossible
`,
      },
    });
    const before = readFileSync(
      join(project, "bindings", "home", "sign-in-button.yaml"),
      "utf8",
    );

    const result = await cli(["record", ".", "--gateway", "fake", "--rebind"], project);

    expect(result.code, result.output).toBe(EXIT.expectationFailed);
    const written = report(project);
    expect(written.complete).toBe(false);
    expect(written.written).toEqual([]);
    expect(written.steps.at(-1)?.status).toBe("failed");
    // The store is byte-for-byte what it was: the grounded entry was staged into
    // the live store so the step could run, and rolled back when it did not pass.
    expect(readFileSync(join(project, "bindings", "home", "sign-in-button.yaml"), "utf8")).toBe(
      before,
    );
  }, 300_000);

  it("reuses a binding it already has, and --rebind re-grounds it", async () => {
    const project = scaffold({
      flows: { "one.flow": "story: One\n  Click the sign in button\n\ntest: One\n" },
    });

    const reused = await cli(["record", ".", "--gateway", "fake"], project);
    expect(reused.code, reused.output).toBe(EXIT.ok);
    expect(report(project).totals["reused"]).toBe(1);
    expect(report(project).totals["modelCalls"]).toBe(0);

    const rebound = await cli(["record", ".", "--gateway", "fake", "--rebind"], project);
    expect(rebound.code, rebound.output).toBe(EXIT.ok);
    expect(report(project).totals["modelCalls"]).toBe(1);
  }, 300_000);

  it("refuses to record against production without --force-production (REQ-AUTO-7)", async () => {
    const project = scaffold({
      environment: "production",
      flows: { "one.flow": "story: One\n  Click the sign in button\n\ntest: One\n" },
    });

    const refused = await cli(["record", ".", "--gateway", "fake"], project);
    expect(refused.code).toBe(EXIT.refused);
    expect(refused.output).toContain("--force-production");
    // Refused before anything ran: no report, no browser.
    expect(existsSync(join(project, "record-report.json"))).toBe(false);

    const forced = await cli(
      ["record", ".", "--gateway", "fake", "--force-production"],
      project,
    );
    expect(forced.code, forced.output).toBe(EXIT.ok);
  }, 300_000);

  it("refuses to record with no credential rather than quietly using a fixture", async () => {
    const project = scaffold({
      flows: { "one.flow": "story: One\n  Click the sign in button\n\ntest: One\n" },
    });
    const result = await cli(["record", "."], project);
    expect(result.code).toBe(EXIT.modelUnavailable);
    expect(result.output).toContain("--gateway fake");
    expect(existsSync(join(project, "record-report.json"))).toBe(false);
  }, 120_000);

  it("reports per step what REQ-REC-8 asks for", async () => {
    const project = scaffold({
      flows: { "one.flow": "story: One\n  Click the sign in button\n\ntest: One\n" },
    });
    await cli(["record", ".", "--gateway", "fake", "--rebind"], project);

    const step = report(project).steps[0] as unknown as {
      text: string;
      decision: {
        snapshotTokens: number;
        outcome: string;
        ref: string;
        candidates: Array<{ by: string }>;
        provenance: { tokensIn: number; tokensOut: number };
      };
      matched: { by: string };
    };

    expect(step.decision.snapshotTokens).toBeGreaterThan(0);
    expect(step.decision.outcome).toBe("grounded");
    expect(step.decision.ref).toMatch(/^r\d+$/);
    expect(step.decision.candidates.length).toBeGreaterThan(0);
    expect(step.decision.provenance.tokensIn).toBe(0);
    expect(step.matched.by).toBe("testid");
  }, 300_000);
});

describe("a recording replays with no model at all (REQ-RUN-1, REQ-NFR-1)", () => {
  it("what record wrote, run reads", async () => {
    const project = scaffold({
      flows: {
        "one.flow": `story: Sign in
  Click the sign in button
  Type "connected2atul@gmail.com" into the username field
  Type "qwerty123" into the password field
  Click the login button

test: Sign in
`,
      },
    });

    // Record from scratch: the store is emptied first, so nothing here was
    // seeded by hand.
    rmSync(join(project, "bindings"), { recursive: true, force: true });
    const recorded = await cli(["record", ".", "--gateway", "fake"], project);
    expect(recorded.code, recorded.output).toBe(EXIT.ok);
    expect(report(project).written.length).toBe(4);

    const replayed = await cli(["run", ".", "--host", "none", "--run-id", "replay"], project);
    expect(replayed.code, replayed.output).toBe(EXIT.ok);
  }, 300_000);
});

/*
 * T3.5's Validate — "replay passes with the model endpoint blocked".
 *
 * REQ-RUN-1 and REQ-NFR-1 are structural: `runtime` cannot import `gateway`, and
 * the lint and the dependency-graph test say so. A structural argument is a thing
 * a reader has to follow; this is the thing a reader can run.
 *
 * `scripts/block-external-network.mjs` refuses every connection that is not to
 * loopback — `fetch`, `http`, `https`, `net` and `tls`, because Node has four
 * doors and patching only the top would leave a socket open. `apps/sample-web` is
 * on loopback and stays reachable; `api.anthropic.com` does not.
 */
describe("replay with the model endpoint blocked (T3.5, REQ-RUN-1, REQ-NFR-1)", () => {
  it("runs the recorded fixtures with nothing but the application reachable", async () => {
    const project = scaffold({
      flows: {
        "one.flow": `story: Sign in
  Click the sign in button
  Type "connected2atul@gmail.com" into the username field
  Type "qwerty123" into the password field
  Click the login button
  Click the Schedule Build link

test: Sign in
`,
      },
    });

    const blocker = join(ROOT, "scripts", "block-external-network.mjs");
    const result = await cli(["run", ".", "--host", "none", "--run-id", "blocked"], project, {
      NODE_OPTIONS: `--import=${blocker}`,
      // A credential *is* present, and unusable: a run that reached for the model
      // would fail on the blocked connection rather than on a missing key, which
      // is the stronger demonstration.
      ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
    });

    expect(result.code, result.output).toBe(EXIT.ok);
    expect(result.output).not.toContain("Blocked a");
  }, 300_000);

  it("the blocker would have caught a call, so the test above means something", async () => {
    const project = scaffold({
      flows: { "one.flow": "story: One\n  Click the sign in button\n\ntest: One\n" },
    });
    const blocker = join(ROOT, "scripts", "block-external-network.mjs");

    // The negative control: `record --gateway anthropic` does reach for a model,
    // and with the blocker loaded it cannot. Without this, "the run passed with
    // the network blocked" could mean the blocker does nothing.
    const result = await cli(["record", ".", "--gateway", "anthropic", "--rebind"], project, {
      NODE_OPTIONS: `--import=${blocker}`,
      ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
    });

    expect(result.code).not.toBe(EXIT.ok);
    expect(result.output).toContain("Blocked a");
    expect(result.output).toContain("api.anthropic.com");
  }, 300_000);
});
