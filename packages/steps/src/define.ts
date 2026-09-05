/**
 * `defineStep` — the Tier 0 authoring API (REQ-LANG-15, LLD §5).
 *
 * ```ts
 * import { defineStep } from "@svatah/steps";
 *
 * export default defineStep(
 *   "Transfer {amount:number} from {from:target} to {to:target}",
 *   { sideEffect: true, description: "Moves funds between two accounts" },
 *   async ({ surface, resolve, args }) => { … },
 * );
 * ```
 *
 * The template is compiled here, not at load time, so a malformed one fails when
 * the file is imported — with the template in the message — rather than as a
 * sentence that mysteriously never matches.
 *
 * `meta` is optional; `defineStep(template, handler)` is the common case.
 */
import { compileTemplate, type CompiledTemplate } from "./template.js";
import { CUSTOM_STEP, type CustomStep, type StepArgs, type StepHandler, type StepMeta } from "./types.js";

/** A defined step, plus the compiled template the matcher uses. */
export interface DefinedStep<A extends StepArgs = StepArgs> extends CustomStep<A> {
  readonly compiled: CompiledTemplate;
  /** Set by the loader once it knows where the definition was written. */
  withId(id: string): DefinedStep<A>;
}

export function defineStep<A extends StepArgs = StepArgs>(
  template: string,
  handler: StepHandler<A>,
): DefinedStep<A>;
export function defineStep<A extends StepArgs = StepArgs>(
  template: string,
  meta: StepMeta,
  handler: StepHandler<A>,
): DefinedStep<A>;
export function defineStep<A extends StepArgs = StepArgs>(
  template: string,
  metaOrHandler: StepMeta | StepHandler<A>,
  maybeHandler?: StepHandler<A>,
): DefinedStep<A> {
  const meta: StepMeta = typeof metaOrHandler === "function" ? {} : metaOrHandler;
  const handler = (typeof metaOrHandler === "function" ? metaOrHandler : maybeHandler)!;

  if (typeof handler !== "function") {
    throw new TypeError(`defineStep("${template}") was given no handler.`);
  }

  const compiled = compileTemplate(template);
  return make({ template, meta, handler, compiled, id: "" });
}

function make<A extends StepArgs>(parts: {
  template: string;
  meta: StepMeta;
  handler: StepHandler<A>;
  compiled: CompiledTemplate;
  id: string;
}): DefinedStep<A> {
  const step: DefinedStep<A> = {
    [CUSTOM_STEP]: true,
    template: parts.template,
    meta: parts.meta,
    handler: parts.handler,
    compiled: parts.compiled,
    placeholders: parts.compiled.placeholders,
    id: parts.id,
    withId: (id: string) => make({ ...parts, id }),
  } as DefinedStep<A>;
  return step;
}
