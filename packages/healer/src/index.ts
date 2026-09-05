/**
 * @svatah/healer — module (a)'s repair half (REQ-HEAL-1..6).
 *
 * The healer consumes a run or a set of `bind()` failures, selects the `locator`
 * failures, repairs them by fingerprint relocalization first (no model), verifies
 * each repair by resolving it, and emits a diff plus a report. Plan and flows are
 * never modified (REQ-HEAL-2).
 *
 * It is part of module (a), so it must not depend on the model gateway. The model
 * re-grounding step is therefore a plugin — `Regrounder`, LLD §10 — with a no-op
 * default: module (b) registers the recorder's implementation at CLI start, and
 * module (a) alone runs relocalization and reports the rest as unrepaired.
 */
export {
  heal,
  type HealOptions,
  type HealReport,
  type HealResult,
} from "./heal.js";

export {
  readBindFailures,
  readRunFailures,
  type HealInput,
} from "./failures.js";

export {
  clearReplayer,
  currentReplayer,
  hasReplayer,
  reachedRecordedPage,
  registerReplayer,
  samePath,
  SESSION_STATE_REPLAYER,
  type ReplayOutcome,
  type Replayer,
} from "./replayer.js";

export {
  NO_REGROUNDER,
  registerRegrounder,
  currentRegrounder,
  clearRegrounder,
  hasRegrounder,
  type Regrounder,
  type RegroundRequest,
} from "./regrounder.js";

export { unifiedDiff, unifiedDiffFor, type FileChange } from "./diff.js";
export { renderHealReport, renderHealMarkdown } from "./report.js";
export { renderHealingEvalMarkdown, renderHealingEvalSummary } from "./eval-report.js";

export {
  runHealingEval,
  recordBaseline,
  entryFrom,
  METHOD,
  MODEL_THRESHOLD,
  RELOCALIZE_THRESHOLD,
  type EvalBinding,
  type EvalCase,
  type HealingEvalOptions,
  type HealingEvalReport,
  type VariantResult,
} from "./eval.js";
