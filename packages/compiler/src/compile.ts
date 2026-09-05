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
import { tierFor, type ModelTierAnswer } from "./tiers.js";
import { referencesOf, validateStory, type ValidateContext } from "./validate.js";
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
  /**
   * Answers a model-backed tier already gave, keyed by `sentenceKey` (T4.3).
   *
   * `compile` stays synchronous and stays a pure function of its inputs, which
   * is what REQ-COMP-7's byte-stability rests on. `compileWithModelTiers` is the
   * asynchronous shell: it compiles once, asks the registered tiers about the
   * sentences the grammar refused, and compiles again with their answers in
   * hand. Two passes rather than an async compiler, because a compiler that
   * awaited in the middle of assembling a plan would be one whose output
   * depended on when a model answered.
   */
  readonly modelAnswers?: ReadonlyMap<string, ModelTierAnswer & { readonly tier: 2 | 3 }>;
}

/**
 * How a sentence is keyed in `modelAnswers`.
 *
 * File, line and text together: the same sentence written twice in one story is
 * two steps, and two identical sentences in different files must not share one
 * answer's provenance.
 */
export function sentenceKey(file: string, line: number, text: string): string {
  return `${file}:${line}:${text}`;
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
        ...(options.modelAnswers === undefined ? {} : { modelAnswers: options.modelAnswers }),
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

  /*
   * Every `{Story name.capture}` any story reads (T5.4).
   *
   * `W_UNUSED_CAPTURE` is decided per story, and a cross-story read is by
   * definition in a different one, so a capture read only from elsewhere looked
   * unused. That is the ordinary shape of a compensating story — it exists to
   * undo what the failing story recorded — and the warning fired on exactly the
   * pattern REQ-AUTO-4 asks people to write.
   *
   * Collected once here, where every story is in hand, rather than by validating
   * twice.
   */
  const crossStoryReads = new Set<string>();
  for (const { story } of compiled) {
    for (const step of story.steps) {
      for (const reference of referencesOf(step)) {
        if (reference.kind === "var" && reference.story !== undefined) {
          crossStoryReads.add(`${reference.story}.${reference.name}`);
        }
      }
    }
  }

  for (const { story, file } of compiled) {
    const context: ValidateContext = {
      file,
      storyName: story.name,
      ...(story.signature === undefined ? {} : { signature: story.signature }),
      otherStories: capturesByStory,
      crossStoryReads,
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

  const plan = assemble(
    compiled.map((c) => (options.stable === true ? stabilise(c.story) : c.story)),
    project,
    options,
  );
  return { plan, diagnostics, ok: !diagnostics.some((d) => d.severity === "error") };
}

/* ── one story ────────────────────────────────────────────────────────────── */

interface StoryContext {
  readonly registry?: StepRegistry;
  readonly lower: LowerContext;
  readonly modelAnswers?: CompileOptions["modelAnswers"];
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

    const result = compileSentence(raw, {
      id,
      storyName: block.name,
      file,
      lower,
      ...(context.registry === undefined ? {} : { registry: context.registry }),
      ...(context.modelAnswers === undefined ? {} : { modelAnswers: context.modelAnswers }),
    });
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
  readonly modelAnswers?: CompileOptions["modelAnswers"];
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

  /*
   * The grammar refused. A model-backed tier may already have answered for this
   * sentence (T4.3, T4.4); if none did, the sentence is reported rather than
   * dropped, so nothing runs a plan that is quietly missing a step.
   */
  const model =
    tier1.raw === undefined
      ? context.modelAnswers?.get(sentenceKey(context.file, raw.line, raw.text))
      : undefined;

  if (tier1.raw === undefined && model === undefined) {
    return { diagnostics: [...tier1.diagnostics] };
  }

  const parsed = tier1.raw ?? model!.raw;
  const withGuard = attachGuard(parsed, raw, where, diagnostics);
  const lowered = lowerStep(
    withGuard,
    {
      id: context.id,
      storyName: context.storyName,
      line: raw.line,
      text: raw.text,
      rule: withGuard.action,
      ...(model === undefined
        ? {}
        : {
            tier: model.tier,
            confidence: model.confidence,
            provenance: model.provenance,
          }),
    },
    context.lower,
  );
  diagnostics.push(...lowered.diagnostics, ...(model?.diagnostics ?? []));
  return { step: lowered.step, diagnostics };
}

/* ── the asynchronous shell (T4.3, T4.4) ─────────────────────────────────── */

export interface ModelTierOptions {
  /** Ask Tier 2. Off by default, so `compile` is offline unless told otherwise. */
  readonly tier2?: boolean;
  /** Ask Tier 3 for what Tier 2 could not place (REQ-COMP-4). */
  readonly tier3?: boolean;
  /** Report progress; one line per sentence a tier was asked about. */
  readonly onProgress?: (message: string) => void;
}

/**
 * Compile, asking the registered model tiers about the residue (REQ-COMP-1, 3, 4).
 *
 * Three passes and no more: compile, ask, compile again. The first pass finds
 * the sentences the grammar refused — which is the *only* thing a model tier is
 * for, because "the first claimant wins" and Tier 1 always claims first. The
 * second asks Tier 2, then Tier 3 for whatever Tier 2 declined ("Tier 3 is used
 * only for Tier 2's residue", REQ-COMP-4). The third produces the plan.
 *
 * Recompiling rather than patching is what keeps the plan byte-stable: a step
 * assembled by a different path from its neighbours would differ from one
 * assembled by the same path, and `--stable` would stop meaning anything.
 */
export async function compileWithModelTiers(
  options: CompileOptions,
  tiers: ModelTierOptions = {},
): Promise<CompileResult> {
  const first = compile(options);
  if (tiers.tier2 !== true && tiers.tier3 !== true) return first;

  const residue = unmatchedSentences(options.project);
  if (residue.length === 0) return first;

  const answers = new Map<string, ModelTierAnswer & { tier: 2 | 3 }>();
  for (const sentence of residue) {
    for (const level of [2, 3] as const) {
      if (tiers[level === 2 ? "tier2" : "tier3"] !== true) continue;
      const tier = tierFor(level);
      if (tier === undefined) continue;

      const answer = await tier.compile(sentence.text, {
        file: sentence.file,
        line: sentence.line,
        storyName: sentence.storyName,
      });
      if (answer === undefined) continue;

      answers.set(sentenceKey(sentence.file, sentence.line, sentence.text), {
        ...answer,
        tier: level,
      });
      tiers.onProgress?.(
        `tier ${level}: "${sentence.text}" → ${answer.raw.action} ` +
          `(confidence ${answer.confidence.toFixed(2)})`,
      );
      break;
    }
  }

  return answers.size === 0 ? first : compile({ ...options, modelAnswers: answers });
}

/** Every sentence in the project the grammar and the custom steps both refused. */
function unmatchedSentences(
  project: Project,
): Array<{ file: string; line: number; text: string; storyName: string }> {
  const out: Array<{ file: string; line: number; text: string; storyName: string }> = [];
  for (const flow of project.flows) {
    for (const block of flow.blocks) {
      if (!isStoryBlock(block)) continue;
      for (const raw of block.steps) {
        if (parseSentence(raw.text, { file: flow.file, line: raw.line }).raw !== undefined) continue;
        out.push({ file: flow.file, line: raw.line, text: raw.text, storyName: block.name });
      }
    }
  }
  return out;
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
  /*
   * A guard reaches here two ways and both are checked below (T5.4).
   *
   * `Only if <predicate>, <sentence>` is one line and the grammar attaches the
   * guard as it parses it. A standalone `Only if <predicate>` line before a step
   * is two lines, and the reader hands them over separately. They are the same
   * guard and must be answered the same way — a check on one spelling only would
   * be worse than no check at all.
   */
  const attached =
    raw.guard === undefined
      ? parsed
      : (() => {
          const guard = parseGuard(raw.guard.text, raw.guard.mode, {
            ...where,
            line: raw.guard.line,
          });
          diagnostics.push(...guard.diagnostics);
          return guard.guard === undefined ? parsed : { ...parsed, guard: guard.guard };
        })();

  return checkGuardTarget(attached, raw, where, diagnostics);
}

/**
 * A `target` guard has to be about *some* element (T5.4, LLD §3.2, Draft 2.7).
 *
 * Since Draft 2.7 `Step.guard` carries an optional `target`, so a guard may ask
 * about an element other than the one the step acts on:
 *
 *     Only if the login error is hidden, click the sign in button
 *
 * compiles to a guard whose own target is the login error, which the recorder
 * grounds and the resolver resolves before the predicate is evaluated. `lower`
 * builds it; nothing is checked here.
 *
 * What is left to refuse is a `target` guard with no element *anywhere*: no
 * phrase of its own, and a step that acts on nothing either. The grammar cannot
 * produce that — its target-guard rules always capture a phrase — but Tier 2
 * and Tier 3 emit raw steps directly, and a model asked to guard a
 * `sleep 2 seconds` can produce a subject with nothing behind it. There is no
 * element to ask the question of, so it is `E_GUARD_NO_TARGET`.
 */
function checkGuardTarget(
  parsed: RawStep,
  raw: ReaderStep,
  where: { file: string; line: number },
  diagnostics: Diagnostic[],
): RawStep {
  const guard = parsed.guard as (NonNullable<RawStep["guard"]> & { phrase?: string }) | undefined;
  if (guard === undefined || guard.subject !== "target") return parsed;
  if (guard.phrase !== undefined || parsed.target !== undefined) return parsed;

  diagnostics.push(
    diagnostic(
      "E_GUARD_NO_TARGET",
      `The guard is about an element, but "${raw.text}" acts on no element and the guard ` +
        "names none either, so there is nothing for it to be about. Name the element " +
        "(`Only if the banner is visible, …`), or use a page guard " +
        '(`Only if the URL contains "…"`) or a scope guard (`Only if {name} is "…"`).',
      { ...where, line: raw.guard?.line ?? raw.line, source: raw.guard?.text ?? raw.text },
    ),
  );
  return { ...parsed, guard: undefined };
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

/**
 * `--stable`: fix everything that would differ between two compiles of one input.
 *
 * `generatedAt` is one such field and was the only one until a model tier could
 * produce a step. A Tier 2 or Tier 3 step carries provenance, and provenance
 * carries the *time of the call* — so a plan with one model step in it could
 * never be byte-stable, and REQ-COMP-7 would hold for the grammar alone.
 *
 * The timestamp is the only field fixed. Everything provenance exists to say —
 * which model, which digest, which prompt version, how many tokens, what it cost
 * — is a fact about the answer rather than about when it was asked for, and
 * stays exactly as the gateway reported it (REQ-AGT-3).
 */
function stabilise(story: Story): Story {
  if (!story.steps.some((step) => step.origin.provenance !== undefined)) return story;
  return {
    ...story,
    steps: story.steps.map((step) =>
      step.origin.provenance === undefined
        ? step
        : {
            ...step,
            origin: {
              ...step.origin,
              provenance: { ...step.origin.provenance, at: STABLE_TIMESTAMP },
            },
          },
    ),
  };
}

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
