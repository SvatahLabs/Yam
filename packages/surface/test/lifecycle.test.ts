/**
 * Launching and quitting an application (T11.2, LLD §13.9, §7.5).
 *
 * Every command this module runs is injected, so all three platforms and every
 * escalation are exercised on any host — which matters, because the failure
 * modes are the ones nobody can reproduce on demand: an application that will
 * not go, a graceful route that is not available, a `.app` bundle whose
 * executable path is not its bundle path.
 *
 * What is *not* here is that `open -n` reaches the WindowServer and a `spawn`
 * does not. That is a fact about macOS, it is measured in
 * `docs/spec/progress/phase-11.md`, and no fake runner can say anything about
 * it — the reason it is `open` at all is written where the decision is.
 */
import { describe, expect, it } from "vitest";
import {
  executableOf,
  launchApplication,
  processIdsOf,
  quitApplication,
  waitFor,
  type Runner,
} from "../src/index.js";

/** A runner that answers from a table and records what it was asked. */
function fake(
  answers: Array<{ match: RegExp; status?: number; stdout?: string; stderr?: string }> = [],
): Runner & { calls: string[] } {
  const calls: string[] = [];
  const runner = {
    calls,
    run(command: string, args: readonly string[]) {
      const line = `${command} ${args.join(" ")}`;
      calls.push(line);
      const answer = answers.find((one) => one.match.test(line));
      return {
        status: answer?.status ?? 0,
        stdout: answer?.stdout ?? "",
        stderr: answer?.stderr ?? "",
      };
    },
  };
  return runner;
}

const instantly = async (): Promise<void> => undefined;

describe("where the executable is (T11.2)", () => {
  it("reads a macOS bundle's executable out of it", () => {
    expect(executableOf({ bundle: "/Applications/Yam.app" }, "darwin")).toBe(
      "/Applications/Yam.app/Contents/MacOS/Yam",
    );
    // A trailing slash is a path somebody typed, not a different application.
    expect(executableOf({ bundle: "/a/Yam.app/" }, "darwin")).toBe(
      "/a/Yam.app/Contents/MacOS/Yam",
    );
  });

  it("is the path itself where there is one", () => {
    expect(executableOf({ path: "C:/x/Yam.exe" }, "win32")).toBe("C:/x/Yam.exe");
    // A `path` wins over a `bundle`, on any platform: it is the more specific.
    expect(executableOf({ path: "/a/b", bundle: "/c.app" }, "darwin")).toBe("/a/b");
  });

  it("has nothing to say when the configuration names nothing", () => {
    expect(executableOf({}, "darwin")).toBeUndefined();
  });
});

describe("launching (T11.2, LLD §7.5)", () => {
  it("goes through LaunchServices on macOS, with a fresh instance", () => {
    const runner = fake();
    const step = launchApplication(
      { bundle: "/a/Yam.app", env: { YAM_A11Y: "1" }, args: ["--headed"] },
      { platform: "darwin", runner },
    );
    expect(step.ok).toBe(true);
    const [call] = runner.calls;
    /*
     * `-n` a new instance, `-F` a fresh one. A GUI application forked from a
     * process outside the user's Aqua session never attaches to the
     * WindowServer, so this is `open` and not `spawn` (LLD §7.5).
     */
    expect(call).toContain("open -n -F");
    // The environment is on the command line: LaunchServices does not inherit
    // this process's.
    expect(call).toContain("--env YAM_A11Y=1");
    expect(call).toContain("-a /a/Yam.app");
    expect(call).toContain("--args --headed");
  });

  it("spawns the executable everywhere else", () => {
    const runner = fake();
    const step = launchApplication(
      { path: "/opt/app", args: ["--x"] },
      { platform: "linux", runner },
    );
    expect(step.ok).toBe(true);
    expect(runner.calls[0]).toBe("/opt/app --x");
  });

  it("says what went wrong when `open` refuses", () => {
    const runner = fake([{ match: /^open/, status: 1, stderr: "no such bundle" }]);
    const step = launchApplication({ bundle: "/nope.app" }, { platform: "darwin", runner });
    expect(step.ok).toBe(false);
    expect(step.detail).toBe("no such bundle");
  });

  it("refuses a configuration that names nothing to start", () => {
    const step = launchApplication({}, { platform: "linux", runner: fake() });
    expect(step.ok).toBe(false);
    expect(step.detail).toContain("neither a `bundle` nor a `path`");
  });
});

describe("finding the processes (P8-F1, P10-F7)", () => {
  it("matches the executable path, so another copy is not counted", () => {
    const runner = fake([{ match: /^pgrep/, stdout: "101\n102\n" }]);
    expect(processIdsOf("/a/Yam.app/Contents/MacOS/Yam", {
      platform: "darwin",
      runner,
    })).toEqual([101, 102]);
    expect(runner.calls[0]).toContain("pgrep -f /a/Yam.app/Contents/MacOS/Yam");
  });

  it("asks PowerShell by process name on Windows", () => {
    const runner = fake([{ match: /Get-Process/, stdout: "  17 \n\n 18\n" }]);
    expect(processIdsOf("C:/x/Yam.exe", { platform: "win32", runner })).toEqual([17, 18]);
    expect(runner.calls[0]).toContain("Get-Process -Name 'Yam'");
  });
});

describe("quitting: the graceful route, then a signal (T11.2, P10-F1)", () => {
  /** A runner whose process list empties after `goesAfter` questions. */
  const going = (goesAfter: number, answers: Parameters<typeof fake>[0] = []) => {
    let asked = 0;
    const inner = fake(answers);
    return {
      calls: inner.calls,
      run(command: string, args: readonly string[]) {
        // The *list* command, not every PowerShell one: `CloseMainWindow` also
        // begins with `Get-Process`, and swallowing it here would have made
        // this fake answer a question the module never asked.
        if (command === "pgrep" || args.some((one) => one.includes("ExpandProperty Id"))) {
          asked += 1;
          return { status: 0, stdout: asked > goesAfter ? "" : "999\n", stderr: "" };
        }
        return inner.run(command, args);
      },
    } as Runner & { calls: string[] };
  };

  it("does nothing at all when it is already gone", async () => {
    const runner = going(0);
    const outcome = await quitApplication("/a/x", {}, { platform: "darwin", runner, sleep: instantly });
    expect(outcome.gone).toBe(true);
    expect(outcome.steps).toEqual([]);
  });

  it("asks the application to quit before it signals, on macOS", async () => {
    const runner = going(2);
    const outcome = await quitApplication(
      "/a/Yam.app/Contents/MacOS/Yam",
      { bundleId: "com.electron.yam" },
      { platform: "darwin", runner, sleep: instantly },
    );
    expect(outcome.gone).toBe(true);
    expect(outcome.steps.map((one) => one.what)).toEqual(["graceful"]);
    expect(runner.calls.some((one) => one.includes("to quit"))).toBe(true);
    // And it never reached the signal, which is the point: a `SIGTERM` ends an
    // Electron main process where it stands and orphans what it spawned.
    expect(runner.calls.some((one) => one.startsWith("pkill"))).toBe(false);
  });

  it("closes the main window on Windows", async () => {
    const runner = going(2);
    const outcome = await quitApplication("C:/x/app.exe", {}, {
      platform: "win32",
      runner,
      sleep: instantly,
    });
    expect(outcome.gone).toBe(true);
    expect(runner.calls.some((one) => one.includes("CloseMainWindow"))).toBe(true);
  });

  it("escalates to a signal, and then to one nothing can catch", async () => {
    // Never goes on its own: every phase has to happen.
    const runner = going(Number.MAX_SAFE_INTEGER);
    const outcome = await quitApplication(
      "/a/x",
      { bundleId: "com.x", gracefulMs: 500, signalMs: 500 },
      { platform: "darwin", runner, sleep: instantly },
    );
    expect(outcome.gone).toBe(false);
    expect(outcome.steps.map((one) => one.what)).toEqual(["graceful", "signal", "kill"]);
    expect(runner.calls.some((one) => one === "pkill -f /a/x")).toBe(true);
    expect(runner.calls.some((one) => one === "pkill -9 -f /a/x")).toBe(true);
  });

  it("gives the signal its own clock, not the graceful route's (P8-F1)", async () => {
    /*
     * The defect this is about: sharing one clock meant escalating to `SIGKILL`
     * five seconds after `SIGTERM` — a signal is a request, and an Electron
     * application takes a second or two to unwind.
     */
    let waited = 0;
    const runner = going(Number.MAX_SAFE_INTEGER);
    await quitApplication(
      "/a/x",
      { bundleId: "com.x", gracefulMs: 1_000, signalMs: 4_000 },
      {
        platform: "darwin",
        runner,
        sleep: async (ms) => {
          waited += ms;
        },
      },
    );
    // 1 s of graceful, then a *further* 4 s after the signal, then 5 s after
    // the kill — not 4 s in total.
    expect(waited).toBeGreaterThanOrEqual(1_000 + 4_000);
  });

  it("has no graceful route without a bundle id, and says so by going straight to the signal", async () => {
    const runner = going(Number.MAX_SAFE_INTEGER);
    const outcome = await quitApplication("/a/x", { gracefulMs: 250, signalMs: 250 }, {
      platform: "darwin",
      runner,
      sleep: instantly,
    });
    expect(outcome.steps.map((one) => one.what)).toEqual(["signal", "kill"]);
  });
});

describe("waiting for a condition (T11.2)", () => {
  it("returns as soon as it is true, with how long it took", async () => {
    let asked = 0;
    const outcome = await waitFor(async () => (asked += 1) >= 3, {
      everyMs: 1,
      sleep: instantly,
    });
    expect(outcome.ready).toBe(true);
    expect(asked).toBe(3);
  });

  it("gives up, rather than waiting for ever", async () => {
    let waited = 0;
    const outcome = await waitFor(async () => false, {
      timeoutMs: 30,
      everyMs: 10,
      sleep: async (ms) => {
        waited += ms;
      },
    });
    expect(outcome.ready).toBe(false);
    // It did wait, rather than answering "no" on the first look.
    expect(waited).toBeGreaterThan(0);
  });
});
