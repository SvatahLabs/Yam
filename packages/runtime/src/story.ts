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
 *
 * ## What `aborted` is a status of
 *
 * The flow and the run, not the steps (LLD §8.3, Draft 2.7). A compensating
 * story's steps are recorded with their own statuses — `passed`, `failed`,
 * `skipped` — because the question a reader has about a compensation is
 * whether it worked, and re-labelling every one of them `aborted` erased the
 * answer. The failing step carries `failure.policyApplied`, which is what says
 * a compensation happened and is what `abortedByPolicy` reads.
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
  /**
   * Called with each step *before* it runs (REQ-AUTO-6).
   *
   * The audit attributes every surface call to a step, and the only moment at
   * which the right step is known is before the call happens. Deriving it from
   * the last *result* instead labelled each step's calls with the previous
   * step's id — which made "the audit shows no surface call for the guarded
   * step" (T5.4) unanswerable, because the calls attributed to it were the next
   * step's.
   */
  readonly onStep?: (step: Step) => void;
  /** Runs the compensating story named by a policy. */
  readonly compensate?: (story: string) => Promise<readonly StepResult[]>;
  /**
   * Somebody asked for this run to stop (Draft 2.12 §13.5, T10.4).
   *
   * Checked **between** steps and never during one: a step that is halfway
   * through a `click` has already changed the application, and a runtime that
   * tore down a session mid-action would leave a state no result describes.
   * The remaining steps are recorded `skipped`, exactly as a policy's are —
   * what says a person did it is the `stop` audit line and `summary.stopped`.
   */
  readonly stopRequested?: () => boolean;
  /** Called once, with the step the stop was noticed after. */
  readonly onStopped?: (where: { story: string; stepId?: string }) => void;
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
    dialog(
      name: string,
      stepId: string,
      answered: { type: string; message: string; armed: boolean; answer: "accept" | "dismiss" },
    ): void;
  };
}

/**
 * The dialogs an adapter answered since the last step, when it keeps a log.
 *
 * Duck-typed, like the conformance suite's `bridgeCost()`: `AgentSurface`
 * (LLD §2) has no dialog-event channel, and widening the published surface for
 * an audit line would be widening a standard for a diagnostic. An adapter that
 * does not keep one simply produces no lines.
 */
function drainDialogs(
  context: StoryContext,
): ReadonlyArray<{ type: string; message: string; armed: boolean; answer: "accept" | "dismiss" }> {
  const log = (
    context.surface as unknown as {
      dialogLog?: () => ReadonlyArray<{
        type: string;
        message: string;
        armed: boolean;
        answer: "accept" | "dismiss";
      }>;
    }
  ).dialogLog;
  if (typeof log !== "function") return [];
  try {
    return log.call(context.surface);
  } catch {
    return [];
  }
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
  /** The last step that actually ran, so a stop line can name it. */
  let lastStepId: string | undefined;
  /** Held with the failure, so the results read in step order. */
  const afterwards: StepResult[] = [];

  /** True when the *policy* stopped the flow; a person stopping it is below. */
  let byRequest = false;

  for (const step of story.steps.slice(start)) {
    if (stopped) {
      afterwards.push(skipped(step, story, context));
      continue;
    }

    /*
     * Between steps, before the next one starts (T10.4). A step already under
     * way is left alone: it has touched the application, and its result is the
     * only account of what it did.
     */
    if (context.stopRequested?.() === true) {
      byRequest = true;
      stopped = true;
      context.onStopped?.({ story: story.name, ...(lastStepId === undefined ? {} : { stepId: lastStepId }) });
      afterwards.push(skipped(step, story, context));
      continue;
    }

    context.onStep?.(step);
    const startedAt = new Date();
    const outcome = await runStep(step, context);
    const endedAt = new Date();

    /*
     * Dialogs the adapter answered while this step ran (Draft 2.9 §3.2, T8.3).
     *
     * Drained here rather than written by the adapter, because the adapter has
     * no run id, no story and no step — and a dialog answered by default is
     * only legible if it can be attributed to the step that opened one.
     */
    for (const answered of drainDialogs(context)) {
      context.audit?.dialog(story.name, step.id, answered);
    }

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
    lastStepId = step.id;
    if (context.checkpoint !== undefined) await context.checkpoint(step);
  }

  /*
   * Stopped by request, with nothing failed: the steps that never started are
   * `skipped` and the flow stops. It is not `failed` — nothing about the
   * application went wrong — and it is not `passed`, because the story did not
   * finish. `summary.stopped` is what a reader looks at (Draft 2.12 §13.5).
   */
  if (byRequest && failedStep === undefined) {
    for (const result of afterwards) emit(result);
    scope.leaveStory();
    return { results, outputs: {}, status: "failed", flowStopped: true };
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
