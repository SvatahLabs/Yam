/**
 * Who is connected over MCP (TV-M05, TV-13).
 *
 * An MCP server is its own process, so a connection is a small file in the
 * user's state directory. What matters is what a reader does with one that was
 * left behind: a client that died is not a client, and reporting it would put an
 * agent in the cockpit's list that nobody could hand control to.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIENT_STALE_MS, readClients, removeClient, writeClient } from "../src/clients.js";

let state: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "yam-clients-"));
});
afterEach(() => {
  rmSync(state, { recursive: true, force: true });
});

const client = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  transport: "stdio" as const,
  profile: "surface",
  since: "2026-09-09T18:41:00.000Z",
  ...over,
});

describe("a connection is a file, because a server is a process", () => {
  it("records one and reads it back", () => {
    writeClient(client("claude-code"), state);
    const found = readClients(state);
    expect(found.map((one) => one.id)).toEqual(["claude-code"]);
    expect(found[0]!.profile).toBe("surface");
  });

  it("forgets one, and a second disconnect is not an error", () => {
    writeClient(client("cursor"), state);
    removeClient("cursor", state);
    removeClient("cursor", state);
    expect(readClients(state)).toEqual([]);
  });

  it("says nobody is connected when nothing ever was", () => {
    expect(readClients(join(state, "never"))).toEqual([]);
  });

  it("carries the session a client holds, which is what a handoff needs", () => {
    writeClient(client("claude-code", { holds: "sf-33b8" }), state);
    expect(readClients(state)[0]!.holds).toBe("sf-33b8");
  });
});

describe("a record that was left behind is not a client", () => {
  it("drops one that has gone quiet, and deletes it", () => {
    writeClient(client("gone"), state);
    const later = Date.now() + CLIENT_STALE_MS + 1;
    expect(readClients(state, later)).toEqual([]);
    /*
     * Deleted, not merely ignored: leaving it would make the next reader wait
     * the same thirty seconds to decide the same thing.
     */
    expect(readdirSync(join(state, "clients"))).toEqual([]);
  });

  it("keeps one that was refreshed", () => {
    writeClient(client("alive"), state);
    const soon = Date.now() + CLIENT_STALE_MS - 1_000;
    expect(readClients(state, soon).map((one) => one.id)).toEqual(["alive"]);
  });

  it("throws nothing at a half-written file, and clears it", () => {
    mkdirSync(join(state, "clients"), { recursive: true });
    writeFileSync(join(state, "clients", "torn.json"), "{ not json");
    expect(readClients(state)).toEqual([]);
    expect(readdirSync(join(state, "clients"))).toEqual([]);
  });
});
