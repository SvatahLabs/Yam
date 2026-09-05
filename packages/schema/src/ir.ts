import { z } from "zod";
import { provenanceSchema } from "./provenance.js";
import { argValueSchema, valueRefSchema } from "./values.js";
import { SCHEMA_VERSION } from "./version.js";

/* ── Actions (LLD §3.2) ───────────────────────────────────────────────────── */

/** Every action a compiled step can carry. Order follows LLD §3.2 exactly. */
export const ACTIONS = [
  "navigate",
  "back",
  "forward",
  "refresh",

  "click",
  "doubleClick",
  "rightClick",
  "hover",
  "hoverAndClick",
  "pressAndHold",
  "release",
  "dragTo",

  "type",
  "clear",
  "press",
  "keyDown",
  "keyUp",
  "submit",
  "upload",

  "selectOption",
  "deselectOption",
  "deselectAll",
  "setChecked",

  "scrollIntoView",
  "scrollToTop",
  "scrollToBottom",

  "sleep",
  "waitFor",

  "switchWindow",
  "closeOtherWindows",
  "switchFrame",

  "dialog",

  "read",
  "expect",
  "evaluate",
  "screenshot",

  "api",
  "custom",
  /** Call another story as a function (workflow behavior). */
  "invoke",
] as const;

export const actionSchema = z.enum(ACTIONS);
export type Action = z.infer<typeof actionSchema>;

/**
 * The actions an adapter implements: the IR action set minus `api`, `custom` and
 * `expect`, which are executor concerns (LLD §2.3).
 */
export const SURFACE_ONLY_EXCLUSIONS = ["api", "custom", "expect"] as const;
export type SurfaceAction = Exclude<Action, (typeof SURFACE_ONLY_EXCLUSIONS)[number]>;

export const surfaceActionSchema = actionSchema.exclude(SURFACE_ONLY_EXCLUSIONS);
export const SURFACE_ACTIONS: readonly SurfaceAction[] = surfaceActionSchema.options;

/* ── Targets (LLD §3.2) ───────────────────────────────────────────────────── */

export const targetStatusSchema = z.enum(["bound", "unbound", "ambiguous"]);
export type TargetStatus = z.infer<typeof targetStatusSchema>;

/** `desktop` and `window` were added in Draft 2 for the OS accessibility adapters. */
export const targetScopeSchema = z.enum(["page", "dialog", "frame", "desktop", "window"]);
export type TargetScope = z.infer<typeof targetScopeSchema>;

export const targetRefSchema = z
  .object({
    /** Element id in the bindings store, e.g. `login.username-field`. */
    ref: z.string().min(1),
    /** The noun phrase the author wrote, e.g. "the username field". */
    phrase: z.string().min(1),
    status: targetStatusSchema,
    scope: targetScopeSchema.optional(),
  })
  .strict();
export type TargetRef = z.infer<typeof targetRefSchema>;

/* ── Predicates (LLD §3.2) ────────────────────────────────────────────────── */

export const STATE_PREDICATE_KINDS = [
  "visible",
  "hidden",
  "enabled",
  "disabled",
  "checked",
  "unchecked",
  "selected",
  "present",
  "absent",
  "multiSelect",
] as const;

export const VALUE_PREDICATE_KINDS = [
  "text",
  "textContains",
  "value",
  "title",
  "titleContains",
  "url",
  "urlContains",
  "tag",
] as const;

export const NAMED_VALUE_PREDICATE_KINDS = ["attribute", "css"] as const;
export const GEOMETRY_PREDICATE_KINDS = ["location", "size", "box"] as const;
export const EXPR_OPS = ["eq", "ne", "gt", "lt", "matches"] as const;

/**
 * The five predicate groups of LLD §3.2. They are separate schemas so a caller can
 * narrow to one group, and the union is what `expect` and `guard` carry.
 */
export const statePredicateSchema = z
  .object({ kind: z.enum(STATE_PREDICATE_KINDS), negate: z.boolean().optional() })
  .strict();

export const valuePredicateSchema = z
  .object({
    kind: z.enum(VALUE_PREDICATE_KINDS),
    value: valueRefSchema,
    negate: z.boolean().optional(),
  })
  .strict();

export const namedValuePredicateSchema = z
  .object({
    kind: z.enum(NAMED_VALUE_PREDICATE_KINDS),
    name: z.string().min(1),
    value: valueRefSchema,
    negate: z.boolean().optional(),
  })
  .strict();

export const geometryPredicateSchema = z
  .object({ kind: z.enum(GEOMETRY_PREDICATE_KINDS), numbers: z.array(z.number()) })
  .strict();

/** Guards over scope values (LLD §4.2 pattern 29). */
export const exprPredicateSchema = z
  .object({
    kind: z.literal("expr"),
    left: valueRefSchema,
    op: z.enum(EXPR_OPS),
    right: valueRefSchema,
    negate: z.boolean().optional(),
  })
  .strict();

export const predicateSchema = z.union([
  statePredicateSchema,
  valuePredicateSchema,
  namedValuePredicateSchema,
  geometryPredicateSchema,
  exprPredicateSchema,
]);

export type Predicate = z.infer<typeof predicateSchema>;

/** Every predicate kind, in LLD §3.2 order. */
export const PREDICATE_KINDS = [
  ...STATE_PREDICATE_KINDS,
  ...VALUE_PREDICATE_KINDS,
  ...NAMED_VALUE_PREDICATE_KINDS,
  ...GEOMETRY_PREDICATE_KINDS,
  "expr",
] as const;

/* ── Step (LLD §3.2) ──────────────────────────────────────────────────────── */

export const predicateSubjectSchema = z.enum(["target", "page", "dialog", "scope"]);
export type PredicateSubject = z.infer<typeof predicateSubjectSchema>;

export const guardSchema = z
  .object({
    subject: predicateSubjectSchema,
    predicate: predicateSchema,
    mode: z.enum(["onlyIf", "unless"]),
  })
  .strict();
export type Guard = z.infer<typeof guardSchema>;

export const expectationSchema = z
  .object({ subject: predicateSubjectSchema, predicate: predicateSchema })
  .strict();
export type Expectation = z.infer<typeof expectationSchema>;

export const captureSchema = z
  .object({
    name: z.string().min(1),
    from: z.enum(["text", "value", "attribute", "title", "result", "response", "output"]),
    attribute: z.string().min(1).optional(),
    jsonPath: z.string().min(1).optional(),
  })
  .strict();
export type Capture = z.infer<typeof captureSchema>;

export const COMPILER_TIERS = [0, 1, 2, 3] as const;
export const tierSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type Tier = z.infer<typeof tierSchema>;

export const originSchema = z
  .object({
    tier: tierSchema,
    /** The grammar rule or custom-step template that matched. */
    rule: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1),
    provenance: provenanceSchema.optional(),
  })
  .strict();
export type Origin = z.infer<typeof originSchema>;

/** Tiers whose output came from a model and therefore requires provenance (REQ-STD-4). */
export const MODEL_TIERS: readonly Tier[] = [2, 3];


const stepShape = z
  .object({
    /** `<story name>/<index>`, unique within a plan. */
    id: z.string().min(1),
    storyName: z.string().min(1),
    /** 1-based line in the flow file the sentence came from. */
    line: z.number().int().positive(),
    text: z.string().min(1),
    action: actionSchema,
    target: targetRefSchema.optional(),
    /** Second target, for two-element actions such as `dragTo`. */
    target2: targetRefSchema.optional(),
    args: z.record(z.string(), argValueSchema).optional(),
    guard: guardSchema.optional(),
    expect: expectationSchema.optional(),
    capture: captureSchema.optional(),
    /**
     * Set when `action === "custom"`; `id` is the file path plus export name (LLD §5).
     *
     * `params` holds the `string | number | boolean | value` placeholders as
     * ValueRefs. `targets` holds the `target` placeholders as TargetRefs, so the
     * recorder grounds them and the resolver resolves them exactly as it does
     * `step.target` (LLD §3.2, §5, Draft 2.2). A `target` placeholder encoded as
     * a literal in `params` would be invisible to both, which is why the
     * refinement below rejects it.
     */
    custom: z
      .object({
        id: z.string().min(1),
        params: z.record(z.string(), valueRefSchema),
        targets: z.record(z.string(), targetRefSchema).optional(),
      })
      .strict()
      .optional(),
    /** Set when `action === "invoke"`. */
    invoke: z
      .object({ story: z.string().min(1), inputs: z.record(z.string(), valueRefSchema) })
      .strict()
      .optional(),
    /** Declared on a custom step or inferred by lint; drives the idempotency warnings. */
    sideEffect: z.boolean().optional(),
    timeoutMs: z.number().int().nonnegative(),
    origin: originSchema,
  })
  .strict();

/**
 * A compiled step.
 *
 * Two refinements are enforced beyond the shape:
 *  * REQ-STD-4 — a Tier 2 or Tier 3 step, being model output, must carry provenance.
 *  * The `custom` and `invoke` blocks must accompany their action and only their action.
 */
export const stepSchema = stepShape
  .superRefine((step, ctx) => {
    if (MODEL_TIERS.includes(step.origin.tier) && step.origin.provenance === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["origin", "provenance"],
        message: `A Tier ${step.origin.tier} step is model output and must carry provenance (REQ-AGT-3, REQ-STD-4).`,
      });
    }
    if (step.action === "custom" && step.custom === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["custom"],
        message: 'A step with action "custom" must carry a `custom` block (LLD §5).',
      });
    }
    if (step.action !== "custom" && step.custom !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["custom"],
        message: 'A `custom` block is only allowed on a step with action "custom".',
      });
    }
    if (step.custom !== undefined) {
      // Draft 2.2: a `target` placeholder lives in `custom.targets` and nowhere
      // else. Two encodings of the same placeholder are rejected here.
      const targets = step.custom.targets ?? {};

      // (a) The same placeholder name in both maps. The executor would have two
      //     bindings for one argument and no rule for which wins.
      for (const name of Object.keys(targets)) {
        if (name in step.custom.params) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["custom", "params", name],
            message:
              `Placeholder "${name}" appears in both \`custom.params\` and \`custom.targets\`. ` +
              "A `target` placeholder belongs in `targets` only (LLD §5, Draft 2.2).",
          });
        }
      }

      // (b) A literal in `params` that repeats an element id or a phrase this
      //     step already grounds as a target — the double encoding the rule
      //     forbids. A literal is invisible to the recorder and to the resolver,
      //     so the step would silently act on nothing.
      const grounded = new Set<string>();
      for (const target of [
        ...Object.values(targets),
        ...(step.target === undefined ? [] : [step.target]),
        ...(step.target2 === undefined ? [] : [step.target2]),
      ]) {
        grounded.add(target.ref);
        grounded.add(target.phrase);
      }
      for (const [name, ref] of Object.entries(step.custom.params)) {
        if (ref.kind === "literal" && grounded.has(ref.value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["custom", "params", name],
            message:
              `\`custom.params.${name}\` is the literal "${ref.value}", which this step already ` +
              "grounds as a target. A `target` placeholder must be a TargetRef under " +
              "`custom.targets`, never a literal in `params` (LLD §5, Draft 2.2).",
          });
        }
      }
    }
    if (step.action === "invoke" && step.invoke === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["invoke"],
        message: 'A step with action "invoke" must carry an `invoke` block (LLD §3.2).',
      });
    }
    if (step.action !== "invoke" && step.invoke !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["invoke"],
        message: 'An `invoke` block is only allowed on a step with action "invoke".',
      });
    }
  });

export type Step = z.infer<typeof stepShape>;

/* ── Signatures and stories (LLD §3.2) ────────────────────────────────────── */

export const INPUT_TYPES = ["string", "number", "boolean", "json", "secret"] as const;
export const OUTPUT_TYPES = ["string", "number", "boolean", "json"] as const;

export const signatureSchema = z
  .object({
    inputs: z.record(
      z.string().min(1),
      z
        .object({
          type: z.enum(INPUT_TYPES),
          default: z.unknown().optional(),
          description: z.string().optional(),
        })
        .strict(),
    ),
    outputs: z.record(
      z.string().min(1),
      z
        .object({ type: z.enum(OUTPUT_TYPES), description: z.string().optional() })
        .strict(),
    ),
  })
  .strict();
export type Signature = z.infer<typeof signatureSchema>;

/** `stop` (default), `continue`, or run a named compensating story then stop. */
export const onFailureSchema = z.union([
  z.literal("stop"),
  z.literal("continue"),
  z.object({ compensate: z.string().min(1) }).strict(),
]);
export type OnFailure = z.infer<typeof onFailureSchema>;

export const storyMetaSchema = z
  .object({
    enabled: z.boolean(),
    dataProvider: z.string().min(1).optional(),
    filePath: z.string().min(1).optional(),
    onFailure: onFailureSchema,
    /** Declares the story free of side effects; lint warns when a non-idempotent story is exposed as a tool (REQ-AUTO-8). */
    idempotent: z.boolean().optional(),
    tags: z.array(z.string().min(1)),
  })
  .strict();
export type StoryMeta = z.infer<typeof storyMetaSchema>;

export const storySchema = z
  .object({
    name: z.string().min(1),
    kind: z.enum(["story", "scenario"]),
    /** Path of the flow file this story came from, relative to the project root. */
    file: z.string().min(1),
    meta: storyMetaSchema,
    signature: signatureSchema.optional(),
    steps: z.array(stepSchema),
  })
  .strict();
export type Story = z.infer<typeof storySchema>;

/* ── Plan (LLD §3.2) ──────────────────────────────────────────────────────── */

export const planSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    generatedAt: z.string().datetime({ offset: true }),
    project: z.string().min(1),
    stories: z.array(storySchema),
    /** `compose:` blocks: name → ordered story names. */
    compositions: z.record(z.string().min(1), z.array(z.string().min(1))),
    /** `test:` / `run:` blocks: flow file → ordered story or composition names. */
    runs: z.record(z.string().min(1), z.array(z.string().min(1))),
    /** The project target dictionary: element id → the phrases that resolve to it. */
    targets: z.record(
      z.string().min(1),
      z.object({ phrases: z.array(z.string().min(1)) }).strict(),
    ),
    /** Names of the `api/*.yaml` requests the plan references. */
    apis: z.array(z.string().min(1)),
    /** Ids of the Tier 0 custom steps the plan references. */
    customSteps: z.array(z.string().min(1)),
    /** Canonical hash of the plan's content; see `planHash` in hash.ts. */
    hash: z.string().min(1),
  })
  .strict();
export type Plan = z.infer<typeof planSchema>;
