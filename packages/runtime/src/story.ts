/**
 * Running one story, and applying a policy when a step fails
 * (REQ-RUN-4, REQ-AUTO-4, 5, LLD §8.1, §8.3).
 *
 * ```
 * runStory(story, inputs?):
 *   validate inputs against story.signature; scope.enterStory(story, inputs)
 *   for step in story.steps:
 *      if flowState.stopped → record skipped; continue
 *      r = runStep(step)
 *      if r.failed → applyPolicy(story.meta.onFailure)
 *   outputs = scope.collectOutputs(story.signature)
 * ```
 *
 * ## The policies, and why the default is `stop`
 *
 * `stop` — the flow stops and everything after it is `skipped`. That is the
 * default because a step failing usually means the application is not in the
 * state the next step assumes, and running the rest produces a screen of
 * failures with one cause somewhere in it.
 *
 * `continue` — the *story* stops and the next one runs. For a suite where
 * stories are independent.
 *
 * `compensate:<story>` — run the named story with the current scope, then stop
 * the flow. The compensating story sees what the failing one captured, which is
 * how it can cancel the booking whose id the failing story remembered
 * (REQ-AUTO-4).
 */
import type { Signature, Step, StepResult, Story } from "@svatah/schema";
import type { Scope } from "./scope.js";
import { messageOf } from "./failure.js";
import { runStep, type StepContext } from "./step.js";

export interface StoryOutcome {
  readonly results: readonly StepResult[];
  readonly outputs: Record<string, unknown>;
  readonly status: "passed" | "failed" | "aborted";
  /** True when the policy stopped the whole flow, not just this story. */
  readonly flowStopped: boolean;
}

export interface StoryContext extends Omit<StepContext, "scope"> {
  readonly scope: Scope;
  readonly runId: string;
  readonly behavior: StepResult["behavior"];
  readonly flow: string;
  /** Written after each step when `config.run.checkpoints` is on (REQ-AUTO-2). */
  readonly checkpoint?: (step: Step) => Promise<void>;
  /** Reports each result as it happens, for a live event stream (REQ-ADE-1). */
  readonly onResult?: (result: StepResult) => void;
  /** Runs the compensating story named by a policy. */
  readonly compensate?: (story: string) => Promise<readonly StepResult[]>;
  /**
   * Skip every step before this one (REQ-AUTO-3, T5.1).
   *
   * Skipped, not recorded as `skipped`: a resumed run's `results.jsonl` holds
   * what *this* run did, and the steps before the resume point were done by the
   * run being resumed. Recording them again — with a status, a duration, and a
   * timestamp from now — would put two accounts of one step in one file.
   */
  readonly startAt?: string;
  readonly audit?: {
    story(name: string, detail?: unknown): void;
    outputs(name: string, outputs: Readonly<Record<string, unknown>>): void;
    policy(name: string, stepId: string, detail: unknown): void;
  };
}

export async function runStory(
  story: Story,
  inputs: Readonly<Record<string, unknown>>,
  context: StoryContext,
): Promise<StoryOutcome> {
  const results: StepResult[] = [];
  const { scope } = context;

  const emit = (result: StepResult): void => {
    results.push(result);
    context.onResult?.(result);
  };

  /* Inputs are validated before anything runs: a story with a signature is a
     function, and a function with the wrong arguments should not half-execute
     (REQ-AUTO-5). */
  let validated: Record<string, unknown>;
  try {
    validated = scope.validateInputs(story.name, story.signature, inputs);
  } catch (error) {
    const at = new Date().toISOString();
    emit({
      runId: context.runId,
      behavior: context.behavior,
      flow: context.flow,
      story: story.name,
      stepId: `${story.name}#0`,
      line: story.steps[0]?.line ?? 1,
      text: `inputs of "${story.name}"`,
      status: "failed",
      startedAt: at,
      endedAt: at,
      durationMs: 0,
      failure: { class: "data", message: messageOf(error) },
    });
    return { results, outputs: {}, status: "failed", flowStopped: true };
  }

  scope.enterStory(story.name, validated);
  context.audit?.story(story.name, { inputs: validated });

  /*
   * A resumed story starts partway through (T5.1). The steps before the resume
   * point already ran, in the run being resumed; their captures came back with
   * the checkpoint.
   */
  const start = context.startAt === undefined ? 0 : story.steps.findIndex((s) => s.id === context.startAt);
  if (start < 0) {
    const at = new Date().toISOString();
    emit({
      runId: context.runId,
      behavior: context.behavior,
      flow: context.flow,
      story: story.name,
      stepId: `${story.name}#0`,
      line: story.steps[0]?.line ?? 1,
      text: `resume "${story.name}"`,
      status: "failed",
      startedAt: at,
      endedAt: at,
      durationMs: 0,
      failure: {
        class: "data",
        message: `"${story.name}" has no step "${context.startAt}" to resume from.`,
      },
    });
    scope.leaveStory();
    return { results, outputs: {}, status: "failed", flowStopped: true };
  }

  /*
   * A failing step's result is held back until the policy is decided, because
   * the policy goes *on* that result (`failure.policyApplied`, LLD §8.3) and a
   * result is emitted once. One step's delay, and only on failure.
   */
  let pending: StepResult | undefined;
  let failedStep: Step | undefined;
  let stopped = false;
  /** Held with the failure, so the results read in step order. */
  const afterwards: StepResult[] = [];

  for (const step of story.steps.slice(start)) {
    if (stopped) {
      afterwards.push(skipped(step, story, context));
      continue;
    }

    const startedAt = new Date();
    const outcome = await runStep(step, context);
    const endedAt = new Date();

    const result: StepResult = {
      runId: context.runId,
      behavior: context.behavior,
      flow: context.flow,
      story: story.name,
      stepId: step.id,
      line: step.line,
      text: step.text,
      status: outcome.status,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      ...(outcome.matched === undefined ? {} : { matched: outcome.matched }),
      ...(outcome.captured === undefined ? {} : { captured: scope.redact(outcome.captured) }),
      ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
    };

    if (outcome.status === "failed") {
      pending = result;
      failedStep = step;
      stopped = true;
      continue;
    }

    emit(result);
    if (context.checkpoint !== undefined) await context.checkpoint(step);
  }

  if (failedStep === undefined) {
    let outputs: Record<string, unknown> = {};
    try {
      outputs = scope.collectOutputs(story.name, story.signature);
    } catch (error) {
      const at = new Date().toISOString();
      emit({
        runId: context.runId,
        behavior: context.behavior,
        flow: context.flow,
        story: story.name,
        stepId: `${story.name}#outputs`,
        line: story.steps[story.steps.length - 1]?.line ?? 1,
        text: `outputs of "${story.name}"`,
        status: "failed",
        startedAt: at,
        endedAt: at,
        durationMs: 0,
        failure: { class: "data", message: messageOf(error) },
      });
      scope.leaveStory();
      return { results, outputs: {}, status: "failed", flowStopped: true };
    }
    context.audit?.outputs(story.name, outputs);
    scope.leaveStory();
    return { results, outputs, status: "passed", flowStopped: false };
  }

  /* ── the policy ─────────────────────────────────────────────────────────── */

  const policy = story.meta.onFailure;
  context.audit?.policy(story.name, failedStep.id, { policy });
  emit({
    ...pending!,
    failure: { ...pending!.failure!, policyApplied: policy },
  });
  for (const result of afterwards) emit(result);

  if (policy === "continue") {
    scope.leaveStory();
    return { results, outputs: {}, status: "failed", flowStopped: false };
  }

  if (typeof policy === "object") {
    // The compensating story runs with the current scope — it has to see what
    // the failing story captured, or it cannot cancel what was created
    // (REQ-AUTO-4). Then the flow stops regardless.
    const compensating = await context.compensate?.(policy.compensate);
    for (const result of compensating ?? []) emit(result);
    scope.leaveStory();
    return { results, outputs: {}, status: "aborted", flowStopped: true };
  }

  scope.leaveStory();
  return { results, outputs: {}, status: "failed", flowStopped: true };
}

/** A step that never ran because an earlier one failed (REQ-RUN-4). */
function skipped(step: Step, story: Story, context: StoryContext): StepResult {
  const at = new Date().toISOString();
  return {
    runId: context.runId,
    behavior: context.behavior,
    flow: context.flow,
    story: story.name,
    stepId: step.id,
    line: step.line,
    text: step.text,
    status: "skipped",
    startedAt: at,
    endedAt: at,
    durationMs: 0,
  };
}

/** A story's signature, for the runner's own validation. */
export function signatureOf(story: Story): Signature | undefined {
  return story.signature;
}
