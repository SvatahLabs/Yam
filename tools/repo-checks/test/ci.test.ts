/**
 * P0-F5 — the CI workflow must be observable on the branch.
 *
 * The repository's only remote is Bitbucket, so `.github/workflows/ci.yml` has
 * nowhere to run (Phase 0, K1). `bitbucket-pipelines.yml` mirrors that workflow's
 * Linux job step for step, on the same Node 22 LTS, so the same commands are
 * executed by a runner this repository actually has.
 *
 * This test is what keeps the two from drifting: every command in the GitHub
 * Linux job must appear, in order, in the Bitbucket workspace step, and the
 * legacy Java job must exist in both.
 *
 * Refs: REQ-NFR-7, T0.2.
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
interface GithubWorkflow {
  env?: Record<string, string>;
  on?: { schedule?: Array<{ cron: string }> };
  jobs: Record<
    string,
    {
      strategy?: {
        matrix?: { os?: string[]; include?: Array<Record<string, string>> };
      };
      if?: string;
      "continue-on-error"?: string;
      steps: GithubStep[];
    }
  >;
}
interface BitbucketStep {
  name?: string;
  image?: string;
  script: string[];
}
interface BitbucketPipelines {
  image?: string;
  pipelines: {
    default: Array<{ parallel?: Array<{ step: BitbucketStep }> }>;
    branches: Record<string, Array<{ parallel?: Array<{ step: BitbucketStep }> }>>;
    "pull-requests": Record<string, Array<{ parallel?: Array<{ step: BitbucketStep }> }>>;
    custom?: Record<string, Array<{ parallel?: Array<{ step: BitbucketStep }> }>>;
  };
}

const github = parse(
  readFileSync(fromRoot(".github", "workflows", "ci.yml"), "utf8"),
) as GithubWorkflow;
const bitbucket = parse(
  readFileSync(fromRoot("bitbucket-pipelines.yml"), "utf8"),
) as BitbucketPipelines;

/** The shell commands a GitHub job runs, in order, ignoring `uses:` actions. */
function githubCommands(job: string): string[] {
  return github.jobs[job]!.steps.filter((s) => typeof s.run === "string").map((s) => s.run!.trim());
}

const bitbucketSteps = bitbucket.pipelines.default[0]!.parallel!.map((p) => p.step);
const workspaceStep = bitbucketSteps.find((s) => s.name?.startsWith("workspace"))!;
const javaStep = bitbucketSteps.find((s) => s.name === "legacy Java project compiles")!;
const quickStartStep = bitbucketSteps.find((s) => s.name?.startsWith("quick start"))!;
const runtimeStep = bitbucketSteps.find((s) => s.name?.startsWith("Java runtime conformance"))!;
const clientsStep = bitbucketSteps.find((s) => s.name?.startsWith("generated clients"))!;
const desktopSteps = (bitbucket.pipelines.custom?.["desktop-gates"]?.[0]?.parallel ?? []).map(
  (p) => p.step,
);

describe("CI mirrors (P0-F5)", () => {
  it("both workflows exist", () => {
    expect(Object.keys(github.jobs).sort()).toEqual([
      "ade-installers",
      // T9.3: the generated clients against a live service (REQ-SDK-1, 2).
      "clients-smoke",
      "desktop-conformance",
      "grounding-eval",
      "legacy-java",
      "model-evals",
      "quick-start",
      "runtime-conformance",
      "workspace",
    ]);
    expect(workspaceStep).toBeDefined();
    expect(javaStep).toBeDefined();
    expect(quickStartStep).toBeDefined();
  });

  /*
   * The eval jobs are GitHub-only, deliberately (T3.4).
   *
   * `model-evals` spends money and needs a repository secret, and
   * `grounding-eval` replays a cache that job commits. Mirroring either onto
   * Bitbucket would mean a second place to hold a credential for no gain, so the
   * mirror test below compares the *workspace* job and this one records why the
   * other two are not in it.
   */
  it("the model evals run on a schedule and never on a pull request", () => {
    expect(github.on?.schedule).toBeDefined();
    const job = github.jobs["model-evals"]!;
    expect(job.if).toContain("schedule");
    expect(job.if).not.toContain("pull_request");
  });

  it("builds the ADE's installers on all three operating systems (T3.6)", () => {
    expect(github.jobs["ade-installers"]!.strategy?.matrix?.os).toEqual([
      "ubuntu-latest",
      "macos-latest",
      "windows-latest",
    ]);
    const script = githubCommands("ade-installers").join("\n");
    expect(script).toContain("pnpm --filter @svatah/ade make");
    /*
     * And it launches the thing it just built (T3.6's Validate item), against
     * the *packaged* application (T8.1's). `pnpm ade:smoke` picks the packaged
     * app when `apps/ade/out/` holds one, which `make` has just filled — and
     * the filtered `@svatah/ade smoke` it replaces always launched the
     * development Electron, which cannot fail the way the product failed.
     */
    expect(script).toContain("pnpm ade:smoke");
    expect(script).toContain("xvfb-run");
  });

  it("runs each desktop adapter on the only host it can run on (T6.1, T6.2)", () => {
    /*
     * The AX adapter needs macOS with the Accessibility permission; the UIA one
     * needs Windows. Everything below their bridges is a pure function of a
     * recorded tree and runs in `workspace` on all three platforms — this job
     * is the part that is not, and there is no point running either leg on a
     * host that cannot host it.
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
    // The conformance target is the ADE itself, packaged (LLD §16, REQ-ADE-6).
    expect(script).toContain("electron-forge package");
    expect(script).toContain("scripts/desktop-conformance.mjs");

    /*
     * The macOS leg is `continue-on-error`, and that is a statement rather than
     * a shrug: GitHub's hosted macOS runners have no way to grant the
     * Accessibility permission, so the step reports `prompt-pending` and stops.
     * A self-hosted runner with the permission granted turns it green.
     */
    /*
     * The macOS leg tolerates exit 2 and nothing else (T7.2).
     *
     * It used to be `continue-on-error: macos-latest`, which tolerated *any*
     * failure — so the 0-of-7 the live gate actually produced would have been
     * green (Phase 6 verification, F1). The gate script exits 2 for "this host
     * cannot run me" and 1 for "this adapter is not conformant"; only the first
     * is a runner's fault.
     */
    expect(job["continue-on-error"]).toBeUndefined();
    expect(script).toContain('if [ "$code" = "2" ]');
    expect(script).toContain('exit "$code"');
  });

  it("runs the Java runtime against the published fixture (T6.4, REQ-STD-3)", () => {
    /*
     * The one job in this workflow that must work with no Node in the loop:
     * a JDK, Maven Central, and the artifacts this repository publishes. Node
     * appears only to compile the plan and serve the sample application, which
     * is what any third party would do.
     */
    const script = githubCommands("runtime-conformance").join("\n");
    expect(script).toContain("./gradlew --no-daemon fatJar test");
    expect(script).toContain("scripts/runtime-conformance.mjs");
    // And it is a *gate*: the script exits non-zero on any mismatch, so the
    // job cannot go green with a runtime that disagrees.
    expect(script).not.toContain("continue-on-error");
    expect(github.jobs["runtime-conformance"]!["continue-on-error"]).toBeUndefined();
  });

  /*
   * T7.2, and the finding it exists for (Phase 6 verification, F8, K10).
   *
   * The GitHub workflow carried the desktop and Java conformance jobs, and this
   * repository's only remote is Bitbucket — so neither had ever run, anywhere.
   * The Java gate now runs on Bitbucket's hosted Linux on every branch; the two
   * desktop gates are defined against self-hosted runner labels and live in a
   * `custom:` pipeline, because a step whose labels match no attached runner
   * queues rather than fails and would stall every branch build.
   */
  describe("the pipeline that exists carries every gate (T7.2)", () => {
    it("runs the Java runtime conformance on every branch and pull request", () => {
      for (const [where, steps] of [
        ["default", bitbucket.pipelines.default[0]!.parallel!],
        ["branches", bitbucket.pipelines.branches["**"]![0]!.parallel!],
        ["pull-requests", bitbucket.pipelines["pull-requests"]["**"]![0]!.parallel!],
      ] as const) {
        expect(
          steps.some((p) => p.step.name?.startsWith("Java runtime conformance")),
          `the ${where} pipeline does not run the Java conformance`,
        ).toBe(true);
      }
      const script = runtimeStep.script.join("\n");
      expect(script).toContain("./gradlew --no-daemon fatJar test");
      expect(script).toContain("scripts/runtime-conformance.mjs");
      // A JDK, because the image is Node's.
      expect(script).toContain("openjdk-17-jdk-headless");
    });

    it("defines both desktop gates against the runners that can host them", () => {
      expect(desktopSteps.map((s) => s.name)).toEqual([
        "desktop conformance (windows, uia)",
        "desktop conformance (macos, ax)",
      ]);
      for (const step of desktopSteps) {
        const script = step.script.join("\n");
        // The host requirement first and on its own.
        expect(script).toContain("surface doctor --adapter");
        expect(script).toContain("electron-forge package");
        expect(script).toContain("scripts/desktop-conformance.mjs");
      }
    });

    it("lets only the macOS leg off, and only for exit 2", () => {
      const [uia, ax] = desktopSteps as [BitbucketStep, BitbucketStep];
      // UI Automation needs no permission grant, so that leg has nothing to
      // hide behind and is a hard gate.
      expect(uia.script.join("\n")).not.toContain('code" = "2"');
      const script = ax.script.join("\n");
      expect(script).toContain('if [ "$code" = "2" ]');
      expect(script).toContain('exit "$code"');
    });
  });

  /**
   * T9.3 — the generated clients are exercised against a live service in CI.
   *
   * > the Python and Java clients each run one smoke script against a live
   * > service (`GET /project`, `POST /run`, events) in CI.
   *
   * Both halves are checked: the drift check, which is what makes "generated"
   * mean something, and the smoke, which is what makes "client" mean something.
   * And the toolchains are *installed* rather than hoped for —
   * `scripts/smoke-clients.mjs` skips a language whose toolchain is missing, so
   * a leg without a JDK would go green having run one client.
   */
  describe("the generated clients run in CI (T9.3)", () => {
    it("is a job in both workflows, on every branch and pull request", () => {
      for (const [where, steps] of [
        ["default", bitbucket.pipelines.default[0]!.parallel!],
        ["branches", bitbucket.pipelines.branches["**"]![0]!.parallel!],
        ["pull-requests", bitbucket.pipelines["pull-requests"]["**"]![0]!.parallel!],
      ] as const) {
        expect(
          steps.some((p) => p.step.name?.startsWith("generated clients")),
          `the ${where} pipeline does not run the client smoke`,
        ).toBe(true);
      }
    });

    it("checks the drift and runs the smoke, in both files", () => {
      for (const script of [githubCommands("clients-smoke").join("\n"), clientsStep.script.join("\n")]) {
        expect(script).toContain("pnpm clients:check");
        expect(script).toContain("pnpm clients:smoke");
      }
    });

    it("installs a JDK and a Python, because a missing one is a skip", () => {
      const github17 = JSON.stringify(github.jobs["clients-smoke"]!.steps);
      expect(github17).toContain("setup-java");
      expect(github17).toContain("setup-python");
      const script = clientsStep.script.join("\n");
      expect(script).toContain("openjdk-17-jdk-headless");
      expect(script).toContain("python3");
    });
  });

  it("the pull-request eval job replays a cache rather than spending", () => {
    const script = githubCommands("grounding-eval").join("\n");
    expect(script).toContain("--cache evals/grounding/cache");
    // And it degrades to the harness check rather than failing when no
    // scheduled run has committed a cache yet.
    expect(script).toContain("--gateway fake");
  });

  it("the quick-start job runs the quick start and checks the recorded bindings (T1.6)", () => {
    for (const script of [githubCommands("quick-start"), quickStartStep.script]) {
      expect(script.join("\n"), "the quick start is not run").toContain("pnpm quick-start");
      expect(
        script.join("\n"),
        "nothing checks that re-recording reproduces the committed bindings",
      ).toContain("git diff --exit-code examples/plain-playwright/bindings");
    }
  });

  it("the GitHub matrix still covers three operating systems (REQ-NFR-7)", () => {
    expect(github.jobs.workspace!.strategy?.matrix?.os).toEqual([
      "ubuntu-latest",
      "macos-latest",
      "windows-latest",
    ]);
  });

  it("both pin Node 22 LTS", () => {
    expect(github.env?.NODE_VERSION).toBe("22");
    expect(bitbucket.image).toBe("node:22");
  });

  it("the Bitbucket workspace step runs every GitHub workspace command, in order", () => {
    const expected = githubCommands("workspace");
    expect(expected.length).toBeGreaterThan(0);

    const actual = workspaceStep.script;
    let cursor = 0;
    for (const command of expected) {
      const found = actual.indexOf(command, cursor);
      expect(
        found,
        `bitbucket-pipelines.yml does not run "${command}" after the previous step. ` +
          "The two CI files must stay in step (P0-F5).",
      ).toBeGreaterThanOrEqual(0);
      cursor = found + 1;
    }
  });

  it("the Bitbucket Java step runs the same Gradle command on a JDK 17 image", () => {
    expect(javaStep.image).toMatch(/temurin:17/);
    expect(javaStep.script).toContain("cd legacy");
    expect(javaStep.script.join("\n")).toContain(githubCommands("legacy-java").join("\n"));
  });

  it("runs on every branch and on pull requests, as the GitHub workflow does", () => {
    /*
     * Plus `custom`, which T7.2 added for the two desktop gates. They are not
     * in the automatic pipelines because Bitbucket's hosted runners are Linux
     * only and a step whose `runs-on` labels match nothing *queues* — putting
     * them in `branches` would stall every build behind a runner that does not
     * exist.
     */
    expect(Object.keys(bitbucket.pipelines).sort()).toEqual([
      "branches",
      "custom",
      "default",
      "pull-requests",
    ]);
    /*
     * `desktop-gates` needs a self-hosted runner (D1); `release` is the half of
     * `.github/workflows/release.yml` that can run on the remote this
     * repository has, and stops at the artifact step (T7.6); `publish` is the
     * one the owner triggers with a token, and a dry run that prints the
     * commands on every other trigger (T8.5).
     */
    expect(Object.keys(bitbucket.pipelines.custom!).sort()).toEqual([
      "desktop-gates",
      "publish",
      "release",
    ]);
  });
});
