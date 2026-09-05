/**
 * T2.11 — the two Validate items that need a real run.
 *
 * "A `run` streams one `step.result` per step and a final `run.summary`; the
 * same run started via CLI and via service produces identical `results.jsonl`."
 *
 * The second is the load-bearing one. LLD §13.5 says every handler calls the
 * same functions the CLI calls, and the way to know that is not to read the
 * handler — it is to run the same thing both ways and diff the output. If they
 * ever differ, the service has grown logic of its own and the ADE has started
 * showing something the CLI does not agree with.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import { createService, type RunningService, type ServiceEvent } from "@svatah/service";
import { compileProject, loadProject, newRunId, runProject } from "../src/index.js";

/**
 * The CLI's own functions, handed to the service (LLD §13.5).
 *
 * This is the wiring `svatah serve` does, written out: the service is given four
 * functions and imports nothing that could implement them itself.
 */
const api = { loadProject, compileProject, runProject, newRunId } as never;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const TOKEN = "run-token";

let app: SampleServer;
let project: string;
let service: RunningService;

/**
 * A copy of the fixture project holding one short flow.
 *
 * The four migrated flows take a minute and have four documented failures; what
 * this test needs is a run that happens, streams and finishes, so it uses one
 * story built from the same bindings.
 */
function scaffold(runsDir: string): string {
  const dir = mkdtempSync(join(tmpdir(), "svatah-service-project-"));
  cpSync(join(FIXTURES, "bindings"), join(dir, "bindings"), { recursive: true });
  mkdirSync(join(dir, "flows"), { recursive: true });

  writeFileSync(
    join(dir, "flows", "smoke.flow"),
    `story: Sign in
  Click the sign in button
  Type "connected2atul@gmail.com" into the username field
  Type "qwerty123" into the password field
  Click the login button

test: Sign in
`,
    "utf8",
  );
  writeFileSync(
    join(dir, "svatah.config.yaml"),
    `schemaVersion: "1.0.0"
project: "service-smoke"
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
  outputDir: ${JSON.stringify(runsDir)}
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

beforeAll(async () => {
  app = await startSampleApp(0);
  project = scaffold("runs");
  service = await createService({ project, token: TOKEN, port: 0, api });
}, 120_000);

afterAll(async () => {
  await service.close();
  await app.close();
  rmSync(project, { recursive: true, force: true });
});

describe("the service answers with the project the CLI loaded (LLD §13.5)", () => {
  it("reports the real project's flows, stories, compositions and APIs", async () => {
    const body = (await (
      await fetch(`${service.url}/project`, { headers: { authorization: `Bearer ${TOKEN}` } })
    ).json()) as {
      flows: string[];
      stories: Array<{ name: string; steps: number }>;
      runs: Record<string, string[]>;
    };
    expect(body.flows).toEqual(["flows/smoke.flow"]);
    expect(body.stories.map((s) => s.name)).toEqual(["Sign in"]);
    expect(body.stories[0]!.steps).toBe(4);
    expect(body.runs["flows/smoke.flow"]).toEqual(["Sign in"]);
  });

  it("compiles it, with the plan hash the CLI would produce", async () => {
    const body = (await (
      await fetch(`${service.url}/compile`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      })
    ).json()) as { ok: boolean; plan: { hash: string } };

    const loaded = await loadProject(project);
    expect(body.ok).toBe(true);
    expect(body.plan.hash).toBe(compileProject(loaded, { stable: true }).plan.hash);
  });

  it("reads a flow file and the bindings store", async () => {
    const flow = await (
      await fetch(`${service.url}/flows/smoke.flow`, { headers: { authorization: `Bearer ${TOKEN}` } })
    ).text();
    expect(flow).toContain("story: Sign in");

    const bindings = (await (
      await fetch(`${service.url}/bindings`, { headers: { authorization: `Bearer ${TOKEN}` } })
    ).json()) as Array<{ id: string }>;
    expect(bindings.map((b) => b.id)).toContain("login.username-field");
  });
});

describe("POST /run streams what happens (REQ-ADE-1, REQ-ADE-3)", () => {
  it("emits one step.result per step, then a run.summary", async () => {
    const events: ServiceEvent[] = [];
    const finished = new Promise<void>((resolve) => {
      service.events.subscribe((event: ServiceEvent) => {
        events.push(event);
        if (event.kind === "run.summary" || event.kind === "run.failed") resolve();
      });
    });

    const response = await fetch(`${service.url}/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(202);
    const { runId } = (await response.json()) as { runId: string };

    await finished;

    const results = events.filter((e) => e.kind === "step.result");
    expect(results.length).toBe(4);
    expect(events.at(0)?.kind).toBe("run.started");
    expect(events.at(-1)?.kind).toBe("run.summary");

    // Every event carries the run id, so a client watching two runs can tell
    // them apart.
    for (const event of events) {
      expect((event as { runId?: string }).runId).toBe(runId);
    }

    // And the stream agrees with the file the run wrote.
    const written = readFileSync(join(project, "runs", runId, "results.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { stepId: string });
    expect(written.map((r) => r.stepId)).toEqual(
      results.map((e) => (e as { result: { stepId: string } }).result.stepId),
    );
  }, 120_000);
});

describe("the service and the CLI run the same thing (LLD §13.5)", () => {
  it("produces identical results.jsonl either way", async () => {
    /* Through the service. */
    const viaService = await new Promise<string>((resolve) => {
      const stop = service.events.subscribe((event: ServiceEvent) => {
        if (event.kind === "run.summary") {
          stop();
          resolve(event.runId);
        }
      });
      void fetch(`${service.url}/run`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
    });

    /* And directly, the way the CLI does. */
    const loaded = await loadProject(project);
    const viaCli = await runProject(loaded, { runId: "via-cli" });

    const read = (id: string) =>
      readFileSync(join(project, "runs", id, "results.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .map(({ runId, startedAt, endedAt, durationMs, ...rest }) => {
          void runId;
          void startedAt;
          void endedAt;
          void durationMs;
          return rest;
        });

    expect(read(viaCli.runId)).toEqual(read(viaService));
  }, 180_000);
});
