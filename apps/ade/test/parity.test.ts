/**
 * T3.7's Validate list, against a real service (REQ-ADE-2, 3, LLD §13.6).
 *
 * "Editing a flow in the ADE and compiling from the CLI yields the same
 * `plan.json`; a run started from the ADE produces the same `runs/<id>` files as
 * the CLI; lint warnings in the editor match `yam lint --json`."
 *
 * The ADE's screens are React, and rendering them proves nothing about any of
 * that: what makes those three claims true is that a screen has no way to reach
 * anything but the service, and the service calls the CLI's own functions. So
 * this drives the *client the screens drive* — the generated one, unchanged —
 * against a real service, and compares what came back with what the CLI produces
 * on its own.
 *
 * Electron never starts. That is the point: an Electron test would be testing
 * Electron, and the properties here are about the service boundary.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import { createService, type RunningService } from "@svatah/yam-service";
import {
  compileProject,
  loadProject,
  newRunId,
  runProject,
} from "@svatah/yam";
import { ServiceClient } from "../src/renderer/client.js";

const ADE = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(ADE, "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
const TOKEN = "ade-parity";

let app: SampleServer;
let project: string;
let service: RunningService;
let client: ServiceClient;

const FLOW = `story: Sign in
  Click the sign in button
  Type "connected2atul@gmail.com" into the username field
  Type "qwerty123" into the password field
  Click the login button

test: Sign in
`;

beforeAll(async () => {
  if (!existsSync(CLI)) throw new Error("Run `pnpm -r build` first.");
  app = await startSampleApp(0);

  project = mkdtempSync(join(tmpdir(), "yam-ade-parity-"));
  cpSync(join(FIXTURES, "bindings"), join(project, "bindings"), { recursive: true });
  mkdirSync(join(project, "flows"), { recursive: true });
  mkdirSync(join(project, "api"), { recursive: true });
  writeFileSync(join(project, "flows", "smoke.flow"), FLOW, "utf8");
  writeFileSync(join(project, "data.yaml"), "user:\n  email: \"a@b.c\"\n", "utf8");
  writeFileSync(
    join(project, "yam.config.yaml"),
    `schemaVersion: "1.0.0"
project: "ade-parity"
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
record: { model: "claude-opus-5", maxSnapshotTokens: 4000, visionFallback: false }
heal: { onFail: false, relocalizeThreshold: 0.72, margin: 0.1, useModel: false }
`,
    "utf8",
  );

  service = await createService({
    project,
    token: TOKEN,
    port: 0,
    // The wiring `yam serve` does, which is the whole reason the ADE can
    // claim to show nothing the CLI cannot produce.
    api: { loadProject, compileProject, runProject, newRunId } as never,
  });
  client = new ServiceClient({ url: service.url, token: TOKEN });
}, 180_000);

afterAll(async () => {
  await service.close();
  await app.close();
  rmSync(project, { recursive: true, force: true });
});

/**
 * `yam <args>` in the project, as a person would run it.
 *
 * Asynchronous, and that is load-bearing rather than stylistic:
 * `apps/sample-web` runs *in this process*, and a synchronous `execFileSync`
 * would block the event loop that has to answer the child's `page.goto`. The
 * first draft did exactly that and every run failed with a navigation timeout to
 * an application that was up.
 *
 * `NODE_OPTIONS` is cleared: vitest sets it to its own loader, and a child `node`
 * that inherited it would be loading the test runner rather than the CLI.
 */
function cli(...args: string[]): Promise<{ code: number; output: string }> {
  const { NODE_OPTIONS, ...environment } = process.env;
  void NODE_OPTIONS;
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: project,
      env: { ...environment, YAM_SAMPLE_PASSWORD: "qwerty123" },
    });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

describe("editing a flow in the ADE, compiling from the CLI (T3.7)", () => {
  it("yields the same plan hash either way", async () => {
    // The edit the ADE makes: a real `PUT /flows/:file`, the one the editor calls.
    const edited = FLOW.replace("story: Sign in", "story (tags=smoke): Sign in");
    await client.putFlowsByFile("smoke.flow", edited);

    expect(readFileSync(join(project, "flows", "smoke.flow"), "utf8")).toBe(edited);

    const viaService = (await client.postCompile()) as { plan: { hash: string } };
    const viaCli = await cli("compile", ".", "--stable", "--json");
    expect(viaCli.code).toBe(0);

    const planPath = join(project, ".yam", "plan.json");
    const plan = JSON.parse(readFileSync(planPath, "utf8")) as { hash: string };
    expect(viaService.plan.hash).toBe(plan.hash);
  }, 120_000);

  it("shows the lint `yam lint --json` shows", async () => {
    const viaService = (await client.postCompile()) as {
      errors: unknown[];
      warnings: Array<{ code?: string; line?: number; message?: string }>;
    };
    const viaCli = await cli("lint", ".", "--json");
    const parsed = JSON.parse(viaCli.output.slice(viaCli.output.indexOf("{"))) as {
      diagnostics: Array<{ severity: string; code?: string; line?: number; message?: string }>;
    };

    const shape = (one: { code?: string; line?: number; message?: string }): string =>
      `${one.code ?? ""}:${one.line ?? ""}:${one.message ?? ""}`;

    expect([...viaService.errors, ...viaService.warnings].map((one) => shape(one as never)).sort()).toEqual(
      parsed.diagnostics.map(shape).sort(),
    );
  }, 120_000);
});

describe("a run started from the ADE (T3.7)", () => {
  it("writes the same runs/<id> files a CLI run writes", async () => {
    const events: Array<{ kind: string; [key: string]: unknown }> = [];
    const finished = new Promise<void>((resolve) => {
      const stop = client.subscribe((event) => {
        events.push(event as never);
        if (event.kind === "run.summary" || event.kind === "run.failed") {
          stop();
          resolve();
        }
      });
    });

    const started = (await client.postRun({})) as { runId: string };
    await finished;

    // The same thing again, straight through the CLI.
    const viaCli = await cli("run", ".", "--host", "none", "--run-id", "via-cli");
    expect(viaCli.code, viaCli.output).toBe(0);

    const read = (id: string): unknown[] =>
      readFileSync(join(project, "runs", id, "results.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .map(({ runId, startedAt, endedAt, durationMs, failure, ...rest }) => {
          void runId;
          void startedAt;
          void endedAt;
          void durationMs;
          void failure;
          return rest;
        });

    expect(read(started.runId)).toEqual(read("via-cli"));

    // And the run directory holds what REQ-RUN-9 names, from either side.
    for (const id of [started.runId, "via-cli"]) {
      expect(existsSync(join(project, "runs", id, "summary.json")), id).toBe(true);
      expect(existsSync(join(project, "runs", id, "audit.jsonl")), id).toBe(true);
    }

    // The stream said the same thing the file did, step for step.
    const streamed = events.filter((one) => one.kind === "step.result");
    expect(streamed.length).toBe(read(started.runId).length);
  }, 300_000);

  it("lists both runs afterwards, because the history is the directory", async () => {
    const runs = (await client.getRuns()) as Array<{ runId: string }>;
    expect(runs.map((one) => one.runId)).toContain("via-cli");
    expect(runs.length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});

describe("the plan the Plan screen renders (T3.7)", () => {
  it("is the plan `yam compile` writes", async () => {
    const viaService = (await client.getPlan()) as { hash: string; stories: unknown[] };
    await cli("compile", ".", "--stable");
    const onDisk = JSON.parse(
      readFileSync(join(project, ".yam", "plan.json"), "utf8"),
    ) as { hash: string; stories: unknown[] };

    expect(viaService.hash).toBe(onDisk.hash);
    expect(viaService.stories.length).toBe(onDisk.stories.length);
  }, 120_000);
});

describe("the data editor keeps the secrets it cannot see (T3.7, REQ-NFR-6)", () => {
  it("writes back a redacted value as the value that was there", async () => {
    writeFileSync(
      join(project, "data.yaml"),
      'user:\n  email: "a@b.c"\n  password: "${YAM_SAMPLE_PASSWORD}"\nsecrets:\n  - user.password\n',
      "utf8",
    );

    const before = (await client.getData()) as {
      values: { user: { email: string; password: string } };
    };
    expect(before.values.user.password).toBe("«redacted»");

    // What the editor sends back: the redacted marker for the secret it never
    // saw, and a real change beside it.
    await client.putData({
      values: { user: { email: "changed@example.com", password: "«redacted»" } },
    });

    const after = (await client.getData()) as {
      values: { user: { email: string; password: string } };
    };
    expect(after.values.user.email).toBe("changed@example.com");
    expect(after.values.user.password).toBe("«redacted»");

    // And on disk the indirection survived: the marker was never written.
    const text = readFileSync(join(project, "data.yaml"), "utf8");
    expect(text).toContain("${YAM_SAMPLE_PASSWORD}");
    expect(text).not.toContain("«redacted»");
  }, 120_000);
});
