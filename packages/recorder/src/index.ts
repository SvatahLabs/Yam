/**
 * @svatah/recorder
 *
 * Grounding, the record session, and the record report (T3.2, T3.3, LLD §11).
 *
 * The recorder is what turns a plan's `unbound` targets into bindings, by
 * driving the plan on a real platform and asking a model — once, per element —
 * which element a phrase names. Everything after the model's answer is
 * model-free: synthesis proposes candidates, the surface verifies them, and the
 * step is actually performed before a binding is called verified.
 *
 * It is also the implementation module (b) registers behind two of module (a)'s
 * plugins: the healer's `Regrounder` (LLD §10) and `bind()`'s record mode
 * (LLD §6.5), so a project that has the flow language installed heals and
 * records with a model, and one that does not stays model-free.
 */
export {
  assertRecordable,
  DEFAULT_MAX_SNAPSHOT_TOKENS,
  DEFAULT_MIN_CONFIDENCE,
  EnvironmentRefused,
  ground,
  type GroundingDecision,
  type GroundingResult,
  type GroundingTarget,
  type GroundOptions,
} from "./ground.js";

export {
  groundingAnswerSchema,
  PROMPT_VERSION,
  question,
  SYSTEM,
  type GroundingAnswer,
  type GroundingQuestionParts,
} from "./prompt.js";

export { prune, STRUCTURAL_ROLES, type PrunedSnapshot, type PruneOptions } from "./prune.js";

export {
  record,
  storyOrder,
  type RecordedStep,
  type RecordReport,
  type RecordSessionOptions,
} from "./session.js";

export { renderReport, reportJson } from "./report.js";

export {
  phraseFromId,
  recorderBindGrounder,
  recorderRegrounder,
  type PluginOptions,
} from "./plugins.js";
