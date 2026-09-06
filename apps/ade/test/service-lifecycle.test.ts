/**
 * T3.6 Validate — "the app opens a fixture project and shows `GET /project`
 * data; killing the app stops the service" (LLD §13.6).
 *
 * The part of that which is the ADE's is the *lifecycle*: spawn `yam serve`,
 * read the handshake, health-check, adopt a service that is already there, and
 * stop the one it started. This drives that directly, against a real
 * `yam serve` on the real fixture project.
 *
 * Electron never starts, and nothing here needs it: the main process is a Node
 * program, `startOrAdopt` is a Node function, and what a window does with the
 * connection afterwards is the renderer's business (`test/parity.test.ts`).
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isStale,
  lockPathFor,
  parseHandshake,
  readLock,
  startOrAdopt,
  writeLock,
  type RunningService,
} from "../src/main/service.js";
import { resolveNodeRuntime } from "@svatah/yam-service/runtime";
import {
  DEFAULT_PREFERENCES,
  normalise,
  preferencesPath,
  readPreferences,
  withRecentProject,
  writePreferences,
} from "../src/main/preferences.js";

const ADE = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(ADE, "..", "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
const PROJECT = join(ROOT, "evals", "fixtures");
/*
 * The interpreter the ADE would resolve (Draft 2.9 §13.6, T8.1).
 *
 * Resolved rather than `process.execPath`, because that is the change P7-F1 is
 * about — under vitest the two happen to be the same Node, and a test that used
 * `process.execPath` would keep passing on the day the ADE went back to
 * spawning its own binary.
 */
const RUNTIME = resolveNodeRuntime({ cli: CLI }).runtime?.path ?? "node";

let userData: string;
const started: RunningService[] = [];

beforeAll(() => {
  if (!existsSync(CLI)) throw new Error("Run `pnpm -r build` first.");
});

afterEach(async () => {
  for (const one of started.splice(0)) await one.stop();
  if (userData !== undefined) rmSync(userData, { recursive: true, force: true });
});

function fresh(): string {
  userData = mkdtempSync(join(tmpdir(), "yam-ade-userdata-"));
  return userData;
}

describe("the handshake (LLD §13.6)", () => {
  it("reads the one line `yam serve` prints", () => {
    expect(
      parseHandshake("yam serve listening url=http://127.0.0.1:51234 token=abc123\n"),
    ).toEqual({ url: "http://127.0.0.1:51234", token: "abc123" });
  });

  it("finds it among the service's other output", () => {
    const noisy = [
      "some warning",
      "yam serve listening url=http://127.0.0.1:9 token=t",
      "Serving . on http://127.0.0.1:9",
    ].join("\n");
    expect(parseHandshake(noisy)?.token).toBe("t");
  });

  it("is nothing at all until the line is complete", () => {
    expect(parseHandshake("yam serve listening url=http://127.0.0.1:9 tok")).toBeUndefined();
    expect(parseHandshake("")).toBeUndefined();
  });
});

describe("the lock file (LLD §13.6)", () => {
  it("lives in the user-data directory, never in the project", () => {
    const path = lockPathFor("/home/someone/.config/yam-ade", "/work/my-project");
    expect(path.startsWith("/home/someone/.config/yam-ade")).toBe(true);
    // A token in a repository is a token in a pull request (REQ-NFR-6).
    expect(path).not.toContain("/work/my-project");
  });

  it("keys on the whole path, so two projects named the same do not collide", () => {
    expect(lockPathFor("/u", "/a/project")).not.toBe(lockPathFor("/u", "/b/project"));
  });

  it("treats an unreachable service as stale", async () => {
    expect(
      await isStale({ url: "http://127.0.0.1:1", token: "t", project: "/p", pid: 1 }),
    ).toBe(true);
  });

  it("treats a live service on another project as stale", async () => {
    // A port is reused. A lock that pointed at whatever answers on it now would
    // hand the ADE somebody else's project.
    const elsewhere = (async () =>
      new Response(JSON.stringify({ ok: true, project: "/somewhere/else" }), { status: 200 })) as
      unknown as typeof fetch;
    expect(
      await isStale({ url: "http://127.0.0.1:9", token: "t", project: "/p", pid: 1 }, elsewhere),
    ).toBe(true);

    const here = (async () =>
      new Response(JSON.stringify({ ok: true, project: "/p" }), { status: 200 })) as
      unknown as typeof fetch;
    expect(
      await isStale({ url: "http://127.0.0.1:9", token: "t", project: "/p", pid: 1 }, here),
    ).toBe(false);
  });
});

describe("opening the fixture project (T3.6)", () => {
  it("spawns the service, hands back a connection, and GET /project answers", async () => {
    const running = await startOrAdopt({
      project: PROJECT,
      userDataDir: fresh(),
      cli: CLI,
      runtime: RUNTIME,
    });
    started.push(running);

    expect(running.connection.adopted).toBe(false);
    expect(running.connection.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(running.connection.token.length).toBeGreaterThan(8);

    const response = await fetch(`${running.connection.url}/project`, {
      headers: { authorization: `Bearer ${running.connection.token}` },
    });
    expect(response.status).toBe(200);

    const summary = (await response.json()) as { root: string; flows: string[] };
    expect(resolve(summary.root)).toBe(resolve(PROJECT));
    expect(summary.flows).toContain("flows/simple.flow");
  }, 120_000);

  it("writes a lock, and adopts rather than starting a second service", async () => {
    const dir = fresh();
    const first = await startOrAdopt({ project: PROJECT, userDataDir: dir, cli: CLI, runtime: RUNTIME });
    started.push(first);

    const lockPath = lockPathFor(dir, PROJECT);
    expect(existsSync(lockPath)).toBe(true);
    expect(readLock(lockPath)?.url).toBe(first.connection.url);

    // A reload of the ADE, or a second window: two services writing to one
    // `runs/` directory is the thing this prevents.
    const second = await startOrAdopt({ project: PROJECT, userDataDir: dir, cli: CLI, runtime: RUNTIME });
    expect(second.connection.adopted).toBe(true);
    expect(second.connection.url).toBe(first.connection.url);

    // And adopting does not give away the right to stop it.
    await second.stop();
    expect(existsSync(lockPath)).toBe(true);
  }, 180_000);

  it("stops the service it started, and removes the lock", async () => {
    const dir = fresh();
    const running = await startOrAdopt({ project: PROJECT, userDataDir: dir, cli: CLI, runtime: RUNTIME });
    const { url, token } = running.connection;

    await running.stop();

    expect(existsSync(lockPathFor(dir, PROJECT))).toBe(false);
    await expect(
      fetch(`${url}/project`, { headers: { authorization: `Bearer ${token}` } }),
    ).rejects.toThrow();
  }, 120_000);

  it("clears a stale lock rather than adopting a service that is gone", async () => {
    const dir = fresh();
    writeLock(lockPathFor(dir, PROJECT), {
      url: "http://127.0.0.1:1",
      token: "gone",
      project: resolve(PROJECT),
      pid: 999_999,
    });

    const running = await startOrAdopt({ project: PROJECT, userDataDir: dir, cli: CLI, runtime: RUNTIME });
    started.push(running);
    expect(running.connection.adopted).toBe(false);
    expect(running.connection.url).not.toBe("http://127.0.0.1:1");
  }, 120_000);

  it("says what the service said when it will not start", async () => {
    await expect(
      startOrAdopt({
        project: PROJECT,
        userDataDir: fresh(),
        cli: join(ROOT, "packages", "cli", "dist", "not-a-file.js"),
        runtime: RUNTIME,
        timeoutMs: 15_000,
      }),
    ).rejects.toThrow(/exited with|did not print/);
  }, 60_000);
});

describe("preferences are the only thing the ADE stores (REQ-ADE-2)", () => {
  it("reads the defaults when there is no file", () => {
    expect(readPreferences(join(fresh(), "nothing.json"))).toEqual(DEFAULT_PREFERENCES);
  });

  it("round-trips, and drops anything the schema does not name", () => {
    const path = preferencesPath(fresh());
    writePreferences(path, {
      ...DEFAULT_PREFERENCES,
      theme: "dark",
      recentProjects: ["/a", "/b"],
    });

    const read = readPreferences(path);
    expect(read.theme).toBe("dark");
    expect(read.recentProjects).toEqual(["/a", "/b"]);
    // A cached flow, a remembered run, a copy of the bindings: none of these can
    // survive a read, so none can become a second source of truth.
    expect(Object.keys(read).sort()).toEqual(["recentProjects", "theme", "window"]);
    expect(
      Object.keys(normalise({ ...read, flows: { "a.flow": "cached!" } })).sort(),
    ).toEqual(["recentProjects", "theme", "window"]);
  });

  it("treats a corrupt file as no file", () => {
    const path = preferencesPath(fresh());
    writePreferences(path, DEFAULT_PREFERENCES);
    rmSync(path);
    expect(readPreferences(path)).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps the recent list newest-first, without duplicates, at ten", () => {
    let preferences = DEFAULT_PREFERENCES;
    for (const project of ["/a", "/b", "/a", "/c"]) {
      preferences = withRecentProject(preferences, project);
    }
    expect(preferences.recentProjects).toEqual(["/c", "/a", "/b"]);

    for (let at = 0; at < 20; at += 1) {
      preferences = withRecentProject(preferences, `/p${at}`);
    }
    expect(preferences.recentProjects).toHaveLength(10);
    expect(preferences.recentProjects[0]).toBe("/p19");
  });
});
