/**
 * @svatah/healer — module (a)'s repair half (REQ-HEAL-1..6).
 *
 * The healer consumes a run or a set of bind-failures, selects the `locator`
 * failures, repairs them by fingerprint relocalization first (no model), verifies
 * each repair by re-running, and emits a diff plus a report. Plan and flows are
 * never modified (REQ-HEAL-2).
 *
 * It is part of module (a), so it must not depend on the model gateway. The model
 * re-grounding step is therefore a plugin — `Regrounder`, LLD §10 — with a no-op
 * default; module (b) registers the recorder's implementation at CLI start, and
 * module (a) alone runs relocalization only and reports the rest as unrepaired.
 */
export {
  runHealingEval,
  recordBaseline,
  entryFrom,
  METHOD,
  RELOCALIZE_THRESHOLD,
  type EvalBinding,
  type EvalCase,
  type HealingEvalOptions,
  type HealingEvalReport,
  type VariantResult,
} from "./eval.js";
