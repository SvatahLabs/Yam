/**
 * @svatah/compiler
 *
 * Tier 1 — the deterministic controlled grammar (REQ-COMP-2, LLD §4.2) — and the
 * pipeline that turns a project's flow files into a plan (T2.5).
 *
 * Tier 0 lives in `@svatah/steps` and is matched first; Tiers 2 and 3 are
 * pluggable and arrive in Phase 4.
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
  renderPlan,
  STABLE_TIMESTAMP,
  type CompileOptions,
  type CompileResult,
} from "./compile.js";
export { validateStory, referencesOf, type ValidateContext } from "./validate.js";
export { lintPlan, DEFAULT_LONG_SLEEP_SECONDS, type LintOptions } from "./lint.js";
export {
  clearTiers,
  hasModelTiers,
  registerTier,
  tierFor,
  type ModelTier,
} from "./tiers.js";
