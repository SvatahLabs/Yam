/**
 * @svatah/yam-workflow
 *
 * The workflow behavior (REQ-BEH-2, REQ-AUTO-3, 5, 7, LLD §13.2): a story with a
 * signature, run as a function.
 *
 * ```ts
 * const { outputs, runId } = await runWorkflow("Book a slot", {
 *   runner: { config, plan, openSurface, resolve, directory },
 *   inputs: { date: "2026-09-03" },
 * });
 * ```
 *
 * It is a configuration of the executor rather than a second one — one story,
 * `behavior: "workflow"`, checkpoints and audit forced on — plus the environment
 * policy, which is the behavior's own: a test against production is a smoke
 * test, and a non-idempotent workflow against production is an accident.
 *
 * `workflow ─► runtime` and nothing else (LLD §1). No model, structurally.
 */
export {
  runWorkflow,
  storyOf,
  UnknownStory,
  type WorkflowOptions,
  type WorkflowOutcome,
} from "./run.js";
export { checkEnvironment, EnvironmentRefusal, type PolicyOptions } from "./policy.js";
