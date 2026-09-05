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
  Step,
  TargetRef,
  ValueRef,
} from "@svatah/schema";
import type { TargetDictionary } from "@svatah/spec";
import type { Diagnostic } from "@svatah/spec";
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
 * A heuristic, and a deliberately narrow one. Its only job is to make `svatah
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
    args[key] =
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
          },
        }),
    ...(raw.expect === undefined
      ? {}
      : {
          expect: {
            subject: raw.expect.subject as "target" | "page" | "dialog" | "scope",
            predicate: lowerPredicate(raw.expect.predicate, secrets),
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
    origin: { tier: 1, rule: identity.rule, confidence: 1 },
  };

  return { step, diagnostics };
}
