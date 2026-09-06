/**
 * T5.1 — choosing a checkpoint and refusing a stale one (REQ-AUTO-3, LLD §8.1).
 *
 * The end-to-end proof is `packages/cli/test/resume.test.ts`, against a browser
 * and the sample application. What is here is the two decisions that have no
 * browser in them and are easy to get subtly wrong:
 *
 * - **which checkpoint `--from` resumes out of.** The one before it, and not
 *   necessarily the *immediately* preceding step: a run stopped by a policy
 *   leaves the steps after the failure with no checkpoint at all.
 * - **when a resume is refused.** Both hashes, each with a message that says
 *   which moved, because "re-run from the start" is the same advice for two
 *   different mistakes and the reader needs to know which they made.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION, type Checkpoint } from "@svatah/yam-schema";
import {
  checkpointFor,
  openRunDirectory,
  planResume,
  readCheckpoint,
  verifyResumeHashes,
  ResumeMismatchError,
  ResumeUnavailableError,
} from "../src/index.js";
import { plan, step, story, target } from "./harness.js";

const HASHES = { planHash: "plan-hash", bindingsHash: "bindings-hash" };

function checkpoint(parts: Partial<Checkpoint> & { stepId: string; story: string }): Checkpoint {
  return checkpointFor({
    runId: "r1",
    flow: "flows/a.flow",
    at: "2026-09-04T00:00:00.000Z",
    planHash: HASHES.planHash,
    bindingsHash: HASHES.bindingsHash,
    scope: { inputs: {}, captures: {} },
    session: { kind: "web", url: "http://app.test/dashboard", windowIndex: 0 },
    ...parts,
  } as Omit<Checkpoint, "schemaVersion">);
}

/** A run directory with checkpoints for the steps named. */
function runDirectory(stepIds: readonly string[], storyName: string): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-resume-unit-"));
  const directory = openRunDirectory(dir, "r1");
  for (const stepId of stepIds) directory.checkpoint(checkpoint({ stepId, story: storyName }));
  return join(dir, "r1");
}

const STORIES = [
  story("First", [
    step({ action: "click", id: "First#1", target: target("a") }),
    step({ action: "click", id: "First#2", target: target("b") }),
  ]),
  story("Second", [
    step({ action: "click", id: "Second#1", target: target("c") }),
    step({ action: "click", id: "Second#2", target: target("d") }),
    step({ action: "click", id: "Second#3", target: target("e") }),
  ]),
];

const PLAN = { ...plan(STORIES), hash: HASHES.planHash };
const ORDER = new Map([["flows/a.flow", ["First", "Second"]]]);

describe("choosing the checkpoint a --from resumes out of (T5.1)", () => {
  it("takes the checkpoint of the step before it", () => {
    const dir = runDirectory(["First#1", "First#2", "Second#1"], "Second");
    const resume = planResume({ runDir: dir, plan: PLAN, order: ORDER, from: "Second#2" });

    expect(resume.checkpoint.stepId).toBe("Second#1");
    expect(resume.from).toBe("Second#2");
    expect(resume.story).toBe("Second");
    expect(resume.flow).toBe("flows/a.flow");
  });

  it("crosses a story boundary, because the flow's steps are one sequence", () => {
    // Resuming at the *first* step of the second story: the state to restore is
    // what the first story's last step left, and it is in a different file.
    const dir = runDirectory(["First#1", "First#2"], "First");
    const resume = planResume({ runDir: dir, plan: PLAN, order: ORDER, from: "Second#1" });

    expect(resume.checkpoint.stepId).toBe("First#2");
    expect(resume.story).toBe("Second");
  });

  it("skips steps that left no checkpoint, rather than giving up at the first gap", () => {
    /*
     * A run stopped by `stop` records the steps after the failure as `skipped`
     * and writes no checkpoint for them; a run killed mid-step writes none for
     * the step it was in. Both are the normal shape of an interrupted run, and a
     * resume that only looked at the immediately preceding step would refuse
     * them both.
     */
    const dir = runDirectory(["First#1", "First#2"], "First");
    const resume = planResume({ runDir: dir, plan: PLAN, order: ORDER, from: "Second#3" });

    expect(resume.checkpoint.stepId).toBe("First#2");
  });

  it("refuses the flow's first step, which has nothing before it", () => {
    const dir = runDirectory(["First#1"], "First");
    expect(() => planResume({ runDir: dir, plan: PLAN, order: ORDER, from: "First#1" })).toThrow(
      ResumeUnavailableError,
    );
    try {
      planResume({ runDir: dir, plan: PLAN, order: ORDER, from: "First#1" });
    } catch (error) {
      // And says the useful thing: `yam run` is the same command.
      expect((error as Error).message).toContain("first step");
    }
  });

  it("refuses a step id no flow has", () => {
    const dir = runDirectory(["First#1"], "First");
    expect(() =>
      planResume({ runDir: dir, plan: PLAN, order: ORDER, from: "Nowhere#1" }),
    ).toThrow(/no flow in the plan has a step/i);
  });

  it("refuses when checkpoints were never written", () => {
    // `run.checkpoints: false` is a legitimate configuration and makes a run
    // unresumable. Saying so beats reporting the step as missing.
    const dir = runDirectory([], "First");
    expect(() => planResume({ runDir: dir, plan: PLAN, order: ORDER, from: "Second#2" })).toThrow(
      /checkpoints: false|stopped before reaching/,
    );
  });
});

describe("refusing a resume whose artifacts moved (LLD §15, exit 12)", () => {
  it("passes when both hashes match", () => {
    expect(() => verifyResumeHashes(checkpoint({ stepId: "a", story: "s" }), HASHES)).not.toThrow();
  });

  it("names the plan when the plan moved", () => {
    try {
      verifyResumeHashes(checkpoint({ stepId: "a", story: "s" }), {
        ...HASHES,
        planHash: "different",
      });
      expect.unreachable("a changed plan must be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(ResumeMismatchError);
      expect((error as ResumeMismatchError).which).toBe("plan");
      expect((error as Error).message).toContain("plan has changed");
    }
  });

  it("names the bindings when a binding moved", () => {
    try {
      verifyResumeHashes(checkpoint({ stepId: "a", story: "s" }), {
        ...HASHES,
        bindingsHash: "different",
      });
      expect.unreachable("changed bindings must be refused");
    } catch (error) {
      expect((error as ResumeMismatchError).which).toBe("bindings");
      expect((error as Error).message).toContain("bindings have changed");
    }
  });

  it("checks the plan first, since a changed plan makes the step ids meaningless", () => {
    try {
      verifyResumeHashes(checkpoint({ stepId: "a", story: "s" }), {
        planHash: "different",
        bindingsHash: "also different",
      });
      expect.unreachable("must be refused");
    } catch (error) {
      expect((error as ResumeMismatchError).which).toBe("plan");
    }
  });
});

describe("reading a checkpoint back", () => {
  it("round-trips through the file the executor wrote", () => {
    const dir = runDirectory(["Second#1"], "Second");
    const read = readCheckpoint(dir, "Second#1");

    expect(read?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(read?.stepId).toBe("Second#1");
    expect(read?.session.url).toBe("http://app.test/dashboard");
  });

  it("answers `undefined` for a step with no checkpoint", () => {
    // The normal answer while walking backwards, so it cannot be an exception.
    expect(readCheckpoint(runDirectory([], "First"), "First#1")).toBeUndefined();
  });
});
