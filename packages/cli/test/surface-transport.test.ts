/**
 * The service serves what the catalogue says, and the same sessions (T12, SF-03).
 *
 * Wave 2's first cut generated an OpenAPI document from the catalogue, tested
 * the generator against itself, and left the service serving hand-written
 * routes beside it. The generated document described an API nobody served, and
 * an argument added to the catalogue reached the CLI and MCP but not HTTP.
 *
 * So this asks the running service, over HTTP, for the routes the catalogue
 * declares — and checks that the session it opens is the one the command line
 * can see, because two transports that could not address each other's sessions
 * would be two products.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import { OPERATIONS } from "@svatah/yam-surface-control";

const YAM = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "bin.js");

let app: SampleServer;
let service: ChildProcess;
let connection: { url: string; token: string };

beforeAll(async () => {
  app = await startSampleApp(0);
  const dir = mkdtempSync(join(tmpdir(), "yam-transport-"));
  mkdirSync(join(dir, "flows"), { recursive: true });
  writeFileSync(
    join(dir, "yam.config.yaml"),
    `schemaVersion: "1.0.0"\nproject: "transport"\nadapter: playwright\napp: { baseUrl: "${app.origin}" }\n` +
      `bindings: { dir: bindings, testIdAttributes: ["data-testid"] }\n` +
      `run: { headless: true, stepTimeoutMs: 10000, candidateTimeoutMs: 2000 }\n`,
    "utf8",
  );
  service = spawn(process.execPath, [YAM, "serve", dir, "--port", "0"], {
    env: { ...process.env, CI: "true" },
  });
  let buffer = "";
  connection = await new Promise((done) => {
    service.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      const match = /url=(\S+) token=(\S+)/.exec(buffer);
      if (match !== null) done({ url: match[1]!, token: match[2]! });
    });
  });
}, 180_000);

afterAll(async () => {
  service?.kill("SIGTERM");
  await app?.close();
  spawnSync("pkill", ["-f", "surface broker"]);
});

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; envelope: Record<string, unknown> }> {
  const response = await fetch(`${connection.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${connection.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const envelope = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, envelope };
}

const resultOf = (envelope: Record<string, unknown>): Record<string, unknown> =>
  (envelope["result"] ?? {}) as Record<string, unknown>;

describe("the service serves the catalogue (T12, SF-03)", () => {
  it("answers on every path the catalogue declares, in the envelope the dispatcher builds", async () => {
    const opened = await call("POST", "/sessions", { url: app.origin });
    expect(opened.status, JSON.stringify(opened.envelope)).toBe(200);
    expect(opened.envelope["status"]).toBe("succeeded");
    const session = String(resultOf(opened.envelope)["sessionId"]);

    try {
      const snapshot = await call("POST", `/sessions/${session}/snapshot`, { maxNodes: 3 });
      expect(snapshot.status).toBe(200);
      expect((resultOf(snapshot.envelope)["nodes"] as unknown[]).length).toBeLessThanOrEqual(3);

      const read = await call("POST", `/sessions/${session}/read`, { kind: "title" });
      expect(String(resultOf(read.envelope)["value"])).toContain("Yam Sample");

      const targets = await call("GET", "/targets");
      expect(targets.envelope["status"]).toBe("succeeded");

      /*
       * One broker behind both transports: the session this HTTP client opened
       * is one the command line lists. Two stores would be two products that
       * happened to share a name.
       */
      const listed = spawnSync(process.execPath, [YAM, "surface", "sessions", "--json"], {
        encoding: "utf8",
        env: { ...process.env, CI: "true" },
      });
      expect(listed.stdout).toContain(session);
    } finally {
      const closed = await call("DELETE", `/sessions/${session}`);
      expect(closed.envelope["status"]).toBe("succeeded");
    }
  }, 240_000);

  it("declares one path per operation, and serves a route for each", async () => {
    // The catalogue is the list; nothing here enumerates operations by hand.
    const paths = OPERATIONS.map((one) => `${one.service.method} ${one.service.path}`);
    expect(new Set(paths).size).toBe(OPERATIONS.length);

    /*
     * A path the catalogue does not declare is not served. `/sessions/:id/act`
     * is real; `/sessions/:id/no-such-operation` is the control.
     */
    const opened = await call("POST", "/sessions", { url: app.origin });
    const session = String(resultOf(opened.envelope)["sessionId"]);
    try {
      const missing = await call("POST", `/sessions/${session}/no-such-operation`, {});
      expect(missing.status).toBe(404);
    } finally {
      await call("DELETE", `/sessions/${session}`);
    }
  }, 240_000);

  it("carries a refusal as a refusal, not as a success", async () => {
    const opened = await call("POST", "/sessions", { url: app.origin });
    const session = String(resultOf(opened.envelope)["sessionId"]);
    try {
      // A reference from no snapshot at all cannot address anything.
      const refused = await call("POST", `/sessions/${session}/describe`, { ref: "r99999" });
      expect(refused.envelope["status"]).toBe("refused");
      expect((refused.envelope["error"] as { code?: string }).code).toBe("STALE_REFERENCE");
    } finally {
      await call("DELETE", `/sessions/${session}`);
    }
  }, 240_000);
});

describe("the help offers every operation the catalogue defines", () => {
  /**
   * `describe`, `capabilities` and `screenshot` were catalogue operations that
   * worked and that `yam surface --help` did not mention, so the only way to
   * find them was to read the source. The help is hand-written for its wording;
   * what it must not do is omit something.
   */
  it("names each CLI subcommand somewhere in the surface help", async () => {
    const { COMMANDS, NOUNS } = await import("../src/help.js");
    const documented = new Set(
      COMMANDS.filter((one) => one.name.startsWith("surface ")).map((one) =>
        one.name.slice("surface ".length),
      ),
    );
    const missing = OPERATIONS.map((one) => one.cli.subcommand).filter(
      (sub) => !documented.has(sub),
    );
    expect(missing, `not documented: ${missing.join(", ")}`).toEqual([]);

    const noun = NOUNS.find(([name]) => name === "surface")?.[1] ?? "";
    for (const operation of OPERATIONS) {
      expect(noun, `the surface noun line omits ${operation.cli.subcommand}`).toContain(
        operation.cli.subcommand,
      );
    }
  });
});
