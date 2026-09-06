/**
 * The journey wave 1 exists to deliver (SF-01, SF-06), end to end.
 *
 * Connect, inspect, act, verify, close — each in its own process, in an empty
 * directory, with no project, no flow, no plan and no credential.
 *
 * It is a slow test and it is the one that matters. Wave 1's first cut passed
 * its unit tests while this could not be run at all: the session store lived in
 * the CLI invocation, so `connect` printed an id and took the browser down with
 * it, and the next command answered `SESSION_NOT_FOUND`. The tests that were
 * supposed to cover it read source files for strings instead, which is why they
 * were green. So this drives the built binary, as a person would.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import { EXIT } from "@svatah/yam-bindings-cli";

const YAM = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "bin.js");
let app: SampleServer;

beforeAll(async () => {
  app = await startSampleApp(0);
}, 120_000);

afterAll(async () => {
  await app?.close();
  // The broker outlives its commands by design; it must not outlive the suite.
  spawnSync("pkill", ["-f", "surface broker"]);
});

interface Ran {
  readonly code: number;
  readonly envelope: Record<string, unknown>;
  readonly stderr: string;
}

/** One command, one process, in `cwd`. */
function run(cwd: string, args: readonly string[]): Promise<Ran> {
  return new Promise((done) => {
    let out = "";
    let err = "";
    const child = spawn(process.execPath, [YAM, ...args], {
      cwd,
      env: { ...process.env, CI: "true" },
    });
    child.stdout.on("data", (chunk) => (out += String(chunk)));
    child.stderr.on("data", (chunk) => (err += String(chunk)));
    child.on("exit", (code) => {
      let envelope: Record<string, unknown> = {};
      try {
        envelope = JSON.parse(out) as Record<string, unknown>;
      } catch {
        envelope = {};
      }
      done({ code: code ?? 1, envelope, stderr: err });
    });
  });
}

const resultOf = (ran: Ran): Record<string, unknown> =>
  (ran.envelope["result"] ?? {}) as Record<string, unknown>;

describe("connect, inspect, act, verify (SF-01, SF-06)", () => {
  it("runs across six separate processes and leaves the directory empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-surface-"));

    const connect = await run(dir, ["surface", "connect", "--url", app.origin, "--json"]);
    expect(connect.code, connect.stderr).toBe(EXIT.ok);
    expect(connect.envelope["status"]).toBe("succeeded");
    const session = String(resultOf(connect)["sessionId"]);
    expect(session).toMatch(/^s_/);

    /*
     * A different process. The session is in the broker, which is why this can
     * see it at all, and the reason the whole command family exists.
     */
    const snapshot = await run(dir, ["surface", "snapshot", "--session", session, "--json"]);
    expect(snapshot.code, snapshot.stderr).toBe(EXIT.ok);
    // Connect navigates: a session that only had a base URL saw a blank tab,
    // and every inspection after it was green against nothing.
    expect((resultOf(snapshot)["nodes"] as unknown[]).length).toBeGreaterThan(0);

    const read = await run(dir, ["surface", "read", "--session", session, "--kind", "title", "--json"]);
    expect(read.code).toBe(EXIT.ok);
    expect(String(resultOf(read)["value"])).toContain("Yam Sample");

    // A predicate a person can write: a bare string is a literal.
    writeFileSync(
      join(dir, "check.json"),
      JSON.stringify({ predicate: { kind: "titleContains", value: "Yam" }, subject: "page" }),
      "utf8",
    );
    const check = await run(dir, ["surface", "check", "--session", session, "--input", "check.json", "--json"]);
    expect(check.code, JSON.stringify(check.envelope)).toBe(EXIT.ok);
    expect(resultOf(check)["ok"]).toBe(true);

    const sessions = await run(dir, ["surface", "sessions", "--json"]);
    expect(sessions.code).toBe(EXIT.ok);
    expect(JSON.stringify(resultOf(sessions))).toContain(session);

    const closed = await run(dir, ["surface", "close", "--session", session, "--json"]);
    expect(closed.code).toBe(EXIT.ok);

    // Closed means closed: the id cannot be used again.
    const after = await run(dir, ["surface", "snapshot", "--session", session, "--json"]);
    expect(after.code).toBe(21);
    expect(after.envelope["status"]).toBe("failed");

    // Nothing but the file the test wrote: no project, no plan, no store.
    expect(readdirSync(dir)).toEqual(["check.json"]);
  }, 240_000);

  it("fails a check that does not hold, with its own exit code and the observed value", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-surface-"));
    const connect = await run(dir, ["surface", "connect", "--url", app.origin, "--json"]);
    const session = String(resultOf(connect)["sessionId"]);
    try {
      writeFileSync(
        join(dir, "no.json"),
        JSON.stringify({ predicate: { kind: "titleContains", value: "Nonesuch" }, subject: "page" }),
        "utf8",
      );
      const check = await run(dir, ["surface", "check", "--session", session, "--input", "no.json", "--json"]);
      // 20 is CHECK_FAILED: a check that answered false is not a crash, and a
      // script has to be able to tell those apart.
      expect(check.code).toBe(20);
      expect((check.envelope["error"] as { code?: string }).code).toBe("CHECK_FAILED");
      expect(String(resultOf(check)["actual"])).toContain("Yam Sample");
    } finally {
      await run(dir, ["surface", "close", "--session", session, "--json"]);
    }
  }, 240_000);

  it("refuses an adapter this host does not have, before opening anything", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-surface-"));
    const connect = await run(dir, [
      "surface",
      "connect",
      "--url",
      app.origin,
      "--adapter",
      "does-not-exist",
      "--json",
    ]);
    expect(connect.envelope["status"]).toMatch(/^(failed|refused)$/);
    expect(JSON.stringify(connect.envelope)).toMatch(/not registered/i);
    // Not a silent fall back to the one that happens to be configured.
    expect(JSON.stringify(connect.envelope)).not.toContain("playwright\"");
    expect(readdirSync(dir)).toEqual([]);
  }, 120_000);
});
