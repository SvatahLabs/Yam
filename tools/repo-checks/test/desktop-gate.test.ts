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
 * > `applicationProcesses.byName("Svatah ADE")` can answer the dying one, which
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
    // By the executable path, so another Svatah ADE on the machine is neither
    // counted nor killed.
    expect(source).toContain('spawnSync("pgrep", ["-f", app]');
  });

  it("polls until none remains rather than returning when the signal was sent", () => {
    expect(source).toMatch(/while \(remaining\.length > 0 && Date\.now\(\) - startedAt </);
    expect(source).toContain("TEARDOWN_TIMEOUT_MS");
  });

  it("escalates to SIGKILL halfway through, and says so when one survives", () => {
    expect(source).toContain('spawnSync("pkill", ["-9", "-f", app]');
    expect(source).toContain("were still running after");
  });

  it("clears leftovers before the first variant too", () => {
    expect(source).toMatch(/stop\(\);\n\ntry \{\n {2}for \(const variant of \[0, 1, 2\]\)/);
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
