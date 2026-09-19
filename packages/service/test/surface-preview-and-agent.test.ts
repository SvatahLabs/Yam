/**
 * The two routes the desktop's inspector needed and the service did not have
 * (T15, T16, SF-07, SF-15).
 *
 * `GET /sessions/:session/screenshot.png` — a picture of the surface as bytes,
 * taken through the broker's own operation into a temporary file that is gone
 * by the time the answer arrives.
 *
 * `POST /agents/test` — the connection test that speaks MCP. It is driven here
 * against a stand-in server started through `YAM_MCP_TEST_COMMAND`, over real
 * stdio pipes, and never against the network.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createService,
  MCP_TEST_COMMAND,
  mcpTestCommand,
  mcpTestTimeout,
  openApiDocument,
  testMcpServer,
  type RunningService,
  type ServiceApi,
} from "../src/index.js";
import { fakeApi } from "./fake-api.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, "..", "..", "..", "evals", "fixtures");
const TOKEN = "test-token";
const FAKE_SERVER = join(HERE, "fixtures", "fake-mcp-server.mjs");

/** Eight bytes of PNG signature and a little more: what an adapter "wrote". */
const PICTURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);

const envelope = (status: string, extra: Record<string, unknown>): Record<string, unknown> => ({
  schemaVersion: "1.0",
  requestId: "req_test",
  status,
  ...extra,
});

/* ────────────────────────────────────────────────────────────────────────────
 * GET /sessions/:session/screenshot.png
 * ──────────────────────────────────────────────────────────────────────────── */

describe("GET /sessions/:session/screenshot.png (T15)", () => {
  const written: string[] = [];
  let service: RunningService;

  /** A broker's `screenshot` operation, answering by session id. */
  const operations: ServiceApi["surfaceOperations"] = [
    {
      name: "screenshot",
      method: "POST",
      path: "/sessions/:session/screenshot",
      async run(args) {
        const path = String(args["path"]);
        written.push(path);
        switch (args["session"]) {
          case "s_ok":
            writeFileSync(path, PICTURE);
            return envelope("succeeded", { result: { path } });
          case "s_gone":
            return envelope("failed", { error: { code: "SESSION_NOT_FOUND", message: "No session s_gone here.", retryable: false } });
          case "s_denied":
            return envelope("refused", {
              error: { code: "PERMISSION_REQUIRED", message: "Screen Recording is not granted.", retryable: false },
            });
          case "s_liar":
            return envelope("succeeded", { result: { path } });
          default:
            throw new Error("connect ECONNREFUSED 127.0.0.1:1");
        }
      },
    },
  ];

  beforeAll(async () => {
    service = await createService({
      project: PROJECT,
      token: TOKEN,
      port: 0,
      api: fakeApi({ surfaceOperations: operations }),
    });
  });
  afterAll(async () => {
    await service.close();
  });

  const get = async (session: string, token = TOKEN): Promise<Response> =>
    await fetch(`${service.url}/sessions/${session}/screenshot.png`, {
      headers: { authorization: `Bearer ${token}` },
    });

  it("answers the picture's bytes as image/png", async () => {
    const response = await get("s_ok");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PICTURE);
  });

  it("takes it into a directory of its own under the OS temporary directory, and deletes it", async () => {
    await get("s_ok");
    const path = written.at(-1)!;
    expect(path.startsWith(tmpdir())).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dirname(path))).toBe(false);
  });

  it("is a 404 with the broker's envelope for a session it does not have", async () => {
    const response = await get("s_gone");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("SESSION_NOT_FOUND");
  });

  it("is a 422 carrying the broker's own refusal, and cleans up after it too", async () => {
    const response = await get("s_denied");
    expect(response.status).toBe(422);
    const body = (await response.json()) as { status: string; error: { code: string; message: string } };
    expect(body.status).toBe("refused");
    expect(body.error).toMatchObject({ code: "PERMISSION_REQUIRED", message: "Screen Recording is not granted." });
    expect(existsSync(dirname(written.at(-1)!))).toBe(false);
  });

  it("does not answer 200 for a screenshot the adapter claimed and did not write", async () => {
    const response = await get("s_liar");
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain("no file was written");
  });

  it("is a 502 when the broker cannot be reached", async () => {
    const response = await get("s_unreachable");
    expect(response.status).toBe(502);
    expect(((await response.json()) as { message: string }).message).toContain("ECONNREFUSED");
  });

  it("needs the bearer token, like every route but two", async () => {
    const before = written.length;
    expect((await get("s_ok", "wrong")).status).toBe(401);
    // Refused before anything was asked of the broker.
    expect(written.length).toBe(before);
  });

  it("is a 501 on a service started without the surface operations", async () => {
    const bare = await createService({ project: PROJECT, token: TOKEN, port: 0, api: fakeApi() });
    try {
      const response = await fetch(`${bare.url}/sessions/s_ok/screenshot.png`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(response.status).toBe(501);
    } finally {
      await bare.close();
    }
  });

  it("is described, with its image answer, in the OpenAPI document", () => {
    const paths = openApiDocument("0.1.0")["paths"] as Record<string, Record<string, { responses: Record<string, { content?: object }> }>>;
    const route = paths["/sessions/{session}/screenshot.png"]?.["get"];
    expect(route).toBeDefined();
    expect(Object.keys(route!.responses["200"]!.content ?? {})).toEqual(["image/png"]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * POST /agents/test
 * ──────────────────────────────────────────────────────────────────────────── */

describe("the MCP connection test (T16, SF-07, SF-15)", () => {
  let scratch: string;
  const pidFile = (): string => join(scratch, `pid-${Math.random().toString(36).slice(2)}`);

  /** Whether the stand-in whose pid is in `file` has stopped, waiting a little for it. */
  const stopped = async (file: string): Promise<boolean> => {
    const pid = Number(readFileSync(file, "utf8"));
    for (let waited = 0; waited < 60; waited += 1) {
      try {
        process.kill(pid, 0);
      } catch {
        return true;
      }
      await new Promise((done) => setTimeout(done, 50));
    }
    return false;
  };

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "yam-agent-test-"));
  });
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  describe("the command", () => {
    it("is the one the agent configuration names, unless the service's environment says otherwise", () => {
      expect(MCP_TEST_COMMAND).toEqual(["npx", "-y", "@svatah/yam-mcp"]);
      expect(mcpTestCommand({})).toEqual(["npx", "-y", "@svatah/yam-mcp"]);
      expect(mcpTestCommand({ YAM_MCP_TEST_COMMAND: "node /abs/packages/mcp/dist/bin.js" })).toEqual([
        "node",
        "/abs/packages/mcp/dist/bin.js",
      ]);
      expect(mcpTestCommand({ YAM_MCP_TEST_COMMAND: '["/a path/node", "b.js"]' })).toEqual(["/a path/node", "b.js"]);
    });

    it("waits sixty seconds by default, for npx to fetch the package", () => {
      expect(mcpTestTimeout({})).toBe(60_000);
      expect(mcpTestTimeout({ YAM_MCP_TEST_TIMEOUT_MS: "1500" })).toBe(1500);
      expect(mcpTestTimeout({ YAM_MCP_TEST_TIMEOUT_MS: "soon" })).toBe(60_000);
    });
  });

  describe("the handshake, against a stand-in over stdio", () => {
    it("completes initialize, notifications/initialized and every page of tools/list, then stops the server", async () => {
      const file = pidFile();
      const result = await testMcpServer({ command: [process.execPath, FAKE_SERVER, file], timeoutMs: 10_000 });
      expect(result).toMatchObject({
        ok: true,
        server: { name: "fake-yam", version: "9.9.9" },
        protocolVersion: "2025-11-25",
        // Two on the first page and one on the second: the cursor was followed,
        // and `tools/list` came after `notifications/initialized` or it refuses.
        tools: 3,
      });
      expect(result.ms).toBeGreaterThanOrEqual(0);
      expect(await stopped(file)).toBe(true);
    });

    it("answers a request the server makes of it, rather than hanging", async () => {
      const result = await testMcpServer({
        command: [process.execPath, FAKE_SERVER, pidFile(), "--ping"],
        timeoutMs: 10_000,
      });
      expect(result.ok).toBe(true);
    });

    it("names initialize when the server refuses it", async () => {
      const file = pidFile();
      const result = await testMcpServer({ command: [process.execPath, FAKE_SERVER, file, "--refuse"], timeoutMs: 10_000 });
      expect(result).toMatchObject({ ok: false, stage: "initialize" });
      expect(result.ok === false && result.message).toContain("Unsupported protocol version");
      expect(await stopped(file)).toBe(true);
    });

    it("gives up at the deadline, says which answer never came, and stops the server", async () => {
      const file = pidFile();
      const result = await testMcpServer({ command: [process.execPath, FAKE_SERVER, file, "--silent"], timeoutMs: 700 });
      expect(result).toMatchObject({ ok: false, stage: "initialize" });
      expect(result.ok === false && result.message).toMatch(/No answer to initialize within \d+ s/);
      expect(result.ok === false && result.message).toContain("fake-mcp-server: listening on stdio");
      expect(await stopped(file)).toBe(true);
    });

    it("reports a server that exits, with what it said on stderr", async () => {
      const result = await testMcpServer({ command: [process.execPath, FAKE_SERVER, pidFile(), "--exit"], timeoutMs: 10_000 });
      expect(result).toMatchObject({ ok: false, stage: "initialize" });
      expect(result.ok === false && result.message).toContain("code 3");
      expect(result.ok === false && result.message).toContain("cannot find module");
    });

    it("does not call a server that writes prose to stdout one that speaks MCP", async () => {
      const result = await testMcpServer({ command: [process.execPath, FAKE_SERVER, pidFile(), "--garbage"], timeoutMs: 10_000 });
      expect(result).toMatchObject({ ok: false, stage: "initialize" });
      expect(result.ok === false && result.message).toContain("not JSON-RPC");
    });

    it("says it could not start a command that does not exist", async () => {
      const result = await testMcpServer({ command: [join(scratch, "no-such-program")], timeoutMs: 10_000 });
      expect(result).toMatchObject({ ok: false, stage: "start" });
      expect(result.ok === false && result.message).toContain("Could not start");
    });
  });

  describe("POST /agents/test", () => {
    let service: RunningService;
    const saved = { command: process.env["YAM_MCP_TEST_COMMAND"], timeout: process.env["YAM_MCP_TEST_TIMEOUT_MS"] };
    let file: string;

    beforeAll(async () => {
      service = await createService({ project: PROJECT, token: TOKEN, port: 0, api: fakeApi() });
    });
    afterEach(() => {
      for (const [name, value] of [
        ["YAM_MCP_TEST_COMMAND", saved.command],
        ["YAM_MCP_TEST_TIMEOUT_MS", saved.timeout],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
    afterAll(async () => {
      await service.close();
    });

    const post = async (body?: unknown, token = TOKEN): Promise<Response> =>
      await fetch(`${service.url}/agents/test`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    it("starts the configured server and answers what the handshake came to", async () => {
      file = pidFile();
      process.env["YAM_MCP_TEST_COMMAND"] = JSON.stringify([process.execPath, FAKE_SERVER, file]);
      const response = await post();
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ ok: true, server: { name: "fake-yam", version: "9.9.9" }, tools: 3 });
      expect(String(body["command"])).toContain("fake-mcp-server.mjs");
      expect(await stopped(file)).toBe(true);
    }, 20_000);

    it("never takes the command from the request (SF-15)", async () => {
      const marker = join(scratch, "pwned");
      file = pidFile();
      process.env["YAM_MCP_TEST_COMMAND"] = JSON.stringify([process.execPath, FAKE_SERVER, file]);
      const response = await post({
        command: ["sh", "-c", `touch ${marker}`],
        args: ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "")`],
      });
      const body = (await response.json()) as Record<string, unknown>;
      expect(body["ok"]).toBe(true);
      expect(String(body["command"])).not.toContain("touch");
      expect(existsSync(marker)).toBe(false);
    }, 20_000);

    it("answers 200 with the stage and the reason when the handshake does not complete", async () => {
      process.env["YAM_MCP_TEST_COMMAND"] = JSON.stringify([process.execPath, FAKE_SERVER, pidFile(), "--silent"]);
      process.env["YAM_MCP_TEST_TIMEOUT_MS"] = "600";
      const response = await post();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: false, stage: "initialize" });
    }, 20_000);

    it("needs the bearer token, and starts nothing without it", async () => {
      file = pidFile();
      process.env["YAM_MCP_TEST_COMMAND"] = JSON.stringify([process.execPath, FAKE_SERVER, file]);
      expect((await post(undefined, "wrong")).status).toBe(401);
      await new Promise((done) => setTimeout(done, 300));
      expect(existsSync(file)).toBe(false);
    });

    it("is described in the OpenAPI document, with no request body to take a command from", () => {
      const paths = openApiDocument("0.1.0")["paths"] as Record<string, Record<string, { requestBody?: unknown; description?: string }>>;
      const route = paths["/agents/test"]?.["post"];
      expect(route).toBeDefined();
      expect(route!.requestBody).toBeUndefined();
      expect(route!.description).toContain("never read from the request");
    });
  });
});
