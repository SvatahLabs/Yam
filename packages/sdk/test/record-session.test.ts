/**
 * T9.3 Validate — "the SDK drives a fake-gateway record session end to end in a
 * test (start, decision, accept, stop) and subscribes to its events".
 *
 * Against a real `yam serve`, wired exactly as the CLI wires one, driving
 * `apps/sample-web` with the **fake gateway**: the committed grounding answers
 * from `evals/grounding/cases`, so the test needs no model credential and makes
 * no network call (REQ-ADE-4, the phase's rule "every recording in the suite
 * uses `--gateway fake`").
 *
 * The four steps of the Validate item are the four things a reviewer does on the
 * Record screen, in order: the session starts, a decision arrives on the stream,
 * it is accepted, and the session stops. What makes it an SDK test rather than a
 * service test is that every one of them goes through `YamClient` — the
 * generated method, and `subscribe()` over SSE — so a route the description
 * renamed would fail here rather than in a renderer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  serviceRecord,
} from "@svatah/yam";
import { YamClient, type ServiceEvent } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const TOKEN = "sdk-record";

/** One story, three steps, all of them groundable from the committed answers. */
const FLOW = `story: book a slot
  Click the Book a slot link
  Type "Indiranagar" into the location field
  Click the Book now button

test: book a slot
`;

let app: SampleServer;
let project: string;
let service: RunningService;
let client: YamClient;

beforeAll(async () => {
  app = await startSampleApp(0);
  project = mkdtempSync(join(tmpdir(), "svatah-yam-record-"));
  mkdirSync(join(project, "flows"), { recursive: true });
  mkdirSync(join(project, "api"), { recursive: true });
  writeFileSync(join(project, "flows", "record.flow"), FLOW, "utf8");
  writeFileSync(join(project, "data.yaml"), "user:\n  email: \"a@b.c\"\n", "utf8");
  /*
   * The fixtures' bindings are copied in and then *removed* for the two targets
   * the recording is about, so the recorder has something to ground. A project
   * with no store at all would exercise a different path (a first recording),
   * and this test is about the review loop.
   */
  cpSync(join(FIXTURES, "bindings"), join(project, "bindings"), { recursive: true });
  rmSync(join(project, "bindings", "booking", "location-field.yaml"), { force: true });
  rmSync(join(project, "bindings", "booking", "book-now-button.yaml"), { force: true });

  writeFileSync(
    join(project, "yam.config.yaml"),
    `schemaVersion: "1.0.0"
project: "sdk-record"
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

  service = await createService({
    project,
    token: TOKEN,
    port: 0,
    api: {
      loadProject,
      compileProject,
      runProject,
      newRunId,
      record: serviceRecord,
    } as never,
  });
  client = new YamClient({ url: service.url, token: TOKEN });
}, 240_000);

afterAll(async () => {
  await service?.close();
  await app?.close();
  rmSync(project, { recursive: true, force: true });
});

describe("the SDK drives a record session end to end (T9.3)", () => {
  it("starts, decides, accepts and stops, over the stream it subscribed to", async () => {
    const seen: ServiceEvent[] = [];
    const decisions: Array<{ sessionId: string; elementId: string }> = [];

    const finished = new Promise<void>((resolve) => {
      const stop = client.subscribe((event) => {
        seen.push(event);
        if (event.kind === "record.decision") {
          const proposal = event["proposal"] as { elementId?: string } | undefined;
          decisions.push({
            sessionId: String(event["sessionId"]),
            elementId: String(proposal?.elementId ?? ""),
          });
        }
        if (event.kind === "record.finished" || event.kind === "record.failed") {
          stop();
          resolve();
        }
      });
    });

    /* 1. start — with the fake gateway, which is the committed answers. */
    const started = (await client.postRecord({
      flows: ["flows/record.flow"],
      gateway: "fake",
      rebind: true,
    })) as { sessionId: string };
    expect(started.sessionId, JSON.stringify(started)).toBeTypeOf("string");

    /* 2. a decision arrives on the stream, before any binding is written. */
    const firstDecision = await waitFor(() => decisions[0], 120_000);
    expect(firstDecision.sessionId).toBe(started.sessionId);
    expect(firstDecision.elementId).not.toBe("");

    /* 3. accept it — and every one after it, which is what a reviewer does. */
    let answered = 0;
    while (answered < 12) {
      const pending = decisions[answered];
      if (pending === undefined) {
        if (seen.some((one) => one.kind === "record.finished" || one.kind === "record.failed")) {
          break;
        }
        await sleep(200);
        continue;
      }
      // `{ accept: true }` is the body the route takes (LLD §13.5); anything
      // else is read as a rejection, which stops the session.
      await client.postRecordByIdDecision(started.sessionId, { accept: true });
      answered += 1;
    }
    expect(answered).toBeGreaterThan(0);

    /* 4. stop, and the session says so on the stream. */
    await client.postRecordByIdStop(started.sessionId).catch(() => undefined);
    await Promise.race([finished, sleep(30_000)]);

    const kinds = seen.map((one) => one.kind);
    if (process.env["YAM_SDK_DEBUG"] === "1") {
      process.stderr.write(`${JSON.stringify(seen, null, 2)}\n`);
    }
    expect(kinds, kinds.join(", ")).toContain("record.started");
    expect(kinds).toContain("record.decision");
    expect(kinds).toContain("record.candidates");
    expect(
      kinds.includes("record.finished") || kinds.includes("record.failed"),
      kinds.join(", "),
    ).toBe(true);

    /*
     * The accepted groundings were *written*, which is the half a test that
     * only watched the stream would miss. `record.finished` carries the
     * session's report; `written` is the bindings the reviewer accepted, and
     * `stoppedBecause` is absent when nobody rejected anything.
     */
    const finishedEvent = seen.find((one) => one.kind === "record.finished");
    expect(finishedEvent, "the session never finished").toBeDefined();
    const report = finishedEvent!["report"] as {
      written?: string[];
      stoppedBecause?: string;
      gateway?: { real?: boolean; name?: string };
      totals?: { grounded?: number; failed?: number };
    };
    expect(report.stoppedBecause, report.stoppedBecause ?? "").toBeUndefined();
    expect(report.written ?? []).not.toEqual([]);
    expect(report.totals?.failed ?? 0).toBe(0);
    // The fake gateway, labelled as such (REQ-ADE-4): no credential was used
    // and none is needed.
    expect(report.gateway?.real).toBe(false);
    expect(report.gateway?.name).toContain("fake");
  }, 300_000);

  it("refuses a second session while one is open, the way LLD §13.5 says", async () => {
    const first = (await client.postRecord({ gateway: "fake" })) as { sessionId: string };
    try {
      await expect(client.postRecord({ gateway: "fake" })).rejects.toThrow(/409/);
    } finally {
      await client.postRecordByIdStop(first.sessionId).catch(() => undefined);
    }
  }, 180_000);
});

describe("the SDK's own surface (REQ-SDK-1, LLD §13.8)", () => {
  it("exposes the screen model's actions, by the same ids", async () => {
    expect(client.actions.length).toBeGreaterThan(20);
    expect(client.actions.map((one) => one.id)).toContain("run.flow");
    expect(client.actions.map((one) => one.id)).toContain("bindings.verify");
  });

  it("runs an action out of process, against the live service", async () => {
    const outcome = await client.run("flows.compile", {});
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Compiled: \d+ error\(s\), \d+ warning\(s\)\./);
  }, 180_000);

  it("says which actions exist when asked for one that does not", async () => {
    await expect(client.run("run.everything")).rejects.toThrow(/No action "run.everything"/);
  });

  it("reads a project through a generated method", async () => {
    const summary = (await client.getProject()) as { config: { project: string } };
    expect(summary.config.project).toBe("sdk-record");
  }, 60_000);
});

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Poll until `read` answers with something, or give up loudly. */
async function waitFor<T>(read: () => T | undefined, timeoutMs: number): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error(`nothing arrived within ${timeoutMs} ms`);
    await sleep(100);
  }
}
