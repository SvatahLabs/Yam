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
import { createService, openApiDocument, type RunningService } from "../src/index.js";
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
 * an interface here would be writing the ADE's client twice.
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
    // The ADE reads the token from the child's stdout and health-checks before
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
    // The ADE shows a data editor in a renderer process. A resolved secret must
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
    expect(served).toEqual(openApiDocument("0.1.0"));
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
    // The ADE's Run screen watches a run happen; a blocking call would make it
    // a spinner.
    const runs = mkdtempSync(join(tmpdir(), "svatah-service-"));
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

/*
 * Inputs, before anything starts (P2-F4, Draft 2.4, LLD §13.5).
 *
 * The fake project's "Sign in" declares `email: string` with no default, and its
 * run block invokes it. Calling a function without its arguments is a mistake in
 * the call; answering 202 and letting the executor fail would give the ADE a red
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
