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
