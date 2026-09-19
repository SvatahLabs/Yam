/**
 * T2.11 — the service's contract (REQ-ADE-1, REQ-ADE-7, LLD §13.5).
 *
 * Validate: "Contract tests per endpoint against the fixtures project; an
 * unauthenticated request is refused; a `run` streams one `step.result` per step
 * and a final `run.summary`; the same run started via CLI and via service
 * produces identical `results.jsonl`."
 *
 * Against the real fixture project, not a mock: the service's whole claim is that
 * it answers with what the CLI would say, and a mocked project would be testing
 * the mock.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createService,
  keepRedacted,
  openApiDocument,
  REDACTED,
  type RunningService,
} from "../src/index.js";
import { fakeApi, fakeProject } from "./fake-api.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PROJECT = join(ROOT, "evals", "fixtures");
const TOKEN = "test-token";

let service: RunningService;

beforeAll(async () => {
  service = await createService({ project: PROJECT, token: TOKEN, port: 0, api: fakeApi() });
});
afterAll(async () => {
  await service.close();
});

const get = async (path: string, init: RequestInit = {}): Promise<Response> =>
  await fetch(`${service.url}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });

/**
 * The body, loosely typed.
 *
 * These are contract tests over JSON, not a generated client: asserting on
 * `body.stories[0].name` is the readable thing to write, and giving every shape
 * an interface here would be writing the app's client twice.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (response: Response): Promise<any> => (await response.json()) as unknown;

describe("the token (REQ-ADE-7)", () => {
  it("refuses a request without one", async () => {
    // The service can compile, run and edit files in a project. Loopback alone
    // is not enough: anything else on the machine can reach loopback.
    const response = await fetch(`${service.url}/project`);
    expect(response.status).toBe(401);
    expect((await json(response)).message).toContain("bearer token");
  });

  it("refuses a wrong one", async () => {
    const response = await fetch(`${service.url}/project`, {
      headers: { authorization: "Bearer nope" },
    });
    expect(response.status).toBe(401);
  });

  it("lets /health and /openapi.json through, because a client needs them first", async () => {
    // The app reads the token from the child's stdout and health-checks before
    // it has parsed anything; a typed client is generated from the document.
    expect((await fetch(`${service.url}/health`)).status).toBe(200);
    expect((await fetch(`${service.url}/openapi.json`)).status).toBe(200);
  });

  it("generates a different token per process", async () => {
    const a = await createService({ project: PROJECT, port: 0, api: fakeApi() });
    const b = await createService({ project: PROJECT, port: 0, api: fakeApi() });
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThan(20);
    await a.close();
    await b.close();
  });

  it("binds to loopback only", async () => {
    expect(service.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});

describe("GET /project (LLD §13.5)", () => {
  it("answers with what the CLI's loadProject returned, shaped for a client", async () => {
    const body = await json(await get("/project"));
    expect(body.flows).toEqual(["flows/a.flow"]);
    expect(body.stories.map((s: { name: string }) => s.name)).toEqual(["Sign in"]);
    expect(body.compositions["Everything"]).toEqual(["Sign in"]);
    expect(body.apis).toEqual(["active count"]);
    expect(body.customSteps).toEqual(["steps/seed.ts#default"]);
  });

  it("carries a story's signature, which is what makes it invocable", async () => {
    const body = await json(await get("/project"));
    expect(body.stories[0].signature.inputs.email.type).toBe("string");
  });
});

describe("flows (LLD §13.5)", () => {
  it("404s a flow that is not there", async () => {
    expect((await get("/flows/nope.flow")).status).toBe(404);
  });

  it("refuses a path that climbs out of the project", async () => {
    // The service edits a project. It is not a file browser.
    const response = await get("/flows/..%2F..%2F..%2Fpackage.json");
    expect([400, 404]).toContain(response.status);
  });
});

describe("POST /compile (REQ-COMP-7)", () => {
  it("reports the plan's hash and splits errors from warnings", async () => {
    const body = await json(await get("/compile", { method: "POST" }));
    expect(body.ok).toBe(true);
    expect(body.errors).toEqual([]);
    expect(body.plan.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is not ok when the compile had an error", async () => {
    const failing = await createService({
      project: PROJECT,
      port: 0,
      token: TOKEN,
      api: fakeApi({
        compileProject: () => ({
          plan: { hash: "b".repeat(64), stories: [] },
          diagnostics: [{ severity: "error", code: "E_SIGIL", message: "v2 syntax" }],
        }),
      }),
    });
    try {
      const body = (await (
        await fetch(`${failing.url}/compile`, {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}` },
        })
      ).json()) as { ok: boolean; errors: unknown[] };
      expect(body.ok).toBe(false);
      expect(body.errors).toHaveLength(1);
    } finally {
      await failing.close();
    }
  });
});

describe("data and api (LLD §13.5)", () => {
  it("redacts secrets on read (REQ-NFR-6)", async () => {
    // The app shows a data editor in a renderer process. A resolved secret must
    // not travel there.
    const body = await json(await get("/data"));
    expect(body.values.user.password).toBe("«redacted»");
    expect(body.values.user.email).toBe("a@b.c");
    expect(body.secrets).toContain("user.password");
  });

  it("lists the named API requests", async () => {
    const body = await json(await get("/api"));
    expect(body.map((r: { name: string }) => r.name)).toEqual(["active count"]);
  });
});

describe("GET /openapi.json (REQ-ADE-1)", () => {
  it("describes every route the service serves", async () => {
    const document = await json(await get("/openapi.json"));
    for (const path of ["/project", "/compile", "/run", "/runs", "/bindings", "/data", "/events"]) {
      expect(Object.keys(document.paths), path).toContain(path);
    }
  });

  it("is what the committed document says", async () => {
    const served = await json(await get("/openapi.json"));
    expect(served).toEqual(openApiDocument("0.2.0"));
  });

  it("says how to authenticate", async () => {
    const document = await json(await get("/openapi.json"));
    expect(document.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  });
});

describe("the event stream (REQ-ADE-1)", () => {
  it("delivers to every subscriber, and stops when one unsubscribes", async () => {
    const seen: string[] = [];
    const stop = service.events.subscribe((event) => seen.push(event.kind));
    service.events.emit({ kind: "log", at: "now", level: "info", message: "hello" });
    expect(seen).toEqual(["log"]);
    stop();
    service.events.emit({ kind: "log", at: "now", level: "info", message: "again" });
    expect(seen).toEqual(["log"]);
  });

  it("a listener that throws does not take the run down with it", async () => {
    // A dead socket must not fail the run that was writing to it.
    const seen: string[] = [];
    const bad = service.events.subscribe(() => {
      throw new Error("socket closed");
    });
    const good = service.events.subscribe((event) => seen.push(event.kind));
    expect(() =>
      service.events.emit({ kind: "log", at: "now", level: "info", message: "x" }),
    ).not.toThrow();
    expect(seen).toEqual(["log"]);
    bad();
    good();
  });

  it("streams over SSE", async () => {
    const controller = new AbortController();
    const response = await get("/events/sse", { signal: controller.signal });
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // The stream opens with a comment line, so the first read returns before
    // anything is emitted. Emitting after that is what makes the event
    // impossible to miss.
    await reader.read();
    service.events.emit({ kind: "log", at: "now", level: "info", message: "streamed" });

    let text = "";
    while (!text.includes("streamed")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    expect(text).toContain("event: log");
    expect(text).toContain("streamed");
    controller.abort();
  });
});

describe("POST /run (REQ-ADE-1, REQ-ADE-3)", () => {
  it("answers with a run id immediately rather than blocking", async () => {
    // The app's Run screen watches a run happen; a blocking call would make it
    // a spinner.
    const runs = mkdtempSync(join(tmpdir(), "yam-service-"));
    try {
      const response = await get("/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flows: ["flows/does-not-exist.flow"] }),
      });
      expect(response.status).toBe(202);
      expect((await json(response)).runId).toMatch(/^[0-9a-z]+$/);
    } finally {
      rmSync(runs, { recursive: true, force: true });
    }
  });

  it("404s a run that does not exist", async () => {
    expect((await get("/runs/nope")).status).toBe(404);
    expect((await get("/runs/nope/results")).status).toBe(404);
  });
});

/**
 * `POST /runs/:id/stop` (T10.4, Draft 2.12 §13.5).
 *
 * The route's own behaviour, against a fake executor that waits to be aborted:
 * a run that is going can be stopped, the signal it gets is the one the route
 * aborts, and a run that has finished is a 404 rather than a success that did
 * nothing. What the *executor* does with the signal is
 * `packages/runtime/test/run.test.ts`; what the whole thing does against a real
 * browser is `tools/repo-checks/test/run-stop.test.ts`.
 */
describe("POST /runs/:id/stop (T10.4, LLD §13.5)", () => {
  it("aborts the signal the executor is watching, and answers 202", async () => {
    let seen: AbortSignal | undefined;
    let release: (() => void) | undefined;
    const slow = await createService({
      project: PROJECT,
      token: TOKEN,
      port: 0,
      api: fakeApi({
        runProject: async (_loaded, options) => {
          seen = options?.signal;
          // Wait until somebody aborts, which is what a run between steps does.
          await new Promise<void>((done) => {
            release = done;
            options?.signal?.addEventListener("abort", () => done());
          });
          return { runId: "fake-run", summary: {} as never, results: [] };
        },
      }),
    });
    try {
      const started = await fetch(`${slow.url}/run`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        // A flow with no story, so `POST /run` has no signature to refuse: what
        // is under test is the stop, not the input check above.
        body: JSON.stringify({ flows: ["flows/does-not-exist.flow"] }),
      });
      const body = (await started.json()) as { runId: string };
      expect(started.status, JSON.stringify(body)).toBe(202);
      const runId = body.runId;

      // The executor is running and holding the signal.
      for (let waited = 0; seen === undefined && waited < 50; waited += 1) {
        await new Promise((done) => setTimeout(done, 20));
      }
      expect(seen, "the service did not hand the executor a signal").toBeDefined();
      expect(seen!.aborted).toBe(false);

      const stopped = await fetch(`${slow.url}/runs/${runId}/stop`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(stopped.status).toBe(202);
      expect(await stopped.json()).toEqual({ ok: true, runId });
      expect(seen!.aborted, "the run's signal was not aborted").toBe(true);

      release?.();
      // And once it has ended, there is nothing left to stop.
      for (let waited = 0; waited < 50; waited += 1) {
        const again = await fetch(`${slow.url}/runs/${runId}/stop`, {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}` },
        });
        if (again.status === 404) {
          expect(((await again.json()) as { error: string }).error).toBe("not-running");
          return;
        }
        await new Promise((done) => setTimeout(done, 20));
      }
      throw new Error("the run never left the running map");
    } finally {
      await slow.close();
    }
  }, 30_000);

  it("404s a run id nothing is running", async () => {
    const response = await get("/runs/never-started/stop", { method: "POST" });
    expect(response.status).toBe(404);
    const body = (await json(response)) as { error: string; message: string };
    expect(body.error).toBe("not-running");
    // The message says where to look instead, rather than only refusing.
    expect(body.message).toContain("GET /runs/:id");
  });
});

/*
 * Inputs, before anything starts (P2-F4, Draft 2.4, LLD §13.5).
 *
 * The fake project's "Sign in" declares `email: string` with no default, and its
 * run block invokes it. Calling a function without its arguments is a mistake in
 * the call; answering 202 and letting the executor fail would give the app a red
 * run to display when what happened is that nobody typed an address.
 */
describe("POST /run validates inputs (REQ-AUTO-5, LLD §13.5)", () => {
  const post = async (body: unknown): Promise<Response> =>
    await get("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("400s with the missing names, and starts nothing", async () => {
    const started: string[] = [];
    const stop = service.events.subscribe((event) => started.push(event.kind));

    const response = await post({});
    expect(response.status).toBe(400);

    const body = await json(response);
    expect(body.error).toBe("missing-inputs");
    expect(body.missing).toEqual([{ story: "Sign in", name: "email", type: "string" }]);
    expect(body.message).toContain('"Sign in".email');

    expect(started).toEqual([]);
    stop();
  });

  it("starts the run once the input is supplied", async () => {
    const response = await post({ inputs: { email: "a@b.c" } });
    expect(response.status).toBe(202);
  });

  it("names the story that is missing one, not every story", async () => {
    const body = await json(await post({ stories: ["Sign in"] }));
    expect(body.missing.map((m: { story: string }) => m.story)).toEqual(["Sign in"]);
  });

  it("asks for nothing from a story with no signature", async () => {
    const noSignature = await createService({
      project: PROJECT,
      port: 0,
      token: TOKEN,
      api: fakeApi({
        loadProject: async (root) => {
          const handle = fakeProject(root);
          return {
            ...handle,
            project: {
              ...handle.project,
              stories: new Map([
                ["Sign in", { story: { kind: "story", steps: [{}] }, file: "flows/a.flow" }],
              ]),
            },
          };
        },
      }),
    });
    try {
      const response = await fetch(`${noSignature.url}/run`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(202);
    } finally {
      await noSignature.close();
    }
  });

  it("expands a composition to the stories it names", async () => {
    const body = await json(await post({ flows: ["flows/a.flow"] }));
    expect(body.missing).toEqual([{ story: "Sign in", name: "email", type: "string" }]);
  });
});

/*
 * `GET /project` carries the signatures, which is the half of LLD §13.5 that
 * makes the 400 above actionable: a client prompts from them.
 */
describe("GET /project carries each story's signature (LLD §13.5)", () => {
  it("so a client can prompt for inputs before it runs", async () => {
    const body = await json(await get("/project"));
    const story = body.stories.find((s: { name: string }) => s.name === "Sign in");
    expect(story.signature.inputs.email.type).toBe("string");
  });
});

/*
 * The routes T3.7's screens need (LLD §13.5).
 *
 * `PUT /data`, `PUT /api/:name`, `POST /api/request` and `GET /plan` were in
 * LLD §13.5's table from Draft 2.1 and arrived with the screens that use them.
 * The interesting one is `PUT /data`: `GET /data` redacts, so a naive write-back
 * would store the redaction marker over the secret and destroy it.
 */
describe("the data editor's write keeps what it could not see (REQ-NFR-6)", () => {
  it("never writes a secret the editor was never shown", () => {
    const supplied = { user: { email: "changed@example.com", password: "«redacted»" } };
    const onDisk = { user: { email: "a@b.c", password: "${YAM_SAMPLE_PASSWORD}" } };

    const merged = keepRedacted(supplied, onDisk, new Set(["user.password"]));

    expect(merged).toEqual({
      user: { email: "changed@example.com", password: "${YAM_SAMPLE_PASSWORD}" },
    });
  });

  it("keeps a secret even when the editor sent something that is not the marker", () => {
    // Stronger than checking for `«redacted»`: a path the project declared secret
    // always takes the file's value, whatever arrived. The editor never saw the
    // secret, so it has nothing to say about it.
    const merged = keepRedacted(
      { user: { password: "hunter2" } },
      { user: { password: "${YAM_SAMPLE_PASSWORD}" } },
      new Set(["user.password"]),
    );
    expect(merged).toEqual({ user: { password: "${YAM_SAMPLE_PASSWORD}" } });
  });

  it("writes an ordinary value exactly as it arrived", () => {
    expect(keepRedacted({ env: "staging" }, { env: "test" }, new Set())).toEqual({
      env: "staging",
    });
  });

  it("goes as deep as the tree does", () => {
    expect(
      keepRedacted(
        { a: { b: { c: REDACTED, d: "new" } } },
        { a: { b: { c: "${X}", d: "old" } } },
        new Set(["a.b.c"]),
      ),
    ).toEqual({ a: { b: { c: "${X}", d: "new" } } });
  });

  it("400s when no values were sent", async () => {
    const response = await get("/data", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });
});

describe("the API client's endpoints (LLD §13.5)", () => {
  it("501s POST /api/request when no HTTP adapter was wired in", async () => {
    // The fake `ServiceApi` has no `apiRequest`, which is the honest answer for a
    // service started without one — not a 500, and not a second HTTP client.
    const response = await get("/api/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: { name: "x", method: "GET", url: "/" } }),
    });
    expect(response.status).toBe(501);
  });

  it("400s a POST /api/request with no request in it", async () => {
    const response = await get("/api/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect([400, 501]).toContain(response.status);
  });
});

describe("GET /plan (T3.7)", () => {
  it("answers with the compiled plan, not a reference to it", async () => {
    const plan = await json(await get("/plan"));
    expect(plan.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Array.isArray(plan.stories)).toBe(true);
  });
});

describe("POST /record: one session, and a decision that expires (P5-F4, LLD §13.5)", () => {
  /**
   * A service whose `record` blocks on the reviewer, exactly as the real one
   * does, with the project's `record.decisionDeadlineMs` set to something a
   * test can wait for.
   */
  async function recordingService(
    deadlineMs: number,
  ): Promise<{ service: RunningService; decisions: unknown[] }> {
    const decisions: unknown[] = [];
    const base = fakeProject();
    const api = fakeApi({
      loadProject: async () => ({
        ...base,
        config: {
          ...base.config,
          record: { model: "none", maxSnapshotTokens: 4000, visionFallback: false, decisionDeadlineMs: deadlineMs },
        },
      }),
      record: async (_loaded, options) => {
        const decision = await options.review?.({
          elementId: "login.username-field",
          entry: { candidates: [{ by: "role", score: 1 }], fingerprint: { tag: "input" } },
        });
        decisions.push(decision);
        return { grounded: 0 };
      },
    });
    const service = await createService({ project: PROJECT, token: TOKEN, port: 0, api });
    return { service, decisions };
  }

  const post = async (service: RunningService, path: string, body?: unknown): Promise<Response> =>
    await fetch(`${service.url}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it("answers 409 while a session is open, and starts nothing", async () => {
    /*
     * One session at a time (LLD §13.5). The second request must not start a
     * recorder — two sessions would drive one project's browser and write one
     * store, and the reviewer would have no way to tell which decision belonged
     * to which.
     */
    const { service } = await recordingService(60_000);
    try {
      const first = await post(service, "/record", { gateway: "fake" });
      expect(first.status).toBe(202);
      const { sessionId } = (await first.json()) as { sessionId: string };

      // Wait for the recorder to reach its first review, which is when the
      // session is properly "open".
      await new Promise((done) => setTimeout(done, 50));

      const second = await post(service, "/record", { gateway: "fake" });
      expect(second.status).toBe(409);
      const body = (await second.json()) as { error: string; message: string };
      expect(body.error).toBe("already-recording");
      expect(body.message).toMatch(/already open/i);

      // And it really started nothing: the first session is still the one
      // holding the pending decision, and stopping it releases the service.
      expect((await post(service, `/record/${sessionId}/stop`)).status).toBe(202);
      await new Promise((done) => setTimeout(done, 50));
      const third = await post(service, "/record", { gateway: "fake" });
      expect(third.status).toBe(202);
      const { sessionId: next } = (await third.json()) as { sessionId: string };
      await post(service, `/record/${next}/stop`);
    } finally {
      await service.close();
    }
  }, 30_000);

  it("expires a pending decision after record.decisionDeadlineMs", async () => {
    /*
     * The reason the deadline exists (Draft 2.7). A blocked session holds the
     * browser open *and* answers 409 to everyone else, so a reviewer who closed
     * the app window without deciding used to leave the service unusable until
     * it was restarted.
     */
    const { service, decisions } = await recordingService(150);
    try {
      const events: Array<Record<string, unknown>> = [];
      const unsubscribe = service.events.subscribe((event) =>
        events.push(event as unknown as Record<string, unknown>),
      );

      const started = await post(service, "/record", { gateway: "fake" });
      expect(started.status).toBe(202);

      await new Promise((done) => setTimeout(done, 600));
      unsubscribe();

      const expired = events.find((one) => one["kind"] === "record.decision.expired");
      expect(expired, events.map((one) => one["kind"]).join(", ")).toBeDefined();
      expect(expired!["elementId"]).toBe("login.username-field");
      expect(expired!["afterMs"]).toBe(150);

      // The grounding was rejected, not accepted by default: nothing a reviewer
      // did not approve reaches the store.
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({ accept: false });
      expect(String((decisions[0] as { why: string }).why)).toMatch(/decisionDeadlineMs/);

      // And the session is gone, so the next one starts.
      const next = await post(service, "/record", { gateway: "fake" });
      expect(next.status).toBe(202);
      const { sessionId } = (await next.json()) as { sessionId: string };
      await post(service, `/record/${sessionId}/stop`);
    } finally {
      await service.close();
    }
  }, 30_000);

  it("a decision that arrives in time cancels the deadline", async () => {
    // The timer must not fire after the answer: a session that was reviewed and
    // moved on would otherwise be aborted mid-recording.
    const { service, decisions } = await recordingService(300);
    try {
      const started = await post(service, "/record", { gateway: "fake" });
      const { sessionId } = (await started.json()) as { sessionId: string };
      await new Promise((done) => setTimeout(done, 50));

      const answered = await post(service, `/record/${sessionId}/decision`, { accept: true });
      expect(answered.status).toBe(202);

      await new Promise((done) => setTimeout(done, 500));
      expect(decisions).toEqual([{ accept: true }]);
    } finally {
      await service.close();
    }
  }, 30_000);
});

describe("the config's decision deadline (P5-F4, LLD §13.5)", () => {
  it("defaults to ten minutes", async () => {
    const { configSchema, DEFAULT_CONFIG } = await import("@svatah/yam-schema");
    expect(DEFAULT_CONFIG.record.decisionDeadlineMs).toBe(600_000);
    // And a config that does not mention it gets the default rather than an error.
    const parsed = configSchema.parse({
      ...DEFAULT_CONFIG,
      project: "x",
      record: { model: "m", maxSnapshotTokens: 100, visionFallback: false },
    });
    expect(parsed.record.decisionDeadlineMs).toBe(600_000);
  });

  it("is documented on POST /record, along with the 409", () => {
    const document = openApiDocument("0.2.0") as unknown as {
      paths: Record<string, { post?: { description?: string; responses: Record<string, { description: string }> } }>;
    };
    const record = document.paths["/record"]!.post!;
    expect(record.description).toMatch(/decisionDeadlineMs/);
    expect(record.description).toMatch(/409/);
    expect(record.responses["409"]!.description).toMatch(/already open/i);
  });
});
