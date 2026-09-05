/**
 * The compiler pipeline (REQ-COMP-1, 5, 6, 7, T2.5, LLD §4).
 *
 * Project in, `plan.json` out:
 *
 * 1. every sentence through Tier 0, then Tier 1, then the model tiers if any are
 *    registered — first claimant wins, two claimants is `E_STEP_AMBIGUOUS`;
 * 2. phrases resolved to element ids through the dictionary, `{data.…}` marked
 *    secret where the data file says so (`lower.ts`);
 * 3. references, inputs, outputs and invokes validated in step order
 *    (`validate.ts`);
 * 4. the plan assembled canonically, so two compiles of the same input are the
 *    same bytes (REQ-COMP-7).
 *
 * ## Byte-stability
 *
 * `generatedAt` is the only field that could differ between two compiles of one
 * input, and `--stable` fixes it. Everything else is derived: step ids are
 * positional, the dictionary is sorted, and the hash is over the canonical JSON
 * of the plan without its own hash. That is what makes `plan.json` reviewable in
 * a pull request and what lets `--resume` refuse a plan that has changed
 * (REQ-AUTO-3).
 */
import {
  canonicalJson,
  planHash,
  SCHEMA_VERSION,
  type Plan,
  type Step,
  type Story,
} from "@svatah/schema";
import {
  diagnostic,
  isStoryBlock,
  type Diagnostic,
  type Project,
  type RawStep as ReaderStep,
  type StoryBlock,
} from "@svatah/spec";
import { emitCustom, type StepRegistry } from "@svatah/steps";
import { lowerStep, lowerValue, type LowerContext } from "./lower.js";
import { parseGuard, parseSentence } from "./tier1.js";
import { validateStory, type ValidateContext } from "./validate.js";
import type { RawStep, RawValue } from "./raw.js";

export interface CompileOptions {
  readonly project: Project;
  /** Loaded `steps/` (T2.3). Absent means the project has none. */
  readonly steps?: StepRegistry;
  /** `config.project`. */
  readonly projectName: string;
  /** `config.run.stepTimeoutMs`. */
  readonly stepTimeoutMs?: number;
  /**
   * Fix `generatedAt`, so two compiles of one input are the same bytes
   * (`--stable`, REQ-COMP-7).
   */
  readonly stable?: boolean;
  /** Words that make a step side-effecting; defaults to `SIDE_EFFECT_WORDS`. */
  readonly sideEffectWords?: readonly string[];
}

export interface CompileResult {
  readonly plan: Plan;
  readonly diagnostics: readonly Diagnostic[];
  /** True when nothing in `diagnostics` is an error. */
  readonly ok: boolean;
}

/** The timestamp `--stable` uses: fixed, and obviously so. */
export const STABLE_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export function compile(options: CompileOptions): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const { project } = options;
  const stepTimeoutMs = options.stepTimeoutMs ?? 10_000;

  const dataPaths = collectPaths(project.data.values);
  const apis = new Set(project.apis.requests.keys());

  /* Compile every story first, so validation can see every other story's
     captures and signatures — a `{Story.name}` reference may point forward. */
  const compiled: Array<{ story: Story; block: StoryBlock; file: string }> = [];

  for (const flow of project.flows) {
    for (const block of flow.blocks) {
      if (!isStoryBlock(block)) continue;
      const { story, diagnostics: stepDiagnostics } = compileStory(block, flow.file, {
        registry: options.steps,
        lower: {
          targets: project.targets,
          secrets: project.data.secrets,
          ...(options.sideEffectWords === undefined
            ? {}
            : { sideEffectWords: options.sideEffectWords }),
          file: flow.file,
          line: 0,
          stepTimeoutMs,
        },
      });
      diagnostics.push(...stepDiagnostics);
      compiled.push({ story, block, file: flow.file });
    }
  }

  const capturesByStory = new Map<string, ReadonlySet<string>>(
    compiled.map(({ story }) => [
      story.name,
      new Set(story.steps.map((step) => step.capture?.name).filter((n): n is string => n !== undefined)),
    ]),
  );
  const signatures = new Map<string, Story["signature"]>(
    compiled.map(({ story }) => [story.name, story.signature]),
  );

  for (const { story, file } of compiled) {
    const context: ValidateContext = {
      file,
      storyName: story.name,
      ...(story.signature === undefined ? {} : { signature: story.signature }),
      otherStories: capturesByStory,
      dataPaths,
      stories: signatures,
      apis,
    };
    diagnostics.push(...validateStory(story.steps, context));
  }

  /* Compensating stories are named in metadata rather than by a step, so
     nothing above would have noticed a name that does not exist. */
  for (const { story, file } of compiled) {
    const policy = story.meta.onFailure;
    if (typeof policy === "object" && !signatures.has(policy.compensate)) {
      diagnostics.push(
        diagnostic(
          "E_UNKNOWN_STORY",
          `"${story.name}" compensates with "${policy.compensate}", which is not a story in this project.`,
          { file, line: story.steps[0]?.line ?? 0 },
        ),
      );
    }
  }

  const plan = assemble(compiled.map((c) => c.story), project, options);
  return { plan, diagnostics, ok: !diagnostics.some((d) => d.severity === "error") };
}

/* ── one story ────────────────────────────────────────────────────────────── */

interface StoryContext {
  readonly registry?: StepRegistry;
  readonly lower: LowerContext;
}

function compileStory(
  block: StoryBlock,
  file: string,
  context: StoryContext,
): { story: Story; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const steps: Step[] = [];

  block.steps.forEach((raw, index) => {
    // Positional and stable: `<story>#<n>`. A step id that depended on the text
    // would change when a typo was fixed, and `--resume` compares plan hashes.
    const id = `${block.name}#${index + 1}`;
    const where = { file, line: raw.line };
    const lower: LowerContext = { ...context.lower, file, line: raw.line };

    const result = compileSentence(raw, { id, storyName: block.name, file, lower, registry: context.registry });
    diagnostics.push(...result.diagnostics);
    if (result.step !== undefined) steps.push(result.step);
    void where;
  });

  const story: Story = {
    name: block.name,
    kind: block.kind,
    file,
    meta: block.meta,
    ...(block.signature === undefined ? {} : { signature: block.signature }),
    steps,
  };
  return { story, diagnostics };
}

interface SentenceContext {
  readonly id: string;
  readonly storyName: string;
  readonly file: string;
  readonly lower: LowerContext;
  readonly registry?: StepRegistry;
}

/**
 * One sentence through the tiers.
 *
 * Tier 0 is asked first, and Tier 1 is asked *even when Tier 0 claimed it*,
 * because REQ-LANG-16 makes two claimants an error naming both. Asking only
 * until the first claim would make which one won depend on the order the tiers
 * happen to be tried, which is exactly what the rule exists to prevent.
 */
export function compileSentence(
  raw: ReaderStep,
  context: SentenceContext,
): { step?: Step; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const where = { file: context.file, line: raw.line };

  const tier0 = context.registry?.match(raw.text);
  const tier1 = parseSentence(raw.text, where);

  if (tier0?.outcome === "ambiguous") {
    diagnostics.push(
      diagnostic(
        "E_STEP_AMBIGUOUS",
        `"${raw.text}" matches ${tier0.matches.length} custom steps: ` +
          `${tier0.matches.map((m) => m.step.id).join(", ")}.`,
        where,
      ),
    );
    return { diagnostics };
  }

  if (tier0?.outcome === "one" && tier1.raw !== undefined) {
    diagnostics.push(
      diagnostic(
        "E_STEP_AMBIGUOUS",
        `"${raw.text}" matches both the custom step ${tier0.match.step.id} ` +
          `("${tier0.match.step.template}") and a grammar pattern. ` +
          "Reword one of them: which ran would otherwise depend on nothing a reader can see.",
        where,
      ),
    );
    return { diagnostics };
  }

  if (tier0?.outcome === "one") {
    return { step: customStep(raw, tier0.match, context), diagnostics };
  }

  if (tier1.raw === undefined) {
    // Tiers 2 and 3 would take the sentence here when registered (Phase 4). The
    // sentence is reported rather than dropped so nothing runs a plan that is
    // quietly missing a step.
    return { diagnostics: [...tier1.diagnostics] };
  }

  const withGuard = attachGuard(tier1.raw, raw, where, diagnostics);
  const lowered = lowerStep(
    withGuard,
    {
      id: context.id,
      storyName: context.storyName,
      line: raw.line,
      text: raw.text,
      rule: withGuard.action,
    },
    context.lower,
  );
  diagnostics.push(...lowered.diagnostics);
  return { step: lowered.step, diagnostics };
}

/**
 * A guard the *reader* split off a preceding line, parsed and attached.
 *
 * A guard written as a prefix on the step's own line was already parsed by the
 * grammar. The two forms mean the same thing, so a step must never end up with
 * both — the reader has already refused that (`E_GUARD_ORPHAN`).
 */
function attachGuard(
  parsed: RawStep,
  raw: ReaderStep,
  where: { file: string; line: number },
  diagnostics: Diagnostic[],
): RawStep {
  if (raw.guard === undefined) return parsed;
  const guard = parseGuard(raw.guard.text, raw.guard.mode, { ...where, line: raw.guard.line });
  diagnostics.push(...guard.diagnostics);
  return guard.guard === undefined ? parsed : { ...parsed, guard: guard.guard };
}

/** A Tier 0 match, as an IR step (LLD §5, Draft 2.2). */
function customStep(
  raw: ReaderStep,
  match: NonNullable<ReturnType<StepRegistry["matchAll"]>[number]>,
  context: SentenceContext,
): Step {
  const secrets = context.lower.secrets;
  const emitted = emitCustom(match.step.placeholders, match.match, {
    parseValue: (text) => lowerValue(parseRawValue(text), secrets),
    resolveTarget: (phrase) => {
      const resolution = context.lower.targets.resolve(phrase);
      const scope = context.lower.targets.scopeOf(resolution.id);
      return {
        ref: resolution.id,
        phrase,
        status: resolution.status === "ambiguous" ? "ambiguous" : resolution.status,
        ...(scope === undefined ? {} : { scope }),
      };
    },
  });

  return {
    id: context.id,
    storyName: context.storyName,
    line: raw.line,
    text: raw.text,
    action: "custom",
    custom: {
      id: match.step.id,
      params: emitted.params,
      ...(Object.keys(emitted.targets).length === 0 ? {} : { targets: emitted.targets }),
    },
    ...(match.step.meta.sideEffect === true ? { sideEffect: true } : {}),
    timeoutMs: match.step.meta.timeoutMs ?? context.lower.stepTimeoutMs,
    origin: { tier: 0, rule: match.step.id, confidence: 1 },
  };
}

/** A `value` placeholder's captured text, as the grammar would have read it. */
function parseRawValue(text: string): RawValue {
  const trimmed = text.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return { literal: trimmed.slice(1, -1) };
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.startsWith("data.")) return { data: inner.slice(5) };
    if (inner.startsWith("input.")) return { input: inner.slice(6) };
    const dot = inner.lastIndexOf(".");
    return dot > 0 ? { var: inner.slice(dot + 1), story: inner.slice(0, dot) } : { var: inner };
  }
  return { literal: trimmed };
}

/* ── the plan ─────────────────────────────────────────────────────────────── */

function assemble(stories: readonly Story[], project: Project, options: CompileOptions): Plan {
  const compositions: Record<string, string[]> = {};
  for (const [name, composition] of project.compositions) {
    compositions[name] = [...composition.names];
  }

  const runs: Record<string, string[]> = {};
  for (const [file, names] of project.runs) runs[file] = [...names];

  const customSteps = [
    ...new Set(
      stories.flatMap((story) =>
        story.steps.map((step) => step.custom?.id).filter((id): id is string => id !== undefined),
      ),
    ),
  ].sort();

  const apis = [
    ...new Set(
      stories.flatMap((story) =>
        story.steps
          .filter((step) => step.action === "api")
          .map((step) => {
            const request = step.args?.["request"];
            return typeof request === "object" &&
              request !== null &&
              (request as { kind?: string }).kind === "literal"
              ? (request as { value: string }).value
              : undefined;
          })
          .filter((name): name is string => name !== undefined),
      ),
    ),
  ].sort();

  const withoutHash = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: options.stable === true ? STABLE_TIMESTAMP : new Date().toISOString(),
    project: options.projectName,
    stories: [...stories],
    compositions,
    runs,
    targets: project.targets.toPlanTargets(),
    apis,
    customSteps,
  };

  return { ...withoutHash, hash: planHash(withoutHash) } as Plan;
}

/** `plan.json`'s bytes: canonical, so two compiles of one input are identical. */
export function renderPlan(plan: Plan): string {
  return `${canonicalJson(plan)}\n`;
}

/** Every dotted path in the run data, so `{data.x}` can be checked. */
function collectPaths(tree: Readonly<Record<string, unknown>>, prefix = ""): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    out.add(path);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const nested of collectPaths(value as Record<string, unknown>, path)) out.add(nested);
    }
  }
  return out;
}
