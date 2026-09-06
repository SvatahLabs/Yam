/**
 * @svatah/yam-compiler
 *
 * Tier 1 — the deterministic controlled grammar (REQ-COMP-2, LLD §4.2) — and the
 * pipeline that turns a project's flow files into a plan (T2.5).
 *
 * Tier 0 lives in `@svatah/yam-steps` and is matched first. Tiers 2 and 3 are
 * pluggable: the compiler declares the interface and defaults to nothing, which
 * is what keeps `compile` offline unless a project asks otherwise (REQ-NFR-3)
 * and keeps this package free of a dependency on the model gateway. `@svatah/yam`
 * registers them (T4.3, T4.4).
 */
export { parseSentence, parseGuard, type Tier1Result } from "./tier1.js";
export { checkSigils, RETIRED_FORMS } from "./sigils.js";
export {
  lowerStep,
  lowerValue,
  SIDE_EFFECT_WORDS,
  type LowerContext,
  type StepIdentity,
} from "./lower.js";
export type { RawPredicate, RawStep, RawTarget, RawValue } from "./raw.js";
export {
  compile,
  compileSentence,
  compileWithModelTiers,
  renderPlan,
  sentenceKey,
  STABLE_TIMESTAMP,
  type CompileOptions,
  type CompileResult,
  type ModelTierOptions,
} from "./compile.js";
export { validateStory, referencesOf, type ValidateContext } from "./validate.js";
export { lintPlan, DEFAULT_LONG_SLEEP_SECONDS, type LintOptions } from "./lint.js";
export {
  clearTiers,
  hasModelTiers,
  registerTier,
  tierFor,
  type ModelTier,
  type ModelTierAnswer,
  type SentenceContext,
} from "./tiers.js";

export {
  comparable,
  goldenEntrySchema,
  materialise,
  readGolden,
  scoreCase,
  summarise,
  GOLDEN_PROVENANCE,
  type CaseResult,
  type EvalReport,
  type GoldenEntry,
} from "./eval.js";

export {
  modelStepSchema,
  rawValueSchema,
  toRawStep,
  type ModelStep,
  type ModelValue,
} from "./raw-schema.js";
