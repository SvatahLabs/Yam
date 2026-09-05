/**
 * P3-F2 — the precedence itself (LLD §15, Draft 2.5).
 *
 * `packages/cli/test/base-url-precedence.test.ts` drives every command that
 * opens a session against a live application, which is what proves each of them
 * *applies* the rule. This is the rule: flag, then environment, then
 * `config.app`, then a fallback for the commands that must open something.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/args.js";
import { resolveSessionTarget, sessionTarget } from "../src/session.js";

const args = (...argv: string[]) => parseArgs(argv);

describe("sessionTarget (LLD §15)", () => {
  const config = { baseUrl: "http://config:1", storageState: "config.json" };
  const env = { SVATAH_BASE_URL: "http://env:2", SVATAH_STORAGE_STATE: "env.json" };

  it("prefers the flag to everything", () => {
    expect(
      sessionTarget(args("--base-url", "http://flag:3", "--storage-state", "flag.json"), {
        env,
        config,
      }),
    ).toEqual({ baseUrl: "http://flag:3", storageState: "flag.json" });
  });

  it("prefers the environment to the config", () => {
    expect(sessionTarget(args(), { env, config })).toEqual({
      baseUrl: "http://env:2",
      storageState: "env.json",
    });
  });

  it("falls back to the config", () => {
    expect(sessionTarget(args(), { env: {}, config })).toEqual(config);
  });

  it("falls back past the config to the given default", () => {
    // `surface conform` has no project to fall back on, so it names the sample
    // application's port — below the config, never instead of it.
    expect(
      sessionTarget(args(), { env: {}, config: {}, fallbackBaseUrl: "http://default:4" }),
    ).toEqual({ baseUrl: "http://default:4" });
  });

  it("resolves each of the two independently", () => {
    // A flag that names only the base URL must not discard a storage state the
    // config declared: they are two settings, not one.
    expect(
      sessionTarget(args("--base-url", "http://flag:3"), { env: {}, config }),
    ).toEqual({ baseUrl: "http://flag:3", storageState: "config.json" });
  });

  it("treats an empty environment variable as unset", () => {
    // The shape a shell leaves behind after `SVATAH_BASE_URL=`, and the shape a
    // test harness uses to clear an inherited one.
    expect(sessionTarget(args(), { env: { SVATAH_BASE_URL: "" }, config })).toEqual(config);
  });

  it("trims a trailing slash, wherever the value came from", () => {
    // `http://host/` and `http://host` name the same deployment; only one of
    // them concatenates with a path correctly.
    expect(sessionTarget(args("--base-url", "http://flag:3/"), {}).baseUrl).toBe("http://flag:3");
    expect(sessionTarget(args(), { env: { SVATAH_BASE_URL: "http://env:2//" } }).baseUrl).toBe(
      "http://env:2",
    );
  });

  it("reads config.app from a project directory when given one", () => {
    const dir = mkdtempSync(join(tmpdir(), "svatah-session-"));
    writeFileSync(
      join(dir, "svatah.config.yaml"),
      'project: "p"\napp: { baseUrl: "http://from-file:5", storageState: "state.json" }\n',
      "utf8",
    );
    expect(sessionTarget(args(), { env: {}, root: dir })).toEqual({
      baseUrl: "http://from-file:5",
      storageState: "state.json",
    });
  });

  it("says nothing when nothing says anything", () => {
    expect(sessionTarget(args(), { env: {}, config: {} })).toEqual({});
  });
});

describe("resolveSessionTarget (LLD §13.5)", () => {
  it("takes the flag layer as values, for callers that have no command line", () => {
    // `POST /run` and `svatah run` reach the same function, so they must reach
    // the same precedence without the service inventing an argv.
    expect(
      resolveSessionTarget(
        { baseUrl: "http://explicit:1" },
        { env: { SVATAH_BASE_URL: "http://env:2" }, config: { baseUrl: "http://config:3" } },
      ),
    ).toEqual({ baseUrl: "http://explicit:1" });

    expect(
      resolveSessionTarget(
        {},
        { env: { SVATAH_BASE_URL: "http://env:2" }, config: { baseUrl: "http://config:3" } },
      ),
    ).toEqual({ baseUrl: "http://env:2" });
  });
});
