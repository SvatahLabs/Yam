/**
 * T10.4 Validate — "the fixture check passes with three unrelated runs in
 * `evals/fixtures/runs`" (P9-F1, Draft 2.12 §13.7).
 *
 * The Phase 9 verification found `scripts/record-screen-fixtures.mjs` running
 * `comp` inside `evals/fixtures` and recording `GET /runs`, which answers with
 * every run in that directory. The suite leaves runs there, the client smoke
 * leaves one, and so does anyone who runs a flow — so the check failed twice
 * during the verification without anyone editing anything.
 *
 * Draft 2.12 §13.7: "The fake service's fixtures are a recording taken against a
 * **copy** of the fixtures project in a temporary directory, never the committed
 * one, so the check does not depend on what else ran there."
 *
 * This is that sentence as a test. Three run directories are written into
 * `evals/fixtures/runs` — the exact condition that used to fail — and the check
 * is expected to pass anyway. It also asserts the check *reads* the committed
 * project rather than ignoring it, so a recorder that had stopped looking at
 * `evals/fixtures` altogether would not pass by accident.
 *
 * Refs: T10.4, P9-F1, LLD §13.7.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

const CHECK = fromRoot("scripts/record-screen-fixtures.mjs");
const CLI = fromRoot("packages/cli/dist/bin.js");
const RUNS = fromRoot("evals/fixtures/runs");

/** Three runs that have nothing to do with `comp`, as a person's would look. */
const UNRELATED = ["unrelated-alpha", "unrelated-beta", "unrelated-gamma"];

const summary = (runId: string): string =>
  JSON.stringify({
    schemaVersion: "1.0.0",
    runId,
    behavior: "test",
    planHash: "0000000000000000",
    bindingsHash: "0000000000000000",
    configHash: "0000000000000000",
    invoker: { kind: "user", id: "local", via: "cli" },
    startedAt: "2026-09-05T00:00:00.000Z",
    endedAt: "2026-09-05T00:00:01.000Z",
    flows: {},
    totals: { passed: 1, failed: 0, skipped: 0, healed: 0, aborted: 0 },
    exitCode: 0,
  });

beforeAll(() => {
  for (const runId of UNRELATED) {
    mkdirSync(join(RUNS, runId), { recursive: true });
    writeFileSync(join(RUNS, runId, "summary.json"), `${summary(runId)}\n`, "utf8");
  }
});

afterAll(() => {
  for (const runId of UNRELATED) rmSync(join(RUNS, runId), { recursive: true, force: true });
});

describe("the screen fixtures are a recording of the project, not of a directory (T10.4)", () => {
  it("has a built CLI to record with", () => {
    expect(existsSync(CLI), "run `pnpm -r build` first").toBe(true);
  });

  it("passes --check with three unrelated runs in evals/fixtures/runs", () => {
    for (const runId of UNRELATED) {
      expect(existsSync(join(RUNS, runId, "summary.json")), `${runId} was not written`).toBe(true);
    }

    const result = spawnSync(process.execPath, [CHECK, "--check"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });

    expect(
      result.status,
      `${result.stdout ?? ""}${result.stderr ?? ""}`,
    ).toBe(0);
    // It read the committed project: the counts are the fixtures project's.
    expect(result.stdout).toContain("7 flow(s)");
    expect(result.stdout).toContain("22 stories");
    expect(result.stdout).toContain("run comp exit 11");
  }, 600_000);

  it("left the three runs where it found them, and made no fourth", () => {
    // The recorder works on a copy; `evals/fixtures/runs` is not its business.
    for (const runId of UNRELATED) {
      expect(existsSync(join(RUNS, runId, "summary.json"))).toBe(true);
    }
    expect(existsSync(join(RUNS, "comp")), "the recorder wrote into the committed project").toBe(
      false,
    );
  });
});
