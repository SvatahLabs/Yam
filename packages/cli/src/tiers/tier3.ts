/**
 * Tier 3: the frontier model, for Tier 2's residue (T4.4, REQ-COMP-4, LLD §10).
 *
 * > Tier 3 is a frontier model used only when configured and only for Tier 2
 * > residue; prompt versioned in provenance.
 *
 * "Only for Tier 2 residue" is enforced by `compileWithModelTiers`, which asks
 * the tiers in order and stops at the first that answers. So a sentence reaches
 * here having been refused by the grammar *and* declined by a local model, which
 * is a small set — and REQ-NFR-2 keeps model usage confined to it.
 *
 * The difference from Tier 2 is not the schema and not the shape of the answer.
 * It is that this one is allowed to think, is not shown examples it needs in
 * order to cope, and is given the vocabulary in prose because a frontier model
 * reads prose. Everything else — the constrained output, the raw-step shape, the
 * lowering — is the same path, which is what makes the two tiers comparable in
 * a per-tier report (REQ-COMP-9).
 */
import { modelStepSchema, toRawStep, type ModelTier, type ModelTierAnswer } from "@svatah/compiler";
import {
  anthropicGateway,
  GatewayRefusal,
  GatewayShapeError,
  GatewayUnavailable,
  type Gateway,
} from "@svatah/gateway";
import { ACTIONS, PREDICATE_KINDS } from "@svatah/schema";
import { diagnostic, type Diagnostic } from "@svatah/spec";
import { conventionsBlock } from "./conventions.js";

/** The prompt version recorded in provenance (REQ-AGT-3, T4.4's `c3-1`). */
export const TIER3_PROMPT_VERSION = "c3-1";

/**
 * A Tier 3 step's confidence.
 *
 * Higher than Tier 2's and still below the default threshold of 0.8, on purpose.
 * A frontier model reading one sentence out of context is better at this than a
 * 3B model is, and it is still a *guess about what a person meant* — which is
 * exactly the thing `svatah lint` exists to put in front of a person before it
 * is committed (REQ-COMP-8).
 */
export const TIER3_MAX_CONFIDENCE = 0.75;

export interface Tier3Options {
  readonly model: string;
  readonly promptVersion?: string;
  /** Injected by the tests and by `eval compiler --gateway fake`. */
  readonly gateway?: Gateway;
  /** Where the prompt cache lives, when there is one. */
  readonly cacheDir?: string;
  readonly onCall?: (line: string) => void;
}

/**
 * The instruction block. Stable, so it is one cached prefix across a whole
 * compile (`shared/prompt-caching.md`, LLD §10).
 */
const SYSTEM = `You translate one sentence from a browser automation script into a JSON step.

The script is prose: one sentence per step, no selectors, no sigils. A sentence
that reached you is one the project's controlled grammar refused, so it is a
paraphrase, an unusual word order, or a construction the grammar does not cover.
Work out which single action the author meant and answer with that step.

The action set is fixed:
${ACTIONS.join(", ")}.

The predicate set, for "expect" and for "waitFor", is fixed:
${PREDICATE_KINDS.join(", ")}.

Conventions the project uses, which you must follow exactly:

- "target" carries the noun phrase **as the author wrote it** — "the username
  field", not "username", not "#username". The project resolves phrases to
  elements; you never name an element id, a selector or an attribute.
- "args" holds literal values as plain strings.
- "argRefs" holds arguments that are references rather than literals: a sentence
  writing {name} means {"kind":"var","value":"name"}, {data.a.b} means
  {"kind":"data","value":"a.b"}, {input.n} means {"kind":"input","value":"n"}.
- "expect" is for a sentence that asserts or waits. "subject" is "target" for a
  claim about the element, "page" for one about the page or the URL.
- "capture" is for a sentence that remembers something under a name.
- A sentence that asserts *and* acts is two steps and is not your problem: emit
  the action, and leave the assertion to the author.

${conventionsBlock()}

Omit every field the sentence does not determine. Never invent a timeout, a
variable name the sentence does not use, or an element the sentence does not
mention.`;

export function tier3(options: Tier3Options): ModelTier {
  const promptVersion = options.promptVersion ?? TIER3_PROMPT_VERSION;
  const gateway =
    options.gateway ??
    anthropicGateway({
      model: options.model,
      ...(options.onCall === undefined ? {} : { onCall: options.onCall }),
    });

  return {
    tier: 3,
    async compile(text, context): Promise<ModelTierAnswer | undefined> {
      const diagnostics: Diagnostic[] = [];
      let answer;
      try {
        answer = await gateway.ask({
          promptVersion,
          system: SYSTEM,
          user: text,
          answer: modelStepSchema,
          // Working out what an unusual sentence means is exactly the kind of
          // work adaptive thinking repays, and the answer is small.
          effort: "medium",
        });
      } catch (error) {
        /*
         * Nothing after Tier 3, so a failure here means the sentence ends as
         * `E_NO_MATCH` — which is the answer it would have had with no tier at
         * all, and is a compile error the author can see and fix.
         */
        if (
          error instanceof GatewayUnavailable ||
          error instanceof GatewayShapeError ||
          error instanceof GatewayRefusal
        ) {
          diagnostics.push(
            diagnostic(
              "W_TIER3",
              `The frontier model could not place "${text}": ${error.message.split("\n")[0]}`,
              { file: context.file, line: context.line },
            ),
          );
          options.onCall?.(`tier 3 declined "${text}": ${error.message.split("\n")[0]}`);
          return undefined;
        }
        throw error;
      }

      return {
        raw: toRawStep(answer.value),
        provenance: answer.provenance,
        confidence: TIER3_MAX_CONFIDENCE,
        ...(diagnostics.length === 0 ? {} : { diagnostics }),
      };
    },
  };
}
