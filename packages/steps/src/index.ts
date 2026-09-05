/**
 * @svatah/steps
 *
 * Tier 0 custom typed steps (REQ-LANG-15, 16, LLD §5): the `defineStep`
 * authoring API, the template compiler, the loader for a project's `steps/`
 * directory, and the matcher that runs ahead of the Tier 1 grammar.
 *
 * The handler contract is the part worth reading: a `StepContext` exposes the
 * published surface, the resolver, the scope, an expectation helper and audit —
 * and no adapter. A custom step that reached the adapter would be a step no
 * other adapter could run, which would break the one promise the whole design
 * rests on.
 */
export { defineStep, type DefinedStep } from "./define.js";
export {
  compileTemplate,
  matchTemplate,
  TemplateError,
  type CompiledTemplate,
  type TemplateMatch,
} from "./template.js";
export { StepRegistry, type RegistryMatch } from "./registry.js";
export { loadSteps, type LoadResult } from "./loader.js";
export { emitCustom, type EmitOptions, type EmittedCustom, type TargetResolver, type ValueParser } from "./emit.js";
export { customDiagnostic, type Diagnostic } from "./diagnostics.js";
export {
  isCustomStep,
  t,
  CUSTOM_STEP,
  PLACEHOLDER_TYPES,
  type CustomStep,
  type Placeholder,
  type PlaceholderType,
  type StepArgs,
  type StepContext,
  type StepHandler,
  type StepMeta,
  type StepScope,
} from "./types.js";
