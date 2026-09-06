/**
 * @svatah/yam-trajectory
 *
 * An agent's exploration over the surface, captured and — from T5.5 — compiled
 * into a story draft, a plan fragment and `verified: false` bindings under
 * `proposals/` (REQ-BEH-4, LLD §13.4).
 *
 * Phase 4 built the capture half (T4.6): the MCP raw-surface tools require an
 * `intent` per call, and `TrajectoryWriter` is the file they write. T5.5 adds
 * the compile half.
 *
 * ```ts
 * const compiled = compileTrajectory(readTrajectory("runs/x/trajectory.jsonl"));
 * writeProposal("proposals", compiled);   // and nowhere else
 * ```
 *
 * No model. Candidates and fingerprints come from the `describe()` captured at
 * the moment of each call; the sentences come from the action the call performed
 * and the element it acted on, with the agent's own intent kept above the step
 * and used verbatim in a `// review:` comment when nothing could be phrased.
 */
export {
  compileTrajectory,
  writeProposal,
  type CompiledTrajectory,
  type CompileTrajectoryOptions,
} from "./compile.js";
export {
  captureNameFor,
  draftFor,
  phraseFor,
  sentenceForAct,
  sentenceForCheck,
  sentenceForRead,
  type DraftStep,
} from "./sentence.js";
export {
  checkTrajectory,
  readTrajectory,
  trajectoryCallSchema,
  trajectoryLineSchema,
  TrajectoryWriter,
  type TrajectoryCall,
  type TrajectoryLine,
} from "./capture.js";
