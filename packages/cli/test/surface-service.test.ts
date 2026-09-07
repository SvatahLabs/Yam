/**
 * The service's surface routes, as a caller experiences them (G04, G05, G07).
 *
 * The audit found three defects here and wave 1's first cut "fixed" them with
 * tests that read the source for a string. Two of the three survived: removing
 * the `missing-intent` gate left the trajectory schema to reject the same call
 * and escape as a 500, and the adapter reached a function that dropped it, so
 * `{"adapter":"does-not-exist"}` still answered 200. A grep cannot see either.
 *
 * So this starts a real service and asks it.
 *
 * T15 moved these routes: the older `/surface/:session/*` shape went with the
 * Explorer that was its only caller, and the catalogue's own routes — `POST
 * /sessions`, `/sessions/:id/{snapshot,read}`, `DELETE /sessions/:id` — are what
 * a caller uses now. The three properties are unchanged, so the cases are the
 * same questions asked of the routes that exist.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";

const YAM = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "bin.js");

let app: SampleServer;
let service: ChildProcess;
let connection: { url: string; token: string };

beforeAll(async () => {
  app = await startSampleApp(0);
  const dir = mkdtempSync(join(tmpdir(), "yam-surface-svc-"));
  mkdirSync(join(dir, "flows"), { recursive: true });
  writeFileSync(
    join(dir, "yam.config.yaml"),
    `schemaVersion: "1.0.0"\nproject: "surface"\nadapter: playwright\napp: { baseUrl: "${app.origin}" }\n` +
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
});

async function post(path: string, body: unknown): Promise<{ status: number; body: string }> {
  const response = await fetch(`${connection.url}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.text() };
}

/** Open a session through the catalogue's connect, and answer with its id. */
async function connect(body: Record<string, unknown> = {}): Promise<{ status: number; body: string; session?: string }> {
  const answer = await post("/sessions", { url: app.origin, ...body });
  const parsed = JSON.parse(answer.body) as { result?: { sessionId?: string } };
  return { ...answer, ...(parsed.result?.sessionId === undefined ? {} : { session: parsed.result.sessionId }) };
}

async function close(session: string): Promise<void> {
  await fetch(`${connection.url}/sessions/${encodeURIComponent(session)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${connection.token}` },
  });
}

describe("the service's surface routes (SF-03, SF-04, SF-12)", () => {
  it("refuses an adapter this host does not have, with a reason and no session", async () => {
    const refused = await connect({ adapter: "does-not-exist" });
    /*
     * The envelope carries the outcome; the status carries whether the service
     * could answer at all (T12). So this is a 200 whose `status` is `refused` —
     * not the audit's 200-that-succeeded, and not a 500, because a caller's
     * mistake is not the service's fault.
     */
    expect(refused.status).toBe(200);
    const envelope = JSON.parse(refused.body) as { status: string; error?: { code?: string; message?: string } };
    expect(envelope.status).toBe("refused");
    expect(envelope.error?.code).toMatch(/ADAPTER_NOT_REGISTERED|ADAPTER_UNAVAILABLE/);
    expect(envelope.error?.message ?? "").toMatch(/not registered|not available|requires/i);
    // And nothing was launched: a refusal opens no session.
    expect(refused.session).toBeUndefined();
  }, 120_000);

  it("inspects without an intent, and says what it saw", async () => {
    const opened = await connect();
    expect(opened.session, opened.body).toBeDefined();
    const session = opened.session!;
    try {
      // Direct control owes nobody a sentence (SF-12). Before wave 1 this was a
      // 400; after the gate came off but before the schema followed, a 500.
      const read = await post(`/sessions/${session}/read`, { kind: "title" });
      expect(read.status, read.body).toBe(200);
      expect(read.body).toContain("Yam Sample");

      const snapshot = await post(`/sessions/${session}/snapshot`, {});
      expect(snapshot.status, snapshot.body).toBe(200);
      expect(JSON.parse(snapshot.body).status).toBe("succeeded");
    } finally {
      await close(session);
    }
  }, 120_000);

  it("forwards the arguments it used to drop: a second ref, an attribute name, a node budget", async () => {
    const opened = await connect();
    expect(opened.session, opened.body).toBeDefined();
    const session = opened.session!;
    try {
      /*
       * `maxNodes` was dropped, so a caller asking for a bounded snapshot got
       * the whole page. Two budgets, two sizes: the argument arrives.
       */
      const small = await post(`/sessions/${session}/snapshot`, { maxNodes: 3, interactiveOnly: true });
      const large = await post(`/sessions/${session}/snapshot`, { maxNodes: 60, interactiveOnly: true });
      expect(small.status).toBe(200);
      const nodesIn = (body: string): number =>
        ((JSON.parse(body) as { result?: { nodes?: unknown[] } }).result?.nodes ?? []).length;
      expect(nodesIn(small.body)).toBeLessThanOrEqual(3);
      expect(nodesIn(large.body)).toBeGreaterThan(nodesIn(small.body));

      // `name` was dropped, so an attribute read had nothing to name.
      const shot = await post(`/sessions/${session}/snapshot`, { interactiveOnly: true, maxNodes: 40 });
      const first = ((JSON.parse(shot.body) as { result: { nodes: Array<{ ref: string }> } }).result.nodes ?? [])[0];
      expect(first, shot.body).toBeDefined();
      const attribute = await post(`/sessions/${session}/read`, {
        kind: "attribute", ref: first!.ref, name: "id",
      });
      expect(attribute.status, attribute.body).toBe(200);
      expect(JSON.parse(attribute.body).status).toBe("succeeded");
    } finally {
      await close(session);
    }
  }, 180_000);
});
