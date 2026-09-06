/**
 * Resolving the Node that runs `svatah serve` (T8.1, P7-F1, Draft 2.9 §13.6).
 *
 * The order, the version floor, and the message — the three things the ADE's
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
  resolveNodeRuntime,
  runtimeNotFoundMessage,
  SUPPORTED_NODE_MAJOR,
} from "../src/runtime.js";

/** A directory holding files named as an executable would be. */
function withFiles(...names: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "svatah-runtime-"));
  for (const name of names) writeFileSync(join(dir, name), "", "utf8");
  return dir;
}

describe("the order LLD §13.6 states", () => {
  it("prefers SVATAH_NODE", () => {
    const path = join(withFiles("my-node"), "my-node");
    const resolution = resolveNodeRuntime({
      env: { SVATAH_NODE: path, PATH: withFiles("node") },
      platform: "darwin",
      probe: () => "v22.23.2",
    });
    expect(resolution.runtime).toEqual({ path, source: "SVATAH_NODE", version: "v22.23.2" });
  });

  it("falls through to a `node` on PATH when SVATAH_NODE is unset", () => {
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
    const cli = join(resources, "svatah", "dist", "bin.js");
    const resolution = resolveNodeRuntime({
      cli: join(resources, "svatah", "bin.js"),
      env: { PATH: "" },
      platform: "darwin",
      probe: () => "v22.23.2",
    });
    expect(cli).toContain("svatah");
    expect(resolution.runtime?.source).toBe("resources");
    expect(resolution.runtime?.path).toBe(join(resources, "node"));
  });

  it("never answers with process.execPath (P7-F1)", () => {
    const resolution = resolveNodeRuntime({
      env: { PATH: "" },
      platform: "darwin",
      probe: () => "v22.23.2",
    });
    expect(resolution.runtime).toBeUndefined();
    expect(JSON.stringify(resolution)).not.toContain(process.execPath);
  });
});

describe("what it says when there is nothing to run", () => {
  it("names the three places, which is what the Project screen shows", () => {
    const resolution = resolveNodeRuntime({ env: { PATH: "" }, platform: "darwin" });
    const message = runtimeNotFoundMessage(resolution.attempts);
    expect(message).toContain("SVATAH_NODE");
    expect(message).toContain("PATH");
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
