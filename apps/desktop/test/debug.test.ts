/**
 * The window-lifecycle log (T11.1, P10-F1, Draft 2.13 §13.6).
 *
 * > the app logs its window lifecycle to its user-data directory when
 * > `YAM_APP_DEBUG=1`
 *
 * What this file is for is the shape of the log rather than the events in it:
 * the events are Electron's and are exercised by `scripts/app-launch-loop.mjs`
 * against a packaged build. A log nobody can parse, or one that writes a token
 * into a file, is a defect that no launch loop would catch.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { debugEnabled, debugLine, debugLogPath, openDebugLog } from "../src/main/debug.js";

const made: string[] = [];
const scratch = (): string => {
  const one = mkdtempSync(join(tmpdir(), "yam-debug-"));
  made.push(one);
  return one;
};
afterEach(() => {
  while (made.length > 0) rmSync(made.pop()!, { recursive: true, force: true });
});

describe("the log is off unless it is asked for", () => {
  it("is on only for YAM_APP_DEBUG=1", () => {
    expect(debugEnabled({ YAM_APP_DEBUG: "1" })).toBe(true);
    expect(debugEnabled({ YAM_APP_DEBUG: "true" })).toBe(false);
    expect(debugEnabled({ YAM_APP_DEBUG: "0" })).toBe(false);
    expect(debugEnabled({})).toBe(false);
  });

  it("writes nothing at all when it is off", () => {
    const directory = scratch();
    const log = openDebugLog(directory, {});
    expect(log.enabled).toBe(false);
    log("window.creating", { width: 1280 });
    expect(existsSync(debugLogPath(directory))).toBe(false);
  });

  it("goes beside the preferences, in the user-data directory", () => {
    // `join`, not a literal: the path is the platform's own, `\tmp\x\…` on Windows.
    expect(debugLogPath("/tmp/x")).toBe(join("/tmp/x", "app-debug.log"));
  });
});

describe("one line per event, and a reader can parse it", () => {
  it("is an instant, a name, and the facts", () => {
    const line = debugLine(
      "window.ready-to-show",
      { id: 1, visible: true, bounds: { x: 0, y: 0, width: 1280, height: 853 } },
      new Date("2026-09-05T20:12:00.000Z"),
    );
    expect(line).toBe(
      "2026-09-05T20:12:00.000Z window.ready-to-show id=1 visible=true " +
        'bounds={"x":0,"y":0,"width":1280,"height":853}\n',
    );
    expect(line.endsWith("\n")).toBe(true);
  });

  it("drops a fact that is not there rather than writing `undefined`", () => {
    expect(debugLine("app.ready", { packaged: true, version: undefined })).toContain("packaged=true");
    expect(debugLine("app.ready", { packaged: true, version: undefined })).not.toContain("version");
  });

  it("never lets a space break a field", () => {
    const line = debugLine("app.ready", { userData: "/Users/atul/Application Support/Yam" });
    expect(line.trimEnd().split(" ")).toHaveLength(3);
    expect(line).toContain("Application_Support");
  });

  it("appends, so a launch does not lose the launch before it", () => {
    const directory = scratch();
    const log = openDebugLog(directory, { YAM_APP_DEBUG: "1" });
    log("window.creating", { width: 1280 });
    log("window.closed");
    const lines = readFileSync(debugLogPath(directory), "utf8").trim().split("\n");
    // `log.opened` first, then the two.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("log.opened");
    expect(lines[1]).toContain("window.creating width=1280");
    expect(lines[2]).toContain("window.closed");
  });

  it("turns itself off rather than failing when it cannot write", () => {
    // A path whose parent is a file: `mkdirSync` refuses it.
    const directory = join(scratch(), "preferences.json", "nested");
    const log = openDebugLog(directory, { YAM_APP_DEBUG: "1" });
    expect(() => log("window.creating")).not.toThrow();
  });
});
