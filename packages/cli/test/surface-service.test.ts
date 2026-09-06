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

describe("the service's surface routes (SF-03, SF-04, SF-12)", () => {
  it("refuses an adapter this host does not have, with a 400 and a reason", async () => {
    const refused = await post("/surface/bad-adapter/open", { adapter: "does-not-exist" });
    // Not 200 (the audit's finding) and not 500 (a caller's mistake is not ours).
    expect(refused.status).toBe(400);
    expect(refused.body).toMatch(/not registered/i);
    expect(refused.body).toMatch(/playwright/);
  }, 120_000);

  it("inspects without an intent, and says what it saw", async () => {
    expect((await post("/surface/no-intent/open", {})).status).toBe(200);

    // Direct control owes nobody a sentence (SF-12). Before wave 1 this was a
    // 400; after the gate came off but before the schema followed, a 500.
    const read = await post("/surface/no-intent/read", { kind: "title" });
    expect(read.status, read.body).toBe(200);
    expect(read.body).toContain("Yam Sample");

    const snapshot = await post("/surface/no-intent/snapshot", {});
    expect(snapshot.status, snapshot.body).toBe(200);

    await post("/surface/no-intent/close", {});
  }, 120_000);

  it("forwards the arguments it used to drop: a second ref, an attribute name, a node budget", async () => {
    expect((await post("/surface/args/open", {})).status).toBe(200);
    try {
      /*
       * `maxNodes` was dropped, so a caller asking for a bounded snapshot got
       * the whole page. Two budgets, two sizes: the argument arrives.
       */
      const small = await post("/surface/args/snapshot", { maxNodes: 3, interactiveOnly: true });
      const large = await post("/surface/args/snapshot", { maxNodes: 60, interactiveOnly: true });
      expect(small.status).toBe(200);
      const nodesIn = (body: string): number =>
        ((JSON.parse(body) as { nodes?: unknown[] }).nodes ?? []).length;
      expect(nodesIn(small.body)).toBeLessThanOrEqual(3);
      expect(nodesIn(large.body)).toBeGreaterThan(nodesIn(small.body));

      // `name` was dropped, so an attribute read had nothing to name.
      const shot = await post("/surface/args/snapshot", { interactiveOnly: true, maxNodes: 40 });
      const first = ((JSON.parse(shot.body) as { nodes: Array<{ ref: string }> }).nodes ?? [])[0];
      expect(first, shot.body).toBeDefined();
      const attribute = await post("/surface/args/read", { kind: "attribute", ref: first!.ref, name: "id" });
      expect(attribute.status, attribute.body).toBe(200);
    } finally {
      await post("/surface/args/close", {});
    }
  }, 180_000);
});
