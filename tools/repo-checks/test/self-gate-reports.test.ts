/**
 * The gate leaves the tree alone unless asked not to (P11-F3, LLD §13.9).
 *
 * `svatah eval self` answers two of its checks by running scripts that write
 * *committed* reports as a side effect: the healing eval writes
 * `reports/eval-healing.md`, the desktop gate writes `reports/adapter-ax.md`.
 * So a clean checkout was dirty after running the contract's own gate, and a
 * verifier reading `git status` had to work out whether two modified files were
 * a change or an echo (the Phase 11 verification, F3).
 *
 * `--update` refreshes the committed set; without it every report goes to a
 * temporary directory and the gate says where. That is the rule `ade:shoot`
 * already follows (P10-F6), and this holds all three reports to it.
 *
 * The gate itself takes eight minutes and needs a packaged ADE, so what runs
 * here is one check whose source is a script — the artboards audit, about a
 * second — and the tree is read before and after.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { REPO_ROOT, fromRoot } from "../src/repo.js";

const cli = fromRoot("packages/cli/dist/bin.js");

/** What `git status --porcelain` says about the committed reports. */
function dirtyReports(): string[] {
  return execFileSync("git", ["status", "--porcelain", "--", "reports"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((one) => one.trim() !== "");
}

describe("`svatah eval self` writes its reports outside the tree (P11-F3)", () => {
  it.runIf(existsSync(cli))(
    "runs a check and leaves reports/ exactly as it found it",
    () => {
      const before = dirtyReports();
      const said = execFileSync(
        process.execPath,
        [cli, "eval", "self", "--only", "design.artboards-fit"],
        { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );

      expect(dirtyReports(), "the gate modified a committed report").toEqual(before);
      // And it said where its own report went, rather than writing it silently.
      expect(said).toMatch(/self-parity\.md/);
    },
    120_000,
  );

  it("routes both side-effecting sources through the same directory", () => {
    /*
     * The two scripts that write a committed report as a side effect of
     * answering. A third one added later without a `--report` under
     * `reportsDir` is the same defect again, so the rule is asserted on the
     * gate's own source rather than only on one run of it.
     */
    const gate = readFileSync(fromRoot("packages/cli/src/commands/eval-self.ts"), "utf8");
    expect(gate).toContain('join(reportsDir, "eval-healing.md")');
    expect(gate).toContain('join(reportsDir, "adapter-ax.md")');
    // The default for the gate's own report is that directory too.
    expect(gate).toContain('join(reportsDir, "self-parity.md")');
    // And `--update` is what points the directory back at the committed set.
    expect(gate).toMatch(/const update = boolOption\(args, "update"\)/);
  });

  it("is what `pnpm self` asks for, because a phase's record wants the committed set", () => {
    const manifest = JSON.parse(readFileSync(fromRoot("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["self"]).toContain("eval self --update");
  });
});
