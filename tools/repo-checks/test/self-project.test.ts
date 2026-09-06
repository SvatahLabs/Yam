/**
 * The self project survives a clean checkout (P11-F1, LLD §13.9).
 *
 * The Phase 11 verification ran `pnpm self:bite` and `pnpm self:record` from a
 * detached worktree and both crashed before they reached the app:
 *
 *   ENOENT: no such file or directory, … 'evals/self/steps'
 *   ENOENT: no such file or directory, … 'evals/self/api'
 *
 * Both directories exist in a working tree and neither is in git, because git
 * carries no empty directory. The fix is two-sided — a tracked placeholder in
 * each, and a copy that tolerates a missing *optional* part — and so is this:
 * either half alone leaves a way to break it again.
 *
 * The scripts themselves need a packaged app and several minutes; what this
 * asserts is the thing that failed, which is the copy, in milliseconds.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromRoot } from "../src/repo.js";
import { copyProjectParts, SELF_PROJECT_PARTS } from "../../../scripts/lib/self-project.mjs";

describe("the self project is copyable from a clean checkout (P11-F1)", () => {
  it("tracks a placeholder in every optional directory its config names", () => {
    /*
     * `yam.config.yaml` names `steps: { dir: steps }` and `api: { dir: api }`,
     * and a directory a config names is one a copying script will reach for.
     */
    for (const part of ["steps", "api"]) {
      const files = readdirSync(fromRoot("evals/self", part));
      expect(
        files.filter((one) => !one.startsWith(".")),
        `evals/self/${part} has nothing git will carry`,
      ).not.toEqual([]);
    }
  });

  it("copies a project whose optional directories are absent, and says which", () => {
    const from = mkdtempSync(join(tmpdir(), "yam-self-project-from-"));
    const to = mkdtempSync(join(tmpdir(), "yam-self-project-to-"));
    try {
      mkdirSync(join(from, "flows"), { recursive: true });
      writeFileSync(join(from, "flows", "one.flow"), "story: one\n\n", "utf8");

      const skipped = copyProjectParts(from, to, ["flows", "steps", "api", "bindings"]);

      expect(skipped.sort()).toEqual(["api", "bindings", "steps"]);
      expect(readdirSync(join(to, "flows"))).toEqual(["one.flow"]);
    } finally {
      rmSync(from, { recursive: true, force: true });
      rmSync(to, { recursive: true, force: true });
    }
  });

  it("still refuses a project with no flows, which is not a project", () => {
    const from = mkdtempSync(join(tmpdir(), "yam-self-project-empty-"));
    const to = mkdtempSync(join(tmpdir(), "yam-self-project-empty-to-"));
    try {
      expect(() => copyProjectParts(from, to, ["flows"])).toThrow(/not a project/);
    } finally {
      rmSync(from, { recursive: true, force: true });
      rmSync(to, { recursive: true, force: true });
    }
  });

  it("names `flows` required and the rest optional, and both scripts use it", () => {
    expect(SELF_PROJECT_PARTS.required).toEqual(["flows"]);
    expect([...SELF_PROJECT_PARTS.optional].sort()).toEqual(["api", "bindings", "steps"]);
  });
});
