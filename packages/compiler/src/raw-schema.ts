/**
 * The shape a model-backed tier is constrained to (T4.3, REQ-COMP-3).
 *
 * > Tier 2 is a local 1.7B to 4B instruct model with output constrained to the
 * > IR JSON Schema, temperature 0, fixed seed, pinned digest in provenance.
 *
 * The constraint is this schema, and it is the *grammar's* raw step rather than
 * the finished `Step` — deliberately, and it is the one place Tier 2 departs
 * from a literal reading of REQ-COMP-3.
 *
 * A finished `Step` carries an element id, a `secret` flag on every value, a
 * timeout, a positional step id and an `origin`. Every one of those is a fact
 * about the *project* — what the bindings store holds, what `data.yaml` marks
 * secret, what the config's `stepTimeoutMs` is, where in the story the step sits
 * — and a model has no basis for any of them. Letting it emit them would mean a
 * model inventing element ids the dictionary has never heard of (REQ-COMP-5) and
 * deciding for itself whether a password is a secret (REQ-NFR-6).
 *
 * So the model produces exactly what the grammar produces — an action, a target
 * *phrase*, argument values — and the same `lower.ts` that finishes a Tier 1
 * step finishes this one. The IR is still deterministic; only the parse is not.
 *
 * The schema is deliberately narrow in another way too. A 3B instruct model does
 * markedly better against an enumeration than against free text, so every field
 * that has a fixed vocabulary is an enum here: the action set, the predicate
 * kinds, the capture sources, the scopes.
 */
import { z } from "zod";
import { ACTIONS, PREDICATE_KINDS } from "@svatah/schema";
import type { RawPredicate, RawStep, RawValue } from "./raw.js";

/**
 * A value the model may name.
 *
 * Four forms, one of which must be chosen — the same four the grammar reads.
 * `template` is left out: a sentence that interleaves literals and references is
 * a Tier 1 pattern, and asking a small model for a nested structure is asking
 * for the shape it gets wrong most often.
 */
export const rawValueSchema = z
  .object({
    kind: z.enum(["literal", "var", "data", "input"]),
    /** The literal text, the variable name, the data path, or the input name. */
    value: z.string(),
    /** For `var` only: the story that captured it, when it was another one. */
    story: z.string().optional(),
  })
  .strict();

export type ModelValue = z.infer<typeof rawValueSchema>;

const rawTargetSchema = z
  .object({
    /** The noun phrase as the author wrote it: "the username field". */
    phrase: z.string().min(1),
    scope: z.enum(["page", "dialog", "frame", "desktop", "window"]).optional(),
  })
  .strict();

const rawPredicateSchema = z
  .object({
    kind: z.enum(PREDICATE_KINDS),
    negate: z.boolean().optional(),
    value: rawValueSchema.optional(),
    /** The attribute or CSS property name, for `attribute` and `css`. */
    name: z.string().optional(),
    numbers: z.array(z.number()).optional(),
    left: rawValueSchema.optional(),
    op: z.enum(["eq", "ne", "gt", "lt", "matches"]).optional(),
    right: rawValueSchema.optional(),
  })
  .strict();

/**
 * The literal arguments a step may carry, each named and typed.
 *
 * A closed object rather than an open map, and that is the difference between a
 * schema that *constrains* and a schema that merely describes. A JSON-Schema-
 * guided decoder cannot emit a key this object does not declare, so
 * `{"url: ": …}` — a real answer from a real 3B model — becomes impossible
 * rather than discouraged. Same for the types: `index` is a number here, so a
 * model cannot answer `"2"` and a model cannot wrap it in a value reference.
 *
 * The names are the grammar's own, from `docs/flow-language.md`: an argument the
 * grammar would emit under one name and a model under another would be two
 * spellings of one step, and the resolver would find neither.
 */
const modelArgsSchema = z
  .object({
    /** `navigate`. */
    url: z.string().optional(),
    /** `type`, `selectOption` by underlying value. */
    value: z.string().optional(),
    /** `selectOption`, `deselectOption` by visible text. */
    label: z.string().optional(),
    /** `press`, `keyDown`, `keyUp`. */
    key: z.string().optional(),
    /** `upload`. */
    path: z.string().optional(),
    /** `setChecked`. */
    checked: z.boolean().optional(),
    /** `sleep`. */
    seconds: z.number().optional(),
    ms: z.number().optional(),
    /** `screenshot`. */
    name: z.string().optional(),
    /** `evaluate`. */
    script: z.string().optional(),
    /** `api`. */
    request: z.string().optional(),
    /**
     * Whether an `api` step shares the web session's cookies (REQ-ADP-3).
     *
     * The grammar emits it — `Call the "x" API with the session cookies` — and
     * the HTTP adapter reads it, so a Tier 2 answer that could not carry it
     * would compile the sentence into a request that quietly sends no cookies.
     * Found by the fine-tune export, which requires every pair to parse.
     */
    withSessionCookies: z.boolean().optional(),
    /** `switchWindow`: 0-based, so "the second tab" is 1. */
    index: z.number().optional(),
    /** `switchWindow`: "new" or "main". */
    which: z.enum(["new", "main"]).optional(),
    /** `dialog`. */
    action: z.enum(["accept", "dismiss"]).optional(),
    /**
     * The text to type into a `prompt` dialog.
     *
     * `text` is what the grammar emits and what the adapter reads
     * (`Answer the dialog with "Atul"` → `args.text`). `promptText` was the only
     * spelling allowed here, so a Tier 2 answer for that sentence could never
     * carry the text the adapter uses — and `g-079` could not even be *shown* to
     * the model as an example, because the schema rejects it.
     *
     * Both are accepted: `text` because it is the one that works, `promptText`
     * because a model that has learned the other name should not be refused over
     * a synonym the lowering can resolve.
     */
    text: z.string().optional(),
    promptText: z.string().optional(),
  })
  .strict();

/**
 * One step, as a model may describe it.
 *
 * `args` holds literals and `argRefs` holds references, kept apart because a
 * small model handles `{"url": "/login"}` reliably and `{"url": {"kind":
 * "literal", "value": "/login"}}` far less so — and the difference between the
 * two is mechanical.
 */
export const modelStepSchema = z
  .object({
    action: z.enum(ACTIONS),
    target: rawTargetSchema.optional(),
    /** The second element, for `dragTo`. */
    target2: rawTargetSchema.optional(),
    /** Literal arguments: `{ "url": "/login" }`, `{ "value": "hello" }`. */
    args: modelArgsSchema.optional(),
    /** Arguments that are variable, data or input references rather than literals. */
    argRefs: z.record(z.string(), rawValueSchema).optional(),
    expect: z
      .object({
        subject: z.enum(["target", "page", "dialog", "scope"]),
        predicate: rawPredicateSchema,
      })
      .strict()
      .optional(),
    capture: z
      .object({
        name: z.string().min(1),
        from: z.enum(["text", "value", "attribute", "title", "result", "response", "output"]),
        attribute: z.string().optional(),
        jsonPath: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ModelStep = z.infer<typeof modelStepSchema>;

/** A model's value reference, as the grammar's `RawValue`. */
function toRawValue(value: ModelValue): RawValue {
  switch (value.kind) {
    case "literal":
      return { literal: value.value };
    case "data":
      return { data: value.value };
    case "input":
      return { input: value.value };
    case "var":
      return value.story === undefined
        ? { var: value.value }
        : { var: value.value, story: value.story };
  }
}

/**
 * The actions that act on the page rather than on an element.
 *
 * The grammar never emits a target for one of these, so a model that did has
 * described the same step in a shape the project does not use — and a target on
 * a `refresh` would send the recorder looking for "the page".
 */
const TARGETLESS: ReadonlySet<string> = new Set([
  "navigate",
  "back",
  "forward",
  "refresh",
  "scrollToTop",
  "scrollToBottom",
  "switchWindow",
  "closeOtherWindows",
  "dialog",
  "screenshot",
  "evaluate",
  "api",
  "sleep",
  "press",
  "keyDown",
  "keyUp",
]);

/** Predicates that are about the page rather than about an element. */
const PAGE_PREDICATES: ReadonlySet<string> = new Set([
  "title",
  "titleContains",
  "url",
  "urlContains",
]);

/**
 * A model's answer, as the raw step the grammar would have produced.
 *
 * Two normalisations happen here, and both are *the grammar's own rules applied
 * mechanically* rather than corrections of the model's judgement:
 *
 * * **A target on a targetless action is dropped.** The grammar never emits one
 *   for `refresh` or `scrollToTop`; a model that answered "the page" or "the top
 *   of the page" described the same step in a shape the project does not have.
 * * **`expect.subject` is derived.** It is not a free choice: a claim about a
 *   URL or a title is about the page, and any other claim on a step that has a
 *   target is about the target. The grammar derives it the same way, so leaving
 *   it to the model would be leaving a mechanical fact to a guess.
 *
 * Everything downstream — `lower.ts`, `validate.ts`, the plan writer — then
 * treats a Tier 2 step exactly as it treats a Tier 1 step, which is what makes
 * "every step records tier of origin" (REQ-COMP-1) the *only* difference between
 * them in the finished plan.
 */
export function toRawStep(step: ModelStep): RawStep {
  const args: Record<string, NonNullable<RawStep["args"]>[string]> = {};
  for (const [name, value] of Object.entries(step.args ?? {})) {
    if (value === undefined) continue;
    // Numbers and booleans stay as they are — `sleep`'s `seconds` and
    // `setChecked`'s `checked` are values, not value *references*.
    args[name] = typeof value === "string" ? { literal: value } : value;
  }
  for (const [name, value] of Object.entries(step.argRefs ?? {})) {
    args[name] = toRawValue(value);
  }

  const predicate = (raw: NonNullable<ModelStep["expect"]>["predicate"]): RawPredicate => ({
    kind: raw.kind,
    ...(raw.negate === undefined ? {} : { negate: raw.negate }),
    ...(raw.value === undefined ? {} : { value: toRawValue(raw.value) }),
    ...(raw.name === undefined ? {} : { name: raw.name }),
    ...(raw.numbers === undefined ? {} : { numbers: raw.numbers }),
    ...(raw.left === undefined ? {} : { left: toRawValue(raw.left) }),
    ...(raw.op === undefined ? {} : { op: raw.op }),
    ...(raw.right === undefined ? {} : { right: toRawValue(raw.right) }),
  });

  const target = TARGETLESS.has(step.action) ? undefined : step.target;
  const subject =
    step.expect === undefined
      ? undefined
      : PAGE_PREDICATES.has(step.expect.predicate.kind)
        ? "page"
        : target !== undefined
          ? "target"
          : step.expect.subject === "target"
            ? "page"
            : step.expect.subject;

  return {
    action: step.action,
    ...(target === undefined ? {} : { target }),
    ...(step.target2 === undefined ? {} : { target2: step.target2 }),
    ...(Object.keys(args).length === 0 ? {} : { args }),
    ...(step.expect === undefined
      ? {}
      : { expect: { subject: subject!, predicate: predicate(step.expect.predicate) } }),
    ...(step.capture === undefined ? {} : { capture: step.capture }),
  };
}
