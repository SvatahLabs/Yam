/**
 * @svatah/runtime
 *
 * The executor core (REQ-RUN-1..13, LLD §8): scope, guards, checkpoints,
 * policies, results, audit — and no model, ever (REQ-RUN-1; the import boundary
 * in LLD §1 makes it structural rather than a promise).
 *
 * Runner-agnostic (REQ-RUN-13). The Playwright Test host calls `runStory` inside
 * a `test()`; `svatah run --host none` calls `run()`. They share every line of
 * what a step *means*, which is what makes REQ-BEH-5 true rather than
 * aspirational.
 *
 * Three things are injected rather than imported, so the dependency graph in
 * LLD §1 stays as drawn (`runtime ─► bindings, surface, schema`): the resolver,
 * the custom-step runner (`@svatah/steps`) and the API runner
 * (`@svatah/adapter-http`). A foreign runtime can supply its own, or say it has
 * none and refuse those plans clearly.
 */
export { run, newRunId, expandRuns, type RunOptions, type RunOutcome } from "./run.js";
export { runStory, signatureOf, type StoryContext, type StoryOutcome } from "./story.js";
export {
  runStep,
  type ApiRunner,
  type CustomStepRunner,
  type Resolver,
  type StepContext,
  type StepOutcome,
  type StoryRunner,
} from "./step.js";
export { Scope, DataError, REDACTED, type ScopeOptions } from "./scope.js";
export { GuardError, classify, messageOf, stackOf } from "./failure.js";
export {
  Auditor,
  MemoryAuditSink,
  type AuditContext,
  type AuditSink,
} from "./audit.js";
export {
  checkpointFor,
  openRunDirectory,
  readCheckpoint,
  abortedByPolicy,
  summarise,
  EXIT,
  type RunDirectory,
} from "./results.js";
export {
  planResume,
  verifyResumeHashes,
  ResumeMismatchError,
  ResumeUnavailableError,
  type Resume,
} from "./resume.js";
export {
  JsonLinesLogger,
  SILENT,
  NO_TRACER,
  clearTracer,
  currentTracer,
  setTracer,
  type LogLine,
  type Logger,
  type Span,
  type Tracer,
} from "./log.js";
