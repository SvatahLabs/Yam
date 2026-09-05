/**
 * The workflow behavior: a story as a function (REQ-BEH-2, REQ-AUTO-5, LLD §13.2).
 *
 * "`runWorkflow(storyName, inputs, opts)`: builds a one-story run with
 * `behavior: "workflow"`, validates inputs, enables checkpoints and audit,
 * applies policies, returns `{ outputs, summary, runId }`."
 *
 * ## It is the executor, not a second one
 *
 * Everything a workflow needs the executor already does: signatures, guards,
 * checkpoints, abort policies, audit. So this is a *configuration* of `run()` —
 * one story, `behavior: "workflow"`, checkpoints and audit forced on — plus the
 * two things that are the behavior's own: the environment policy (REQ-AUTO-7)
 * and returning the outputs as a value rather than as a line in a summary.
 *
 * That is what makes REQ-BEH-5 true rather than aspirational: "behaviors share
 * one plan; switching behavior never requires recompiling or re-recording". A
 * second runner would be a second set of semantics for `onFailure`, for guards,
 * for what a capture means — and the first time the two disagreed, the plan
 * would mean two different things.
 *
 * ## No model, structurally
 *
 * `workflow` may not import `gateway`, `recorder`, `compiler` or `trajectory`
 * (LLD §1), and the import-boundary lint says so. A workflow run is a replay:
 * whatever the model decided, it decided at authoring time and it is in the
 * files.
 */
import {
  run,
  type RunOptions,
  type RunOutcome,
} from "@svatah/runtime";
import type { Plan, Story } from "@svatah/schema";
import { checkEnvironment, type PolicyOptions } from "./policy.js";

export interface WorkflowOptions extends PolicyOptions {
  /**
   * Everything `run()` needs except what this behavior decides.
   *
   * `behavior`, `stories`, `inputs` and the checkpoint and audit switches are
   * the workflow's own and are set here; the caller supplies the plan, the
   * surface, the resolver and the run directory, exactly as it does for a test
   * run.
   */
  readonly runner: Omit<RunOptions, "behavior" | "stories" | "inputs">;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface WorkflowOutcome {
  readonly runId: string;
  /** The story's declared outputs, by name, coerced to their declared types. */
  readonly outputs: Record<string, unknown>;
  readonly summary: RunOutcome["summary"];
  readonly results: RunOutcome["results"];
  /** Non-zero on failed, healed or aborted, as `run` (REQ-RUN-9). */
  readonly exitCode: number;
}

/**
 * Run one story as a function.
 *
 * Throws `EnvironmentRefusal` before anything opens a session when the
 * environment policy refuses it, and `UnknownStory` when the plan has no such
 * story. Everything else is a *result*: a workflow whose third step failed
 * returns an outcome with a non-zero exit code and the results that say why,
 * because a caller — a CI job, an agent over MCP — needs the record, not a
 * stack trace.
 */
export async function runWorkflow(
  storyName: string,
  options: WorkflowOptions,
): Promise<WorkflowOutcome> {
  const story = storyOf(options.runner.plan, storyName);
  checkEnvironment(story, options.runner.config, options);

  const outcome = await run({
    ...options.runner,
    behavior: "workflow",
    stories: [storyName],
    ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
    /*
     * Checkpoints and audit on, whatever the project's config says (LLD §13.2).
     *
     * A test that is not checkpointed can be re-run from the start; a workflow
     * that booked three of four slots and stopped cannot. And a workflow is by
     * definition doing something to a real system on someone's behalf, so
     * REQ-AUTO-6's record of who asked and what happened is not optional the way
     * it arguably is for a test.
     */
    config: {
      ...options.runner.config,
      run: { ...options.runner.config.run, checkpoints: true, audit: true },
    },
    invoker: options.runner.invoker ?? { kind: "user", id: "local", via: "cli" },
  });

  /*
   * `run()` namespaces a flow's outputs by story, because a flow holds several.
   * A workflow is one story called by name, and its caller asked for *its*
   * outputs — `{ bookingId }`, not `{ "Book a slot.bookingId": … }`.
   */
  const prefix = `${storyName}.`;
  const outputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(outcome.outputs)) {
    outputs[key.startsWith(prefix) ? key.slice(prefix.length) : key] = value;
  }

  return {
    runId: outcome.runId,
    outputs,
    summary: outcome.summary,
    results: outcome.results,
    exitCode: outcome.summary.exitCode,
  };
}

/** The plan has no story by that name (LLD §15, exit 64). */
export class UnknownStory extends Error {
  constructor(
    readonly wanted: string,
    readonly available: readonly string[],
  ) {
    super(
      `No story called "${wanted}". This project has: ${available.join(", ") || "(none)"}.`,
    );
    this.name = "UnknownStory";
  }
}

/** The story, or a message naming the ones that exist. */
export function storyOf(plan: Plan, name: string): Story {
  const story = plan.stories.find((one) => one.name === name);
  if (story === undefined) {
    throw new UnknownStory(
      name,
      plan.stories.map((one) => one.name).sort(),
    );
  }
  return story;
}
