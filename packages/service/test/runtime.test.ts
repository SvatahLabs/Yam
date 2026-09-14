/**
 * Resolving the Node that runs `yam serve` (T8.1, P7-F1, Draft 2.9 §13.6).
 *
 * The order, the version floor, and the message — the three things the app's
 * behaviour rests on. Every candidate is probed through an injected function, so
 * these say what the resolver does rather than what this machine happens to have
 * installed.
 */
import { describe, expect, it } from "vitest";
import { delimiter, join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  describeRuntime,
  majorOf,
  childEnvironment,
  resolveNodeRuntime,
  runtimeNotFoundMessage,
  SUPPORTED_NODE_MAJOR,
} from "../src/runtime.js";

/** A directory holding files named as an executable would be. */
function withFiles(...names: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-runtime-"));
  for (const name of names) writeFileSync(join(dir, name), "", "utf8");
  return dir;
}

/**
 * The two steps that reach outside the test, switched off.
 *
 * The login shell and the platform's install locations both look at the machine
 * running the suite. A test that says `PATH: ""` and expects nothing found would
 * otherwise pass on a machine without Homebrew and fail on one with it — a test
 * that measures the laptop. Every case that asserts *absence* names this.
 */
const NOTHING_ELSE = { loginPath: () => undefined, wellKnown: () => [] } as const;

describe("the order LLD §13.6 states", () => {
  it("prefers YAM_NODE", () => {
    const path = join(withFiles("my-node"), "my-node");
    const resolution = resolveNodeRuntime({
      env: { YAM_NODE: path, PATH: withFiles("node") },
      platform: "darwin",
      probe: () => "v22.23.2",
    });
    expect(resolution.runtime).toEqual({ path, source: "YAM_NODE", version: "v22.23.2" });
  });

  it("falls through to a `node` on PATH when YAM_NODE is unset", () => {
    const dir = withFiles("node");
    const resolution = resolveNodeRuntime({
      env: { PATH: dir },
      platform: "darwin",
      probe: () => "v24.0.0",
    });
    expect(resolution.runtime?.source).toBe("PATH");
    expect(resolution.runtime?.path).toBe(join(dir, "node"));
  });

  it("takes the first PATH entry that is new enough, not the first that exists", () => {
    const old = withFiles("node");
    const current = withFiles("node");
    const resolution = resolveNodeRuntime({
      env: { PATH: `${old}${delimiter}${current}` },
      platform: "darwin",
      probe: (path) => (path.startsWith(old) ? "v20.11.0" : "v22.23.2"),
    });
    expect(resolution.runtime?.path).toBe(join(current, "node"));
    expect(resolution.attempts.find((one) => one.path?.startsWith(old))?.rejected).toMatch(
      /older than the supported 22/,
    );
  });

  it("uses a Node beside the CLI under resources/ when the packager shipped one", () => {
    const resources = withFiles("node");
    const cli = join(resources, "yam", "dist", "bin.js");
    const resolution = resolveNodeRuntime({
      cli: join(resources, "yam", "bin.js"),
      env: { PATH: "" },
      platform: "darwin",
      probe: () => "v22.23.2",
      ...NOTHING_ELSE,
    });
    expect(cli).toContain("yam");
    expect(resolution.runtime?.source).toBe("resources");
    expect(resolution.runtime?.path).toBe(join(resources, "node"));
  });

  it("never answers with process.execPath (P7-F1)", () => {
    const resolution = resolveNodeRuntime({
      env: { PATH: "" },
      platform: "darwin",
      probe: () => "v22.23.2",
      ...NOTHING_ELSE,
    });
    expect(resolution.runtime).toBeUndefined();
    expect(JSON.stringify(resolution)).not.toContain(process.execPath);
  });
});

describe("what it says when there is nothing to run", () => {
  it("names the three places, which is what the Project screen shows", () => {
    const resolution = resolveNodeRuntime({ env: { PATH: "" }, platform: "darwin", ...NOTHING_ELSE });
    const message = runtimeNotFoundMessage(resolution.attempts);
    expect(message).toContain("YAM_NODE");
    expect(message).toContain("PATH");
    expect(message).toContain("login shell");
    expect(message).toContain("resources/");
    expect(message).toContain(`Node ${SUPPORTED_NODE_MAJOR}`);
  });

  it("describes a chosen runtime in one line, for doctor and the smoke check", () => {
    const dir = withFiles("node");
    const resolution = resolveNodeRuntime({
      env: { PATH: dir },
      platform: "darwin",
      probe: () => "v22.23.2",
    });
    expect(describeRuntime(resolution)).toBe(
      `runtime: ${join(dir, "node")} (v22.23.2, from PATH)`,
    );
    expect(describeRuntime({ attempts: [] })).toContain("none found");
  });
});

describe("version parsing", () => {
  it("reads the major, and refuses anything that is not a version", () => {
    expect(majorOf("v22.23.2")).toBe(22);
    expect(majorOf("v25.6.1")).toBe(25);
    expect(majorOf("not a version")).toBeUndefined();
  });
});

describe("this machine", () => {
  it("resolves a real Node, because the contract runs on one", () => {
    const resolution = resolveNodeRuntime();
    expect(resolution.runtime).toBeDefined();
    expect(majorOf(resolution.runtime!.version)!).toBeGreaterThanOrEqual(SUPPORTED_NODE_MAJOR);
  });
});

/**
 * The failure a person actually hits (P-W2-F1).
 *
 * A packaged app launched from Finder on macOS inherits `launchd`'s environment:
 * `/usr/bin:/bin:/usr/sbin:/sbin`, and nothing a shell profile added. Homebrew
 * puts Node at `/opt/homebrew/bin/node`, every version manager puts it under a
 * home directory, and none of those are on that PATH — so a machine with a
 * perfectly good Node 22 looked, from inside the window, like a machine with
 * none. The first packaged launch showed exactly that.
 *
 * Two recoveries, in order: ask the login shell what its PATH is, and failing
 * that look where installers put things.
 */
describe("a windowed app does not have the shell's PATH", () => {
  const GUI_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

  /*
   * Not on a Windows host. The case is macOS's launchd PATH, written with `:`,
   * and the directory it adds is a real temporary one — which on Windows is
   * `C:\Users\…`, a colon of its own. There is no PATH that is both, and no
   * login shell to ask on Windows either (`resolveNodeRuntime` says so).
   */
  it.skipIf(process.platform === "win32")("recovers the runtime from the login shell", () => {
    const dir = withFiles("node");
    const resolution = resolveNodeRuntime({
      env: { PATH: GUI_PATH, SHELL: "/bin/zsh" },
      platform: "darwin",
      probe: (path) => (path === join(dir, "node") ? "v22.23.2" : undefined),
      loginPath: () => `${GUI_PATH}:${dir}`,
      wellKnown: () => [],
    });
    expect(resolution.runtime?.source).toBe("login-shell");
    expect(resolution.runtime?.path).toBe(join(dir, "node"));
  });

  it("falls back to where an installer puts one when the shell says nothing", () => {
    const dir = withFiles("node");
    const resolution = resolveNodeRuntime({
      env: { PATH: GUI_PATH },
      platform: "darwin",
      probe: (path) => (path === join(dir, "node") ? "v22.23.2" : undefined),
      loginPath: () => undefined,
      wellKnown: () => [join(dir, "node")],
    });
    expect(resolution.runtime?.source).toBe("well-known");
  });

  /*
   * Order matters and is not incidental: `YAM_NODE` is the override a person
   * set deliberately, and it must beat anything discovered.
   */
  it("still prefers YAM_NODE to anything it discovers", () => {
    const chosen = withFiles("node");
    const other = withFiles("node");
    const resolution = resolveNodeRuntime({
      env: { PATH: GUI_PATH, YAM_NODE: join(chosen, "node") },
      platform: "darwin",
      probe: () => "v22.23.2",
      loginPath: () => other,
      wellKnown: () => [join(other, "node")],
    });
    expect(resolution.runtime?.source).toBe("YAM_NODE");
    expect(resolution.runtime?.path).toBe(join(chosen, "node"));
  });

  /*
   * A Node too old is still refused wherever it was found. The login shell is
   * exactly where a version manager's Node 18 lives.
   */
  it("refuses an old Node found in the shell, and says which it was", () => {
    const dir = withFiles("node");
    const resolution = resolveNodeRuntime({
      env: { PATH: GUI_PATH },
      platform: "darwin",
      probe: () => "v18.20.4",
      loginPath: () => dir,
      wellKnown: () => [],
    });
    expect(resolution.runtime).toBeUndefined();
    expect(runtimeNotFoundMessage(resolution.attempts)).toContain("v18.20.4");
  });
});

/**
 * Finding Node is not the whole of it (P-W2-F2).
 *
 * The service the app spawns shells out too — `npx playwright --version` is how
 * adapter readiness is probed — so a service handed launchd's PATH reports every
 * probed adapter unavailable. The Session screen said Playwright was not
 * installed, and told the person to install a browser, on a machine with
 * Playwright 1.62.1 and its browsers both present.
 */
describe("what a child of the app is spawned with", () => {
  const GUI_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

  // Not on a Windows host, for the reason the login-shell case above gives.
  it.skipIf(process.platform === "win32")("hands on the PATH that found the runtime, with that runtime first", () => {
    const dir = withFiles("node");
    const resolution = resolveNodeRuntime({
      env: { PATH: GUI_PATH },
      platform: "darwin",
      probe: (path) => (path === join(dir, "node") ? "v22.23.2" : undefined),
      loginPath: () => `${GUI_PATH}:${dir}`,
      wellKnown: () => [],
    });
    const env = childEnvironment(resolution, { PATH: GUI_PATH, HOME: "/Users/x" });
    expect(env["PATH"]?.split(":")[0]).toBe(dir);
    expect(env["PATH"]).toContain("/usr/bin");
    /* Everything else is the caller's, untouched. */
    expect(env["HOME"]).toBe("/Users/x");
  });

  /* A resolution that found Node on PATH rewrites nothing. */
  it("leaves PATH alone when PATH was already enough", () => {
    const dir = withFiles("node");
    const resolution = resolveNodeRuntime({
      env: { PATH: dir },
      platform: "darwin",
      probe: () => "v22.23.2",
      ...NOTHING_ELSE,
    });
    expect(resolution.childPath).toBeUndefined();
    expect(childEnvironment(resolution, { PATH: dir })["PATH"]).toBe(dir);
  });

  it("names no runtime and rewrites nothing when none was found", () => {
    const resolution = resolveNodeRuntime({ env: { PATH: "" }, platform: "darwin", ...NOTHING_ELSE });
    expect(childEnvironment(resolution, { PATH: "x" })["PATH"]).toBe("x");
  });
});
