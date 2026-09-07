/**
 * The CI workflow, and the properties each phase pinned on it.
 *
 * Until Draft 2.18 this file kept `.github/workflows/ci.yml` and a Bitbucket
 * pipeline in step, because the repository's only remote was Bitbucket and the
 * GitHub workflow had nowhere to run (Phase 0, K1; P0-F5). The repository now
 * lives at `github.com/SvatahLabs/yam` and GitHub Actions is the only CI, so
 * the twin-file mirror is gone and what remains are the assertions about the
 * one workflow that runs.
 *
 * Refs: REQ-NFR-7, T0.2, T3.4, T3.6, T6.1, T6.2, T6.4, T7.2, T9.3, T12.1, T13.2.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { fromRoot } from "../src/repo.js";

interface GithubStep {
  name?: string;
  run?: string;
  uses?: string;
}
interface GithubJob {
  "runs-on"?: string | string[];
  strategy?: {
    matrix?: { os?: string[]; include?: Array<Record<string, string>> };
  };
  if?: string;
  "continue-on-error"?: string;
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
      // T9.3: the generated clients against a live service (REQ-SDK-1, 2).
      "clients-smoke",
      "desktop-conformance",
      "grounding-eval",
      "model-evals",
      "quick-start",
      "runtime-conformance",
      "workspace",
      // T00: Yam drives the packaged Yam, behind the packaged build (SF-18, SF-21).
      "yam-on-yam",
    ]);
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
      "pnpm -r test",
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
    // The conformance target is the app itself, packaged (LLD §16, REQ-ADE-6).
    expect(script).toContain("electron-forge package");
    expect(script).toContain("scripts/desktop-conformance.mjs");

    /*
     * The macOS leg tolerates exit 2 and nothing else (T7.2). The gate script
     * exits 2 for "this host cannot run me" and 1 for "this adapter is not
     * conformant"; only the first is a runner's fault, and a blanket
     * `continue-on-error` would have made Phase 6's 0-of-7 green.
     */
    expect(job["continue-on-error"]).toBeUndefined();
    expect(script).toContain('if [ "$code" = "2" ]');
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
