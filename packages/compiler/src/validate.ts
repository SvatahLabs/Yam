/**
 * Validation over a compiled story (REQ-COMP-6, REQ-AUTO-5, LLD §8.5).
 *
 * "Every reference is defined earlier by order; inputs without defaults must be
 * supplied at run; outputs must be captured. Violations are compile errors."
 *
 * **Earlier by order** is the load-bearing phrase. A capture read before the step
 * that makes it is not a value that happens to be missing — it is a story that
 * cannot work, and finding that at compile time rather than three minutes into a
 * run is most of what a compiler is for here.
 *
 * The check walks a story's steps in order and carries the set of names defined
 * so far, which is exactly what the executor's scope will hold at that point.
 */
import type { Signature, Step, ValueRef } from "@svatah/schema";
import { diagnostic, type Diagnostic } from "@svatah/spec";

export interface ValidateContext {
  readonly file: string;
  readonly storyName: string;
  readonly signature?: Signature;
  /** Captures of other stories in the project: story name → names. */
  readonly otherStories: ReadonlyMap<string, ReadonlySet<string>>;
  /** Run data paths that exist, so `{data.x}` can be checked. */
  readonly dataPaths: ReadonlySet<string>;
  /** Story names that exist, for `invoke` and its inputs. */
  readonly stories: ReadonlyMap<string, Signature | undefined>;
  /** Named `api/*.yaml` requests, for `api` steps. */
  readonly apis: ReadonlySet<string>;
}

/** Every `ValueRef` a step reads, wherever it sits. */
export function referencesOf(step: Step): ValueRef[] {
  const out: ValueRef[] = [];
  const add = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    const ref = value as ValueRef;
    if (typeof (ref as { kind?: unknown }).kind === "string") {
      out.push(ref);
      if (ref.kind === "template") for (const part of ref.parts) add(part);
      return;
    }
  };

  for (const value of Object.values(step.args ?? {})) add(value);
  for (const value of Object.values(step.invoke?.inputs ?? {})) add(value);
  for (const value of Object.values(step.custom?.params ?? {})) add(value);
  for (const clause of [step.guard, step.expect]) {
    if (clause === undefined) continue;
    const predicate = clause.predicate as Record<string, unknown>;
    add(predicate["value"]);
    add(predicate["left"]);
    add(predicate["right"]);
  }
  return out;
}

/**
 * Validate one story's steps.
 *
 * Returns diagnostics only; the steps are not modified. A story with errors
 * still appears in the plan so that a partial compile can be inspected — the
 * exit code is what stops a broken plan being run (LLD §15).
 */
export function validateStory(
  steps: readonly Step[],
  context: ValidateContext,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const inputs = new Set(Object.keys(context.signature?.inputs ?? {}));
  /** Names captured so far, in step order. */
  const captured = new Set<string>();
  /** Names read, so an unused capture can be reported (REQ-COMP-8). */
  const read = new Set<string>();

  for (const step of steps) {
    const where = { file: context.file, line: step.line };

    for (const reference of referencesOf(step)) {
      switch (reference.kind) {
        case "input":
          if (!inputs.has(reference.name)) {
            diagnostics.push(
              diagnostic(
                "E_VAR_UNDEFINED",
                `{input.${reference.name}} is not an input of "${context.storyName}". ` +
                  (inputs.size === 0
                    ? "The story declares no inputs; add an `inputs:` line under its header."
                    : `It declares: ${[...inputs].sort().join(", ")}.`),
                where,
              ),
            );
          }
          break;

        case "data":
          if (context.dataPaths.size > 0 && !context.dataPaths.has(reference.path)) {
            diagnostics.push(
              diagnostic(
                "E_VAR_UNDEFINED",
                `{data.${reference.path}} is not in the run data.`,
                where,
              ),
            );
          }
          break;

        case "var": {
          if (reference.story !== undefined) {
            const other = context.otherStories.get(reference.story);
            if (other === undefined) {
              diagnostics.push(
                diagnostic(
                  "E_UNKNOWN_STORY",
                  `{${reference.story}.${reference.name}} names a story that does not exist.`,
                  where,
                ),
              );
            } else if (!other.has(reference.name)) {
              diagnostics.push(
                diagnostic(
                  "E_VAR_UNDEFINED",
                  `"${reference.story}" captures no "${reference.name}".`,
                  where,
                ),
              );
            }
            read.add(`${reference.story}.${reference.name}`);
            break;
          }
          if (!captured.has(reference.name) && !inputs.has(reference.name)) {
            diagnostics.push(
              diagnostic(
                "E_VAR_UNDEFINED",
                `{${reference.name}} is read before anything captures it. ` +
                  "A name has to be captured by an earlier step in the same story, or be one of its inputs.",
                where,
              ),
            );
          }
          read.add(reference.name);
          break;
        }

        case "literal":
        case "template":
          break;
      }
    }

    if (step.action === "invoke" && step.invoke !== undefined) {
      diagnostics.push(...validateInvoke(step, context, where));
    }

    if (step.action === "api" && step.args?.["request"] !== undefined) {
      const request = step.args["request"];
      const name =
        typeof request === "object" && request !== null && (request as ValueRef).kind === "literal"
          ? (request as { value: string }).value
          : undefined;
      if (name !== undefined && context.apis.size > 0 && !context.apis.has(name)) {
        diagnostics.push(
          diagnostic(
            "E_UNKNOWN_API",
            `There is no API request named "${name}". Add \`api/${name.replace(/\s+/g, "-")}.yaml\`, ` +
              `or check the name: the project has ${[...context.apis].sort().map((a) => `"${a}"`).join(", ")}.`,
            where,
          ),
        );
      }
    }

    if (step.capture !== undefined) {
      if (captured.has(step.capture.name)) {
        diagnostics.push(
          diagnostic(
            "E_VAR_REDEFINED",
            `"${step.capture.name}" is captured twice. A name is never reassigned (LLD §8.5); ` +
              "capture the second one under a different name.",
            where,
          ),
        );
      }
      captured.add(step.capture.name);
    }
  }

  diagnostics.push(...validateOutputs(context, captured));

  // An unused capture is a warning, not an error: it is usually a step someone
  // kept for its side effect, and sometimes a name they meant to read.
  for (const name of captured) {
    if (read.has(name)) continue;
    if (context.signature?.outputs[name] !== undefined) continue;
    const step = steps.find((s) => s.capture?.name === name);
    diagnostics.push(
      diagnostic(
        "W_UNUSED_CAPTURE",
        `"${name}" is captured and never read.`,
        { file: context.file, line: step?.line ?? 0 },
      ),
    );
  }

  return diagnostics;
}

function validateInvoke(
  step: Step,
  context: ValidateContext,
  where: { file: string; line: number },
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const invoke = step.invoke!;

  if (!context.stories.has(invoke.story)) {
    out.push(
      diagnostic("E_UNKNOWN_STORY", `Run the "${invoke.story}" story: there is no such story.`, where),
    );
    return out;
  }

  const signature = context.stories.get(invoke.story);
  const declared = signature?.inputs ?? {};

  for (const name of Object.keys(invoke.inputs)) {
    if (declared[name] === undefined) {
      out.push(
        diagnostic(
          "E_VAR_UNDEFINED",
          `"${invoke.story}" has no input "${name}".` +
            (Object.keys(declared).length === 0
              ? " It declares no inputs at all."
              : ` It declares: ${Object.keys(declared).sort().join(", ")}.`),
          where,
        ),
      );
    }
  }

  // REQ-COMP-6: an input without a default must be supplied. At an `invoke` the
  // supplier is the calling step, so the check is possible here rather than only
  // at run time (REQ-AUTO-5).
  for (const [name, input] of Object.entries(declared)) {
    if (invoke.inputs[name] !== undefined) continue;
    if ("default" in input) continue;
    out.push(
      diagnostic(
        "E_INPUT_REQUIRED",
        `"${invoke.story}" needs an input "${name}" and this step does not supply one. ` +
          "Pass it, or give the input a default in the story's signature.",
        where,
      ),
    );
  }

  if (step.capture?.from === "output") {
    const outputs = signature?.outputs ?? {};
    if (Object.keys(outputs).length === 0) {
      out.push(
        diagnostic(
          "E_VAR_UNDEFINED",
          `"${invoke.story}" declares no outputs, so there is nothing to remember.`,
          where,
        ),
      );
    }
  }

  return out;
}

/** REQ-LANG-13: "Outputs must be captured names." */
function validateOutputs(context: ValidateContext, captured: ReadonlySet<string>): Diagnostic[] {
  const outputs = context.signature?.outputs ?? {};
  const out: Diagnostic[] = [];
  for (const name of Object.keys(outputs)) {
    if (captured.has(name)) continue;
    out.push(
      diagnostic(
        "E_OUTPUT_UNCAPTURED",
        `"${context.storyName}" declares an output "${name}" that no step captures. ` +
          "An output is a captured name; add a step that remembers it, or drop it from the signature.",
        { file: context.file, line: 0 },
      ),
    );
  }
  return out;
}
