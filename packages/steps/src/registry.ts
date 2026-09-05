/**
 * Matching a sentence against the loaded custom steps (REQ-LANG-16, LLD §5).
 *
 * Tier 0 runs **before** Tier 1, so a project can claim a sentence shape the
 * grammar would otherwise take. That ordering is also what makes REQ-LANG-16
 * necessary: if a sentence matches a custom template *and* a grammar pattern,
 * the compile fails naming both, rather than silently preferring one.
 *
 * The registry cannot see the grammar — `@svatah/steps` depends on `schema` and
 * `surface` and nothing else (LLD §1) — so it answers "does Tier 0 claim this?"
 * and the compiler asks Tier 1 the same question and compares. Two custom
 * templates matching one sentence is a question the registry *can* answer, and
 * it is the same error.
 */
import type { Diagnostic } from "./diagnostics.js";
import { customDiagnostic } from "./diagnostics.js";
import { matchTemplate, type TemplateMatch } from "./template.js";
import type { DefinedStep } from "./define.js";

export interface RegistryMatch {
  readonly step: DefinedStep;
  readonly match: TemplateMatch;
}

export class StepRegistry {
  private readonly steps: DefinedStep[] = [];

  constructor(steps: readonly DefinedStep[] = []) {
    for (const step of steps) this.add(step);
  }

  /**
   * Add a definition.
   *
   * Two definitions with the same template is an author mistake with no sensible
   * resolution: whichever ran would depend on file order. It is reported rather
   * than thrown, because a `steps/` directory is user code and one bad file
   * should not stop the other nine loading.
   */
  add(step: DefinedStep): Diagnostic | undefined {
    const existing = this.steps.find((s) => s.template === step.template);
    if (existing !== undefined) {
      return customDiagnostic(
        "E_STEP_AMBIGUOUS",
        `Two custom steps declare the template "${step.template}": ${existing.id || "?"} and ${step.id || "?"}.`,
        step.id,
      );
    }
    this.steps.push(step);
    return undefined;
  }

  /** Every registered step, in load order. */
  all(): readonly DefinedStep[] {
    return this.steps;
  }

  /** The ids a plan records (`Plan.customSteps`, LLD §3.2). */
  ids(): string[] {
    return this.steps.map((step) => step.id).sort();
  }

  /**
   * Every custom step that matches a sentence.
   *
   * Returns all of them rather than the first, because "two custom steps both
   * claim this sentence" is a diagnostic the caller has to be able to write, and
   * it cannot if it only ever sees one.
   */
  matchAll(sentence: string): RegistryMatch[] {
    const out: RegistryMatch[] = [];
    for (const step of this.steps) {
      const match = matchTemplate(step.compiled, sentence);
      if (match !== undefined) out.push({ step, match });
    }
    return out;
  }

  /**
   * The one custom step that claims a sentence.
   *
   * `ambiguous` carries every claimant so the diagnostic can name them all; the
   * compiler adds the grammar's claim to the same list when Tier 1 also matched
   * (REQ-LANG-16).
   */
  match(
    sentence: string,
  ):
    | { outcome: "none" }
    | { outcome: "one"; match: RegistryMatch }
    | { outcome: "ambiguous"; matches: readonly RegistryMatch[] } {
    const matches = this.matchAll(sentence);
    if (matches.length === 0) return { outcome: "none" };
    if (matches.length === 1) return { outcome: "one", match: matches[0]! };
    return { outcome: "ambiguous", matches };
  }
}
