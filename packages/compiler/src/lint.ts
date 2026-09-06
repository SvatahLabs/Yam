/**
 * `yam lint` (REQ-COMP-8, `docs/flow-language.md` §9).
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
import type { Plan, Step, Story } from "@svatah/yam-schema";
import { diagnostic, type Diagnostic } from "@svatah/yam-spec";

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

    out.push(...dialogWarnings(story, file));

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

/**
 * Actions that can put a native dialog in front of the page.
 *
 * `alert`, `confirm` and `prompt` are called from a handler, and these are the
 * four ways a flow reaches one: the three the sample application uses, and
 * `navigate`, which fires `beforeunload`.
 */
const OPENS_A_DIALOG = new Set(["click", "doubleClick", "rightClick", "press", "submit", "navigate"]);

/**
 * Whether this `navigate` can open a dialog.
 *
 * §3.2 lists `navigate` among the openers, and it is one: leaving a page fires
 * `beforeunload`, which can put a dialog up. But the *first* navigation of a
 * story cannot — there is no page to leave — and almost every story starts with
 * one. Counting it would warn on `Go to "/widgets"` in the reference's own
 * examples, which is the opposite of what this warning is for.
 */
function leavesAPage(story: Story, index: number): boolean {
  return story.steps.slice(0, index).some((step) => step.action === "navigate");
}

/**
 * The two dialog warnings (Draft 2.9 LLD §3.2, §4.2, T8.3).
 *
 * A `dialog` step does not *answer* a dialog; it **arms** the answer for the
 * next one the page opens. Written after the click that opens one, it does
 * nothing at all — the dialog has already been accepted by the default — and
 * nothing said so: `Click the Show confirm button` followed by `Dismiss the
 * dialog` left the sample page saying `confirmed`, twice through verification
 * (Phase 6 F4, Phase 7 F3).
 *
 * ## Why the arming is counted rather than merely looked for
 *
 * One `dialog` step arms exactly one dialog. A story that arms once and clicks
 * twice answers the first dialog and defaults the second, which is the same
 * defect one step later, so the walk keeps a count: a `dialog` step adds one, a
 * step that can open a dialog spends one, and a step that opens one with
 * nothing left to spend is the warning.
 *
 * ## Why only stories that mention dialogs
 *
 * Every `click` in every flow can open a dialog in principle, and warning about
 * all of them would be a warning nobody reads. A story with a `dialog` step in
 * it is a story whose author is thinking about dialogs, and that is where the
 * ordering mistake is worth pointing at.
 */
function dialogWarnings(story: Story, file: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const dialogSteps = story.steps.filter((step) => step.action === "dialog");
  if (dialogSteps.length === 0) return out;

  let armed = 0;
  for (const [index, step] of story.steps.entries()) {
    if (step.action === "dialog") {
      armed += 1;
      continue;
    }
    if (!OPENS_A_DIALOG.has(step.action)) continue;
    if (step.action === "navigate" && !leavesAPage(story, index)) continue;
    if (armed > 0) {
      armed -= 1;
      continue;
    }
    out.push(
      diagnostic(
        "W_DIALOG_UNARMED",
        `"${step.text}" can open a dialog and no \`dialog\` step has armed an answer for it, ` +
          "so it would be accepted by default. A `dialog` step arms the *next* dialog: write it " +
          "before the step that opens one (`docs/flow-language.md` pattern 21).",
        { file, line: step.line },
      ),
    );
  }

  /*
   * And the mirror image: an armed answer no step ever collects. Usually the
   * same mistake seen from the other end — the `dialog` step written last —
   * and always a step that does nothing.
   */
  const opens = (step: Step, index: number): boolean =>
    OPENS_A_DIALOG.has(step.action) &&
    (step.action !== "navigate" || leavesAPage(story, index));
  const lastOpener = story.steps.reduce((at, step, index) => (opens(step, index) ? index : at), -1);
  for (const [index, step] of story.steps.entries()) {
    if (step.action !== "dialog" || index < lastOpener) continue;
    out.push(
      diagnostic(
        "W_DIALOG_NEVER_OPENED",
        `"${step.text}" arms an answer for the next dialog, and no later step in "${story.name}" ` +
          "can open one. A `dialog` step written after the click it was meant to answer does " +
          "nothing (`docs/flow-language.md` pattern 21).",
        { file, line: step.line },
      ),
    );
  }

  return out;
}

/** The seconds a `sleep` step waits, when they are a plain number. */
function sleepSeconds(step: Step): number | undefined {
  if (step.action !== "sleep") return undefined;
  const value = step.args?.["seconds"];
  return typeof value === "number" ? value : undefined;
}
