/**
 * One broker to a machine, and one that is busy is not one that is gone
 * (T00, SF-05, SF-13).
 *
 * These are the two defects that made the Yam-on-Yam suite intermittent. Both
 * showed as the same sentence — the outer session answering `SESSION_NOT_FOUND`
 * around the moment the packaged application opened its own inner session —
 * and neither had anything to do with the application. That moment is simply
 * the first time two clients ask for a broker at once: the command line driving
 * the application, and the application's own service, which reaches the same
 * broker through the same catalogue.
 *
 * 1. **Two starters, two brokers.** Starting one was "look for a descriptor; if
 *    there is none, spawn one". Nothing sat between the looking and the
 *    spawning, so two clients that looked at the same instant both spawned;
 *    both bound a port and wrote `broker.json`; the second write won. The loser
 *    kept running with every session that had been opened on it, and nothing
 *    could address it again.
 * 2. **A busy broker taken for a dead one.** Liveness was a boolean over a
 *    two-second deadline. A broker launching a browser for somebody else can
 *    take longer than that to answer, and the caller that read the `false`
 *    removed its descriptor and started a rival — without ever asking whether
 *    the process was still there.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireStartLock, startLockHeld } from "../src/broker.js";
import { brokerState } from "../src/server.js";
import { catalogueFingerprint } from "@svatah/yam-contract";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "yam-one-broker-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the start lock (T00)", () => {
  it("is held by exactly one of many callers", () => {
    const taken = Array.from({ length: 20 }, () => acquireStartLock(dir));
    expect(taken.filter((one) => one !== undefined)).toHaveLength(1);
  });

  it("lets the next caller in once the holder gives it up", () => {
    const first = acquireStartLock(dir);
    expect(first).toBeDefined();
    expect(acquireStartLock(dir)).toBeUndefined();
    first!.release();
    const second = acquireStartLock(dir);
    expect(second).toBeDefined();
    second!.release();
  });

  it("reports that a start is in progress, and that it is not once released", () => {
    const lock = acquireStartLock(dir);
    expect(startLockHeld(dir)).toBe(true);
    lock!.release();
    expect(startLockHeld(dir)).toBe(false);
  });

  it("survives a double release", () => {
    const lock = acquireStartLock(dir);
    lock!.release();
    expect(() => lock!.release()).not.toThrow();
  });

  it("breaks a lock whose holder is gone, so one crash is not permanent", () => {
    /*
     * A pid that cannot be running: the kernel reserves 0, and `process.kill`
     * on it does not mean what a lock holder would mean by it.
     */
    writeFileSync(join(dir, "broker.lock"), JSON.stringify({ pid: 2 ** 31 - 1, at: "then" }));
    const taken = acquireStartLock(dir);
    expect(taken, "a lock naming a dead process is the residue of a crash").toBeDefined();
    taken!.release();
  });

  it("does not break a lock whose holder is this very process", () => {
    writeFileSync(join(dir, "broker.lock"), JSON.stringify({ pid: process.pid, at: "now" }));
    expect(acquireStartLock(dir)).toBeUndefined();
  });

  it("writes its holder's pid, so the file is never a lock about nobody", () => {
    const lock = acquireStartLock(dir);
    const held = JSON.parse(readFileSync(join(dir, "broker.lock"), "utf8")) as { pid: number };
    expect(held.pid).toBe(process.pid);
    lock!.release();
    expect(existsSync(join(dir, "broker.lock"))).toBe(false);
  });
});

/** A broker-shaped `/health`, with the delay and the contract a test wants. */
function healthServer(options: {
  delayMs?: number;
  contract?: string;
  status?: number;
}): Promise<{ url: string; close(): Promise<void>; server: Server }> {
  const server = createServer((request, response) => {
    const answer = (): void => {
      if (options.status !== undefined && options.status !== 200) {
        response.writeHead(options.status).end("{}");
        return;
      }
      const body = JSON.stringify({
        ok: true,
        sessions: 0,
        contract: options.contract ?? catalogueFingerprint(),
      });
      response.writeHead(200, { "content-type": "application/json" }).end(body);
    };
    if (options.delayMs === undefined) answer();
    else setTimeout(answer, options.delayMs).unref();
    void request;
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      done({
        url: `http://127.0.0.1:${port}`,
        server,
        close: () => new Promise<void>((closed) => server.close(() => closed())),
      });
    });
  });
}

describe("what a broker at a descriptor is (T00, SF-05)", () => {
  it("is serving when it answers with this build's contract", async () => {
    const one = await healthServer({});
    expect(
      (await brokerState({ url: one.url, token: "t", pid: process.pid })).state,
    ).toBe("serving");
    await one.close();
  });

  it("is mismatched when it answers with another build's", async () => {
    const one = await healthServer({ contract: "0000000000000000" });
    expect(
      (await brokerState({ url: one.url, token: "t", pid: process.pid })).state,
    ).toBe("mismatched");
    await one.close();
  });

  it("is BUSY, not gone, when it is slow and its process is alive", async () => {
    /*
     * The defect, in one case. The old `brokerAlive` answered `false` here, and
     * `false` meant "replace it" — so a broker that was merely launching a
     * browser for somebody else lost its descriptor and every session on it.
     */
    const one = await healthServer({ delayMs: 5_000 });
    const answer = await brokerState(
      { url: one.url, token: "t", pid: process.pid },
      { timeoutMs: 150 },
    );
    expect(answer.state).toBe("busy");
    await one.close();
  });

  it("is gone when it is slow and its process is not there", async () => {
    const one = await healthServer({ delayMs: 5_000 });
    const answer = await brokerState(
      { url: one.url, token: "t", pid: 2 ** 31 - 1 },
      { timeoutMs: 150 },
    );
    expect(answer.state).toBe("gone");
    await one.close();
  });

  it("is gone when nothing is listening at all", async () => {
    const one = await healthServer({});
    const url = one.url;
    await one.close();
    expect((await brokerState({ url, token: "t", pid: process.pid })).state).toBe("gone");
  });

  it("is gone when the descriptor's token is not the running broker's", async () => {
    /*
     * A 401 is a descriptor about a process that has gone and a port somebody
     * else now holds. Waiting for it to say yes would be waiting for ever.
     */
    const one = await healthServer({ status: 401 });
    expect((await brokerState({ url: one.url, token: "t", pid: process.pid })).state).toBe("gone");
    await one.close();
  });

  it("is gone when the descriptor carries no pid to ask about", async () => {
    const one = await healthServer({ delayMs: 5_000 });
    expect((await brokerState({ url: one.url, token: "t" }, { timeoutMs: 150 })).state).toBe("gone");
    await one.close();
  });
});
