/**
 * P6-F6 — the desktop gate's report path and its wait for the window.
 *
 * Two defects the Phase 6 verification found in
 * `scripts/desktop-conformance.mjs`, both of the kind that only shows up on a
 * host that can run the gate:
 *
 * 1. `--report ../adapter-ax.md` from the repository root wrote
 *    `evals/adapter-ax.md`, because the path was handed to a CLI whose working
 *    directory is the fixture project. LLD §15's command table says `--report`
 *    is "resolved against the current directory".
 * 2. The wait for the ADE's window was a fixed eight-second sleep, on a machine
 *    that took fifteen seconds twice. §15 says the gate "polls for the ADE
 *    window up to 60 s".
 *
 * Neither can be tested by running the gate on a Linux CI runner: it needs a
 * packaged ADE and a granted permission. So the path is tested through
 * `--print-report-path`, which resolves and stops, and the poll is read from the
 * source — which is weaker, and is why the flag exists for the half that can be
 * executed.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fromRoot } from "../src/repo.js";

const SCRIPT = fromRoot("scripts/desktop-conformance.mjs");

const printReportPath = (report: string, cwd: string): string =>
  execFileSync(process.execPath, [SCRIPT, "--adapter", "ax", "--report", report, "--print-report-path"], {
    cwd,
    encoding: "utf8",
  }).trim();

describe("the desktop gate's --report path (P6-F6, LLD §15)", () => {
  it("resolves a relative path against the current directory, not the project", () => {
    const root = fromRoot(".");
    /*
     * The exact command the verifier ran, and the exact answer it should have
     * given: one directory *above* the repository, not `evals/` inside it.
     */
    expect(printReportPath("../adapter-ax.md", root)).toBe(resolve(root, "../adapter-ax.md"));
    expect(printReportPath("reports/adapter-ax.md", root)).toBe(
      join(root, "reports", "adapter-ax.md"),
    );
  });

  it("follows the directory it was run from", () => {
    const evals = fromRoot("evals");
    expect(printReportPath("../adapter-ax.md", evals)).toBe(resolve(evals, "../adapter-ax.md"));
  });

  it("leaves an absolute path alone", () => {
    expect(printReportPath("/tmp/adapter-ax.md", fromRoot("."))).toBe("/tmp/adapter-ax.md");
  });

  it("defaults to reports/, which is where run artifacts may be committed (LLD §16)", () => {
    expect(printReportPath("reports/adapter-ax.md", fromRoot("."))).toBe(
      fromRoot("reports/adapter-ax.md"),
    );
  });
});

describe("the desktop gate's wait for the ADE window (P6-F6, LLD §15)", () => {
  const source = readFileSync(SCRIPT, "utf8");

  it("polls for a window rather than sleeping a fixed time", () => {
    expect(source).toContain("function hasWindow()");
    // The fixed sleep that was there, in the shape it had.
    expect(source).not.toMatch(/setTimeout\(done, 8_?000\)/);
  });

  it("waits up to sixty seconds, which §15 names", () => {
    expect(source).toContain('option("window-timeout-ms", "60000")');
  });

  it("asks the OS on both platforms, not the adapter", () => {
    // Asking the adapter would fold "the bridge is slow" into "no window yet",
    // which are the two things this gate exists to keep apart.
    expect(source).toContain("System Events");
    expect(source).toContain("MainWindowHandle");
  });

  it("reports a launch that shows no window as that, and writes no report", () => {
    expect(source).toContain("showed no window within");
    expect(source).toContain("That is a launch failure, not an adapter failure");
  });
});

/**
 * P8-F1 — the gate may not launch the next variant while the previous one is
 * still exiting, and the bridge may not drive a process with no window.
 *
 * > Between variants the gate stops the ADE with `pkill -f <app>` and launches
 * > the next with `open -n`, and the bridge addresses the process by name. When
 * > the previous instance is still shutting down,
 * > `applicationProcesses.byName("Yam ADE")` can answer the dying one, which
 * > owns no window, so every case at the new variant throws `no-window`.
 *
 * Neither half can be executed on a runner with no packaged ADE and no
 * Accessibility grant — the whole finding is about a live macOS gate — so both
 * are read from the source, and the *behaviour* is tested where it is testable:
 * `packages/adapter-ax/test/bridge.test.ts` drives the perform script's process
 * choice through a fake `osascript`.
 */
describe("the desktop gate waits for the previous launch to go (P8-F1, LLD §7.5)", () => {
  const source = readFileSync(SCRIPT, "utf8");

  it("can list the processes of this checkout's build", () => {
    expect(source).toContain("function processIds()");
    // By the executable path, so another Yam ADE on the machine is neither
    // counted nor killed.
    expect(source).toContain('spawnSync("pgrep", ["-f", app]');
  });

  it("polls until none remains rather than returning when the signal was sent", () => {
    /*
     * The clock is the *signal's*, not the whole teardown's (T11.1).
     *
     * Draft 2.13 puts a graceful quit route in front of the signal (P10-F1), so
     * `stop()` has two phases with two budgets: ten seconds asking the ADE to
     * quit, then thirty waiting for a `SIGTERM` it may still be unwinding from.
     * Sharing one clock meant escalating to `SIGKILL` five seconds after
     * `SIGTERM` — the defect P8-F1 is about, in a new place.
     */
    expect(source).toMatch(/while \(remaining\.length > 0 && Date\.now\(\) - signalledAt </);
    expect(source).toContain("TEARDOWN_TIMEOUT_MS");
  });

  it("asks the application to quit before it signals (Draft 2.13, P10-F1)", () => {
    expect(source).toContain("function requestQuit()");
    // The graceful route on each platform: an Apple-event quit, a
    // `CloseMainWindow`. Both reach the ADE's `before-quit`, which stops the
    // `yam serve` it spawned; a bare signal used to leave one behind.
    expect(source).toContain("to quit");
    expect(source).toContain("CloseMainWindow");
    expect(source).toContain("GRACEFUL_QUIT_MS");
    // And the graceful phase comes first, with its own clock.
    const graceful = source.indexOf("if (processIds().length > 0) requestQuit();");
    const signal = source.indexOf('spawnSync("pkill", ["-f", app]');
    expect(graceful).toBeGreaterThan(0);
    expect(signal).toBeGreaterThan(graceful);
  });

  it("polls the accessibility API for a window, not System Events (P10-F1)", () => {
    /*
     * `count windows` over an Apple event asks System Events to do the same
     * accessibility read, one process away, under a second permission — and it
     * answers 0 for *every* application when that read is refused, which is
     * indistinguishable from "the ADE has no window yet".
     */
    expect(source).toContain("REAL_WINDOW_SCRIPT");
    expect(source).not.toContain("to count windows");
    // The role is the test: a locked screen answers `AXWindows` with a
    // one-element list holding the application itself.
    expect(source).toContain("'AXWindow'");
  });

  it("names a cause only when the session check can name one (P10-F5)", () => {
    expect(source).toContain("function sessionCheck()");
    expect(source).toMatch(/state === "locked" \|\| .*state === "no-session"/s);
  });

  it("escalates to SIGKILL halfway through, and says so when one survives", () => {
    expect(source).toContain('spawnSync("pkill", ["-9", "-f", app]');
    expect(source).toContain("were still running after");
  });

  it("clears leftovers before the first variant too", () => {
    /*
     * The intent, not the adjacency: `stop()` runs before the variant loop and
     * nothing launches an ADE between the two. Asserted as a *window* of source
     * rather than as two lines touching, because T12.3 put the sample
     * application's start-up in that window — it is not an ADE and it is not a
     * leftover, and a check that read the two lines as one string would have
     * failed for a reason it is not about.
     */
    const from = source.lastIndexOf("\nstop();\n");
    const to = source.indexOf("for (const variant of [0, 1, 2])");
    expect(from, "the gate does not call stop() before the loop").toBeGreaterThan(0);
    expect(to, "the gate has no variant loop").toBeGreaterThan(from);
    const between = source.slice(from, to);
    expect(between, "something launches an ADE between the clean slate and the first variant")
      .not.toMatch(/\blaunch\(|\brunSuite\(/);
  });
});

/**
 * P8-F2 — the cost line says nothing about the machine, and an exceeded
 * deadline is not retried.
 *
 * > Measured here: 1.6 ms per node at load average seven, 29.6 ms per node
 * > beside the test suite. The number is honest each time and useless without
 * > the load beside it.
 *
 * The measurement itself needs macOS and a granted permission; what is checked
 * here is that the gate *publishes* the two numbers and retries once, and
 * `packages/adapter-ax/test/bridge.test.ts` checks that the bridge records
 * them.
 */
describe("the gate records the load and retries once (P8-F2, LLD §7.5)", () => {
  const source = readFileSync(SCRIPT, "utf8");

  it("prints the load average and the CPU count beside the cost", () => {
    expect(source).toContain("at **load average ${bridge.loadAverage1m");
    expect(source).toContain("over ${bridge.cpus} CPUs");
  });

  it("retries a variant whose read exceeded the deadline, exactly once", () => {
    expect(source).toContain("function exceededDeadline(report)");
    expect(source).toContain("did not finish reading the window");
    // The retry runs the suite again and marks the report, and there is no loop.
    expect(source).toContain("retried: true");
    expect(source).not.toMatch(/while \(exceededDeadline/);
  });

  it("says in the report whether anything was retried", () => {
    expect(source).toContain("No variant's window read exceeded the bridge's deadline");
    expect(source).toContain("the first read exceeded the bridge's deadline and the ");
  });
});

/**
 * P9-F7 — a locked display is named as the cause of exit 2 (T10.4).
 *
 * The Phase 9 live gate could not run for either the implementer or the
 * verifier: both had a locked display, and both got "showed no window within
 * 60000 ms" — true, and useless, because it sends a reader to look at the ADE
 * when nothing launched on that machine would get a window.
 *
 * Draft 2.12 §7.5 adds `ax/session` to `yam surface doctor` and asks the gate
 * to name it. The gate itself needs a packaged ADE and a granted permission, so
 * what is checked here is that the source has the branch and the doctor has the
 * check — the same bargain the poll above is tested under, and for the same
 * reason.
 */
describe("a locked display is the cause the gate names (P9-F7, Draft 2.12 §7.5)", () => {
  const gate = readFileSync(SCRIPT, "utf8");

  it("asks the doctor about the session when a launch shows no window", () => {
    expect(gate).toContain("function lockedDisplay()");
    expect(gate).toContain('one.name === "session"');
    // Asked again at the moment of failure: a display can lock mid-gate.
    expect(gate).toMatch(/const locked = lockedDisplay\(\);/);
  });

  it("says the session cannot show a window, rather than blaming the launch", () => {
    expect(gate).toContain("because this login session cannot ");
    expect(gate).toContain("launched here would get a window");
    // And it still exits 2 and writes no report, as it did before.
    expect(gate).toMatch(/die\(\s*\n?\s*2,\s*\n?\s*locked === undefined/);
    expect(gate).toContain("Nothing was written to ${report}");
  });

  it("only ever says it about the macOS adapter", () => {
    expect(gate).toContain('if (adapter !== "ax") return undefined;');
  });
});

/**
 * `yam surface doctor --adapter ax` reports `ax/session` (P9-F7).
 *
 * Run for real: the check needs macOS and the Accessibility permission, and on
 * any other host `doctor` answers `skip ax/platform` — which this asserts
 * instead, so the case says something everywhere rather than skipping in
 * silence.
 */
describe("`surface doctor --adapter ax` reports the login session (P9-F7)", () => {
  const doctor = (): { checks: Array<Record<string, unknown>> } =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [fromRoot("packages/cli/dist/bin.js"), "surface", "doctor", "--adapter", "ax", "--json"],
        { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      ),
    ) as { checks: Array<Record<string, unknown>> };

  it("carries an ax/session check on macOS, and says why not elsewhere", () => {
    const checks = doctor().checks;
    const session = checks.find((one) => one["adapter"] === "ax" && one["name"] === "session");

    if (process.platform !== "darwin") {
      const platform = checks.find((one) => one["adapter"] === "ax" && one["name"] === "platform");
      expect(platform?.["skipped"], "a non-macOS host should skip the ax checks").toBe(true);
      expect(session).toBeUndefined();
      return;
    }

    expect(session, JSON.stringify(checks, null, 2)).toBeDefined();
    // Advisory: a locked display is not a setting that is wrong, and `doctor`'s
    // exit code is about whether the host is *configured* for the adapter
    // (LLD §15's severities).
    expect(session!["advisory"]).toBe(true);
    expect(typeof session!["detail"]).toBe("string");
    expect(String(session!["detail"]).length).toBeGreaterThan(0);
    // Either it names what owns a window, or it says the display is locked.
    expect(String(session!["detail"])).toMatch(/own a window|locked|no process|could not tell/);
  }, 120_000);
});
