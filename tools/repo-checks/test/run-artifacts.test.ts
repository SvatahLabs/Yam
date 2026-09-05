/**
 * P3-F3 — run artifacts are not committed (LLD §16, Draft 2.5).
 *
 * > Run artifacts (`results.jsonl`, `summary.json`, `audit.jsonl`, screenshots,
 * > traces) are committed only under `evals/conformance/` and `reports/`. Every
 * > project directory ignores `runs/`, `.svatah/`, and any absolute-path echo
 * > such as `var/`; a repository check enforces it.
 *
 * Phase 2's compatibility milestone passed an absolute `--out` at a temp
 * directory, something joined it onto the project root instead of resolving it,
 * and fourteen files — three JSON-lines artifacts and eight screenshots — landed
 * under `evals/fixtures/var/folders/x5/…` and were committed. Nobody noticed for
 * a phase, because a diff of a directory named after a temp path is not a diff
 * anyone reads.
 *
 * This is the check that would have. It asks `git` what is tracked rather than
 * walking the filesystem, because the question is what is *committed*: a run
 * directory sitting untracked in a working tree is exactly what should happen.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

/** Every path `git` tracks, repository-relative, with forward slashes. */
function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter((line) => line !== "");
}

/**
 * The two places a run artifact may be committed (LLD §16).
 *
 * `evals/conformance/` holds the runtime conformance suite — expected results a
 * foreign runtime is checked against, which are a *contract*, not a run's
 * output. `reports/` holds the published eval reports (REQ-PKG-4).
 */
const ALLOWED = ["evals/conformance/", "reports/"];

/** What a run writes (REQ-RUN-9): the three streams, screenshots, and traces. */
const ARTIFACTS: ReadonlyArray<{ what: string; matches: (path: string) => boolean }> = [
  { what: "results.jsonl", matches: (p) => p.endsWith("/results.jsonl") },
  { what: "summary.json", matches: (p) => p.endsWith("/summary.json") },
  { what: "audit.jsonl", matches: (p) => p.endsWith("/audit.jsonl") },
  {
    what: "a screenshot",
    // Under a `screenshots/` directory, or in a run directory beside the three
    // streams. A PNG elsewhere in the repository is a document's image.
    matches: (p) => /(^|\/)screenshots\/[^/]+\.png$/.test(p),
  },
  { what: "an adapter trace", matches: (p) => /(^|\/)traces?\/[^/]+\.zip$/.test(p) },
];

const tracked = trackedFiles();

describe("committed run artifacts (LLD §16, P3-F3)", () => {
  it("git ls-files answered, so the check is not vacuously green", () => {
    expect(tracked.length).toBeGreaterThan(100);
    expect(tracked).toContain("docs/spec/lld.md");
  });

  for (const { what, matches } of ARTIFACTS) {
    it(`commits no ${what} outside ${ALLOWED.join(" and ")}`, () => {
      const offenders = tracked.filter(
        (path) => matches(path) && !ALLOWED.some((prefix) => path.startsWith(prefix)),
      );
      expect(
        offenders,
        `${offenders.length} committed run artifact(s). A run's output is reproduced by ` +
          "re-running it; committing it puts a diff nobody reads in front of the ones that matter.",
      ).toEqual([]);
    });
  }

  it("commits nothing under a run, .svatah or absolute-path-echo directory", () => {
    const offenders = tracked.filter((path) =>
      /(^|\/)(runs|\.svatah|var\/folders|private\/var)\//.test(path),
    );
    expect(offenders).toEqual([]);
  });

  it("has no `evals/fixtures/var` left, which is where this came from", () => {
    // Named, because this is the specific tree the Phase 3 verification found.
    expect(existsSync(fromRoot("evals", "fixtures", "var"))).toBe(false);
  });
});

describe("project directories ignore what a run writes (LLD §16, P3-F3)", () => {
  /**
   * Every directory this repository treats as a Svatah project.
   *
   * `svatah init` writes the same list into a new project's `.gitignore`; these
   * are the ones already here, which `init` never touched.
   */
  const projects = ["evals/fixtures", "examples/plain-playwright"];

  for (const project of projects) {
    it(`${project} ignores runs/, .svatah/ and var/`, () => {
      const path = fromRoot(...project.split("/"), ".gitignore");
      expect(existsSync(path), `${project}/.gitignore`).toBe(true);
      const rules = readFileSync(path, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"));
      for (const rule of ["runs/", ".svatah/", "var/"]) {
        expect(rules, `${project} must ignore ${rule}`).toContain(rule);
      }
    });
  }

  it("`svatah init` writes the same rules into a new project", () => {
    // The template, read from the source: a new project must start ignoring
    // what an existing one ignores, or this check only holds for the two
    // directories that happen to be here today.
    const source = readFileSync(
      fromRoot("packages", "cli", "src", "commands", "init.ts"),
      "utf8",
    );
    const template = /const GITIGNORE = `([\s\S]*?)`;/.exec(source)?.[1];
    expect(template, "init.ts must define a GITIGNORE template").toBeDefined();
    for (const rule of ["runs/", ".svatah/", "var/"]) {
      expect(template!.split("\n").map((l) => l.trim())).toContain(rule);
    }
  });
});
