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
    { strategy?: { matrix?: { os?: string[] } }; if?: string; steps: GithubStep[] }
  >;
}
interface BitbucketStep {
  name?: string;
  image?: string;
  script: string[];
}
interface BitbucketPipelines {
  image?: string;
  pipelines: Record<string, Array<{ parallel?: Array<{ step: BitbucketStep }> }>>;
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

const bitbucketSteps = bitbucket.pipelines.default![0]!.parallel!.map((p) => p.step);
const workspaceStep = bitbucketSteps.find((s) => s.name?.startsWith("workspace"))!;
const javaStep = bitbucketSteps.find((s) => s.name?.includes("Java"))!;
const quickStartStep = bitbucketSteps.find((s) => s.name?.startsWith("quick start"))!;

describe("CI mirrors (P0-F5)", () => {
  it("both workflows exist", () => {
    expect(Object.keys(github.jobs).sort()).toEqual([
      "grounding-eval",
      "legacy-java",
      "model-evals",
      "quick-start",
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
    expect(Object.keys(bitbucket.pipelines).sort()).toEqual([
      "branches",
      "default",
      "pull-requests",
    ]);
  });
});
