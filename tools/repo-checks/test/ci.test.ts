/**
 * The CI workflow, and the properties each phase pinned on it.
 *
 * Until Draft 2.18 this file kept `.github/workflows/ci.yml` and a Bitbucket
 * pipeline in step, because the repository's only remote was Bitbucket and the
 * GitHub workflow had nowhere to run (Phase 0, K1; P0-F5). The repository now
 * lives at `github.com/SvatahLabs/Yam` and GitHub Actions is the only CI, so
 * the twin-file mirror is gone and what remains are the assertions about the
 * one workflow that runs.
 *
 * Refs: REQ-NFR-7, T0.2, T3.4, T3.6, T4.2, T6.1, T6.2, T6.4, T7.2, T9.3, T11.5, T12.1, T13.2, T23.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { fromRoot } from "../src/repo.js";

interface GithubStep {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string | number | boolean>;
}
interface GithubJob {
  "runs-on"?: string | string[];
  strategy?: {
    matrix?: { os?: string[]; include?: Array<Record<string, string>> };
  };
  if?: string;
  "continue-on-error"?: string;
  env?: Record<string, string>;
  steps: GithubStep[];
}
interface GithubWorkflow {
  env?: Record<string, string>;
  on?: { schedule?: Array<{ cron: string }>; push?: unknown; pull_request?: unknown };
  jobs: Record<string, GithubJob>;
}

const github = parse(
  readFileSync(fromRoot(".github", "workflows", "ci.yml"), "utf8"),
) as GithubWorkflow;

/** The shell commands a job runs, in order, ignoring `uses:` actions. */
function githubCommands(job: string): string[] {
  return github.jobs[job]!.steps.filter((s) => typeof s.run === "string").map((s) => s.run!.trim());
}

describe("the CI workflow (T0.2, T13.2)", () => {
  it("is the one workflow, with every job a phase pinned", () => {
    expect(Object.keys(github.jobs).sort()).toEqual([
      "app-installers",
      // T4.2: Android Chrome through Appium on an emulator, nightly (REQ-ADP-5).
      "appium-emulator",
      // T9.3: the generated clients against a live service (REQ-SDK-1, 2).
      "clients-smoke",
      "desktop-conformance",
      // T23: the Linux AT-SPI gate, nightly until it has been green (SF-23).
      "desktop-conformance-linux",
      "grounding-eval",
      "model-evals",
      "quick-start",
      // The published MCP server from npm, nightly (SF-07, REQ-PKG-2).
      "registry-mcp",
      "runtime-conformance",
      // T11.5: Yam verifies Yam, the two-sided parity gate, nightly (REQ-SELF-2).
      "self-parity",
      "workspace",
      // T00: Yam drives the packaged Yam, behind the packaged build (SF-18, SF-21).
      "yam-on-yam",
    ]);
  });

  it("runs the published MCP server from an empty directory, nightly and never from this checkout", () => {
    const job = github.jobs["registry-mcp"]!;
    expect(job.if).toContain("schedule");
    const script = githubCommands("registry-mcp").join("\n");
    expect(script).toContain("scripts/registry-mcp-smoke.mjs");
    // Nothing from this checkout on the path: no install, no build.
    expect(script).not.toContain("pnpm");
  });

  it("runs on every push and on pull requests", () => {
    expect(github.on?.push).toBeDefined();
    expect(github.on?.pull_request).toBeDefined();
  });

  it("the workspace job covers three operating systems on Node 22 LTS (REQ-NFR-7)", () => {
    expect(github.jobs.workspace!.strategy?.matrix?.os).toEqual([
      "ubuntu-latest",
      "macos-latest",
      "windows-latest",
    ]);
    expect(github.env?.NODE_VERSION).toBe("22");
  });

  it("the workspace job runs the whole verification contract and the gates beside it", () => {
    const script = githubCommands("workspace").join("\n");
    for (const command of [
      "pnpm install --frozen-lockfile",
      "pnpm -r build",
      "pnpm -r typecheck",
      "pnpm lint",
      "pnpm check:licenses",
      // `--no-bail`, so one run reports every failing package rather than the first.
      "pnpm -r --no-bail test",
      "node scripts/compatibility.mjs",
      "node scripts/privacy-check.mjs",
      "pnpm examples",
    ]) {
      expect(script, `the workspace job does not run "${command}"`).toContain(command);
    }
  });

  /*
   * The eval jobs spend money and need a repository secret (T3.4): `model-evals`
   * runs on the schedule and never on a pull request; `grounding-eval` replays
   * the cache the scheduled job commits.
   */
  it("the model evals run on a schedule and never on a pull request", () => {
    expect(github.on?.schedule).toBeDefined();
    const job = github.jobs["model-evals"]!;
    expect(job.if).toContain("schedule");
    expect(job.if).not.toContain("pull_request");
  });

  it("the pull-request eval job replays a cache rather than spending", () => {
    const script = githubCommands("grounding-eval").join("\n");
    expect(script).toContain("--cache evals/grounding/cache");
    // And it degrades to the harness check rather than failing when no
    // scheduled run has committed a cache yet.
    expect(script).toContain("--gateway fake");
  });

  it("builds the app's installers on all three operating systems (T3.6)", () => {
    expect(github.jobs["app-installers"]!.strategy?.matrix?.os).toEqual([
      "ubuntu-latest",
      "macos-latest",
      "windows-latest",
    ]);
    const script = githubCommands("app-installers").join("\n");
    expect(script).toContain("pnpm --filter @svatah/yam-desktop make");
    /*
     * And it launches the thing it just built (T3.6's Validate item), against
     * the *packaged* application (T8.1's). `pnpm app:smoke` picks the packaged
     * app when `apps/desktop/out/` holds one, which `make` has just filled.
     */
    expect(script).toContain("pnpm app:smoke");
    expect(script).toContain("xvfb-run");
  });

  it("runs each desktop adapter on the only host it can run on (T6.1, T6.2)", () => {
    /*
     * The AX adapter needs macOS with the Accessibility permission; the UIA one
     * needs Windows. Everything below their bridges is a pure function of a
     * recorded tree and runs in `workspace` on all three platforms — this job
     * is the part that is not.
     */
    const job = github.jobs["desktop-conformance"]!;
    expect(job.strategy?.matrix?.include).toEqual([
      { os: "windows-latest", adapter: "uia" },
      { os: "macos-latest", adapter: "ax" },
    ]);

    const script = githubCommands("desktop-conformance").join("\n");
    // The host requirement first and on its own, so a failure reads as "the
    // runner cannot do this" rather than as a failed suite.
    expect(script).toContain("surface doctor --adapter");
    // The conformance target is the app itself, packaged (LLD §16, REQ-ADE-6),
    // by the app's own script: Forge alone does not stage the bundled CLI, and
    // on a clean checkout it failed on the missing `.stage/yam`.
    expect(script).toContain("pnpm --filter @svatah/yam-desktop package");
    expect(script).not.toContain("electron-forge package");
    expect(script).toContain("scripts/desktop-conformance.mjs");

    /*
     * Neither leg tolerates a failure (T7.2). The gate script exits 2 for "this
     * host cannot run me" and 1 for "this adapter is not conformant". A blanket
     * `continue-on-error` would have made Phase 6's 0-of-7 green; passing exit
     * 2 with a warning outlived the belief that hosted macOS could not grant
     * Accessibility, and would pass a leg whose gate never ran.
     */
    expect(job["continue-on-error"]).toBeUndefined();
    expect(script).toContain('if [ "$code" = "2" ]');
    expect(script).toContain("::error::");
    expect(script).not.toContain("exit 0");
    expect(script).toContain('exit "$code"');
  });

  it("fails the Yam-on-Yam leg when the suite could reach nothing", () => {
    const script = githubCommands("yam-on-yam").join("\n");
    expect(script).toContain("evals/self/yam-on-yam/run.mjs");
    expect(script).toContain("::error::");
    expect(script).not.toContain("exit 0");
    expect(script).toContain('exit "$code"');
  });

  /*
   * Three gates that had never run live when they were added: the Linux AT-SPI
   * bridge (T23), the Appium adapter on an emulator (T4.2) and the self-parity
   * gate (T11.5). Each ran on the schedule and on a manual dispatch and on
   * nothing else, because a leg nobody has seen pass must not be able to block
   * a push.
   *
   * All three were green for the first time on 2026-09-21. Draft 2.29 promotes
   * the Linux leg and holds the other two back, and the difference is what each
   * costs against what it has shown: three minutes for the gate to a surface
   * nothing else drives, against twenty-six for `self-parity`. One green run is
   * not yet evidence of a reliable one, so the two expensive legs wait for a
   * week of nightlies. `docs/ci.md` §1 carries the same reasoning in prose.
   */
  for (const job of ["appium-emulator", "self-parity"]) {
    it(`runs ${job} on the schedule and on dispatch only`, () => {
      const condition = github.jobs[job]!.if ?? "";
      expect(condition).toContain("github.event_name == 'schedule'");
      expect(condition).toContain("github.event_name == 'workflow_dispatch'");
      expect(condition).not.toContain("push");
      expect(condition).not.toContain("pull_request");
      expect(github.jobs[job]!["continue-on-error"]).toBeUndefined();
    });
  }

  it("runs the Linux AT-SPI gate on every push, and lets it block one", () => {
    // No `if` at all: it runs on whatever the workflow runs on.
    expect(github.jobs["desktop-conformance-linux"]!.if).toBeUndefined();
    // And it blocks: a leg that cannot fail the run is not a gate.
    expect(github.jobs["desktop-conformance-linux"]!["continue-on-error"]).toBeUndefined();
  });

  it("runs the AT-SPI gate on Linux and fails the leg on exit 2 (T23)", () => {
    expect(github.jobs["desktop-conformance-linux"]!["runs-on"]).toBe("ubuntu-latest");
    const script = githubCommands("desktop-conformance-linux").join("\n");
    expect(script).toContain("surface doctor --adapter atspi");
    expect(script).toContain("pnpm --filter @svatah/yam-desktop package");
    expect(script).toMatch(/scripts\/desktop-conformance\.mjs[\s\\]+--adapter atspi/);
    // A display, a session bus and a registry the walker can reach.
    expect(script).toContain("Xvfb");
    expect(script).toContain("dbus-launch");
    expect(script).toContain("at-spi2-registryd");
    // Exit 2 is not tolerated: the same shape as the other two desktop legs.
    expect(script).toContain('if [ "$code" = "2" ]');
    expect(script).toContain("::error::");
    expect(script).not.toContain("exit 0");
    expect(script).toContain('exit "$code"');
    // And the gate has its runner to itself (T12.1).
    expect(script).not.toMatch(/pnpm -r test|pnpm test\b|vitest|playwright test/);
  });

  it("runs the Appium subset through its script on an emulator (T4.2)", () => {
    const steps = github.jobs["appium-emulator"]!.steps;
    const emulator = steps.find((step) => (step.uses ?? "").startsWith("reactivecircus/android-emulator-runner@"));
    expect(emulator, "no emulator step").toBeDefined();
    const script = String(emulator!.with?.["script"] ?? "");
    expect(script).toContain("node scripts/appium-conformance.mjs");
    expect(script).toContain("::error::");
    expect(script).not.toContain("exit 0");
    expect(script).toContain('exit "$code"');
    // Appium is installed pinned, with ChromeDriver fetched to match the image's Chrome.
    const commands = githubCommands("appium-emulator").join("\n");
    expect(commands).toContain("--allow-insecure chromedriver_autodownload");
    expect(commands).toContain("appium-uiautomator2-driver@");
    expect(github.jobs["appium-emulator"]!).toMatchObject({ env: { APPIUM_VERSION: expect.stringMatching(/^2\./) } });
  });

  it("runs the self-parity gate without committing or updating the tracked reports (T11.5)", () => {
    const script = githubCommands("self-parity").join("\n");
    expect(script).toContain("node scripts/seed-app-recents.mjs");
    expect(script).toContain("eval self");
    // `pnpm self` is `eval self --update`, which rewrites `reports/`.
    expect(script).not.toContain("--update");
    expect(script).not.toMatch(/pnpm self\b/);
    expect(script).not.toMatch(/--report\s+"?reports\//);
    expect(script).not.toMatch(/git (add|commit|push)/);
    // And it checks that the run left them alone.
    expect(script).toContain("git diff --exit-code -- reports");
    // A disagreement fails the leg, and so does a run that compared nothing.
    expect(script).toContain("::error::");
    expect(script).not.toContain("exit 0");
    expect(script).toContain('exit "$code"');
  });

  it("runs the Java runtime against the published fixture (T6.4, REQ-STD-3)", () => {
    /*
     * The one job in this workflow that must work with no Node in the loop:
     * a JDK, Maven Central, and the artifacts this repository publishes.
     */
    const script = githubCommands("runtime-conformance").join("\n");
    expect(script).toContain("./gradlew --no-daemon fatJar test");
    expect(script).toContain("scripts/runtime-conformance.mjs");
    // And it is a *gate*: the script exits non-zero on any mismatch.
    expect(script).not.toContain("continue-on-error");
    expect(github.jobs["runtime-conformance"]!["continue-on-error"]).toBeUndefined();
  });

  /**
   * T9.3 — the generated clients are exercised against a live service in CI.
   * Both halves are checked: the drift check, which is what makes "generated"
   * mean something, and the smoke, which is what makes "client" mean something.
   * The toolchains are *installed* rather than hoped for, because
   * `scripts/smoke-clients.mjs` skips a language whose toolchain is missing.
   */
  it("checks the generated clients' drift and runs their smoke with a JDK and a Python (T9.3)", () => {
    const script = githubCommands("clients-smoke").join("\n");
    expect(script).toContain("pnpm clients:check");
    expect(script).toContain("pnpm clients:smoke");
    const steps = JSON.stringify(github.jobs["clients-smoke"]!.steps);
    expect(steps).toContain("setup-java");
    expect(steps).toContain("setup-python");
  });

  /*
   * A workflow can only call a root script that exists.
   *
   * `pnpm clients:check` and `pnpm clients:smoke` were in this workflow from
   * T9.3 and in no root `package.json` until the first GitHub run answered
   * "Command not found". The test above checks that the workflow *says* them,
   * which is the half that cannot fail.
   */
  it("calls only root scripts that exist", () => {
    const manifest = JSON.parse(readFileSync(fromRoot("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const builtins = new Set(["install", "add", "exec", "dlx", "deploy", "licenses", "pack", "publish", "store"]);
    const called = new Set<string>();
    for (const file of ["ci.yml", "release.yml"]) {
      const workflow = parse(
        readFileSync(fromRoot(".github", "workflows", file), "utf8"),
      ) as GithubWorkflow;
      for (const job of Object.values(workflow.jobs)) {
        for (const step of job.steps) {
          for (const match of (step.run ?? "").matchAll(/(?:^|[\s;&|(])pnpm\s+(?:run\s+)?([^\s-][^\s;&|)]*)/gm)) {
            if (!builtins.has(match[1]!)) called.add(match[1]!);
          }
        }
      }
    }
    expect(called.size, "no root script calls were found, so this checked nothing").toBeGreaterThan(5);
    expect([...called].filter((name) => manifest.scripts[name] === undefined)).toEqual([]);
  });

  it("the quick-start job runs the quick start and checks the recorded bindings (T1.6)", () => {
    const script = githubCommands("quick-start").join("\n");
    expect(script, "the quick start is not run").toContain("pnpm quick-start");
    expect(
      script,
      "nothing checks that re-recording reproduces the committed bindings",
    ).toContain("git diff --exit-code examples/plain-playwright/bindings");
  });
});

/**
 * T12.1, LLD §7.5 (Draft 2.10) — "a CI leg that runs the desktop gate runs
 * nothing else on that runner".
 *
 * The bridge's budget is wall-clock: 1.6 ms per node on a quiet machine, 29.6 ms
 * beside a full test run. A second job sharing the runner would not make the
 * gate slower, it would make it measure something else — and the report would
 * carry a per-node cost nobody could compare with anybody's.
 */
describe("a desktop gate has its runner to itself (T12.1)", () => {
  const legs = github.jobs["desktop-conformance"]!.strategy?.matrix?.include ?? [];

  it("gives the two gates different hosts, so the matrix is two runners", () => {
    const hosts = legs.map((leg) => leg["os"]);
    expect(hosts.length, "the desktop-conformance job has no matrix").toBeGreaterThan(1);
    expect(new Set(hosts).size, `two gates on one host: ${hosts.join(" | ")}`).toBe(hosts.length);
  });

  it("runs no test suite beside the gate", () => {
    const script = githubCommands("desktop-conformance").join("\n");
    expect(script, "the desktop-conformance job runs the test suite beside the gate").not.toMatch(
      /pnpm -r test|pnpm test\b|vitest|playwright test/,
    );
  });
});
