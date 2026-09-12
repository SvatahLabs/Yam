/**
 * Who macOS is being asked to trust (native-feedback D6).
 *
 * The process tree is injected, so this asserts the rule — the *outermost*
 * application ancestor, not the nearest — without depending on what happens to
 * have started the test runner.
 */
import { describe, expect, it } from "vitest";
import {
  accessibilityGranted,
  nameFor,
  requestAccessibility,
  responsibleProgram,
  screenRecordingGranted,
  type GrantRunner,
} from "../src/index.js";

/** A `ps -eo pid=,ppid=,comm=` listing, from `pid ppid command` triples. */
const psRunner = (rows: ReadonlyArray<[number, number, string]>): GrantRunner => ({
  run: (command) =>
    command === "ps"
      ? { status: 0, stdout: rows.map(([pid, ppid, comm]) => `${pid} ${ppid} ${comm}`).join("\n") }
      : { status: 1, stdout: "" },
});

describe("the program a macOS permission attaches to (native-feedback D6)", () => {
  it("names the terminal that started Yam, not Yam", () => {
    const who = responsibleProgram({
      pid: 500,
      platform: "darwin",
      runner: psRunner([
        [500, 400, "/opt/homebrew/bin/node"],
        [400, 300, "/bin/zsh"],
        [300, 1, "/Applications/iTerm.app/Contents/MacOS/iTerm2"],
      ]),
    });
    expect(who).toEqual({
      name: "iTerm",
      bundlePath: "/Applications/iTerm.app",
      isApplication: true,
    });
    expect(nameFor(who)).toBe("iTerm (`/Applications/iTerm.app`)");
  });

  it("names the MCP client, which is the case that surprises people", () => {
    // `claude mcp add yam -- yam mcp` grants Claude, never yam.
    const who = responsibleProgram({
      pid: 900,
      platform: "darwin",
      runner: psRunner([
        [900, 800, "/opt/homebrew/bin/node"],
        [800, 1, "/Applications/Claude.app/Contents/MacOS/Claude"],
      ]),
    });
    expect(who.name).toBe("Claude");
  });

  it("takes the outermost application, not the nearest one", () => {
    /*
     * The finding this rule exists for: a Python harness's interpreter lives
     * inside a `Python.app` stub in a Homebrew cellar, so the *nearest*
     * ancestor bundle is a directory nobody can add to a settings pane. TCC
     * responsibility flows from the application the person actually launched.
     */
    const who = responsibleProgram({
      pid: 100,
      platform: "darwin",
      runner: psRunner([
        [100, 90, "/opt/homebrew/bin/node"],
        [90, 80, "/opt/homebrew/Cellar/python@3.14/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python"],
        [80, 70, "/bin/zsh"],
        [70, 1, "/Applications/iTerm.app/Contents/MacOS/iTerm2"],
      ]),
    });
    expect(who.name).toBe("iTerm");
  });

  it("says plainly when no application owns the process", () => {
    // ssh, cron, a CI runner: there is nothing for a grant to attach to, and
    // inventing a name would send someone to a settings pane with no such row.
    const who = responsibleProgram({
      pid: 10,
      platform: "darwin",
      runner: psRunner([
        [10, 9, "/usr/local/bin/node"],
        [9, 1, "/usr/sbin/sshd"],
      ]),
    });
    expect(who.isApplication).toBe(false);
    expect(nameFor(who)).toBe("the program running Yam");
  });

  it("survives a process table it cannot read", () => {
    const who = responsibleProgram({
      platform: "darwin",
      runner: { run: () => ({ status: 1, stdout: "" }) },
    });
    expect(who.isApplication).toBe(false);
  });

  it("is a macOS question and answers so elsewhere", () => {
    expect(responsibleProgram({ platform: "win32" }).isApplication).toBe(false);
    expect(accessibilityGranted({ platform: "win32" })).toBeUndefined();
    expect(screenRecordingGranted({ platform: "linux" })).toBeUndefined();
  });
});

describe("asking TCC (native-feedback D6)", () => {
  const answering = (stdout: string, status = 0): GrantRunner => ({ run: () => ({ status, stdout }) });

  it("reads the permission out of the TCC call", () => {
    expect(accessibilityGranted({ platform: "darwin", runner: answering("true\n") })).toBe(true);
    expect(screenRecordingGranted({ platform: "darwin", runner: answering("false\n") })).toBe(false);
  });

  it("calls osascript with the prompting option when it is asked to prompt", () => {
    const scripts: string[] = [];
    const runner: GrantRunner = {
      run: (_command, args) => {
        scripts.push(args[args.length - 1] ?? "");
        return { status: 0, stdout: "true" };
      },
    };
    requestAccessibility({ platform: "darwin", runner });
    expect(scripts[0]).toContain("AXIsProcessTrustedWithOptions");
    expect(scripts[0]).toContain("numberWithBool(true)");
  });

  it("checks without prompting when it is only asked the question", () => {
    const scripts: string[] = [];
    const runner: GrantRunner = {
      run: (_command, args) => {
        scripts.push(args[args.length - 1] ?? "");
        return { status: 0, stdout: "true" };
      },
    };
    accessibilityGranted({ platform: "darwin", runner });
    expect(scripts[0]).toContain("numberWithBool(false)");
  });

  it("answers `undefined` when it could not ask, never `false`", () => {
    /*
     * "Could not be asked" and "refused" send a reader to different places, and
     * reporting the first as the second is how a working host gets told to
     * change a setting that is already right.
     */
    expect(accessibilityGranted({ platform: "darwin", runner: answering("", 1) })).toBeUndefined();
    expect(
      screenRecordingGranted({ platform: "darwin", runner: answering("not a boolean") }),
    ).toBeUndefined();
  });
});
