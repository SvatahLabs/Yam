/**
 * Resuming an interrupted run (REQ-AUTO-3, LLD §8.1, T5.1).
 *
 * ```
 * yam run --resume <runId> --from <stepId>
 * ```
 *
 * "Continues a flow from a checkpoint with the same plan and bindings hash;
 * mismatch is refused."
 *
 * ## What `--from` means
 *
 * The step to **start at**. Not the checkpoint to load — a checkpoint is written
 * *after* a step completes, so the one that describes the state `--from` should
 * begin in is the one before it. Finding it is this file's job: walk the flow's
 * steps backwards from `--from` and take the first that has a checkpoint file.
 *
 * That indirection is worth it because it makes `--from step-5` mean what a
 * person reading the run's results means by it. The alternative — `--from` names
 * a checkpoint and the run starts at the step after — reads correctly only to
 * someone who already knows how checkpoints are written.
 *
 * ## Why the hashes are refused rather than warned about
 *
 * A checkpoint is a claim about a plan: "story S is at step 5 and these are its
 * captures". Recompile the flow and step 5 may be a different sentence; re-record
 * a binding and the element the next step clicks may be a different element. The
 * run would continue, produce results, and be wrong in a way nothing downstream
 * could detect. Exit 12 and a message naming which hash moved is the only honest
 * answer (LLD §15).
 */
import type { Checkpoint, Plan, Story } from "@svatah/yam-schema";
import { readCheckpoint } from "./results.js";

/** The plan or the bindings moved under a checkpoint (LLD §15, exit 12). */
export class ResumeMismatchError extends Error {
  constructor(
    message: string,
    /** Which hash moved, for a message that says what to do about it. */
    readonly which: "plan" | "bindings",
    readonly expected: string,
    readonly actual: string,
  ) {
    super(message);
    this.name = "ResumeMismatchError";
  }
}

/** `--resume` was asked for and the run directory cannot support it. */
export class ResumeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeUnavailableError";
  }
}

/** Where a resumed run picks up. */
export interface Resume {
  /** The checkpoint whose state is restored before the first step runs. */
  readonly checkpoint: Checkpoint;
  /** The flow to run; every other flow in the plan is left alone. */
  readonly flow: string;
  /** The story to start in. */
  readonly story: string;
  /** The first step to run, inclusive. */
  readonly from: string;
}

/**
 * Find the checkpoint a `--from` step resumes out of.
 *
 * `order` is the flow's stories in the order the run block gave them, which is
 * how "the step before" is defined across a story boundary: resuming at the
 * first step of the third story picks up the checkpoint the second story's last
 * step wrote.
 */
export function planResume(options: {
  readonly runDir: string;
  readonly plan: Plan;
  readonly order: ReadonlyMap<string, readonly string[]>;
  readonly from: string;
}): Resume {
  const byName = new Map(options.plan.stories.map((story) => [story.name, story]));

  for (const [flow, stories] of options.order) {
    /* Every step of this flow, in the order it would run. */
    const steps: Array<{ story: Story; stepId: string }> = [];
    for (const name of stories) {
      const story = byName.get(name);
      if (story === undefined) continue;
      for (const step of story.steps) steps.push({ story, stepId: step.id });
    }

    const at = steps.findIndex((one) => one.stepId === options.from);
    if (at < 0) continue;

    /*
     * Backwards from the step before `--from`, taking the first checkpoint that
     * exists. Not simply "the previous step": a run stopped by `stop` leaves
     * the steps after the failure `skipped` with no checkpoint, and a run killed
     * mid-step leaves the step it was in without one either.
     */
    for (let index = at - 1; index >= 0; index -= 1) {
      const checkpoint = readCheckpoint(options.runDir, steps[index]!.stepId);
      if (checkpoint === undefined) continue;
      return {
        checkpoint,
        flow,
        story: steps[at]!.story.name,
        from: options.from,
      };
    }

    throw new ResumeUnavailableError(
      `There is no checkpoint before "${options.from}" in ${options.runDir}. ` +
        (at === 0
          ? "It is the first step of the flow, so there is nothing to resume from: " +
            "`yam run` without --resume is the same thing."
          : "The run may have been started with `run.checkpoints: false`, or it stopped " +
            "before reaching this step."),
    );
  }

  throw new ResumeUnavailableError(
    `No flow in the plan has a step "${options.from}". ` +
      "A step id is `<story name>#<n>`, as it appears in `results.jsonl`.",
  );
}

/**
 * Refuse a resume whose artifacts have moved (REQ-AUTO-3, LLD §15).
 *
 * Both hashes, and the plan first, because a changed plan is the one that makes
 * the step ids themselves untrustworthy.
 */
export function verifyResumeHashes(
  checkpoint: Checkpoint,
  current: { planHash: string; bindingsHash: string },
): void {
  if (checkpoint.planHash !== current.planHash) {
    throw new ResumeMismatchError(
      `The plan has changed since run "${checkpoint.runId}" was checkpointed, so its step ids ` +
        "and their meaning cannot be trusted. Re-run from the start, or check out the " +
        `commit the run was made from. (checkpoint ${short(checkpoint.planHash)}, ` +
        `now ${short(current.planHash)})`,
      "plan",
      checkpoint.planHash,
      current.planHash,
    );
  }
  if (checkpoint.bindingsHash !== current.bindingsHash) {
    throw new ResumeMismatchError(
      `The bindings have changed since run "${checkpoint.runId}" was checkpointed, so the ` +
        "elements the remaining steps address may not be the ones it addressed. Re-run from " +
        `the start. (checkpoint ${short(checkpoint.bindingsHash)}, ` +
        `now ${short(current.bindingsHash)})`,
      "bindings",
      checkpoint.bindingsHash,
      current.bindingsHash,
    );
  }
}

function short(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}
