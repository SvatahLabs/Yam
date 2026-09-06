/**
 * Lowering the grammar's output into IR (LLD §3.2, §4.2).
 *
 * The grammar produced phrases and raw references. This applies the project:
 *
 * * a **phrase** becomes a `TargetRef` through the dictionary, with the element
 *   id, the status, and the scope the dictionary knows about (REQ-COMP-5);
 * * a **`{data.…}` reference** becomes a `ValueRef` carrying `secret: true` when
 *   the path is declared secret in `data.yaml`, which is what makes redaction
 *   possible everywhere downstream (REQ-NFR-6);
 * * a **side-effect heuristic** sets `sideEffect` on the step, so lint can warn
 *   about a non-idempotent story exposed as a tool (REQ-AUTO-8, LLD §3.2:
 *   "set by lint heuristics").
 *
 * None of it can change *which pattern matched*, only what the matched pattern
 * resolves to. That is deliberate: a sentence's meaning must not depend on the
 * project's configuration, or the golden set would be measuring the fixture.
 */
import type {
  Action,
  Predicate,
  Provenance,
  Step,
  TargetRef,
  ValueRef,
} from "@svatah/yam-schema";
import type { TargetDictionary } from "@svatah/yam-spec";
import type { Diagnostic } from "@svatah/yam-spec";
import type { RawPredicate, RawStep, RawTarget, RawValue } from "./raw.js";

export interface LowerContext {
  readonly targets: TargetDictionary;
  /** Dotted paths declared secret in `data.yaml` (REQ-NFR-6). */
  readonly secrets: ReadonlySet<string>;
  /** Words in a target phrase that make a step side-effecting. */
  readonly sideEffectWords?: readonly string[];
  readonly file: string;
  readonly line: number;
  readonly stepTimeoutMs: number;
}

/**
 * Target phrases that make a step side-effecting (REQ-AUTO-8).
 *
 * A heuristic, and a deliberately narrow one. Its only job is to make `yam
 * lint` say "this story changes something and is exposed as a tool without being
 * marked idempotent", and a list that fired on every click would make that
 * warning worthless. It errs towards silence: a story that really does have side
 * effects and is not caught here is caught by the author declaring `idempotent`
 * — or not — which is the authoritative signal.
 */
export const SIDE_EFFECT_WORDS = [
  "pay",
  "purchase",
  "buy",
  "order",
  "charge",
  "refund",
  "transfer",
  "delete",
  "destroy",
  "deploy",
  "publish",
  "run build",
] as const;

function isSideEffecting(phrase: string, words: readonly string[]): boolean {
  const text = ` ${phrase.toLowerCase()} `;
  return words.some((word) => text.includes(` ${word} `) || text.includes(` ${word}s `));
}

/** A raw reference to a `ValueRef`, marking a secret data path as one. */
export function lowerValue(raw: RawValue, secrets: ReadonlySet<string>): ValueRef {
  if ("literal" in raw) return { kind: "literal", value: raw.literal };
  if ("input" in raw) return { kind: "input", name: raw.input };
  if ("data" in raw) {
    const secret = isSecret(raw.data, secrets);
    return secret ? { kind: "data", path: raw.data, secret: true } : { kind: "data", path: raw.data };
  }
  if ("var" in raw) {
    return raw.story === undefined
      ? { kind: "var", name: raw.var }
      : { kind: "var", name: raw.var, story: raw.story };
  }
  return { kind: "template", parts: raw.template.map((part) => lowerValue(part, secrets)) };
}

/** A path is secret when it is declared, or sits under something declared. */
function isSecret(path: string, secrets: ReadonlySet<string>): boolean {
  if (secrets.has(path)) return true;
  for (const secret of secrets) if (path.startsWith(`${secret}.`)) return true;
  return false;
}

function lowerTarget(
  raw: RawTarget,
  context: LowerContext,
  diagnostics: Diagnostic[],
): TargetRef {
  const { resolution, diagnostic } = context.targets.resolveWithDiagnostic(raw.phrase, {
    file: context.file,
    line: context.line,
  });
  if (diagnostic !== undefined) diagnostics.push(diagnostic);

  // The scope the sentence declared wins; otherwise whatever the dictionary
  // knows about the element (a control inside an iframe, say).
  const scope = raw.scope ?? context.targets.scopeOf(resolution.id);

  return {
    ref: resolution.id,
    phrase: raw.phrase,
    status: resolution.status === "ambiguous" ? "ambiguous" : resolution.status,
    ...(scope === undefined ? {} : { scope }),
  };
}

/**
 * A `target` guard's own element, when it differs from the step's (Draft 2.7).
 *
 * Three cases, and the middle one is the whole change:
 *
 * * the guard names the element the step acts on — nothing, `step.target` is
 *   the answer and `guard.target` absent means exactly that;
 * * the guard names a different element — a `TargetRef` resolved through the
 *   same dictionary, so the recorder grounds it and the resolver resolves it
 *   like any other target;
 * * the guard names nothing at all and the step has no target either — no
 *   element anywhere, which `compile.ts` reports as `E_GUARD_NO_TARGET`.
 */
function guardTarget(
  guard: NonNullable<RawStep["guard"]>,
  stepTarget: TargetRef | undefined,
  context: LowerContext,
  diagnostics: Diagnostic[],
): { target?: TargetRef } {
  if (guard.subject !== "target" || guard.phrase === undefined) return {};
  const target = lowerTarget({ phrase: guard.phrase }, context, diagnostics);
  if (stepTarget !== undefined && target.ref === stepTarget.ref) return {};
  return { target };
}

function lowerPredicate(raw: RawPredicate, secrets: ReadonlySet<string>): Predicate {
  const out: Record<string, unknown> = { kind: raw.kind };
  if (raw.negate === true) out["negate"] = true;
  if (raw.name !== undefined) out["name"] = raw.name;
  if (raw.numbers !== undefined) out["numbers"] = [...raw.numbers];
  if (raw.value !== undefined) out["value"] = lowerValue(raw.value, secrets);
  if (raw.left !== undefined) out["left"] = lowerValue(raw.left, secrets);
  if (raw.op !== undefined) out["op"] = raw.op;
  if (raw.right !== undefined) out["right"] = lowerValue(raw.right, secrets);
  return out as unknown as Predicate;
}

/** Everything a step needs that the grammar does not decide. */
export interface StepIdentity {
  readonly id: string;
  readonly storyName: string;
  readonly line: number;
  readonly text: string;
  readonly rule: string;
  /**
   * Which tier produced the parse. `1` — the grammar — unless a model tier did
   * (T4.3, T4.4).
   *
   * A step from a model is lowered by exactly this function, from exactly the
   * same raw shape, so `origin` is the *only* thing in the finished step that
   * differs. That is what makes REQ-COMP-1's "every step records tier of origin"
   * a property of the plan rather than of a report beside it.
   */
  readonly tier?: 1 | 2 | 3;
  /** The tier's confidence; lint compares it to the threshold (REQ-COMP-8). */
  readonly confidence?: number;
  /** Mandatory on a Tier 2 or Tier 3 step, and schema-enforced (REQ-STD-4). */
  readonly provenance?: Provenance;
}

/** The IR step for one parsed sentence. */
export function lowerStep(
  raw: RawStep,
  identity: StepIdentity,
  context: LowerContext,
): { step: Step; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const secrets = context.secrets;
  const words = context.sideEffectWords ?? SIDE_EFFECT_WORDS;

  const target = raw.target === undefined ? undefined : lowerTarget(raw.target, context, diagnostics);
  const target2 = raw.target2 === undefined ? undefined : lowerTarget(raw.target2, context, diagnostics);

  const args: Record<string, ValueRef | number | string | boolean> = {};
  for (const [key, value] of Object.entries(raw.args ?? {})) {
    /*
     * `promptText` becomes `text` here, and nowhere else (Draft 2.8 §3.2).
     *
     * §3.2 fixes `dialog`'s args as `{ action, text? }`, and the raw schema
     * accepts `promptText` as a synonym because a Tier 2 model may have learned
     * the other name and refusing a step over it would lose a correct answer.
     * Resolving it *at the boundary* is what keeps that tolerance from reaching
     * the adapters: an adapter that had to know both spellings is an adapter
     * that can disagree with another one about which it reads, which is the
     * shape of the defect §3.2 was written for (P6-F4).
     */
    const name = raw.action === "dialog" && key === "promptText" ? "text" : key;
    if (name === "text" && args["text"] !== undefined) continue;
    args[name] =
      typeof value === "number" || typeof value === "boolean"
        ? value
        : lowerValue(value, secrets);
  }

  const sideEffect =
    (target !== undefined && isSideEffecting(target.phrase, words)) ||
    (target2 !== undefined && isSideEffecting(target2.phrase, words));

  const step: Step = {
    id: identity.id,
    storyName: identity.storyName,
    line: identity.line,
    text: identity.text,
    action: raw.action as Action,
    ...(target === undefined ? {} : { target }),
    ...(target2 === undefined ? {} : { target2 }),
    ...(Object.keys(args).length === 0 ? {} : { args }),
    ...(raw.guard === undefined
      ? {}
      : {
          guard: {
            subject: raw.guard.subject as "target" | "page" | "dialog" | "scope",
            predicate: lowerPredicate(raw.guard.predicate, secrets),
            mode: raw.guard.mode as "onlyIf" | "unless",
            /*
             * The element the guard is about, when it is not the step's own
             * (LLD §3.2, Draft 2.7).
             *
             * "Only if the login error is hidden, click the sign in button"
             * asks about one element and acts on another. The guard's own
             * target is grounded and resolved exactly like `step.target`, so
             * the question asked at run time is the one the sentence asks.
             *
             * Omitted when the phrases name the same element, because
             * `step.target` already says it and a redundant copy would put two
             * accounts of one element in the plan. That also keeps every plan
             * compiled before Draft 2.7 byte-identical (REQ-COMP-7).
             */
            ...guardTarget(raw.guard, target, context, diagnostics),
          },
        }),
    ...(raw.expect === undefined
      ? {}
      : {
          expect: {
            subject: raw.expect.subject as NonNullable<Step["expect"]>["subject"],
            predicate: lowerPredicate(raw.expect.predicate, secrets),
            /*
             * Pattern 32's quantifier and noun (T12.7, LLD §13.9 Draft 2.15).
             *
             * Carried straight through: the grammar already normalised the
             * noun to the singular and the quantifier to `every` or `no`, and
             * the *scope* of the set is `step.target`, which the lines above
             * resolved through the dictionary like any other target. Nothing
             * about a set is a project question.
             */
            ...(raw.expect.set === undefined
              ? {}
              : {
                  set: {
                    quantifier: raw.expect.set.quantifier as "every" | "no",
                    of: raw.expect.set.of,
                  },
                }),
          },
        }),
    ...(raw.capture === undefined
      ? {}
      : {
          capture: {
            name: raw.capture.name,
            from: raw.capture.from as NonNullable<Step["capture"]>["from"],
            ...(raw.capture.attribute === undefined ? {} : { attribute: raw.capture.attribute }),
            ...(raw.capture.jsonPath === undefined ? {} : { jsonPath: raw.capture.jsonPath }),
          },
        }),
    ...(raw.invoke === undefined
      ? {}
      : {
          invoke: {
            story: raw.invoke.story,
            inputs: Object.fromEntries(
              Object.entries(raw.invoke.inputs).map(([name, value]) => [
                name,
                lowerValue(value, secrets),
              ]),
            ),
          },
        }),
    ...(sideEffect ? { sideEffect: true } : {}),
    timeoutMs: context.stepTimeoutMs,
    origin: {
      tier: identity.tier ?? 1,
      rule: identity.rule,
      confidence: identity.confidence ?? 1,
      ...(identity.provenance === undefined ? {} : { provenance: identity.provenance }),
    },
  };

  return { step, diagnostics };
}
