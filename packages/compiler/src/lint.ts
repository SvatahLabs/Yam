/**
 * `svatah lint` (REQ-COMP-8, `docs/flow-language.md` §9).
 *
 * "Reports ambiguous targets, Tier 2/3 steps, low confidence, unused captures,
 * sleeps over 5 s, side-effecting steps in stories not marked `idempotent` when
 * used as tools."
 *
 * Everything here is a *warning*. Lint says what a person should look at; the
 * compile's errors say what cannot run. Keeping the two apart is what lets a
 * project turn lint on in CI without the whole team being blocked by a phrase
 * that happens to name two elements.
 *
 * Ambiguous targets and unused captures are produced during compilation and
 * validation, where the context to produce them exists; this file holds the ones
 * that need the finished plan.
 */
import type { Plan, Step, Story } from "@svatah/schema";
import { diagnostic, type Diagnostic } from "@svatah/spec";

export interface LintOptions {
  /** `config.compile.confidenceThreshold`. */
  readonly confidenceThreshold?: number;
  /** Sleeps longer than this are reported. REQ-COMP-8 names 5 seconds. */
  readonly longSleepSeconds?: number;
  /** Stories `config.tool.expose` names, for the idempotency warning. */
  readonly exposedAsTools?: readonly string[];
  readonly file?: (story: Story) => string;
}

export const DEFAULT_LONG_SLEEP_SECONDS = 5;

/** The warnings that need the whole plan. */
export function lintPlan(plan: Plan, options: LintOptions = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  const threshold = options.confidenceThreshold ?? 0;
  const longSleep = options.longSleepSeconds ?? DEFAULT_LONG_SLEEP_SECONDS;
  const exposed = new Set(options.exposedAsTools ?? []);

  for (const story of plan.stories) {
    const file = options.file?.(story) ?? story.file;

    for (const step of story.steps) {
      const where = { file, line: step.line };

      if (step.origin.tier === 2) {
        out.push(
          diagnostic("W_TIER2", `Compiled by the local model, not by the grammar: "${step.text}".`, where),
        );
      }
      if (step.origin.tier === 3) {
        out.push(
          diagnostic("W_TIER3", `Compiled by the frontier model: "${step.text}".`, where),
        );
      }
      if (step.origin.tier === 0) {
        // Not a problem — a custom step is the escape hatch working. It is
        // reported so a reviewer knows which steps are project code rather than
        // grammar (LLD §5: "lint records W_CUSTOM for visibility").
        out.push(
          diagnostic(
            "W_CUSTOM",
            `Custom step ${step.custom?.id ?? "?"}: "${step.text}".`,
            where,
          ),
        );
      }
      if (step.origin.confidence < threshold) {
        out.push(
          diagnostic(
            "W_LOW_CONFIDENCE",
            `Confidence ${step.origin.confidence.toFixed(2)} is below the configured ${threshold.toFixed(2)}: "${step.text}".`,
            where,
          ),
        );
      }

      const seconds = sleepSeconds(step);
      if (seconds !== undefined && seconds > longSleep) {
        out.push(
          diagnostic(
            "W_LONG_SLEEP",
            `A ${seconds}-second sleep. A sleep is a guess about timing; ` +
              "`Wait for <target> to be visible` waits for the thing that actually has to happen.",
            where,
          ),
        );
      }
    }

    if (exposed.has(story.name) && story.meta.idempotent !== true) {
      const offending = story.steps.filter((step) => step.sideEffect === true);
      if (offending.length > 0) {
        out.push(
          diagnostic(
            "W_SIDE_EFFECT_TOOL",
            `"${story.name}" is exposed as a tool and has ${offending.length} step(s) with side ` +
              `effects (line ${offending.map((s) => s.line).join(", ")}), but is not marked ` +
              "`idempotent`. An agent may call a tool more than once (REQ-AUTO-8).",
            { file, line: 0 },
          ),
        );
      }
    }
  }

  return out;
}

/** The seconds a `sleep` step waits, when they are a plain number. */
function sleepSeconds(step: Step): number | undefined {
  if (step.action !== "sleep") return undefined;
  const value = step.args?.["seconds"];
  return typeof value === "number" ? value : undefined;
}
