/**
 * T5.7 and T5.8's Validate, against a real service (REQ-ADE-4, 5, 8, LLD §13.6).
 *
 * T5.7: "author a three-step story, record against the sample web app, reject
 * one grounding and re-pick, and confirm the written binding matches the pick; a
 * healed variant shows a proposal that applies and re-runs green."
 *
 * T5.8: "a six-step exploration compiles to a proposal in `proposals/`; an MCP
 * client invocation appears in the tool panel with its audit record."
 *
 * ## Why this drives the client rather than the screens
 *
 * The same reason `parity.test.ts` does. A screen has no way to reach anything
 * but the generated client, and `test/screen-rule.test.ts` proves that
 * statically; what the screens *show* is whatever the service answers with. So
 * this drives the client the screens drive, against a service wired exactly as
 * `svatah serve` wires one, and checks the answers — which is the part a
 * rendering test could not check and the part that can be wrong.
 *
 * Electron never starts, and a browser does: the recorder, the healer and the
 * explorer all drive the sample application for real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import { createService, type RunningService } from "@svatah/service";
import {
  compileProject,
  loadProject,
  newRunId,
  runProject,
  serviceCompileTrajectory,
  serviceHeal,
  serviceOpenSurfaceSession,
  serviceRecord,
  serviceToolsFor,
  serviceVerifyBindings,
} from "@svatah/cli";
import { ServiceClient, type StreamedEvent } from "../src/renderer/client.js";

const ADE = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(ADE, "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const TOKEN = "ade-review";

/** The three-step story T5.7 asks for, with one target nothing has recorded. */
const FLOW = `story: Sign in and look
  Click the sign in button
  Type "connected2atul@gmail.com" into the username field
  Click the login button

test: Sign in and look
`;

let app: SampleServer;
const projects: string[] = [];

function scaffold(options: { flow?: string; bindings?: boolean } = {}): string {
  const project = mkdtempSync(join(tmpdir(), "svatah-ade-review-"));
  projects.push(project);
  if (options.bindings !== false) {
    cpSync(join(FIXTURES, "bindings"), join(project, "bindings"), { recursive: true });
  } else {
    mkdirSync(join(project, "bindings"), { recursive: true });
  }
  mkdirSync(join(project, "flows"), { recursive: true });
  mkdirSync(join(project, "api"), { recursive: true });
  writeFileSync(join(project, "flows", "review.flow"), options.flow ?? FLOW, "utf8");
  writeFileSync(join(project, "data.yaml"), 'user:\n  email: "a@b.c"\n', "utf8");
  writeFileSync(
    join(project, "svatah.config.yaml"),
    `schemaVersion: "1.0.0"
project: "ade-review"
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
tool: { expose: ["Sign in and look"], requireIdempotent: false }
`,
    "utf8",
  );
  return project;
}

/** A service wired exactly as `svatah serve` wires one (LLD §13.5). */
async function serve(project: string): Promise<{ service: RunningService; client: ServiceClient }> {
  const service = await createService({
    project,
    token: TOKEN,
    port: 0,
    api: {
      loadProject,
      compileProject,
      runProject,
      newRunId,
      record: serviceRecord,
      verifyBindings: serviceVerifyBindings,
      heal: serviceHeal,
      openSurfaceSession: serviceOpenSurfaceSession,
      compileTrajectory: serviceCompileTrajectory,
      toolsFor: serviceToolsFor,
    } as never,
  });
  return { service, client: new ServiceClient({ url: service.url, token: TOKEN }) };
}

/** Collect events until `stop` says so, or the deadline passes. */
function collect(
  client: ServiceClient,
  stop: (event: StreamedEvent, all: StreamedEvent[]) => boolean,
  timeoutMs = 60_000,
): { events: StreamedEvent[]; done: Promise<StreamedEvent[]> } {
  const events: StreamedEvent[] = [];
  let resolve: (value: StreamedEvent[]) => void;
  let reject: (reason: Error) => void;
  const done = new Promise<StreamedEvent[]>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  const timer = setTimeout(
    () => reject(new Error(`no stop event within ${timeoutMs} ms; saw ${events.map((e) => e.kind).join(", ")}`)),
    timeoutMs,
  );
  const unsubscribe = client.subscribe((event) => {
    events.push(event);
    if (stop(event, events)) {
      clearTimeout(timer);
      unsubscribe();
      resolve(events);
    }
  });
  return { events, done };
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

beforeAll(async () => {
  app = await startSampleApp(0);
}, 180_000);

afterAll(async () => {
  await app.close();
  for (const project of projects) rmSync(project, { recursive: true, force: true });
});

describe("record review: accept, reject and re-pick before anything is written (T5.7)", () => {
  it("streams a decision with its candidates and blocks until the reviewer answers", async () => {
    /*
     * The property T5.7 turns on. `record.decision` arrives, and the store is
     * still untouched — a review that ran after the write would be an undo.
     */
    const project = scaffold({ bindings: false });
    const { service, client } = await serve(project);
    try {
      const waiting = collect(client, (event) => event.kind === "record.candidates");
      const { sessionId } = (await client.postRecord({ gateway: "fake" })) as {
        sessionId: string;
      };
      expect(sessionId).toBeTypeOf("string");

      const events = await waiting.done;
      const decision = events.find((one) => one.kind === "record.decision");
      const candidates = events.find((one) => one.kind === "record.candidates");
      expect(decision).toBeDefined();
      expect(candidates).toBeDefined();

      const proposal = decision!["proposal"] as {
        phrase: string;
        elementId: string;
        snapshot: string;
        entry: { candidates: unknown[]; fingerprint: { tag: string } };
        decision: { outcome: string; ref?: string };
      };
      // Everything REQ-ADE-4 names: the excerpt, the chosen reference, the
      // bundle and the fingerprint.
      expect(proposal.snapshot).toContain("[ref=");
      expect(proposal.decision.ref).toBeTypeOf("string");
      expect(proposal.entry.candidates.length).toBeGreaterThan(0);
      expect(proposal.entry.fingerprint.tag).toBeTypeOf("string");

      // And nothing is in the store: the session is blocked on this decision.
      expect(readdirSync(join(project, "bindings"))).toEqual([]);

      await client.postRecordByIdStop(sessionId);
      await sleep(200);
    } finally {
      await service.close();
    }
  }, 240_000);

  it("writes the element the reviewer re-picked, not the one the model chose", async () => {
    /*
     * T5.7's Validate, exactly: "reject one grounding and re-pick, and confirm
     * the written binding matches the pick."
     *
     * The re-picked element is chosen from the *live* snapshot the recorder is
     * on — `POST /surface/{session}/snapshot`, which is what the screen's
     * "Re-pick" button calls — and the entry is re-synthesised from it, so the
     * candidates in the store are the ones synthesis makes for that element.
     */
    const project = scaffold({
      bindings: false,
      flow: 'story: Look\n  Click the sign in button\n\ntest: Look\n',
    });
    const { service, client } = await serve(project);
    try {
      const waiting = collect(client, (event) => event.kind === "record.decision");
      const { sessionId } = (await client.postRecord({ gateway: "fake" })) as {
        sessionId: string;
      };
      const events = await waiting.done;
      const proposal = events.find((one) => one.kind === "record.decision")!["proposal"] as {
        elementId: string;
        decision: { ref: string };
      };

      // The picker reads the driven session, as the screen does.
      const snapshot = (await client.postSurfaceBySessionSnapshot(sessionId, {
        interactiveOnly: true,
      })) as { nodes: Array<{ ref: string; role: string; name?: string }> };

      // A different element from the one the model chose — the docs link, which
      // is on the home page and is not the sign in button.
      const other = snapshot.nodes.find(
        (node) => node.ref !== proposal.decision.ref && node.name === "Docs",
      );
      expect(other, snapshot.nodes.map((n) => `${n.role} ${n.name}`).join(" | ")).toBeDefined();

      const finished = collect(
        client,
        (event) => event.kind === "record.finished" || event.kind === "record.failed",
      );
      await client.postRecordByIdDecision(sessionId, { repick: other!.ref });
      await finished.done;

      /*
       * The store holds the *picked* element. A file that named the model's
       * choice would mean the re-pick was cosmetic.
       */
      const path = join(project, "bindings", ...proposal.elementId.split("."));
      expect(existsSync(`${path}.yaml`), `${path}.yaml`).toBe(true);
      const written = readFileSync(`${path}.yaml`, "utf8");
      expect(written).toContain("docs-link");
      expect(written).not.toContain('value: "sign-in"');
      // A re-pick is a person's decision, and the provenance says so rather than
      // claiming a model made it.
      expect(written).toContain('model: "human"');
    } finally {
      await service.close();
    }
  }, 240_000);
});

describe("the bindings browser and the heal review (T5.7, REQ-ADE-5)", () => {
  it("dry-resolves the store against a live page", async () => {
    const project = scaffold();
    const { service, client } = await serve(project);
    try {
      const store = (await client.getBindings()) as Array<{ id: string }>;
      expect(store.length).toBeGreaterThan(0);

      const report = (await client.postBindingsVerify({ id: "home.sign-in-button" })) as {
        resolved: number;
        results: Array<{ id: string; status: string; by?: string }>;
      };
      expect(report.results).toHaveLength(1);
      expect(report.results[0]?.status).toBe("resolved");
      // By an actual candidate kind — this is the resolver's answer, not a
      // re-reading of the YAML.
      expect(report.results[0]?.by).toBeTypeOf("string");
    } finally {
      await service.close();
    }
  }, 240_000);

  it("proposes a repair with its before and after, applies it, and re-runs green", async () => {
    const project = scaffold();
    const { service, client } = await serve(project);
    try {
      // Break every candidate of one binding, leaving the fingerprint alone —
      // the shape relocalization is for.
      const path = join(project, "bindings", "home", "sign-in-button.yaml");
      const text = readFileSync(path, "utf8");
      const end = text.indexOf("    context:");
      writeFileSync(
        path,
        text.slice(0, end).replace(/^(\s+(?:value|name): )"(.*)"$/gm, '$1"$2-GONE"') +
          text.slice(end),
        "utf8",
      );

      const failing = collect(client, (event) => event.kind === "run.summary");
      await client.postRun({});
      await failing.done;
      const runs = (await client.getRuns()) as Array<{ runId: string; exitCode: number }>;
      const broken = runs.find((one) => one.exitCode !== 0);
      expect(broken, JSON.stringify(runs)).toBeDefined();

      /* Propose, without applying: a repair is a diff a person accepts. */
      const proposing = collect(client, (event) => event.kind === "heal.finished");
      await client.postHeal({ runId: broken!.runId, apply: false });
      const proposals = (await proposing.done).filter((one) => one.kind === "heal.proposal");

      expect(proposals.length).toBeGreaterThan(0);
      const proposal = proposals[0]!["proposal"] as {
        id: string;
        outcome: string;
        before: { entries: Array<{ candidates: Array<{ value?: string }> }> };
        after: { entries: Array<{ candidates: Array<{ value?: string }> }> };
      };
      expect(proposal.outcome).toBe("repaired");
      // Before and after candidates, which is what REQ-ADE-5 asks the screen to
      // show: the broken value on one side and the repaired one on the other.
      expect(JSON.stringify(proposal.before)).toContain("-GONE");
      expect(JSON.stringify(proposal.after)).not.toContain("-GONE");
      // And the file on disk is still the broken one: nothing was applied.
      expect(readFileSync(path, "utf8")).toContain("-GONE");

      /* Apply, and re-run green. */
      const applying = collect(client, (event) => event.kind === "heal.finished");
      await client.postHeal({ runId: broken!.runId, apply: true });
      await applying.done;
      expect(readFileSync(path, "utf8")).not.toContain("-GONE");

      const rerun = collect(client, (event) => event.kind === "run.summary");
      await client.postRun({});
      const after = (await rerun.done).find((one) => one.kind === "run.summary")!;
      expect((after["summary"] as { exitCode: number }).exitCode).toBe(0);
    } finally {
      await service.close();
    }
  }, 300_000);
});

describe("the surface explorer (T5.8, REQ-ADE-8)", () => {
  it("compiles a six-call exploration to a proposal in proposals/", async () => {
    const project = scaffold();
    const { service, client } = await serve(project);
    try {
      const opened = (await client.postSurfaceBySessionOpen("explorer", {})) as {
        trajectory: string;
      };

      const home = (await client.postSurfaceBySessionSnapshot("explorer", {
        intent: "see what is on the home page",
        interactiveOnly: true,
      })) as { nodes: Array<{ ref: string; role: string; name?: string }> };
      const signIn = home.nodes.find((node) => node.name === "Sign in");
      expect(signIn, home.nodes.map((n) => `${n.role} ${n.name}`).join(" | ")).toBeDefined();

      await client.postSurfaceBySessionAct("explorer", {
        intent: "go to the sign-in page",
        action: "click",
        ref: signIn!.ref,
      });

      const login = (await client.postSurfaceBySessionSnapshot("explorer", {
        intent: "see the sign-in form",
        interactiveOnly: true,
      })) as { nodes: Array<{ ref: string; role: string; name?: string }> };
      const username = login.nodes.find((node) => node.name === "Username");
      expect(username).toBeDefined();

      await client.postSurfaceBySessionAct("explorer", {
        intent: "type the enterprise user's email into the username field",
        action: "type",
        ref: username!.ref,
        args: { value: "connected2atul@gmail.com" },
      });
      const read = (await client.postSurfaceBySessionRead("explorer", {
        intent: "check what the username field now holds",
        kind: "value",
        ref: username!.ref,
      })) as { value: unknown };
      expect(read.value).toBe("connected2atul@gmail.com");
      await client.postSurfaceBySessionCheck("explorer", {
        intent: "confirm the sign-in button is ready",
        predicate: { kind: "visible" },
        subject: "ref",
        ref: login.nodes.find((node) => node.name === "Sign In")?.ref,
      });

      const before = readdirSync(project).sort();

      const report = (await client.postTrajectoryCompile({ path: opened.trajectory })) as {
        dir: string;
        files: string[];
        steps: { total: number; compiled: number; rate: number };
        flow: string;
      };

      expect(report.steps.total).toBeGreaterThanOrEqual(4);
      expect(report.steps.rate).toBeGreaterThanOrEqual(0.8);
      expect(report.flow).toContain("Click the Sign in link");

      // In `proposals/`, and nowhere else.
      expect(report.files.every((file) => file.includes(`${join("", "proposals")}`))).toBe(true);
      expect(readdirSync(project).sort()).toEqual([...before, "proposals"].sort());

      await client.postSurfaceBySessionClose("explorer");
    } finally {
      await service.close();
    }
  }, 300_000);

  it("refuses a call with no intent, because a log is not a trajectory", async () => {
    const project = scaffold();
    const { service, client } = await serve(project);
    try {
      await client.postSurfaceBySessionOpen("explorer", {});
      await expect(
        client.postSurfaceBySessionAct("explorer", { action: "click", ref: "r1" }),
      ).rejects.toThrow(/intent/i);
      await client.postSurfaceBySessionClose("explorer");
    } finally {
      await service.close();
    }
  }, 240_000);
});

describe("the tool panel (T5.8, REQ-ADE-8, REQ-BEH-3)", () => {
  it("lists the tools a project exposes, and why the others are not", async () => {
    const project = scaffold();
    const { service, client } = await serve(project);
    try {
      const answer = (await client.getTools()) as {
        tools: { tools: Array<{ name: string; story: string }>; refused: unknown[] };
        invocations: unknown[];
      };
      expect(answer.tools.tools).toEqual([]);
      // `Sign in and look` has no signature, so there is nothing to derive a
      // schema from — and the panel says so rather than showing nothing.
      expect(JSON.stringify(answer.tools.refused)).toContain("no signature");
    } finally {
      await service.close();
    }
  }, 240_000);

  it("shows an invocation with its audit record, read from the run directory", async () => {
    /*
     * T5.8's Validate: "an MCP client invocation appears in the tool panel with
     * its audit record."
     *
     * The invocation is produced the way a tool call produces one — a run with
     * `behavior: "tool"` and an agent invoker — and the panel finds it by
     * reading `runs/`, which is why a `svatah tool serve` in another terminal
     * would appear here too (REQ-ADE-2).
     */
    const project = scaffold();
    const { service, client } = await serve(project);
    try {
      const loaded = await loadProject(project);
      await runProject(loaded, {
        behavior: "tool",
        stories: ["Sign in and look"],
        invoker: { kind: "agent", id: "an-agent", via: "mcp" },
        runId: "tool-1",
      });

      const answer = (await client.getTools()) as {
        invocations: Array<{
          runId: string;
          invoker?: { kind: string; id: string };
          audit: Array<{ kind: string }>;
        }>;
      };

      const invocation = answer.invocations.find((one) => one.runId === "tool-1");
      expect(invocation, JSON.stringify(answer.invocations)).toBeDefined();
      expect(invocation!.invoker).toEqual({ kind: "agent", id: "an-agent", via: "mcp" });
      expect(invocation!.audit.length).toBeGreaterThan(0);
      expect(invocation!.audit.some((line) => line.kind === "surface")).toBe(true);
    } finally {
      await service.close();
    }
  }, 300_000);
});
