/**
 * Tier 2: a local instruct model, for the sentences the grammar refused
 * (T4.3, REQ-COMP-3, REQ-NFR-3, LLD §4.3).
 *
 * > Tier 2 is a local 1.7B to 4B instruct model with output constrained to the
 * > IR JSON Schema, temperature 0, fixed seed, pinned digest in provenance.
 *
 * It lives in `@svatah/yam` rather than in `@svatah/yam-compiler` because the
 * compiler declares the tier interface and nothing more: that is what keeps
 * `yam compile` offline unless a project asks otherwise, and what keeps the
 * compiler free of a dependency on the model gateway (LLD §1, `tiers.ts`).
 *
 * Four things make a 3B model usable for this at all, and each is a decision
 * rather than a knob:
 *
 * * **A schema, not a plea for JSON.** `localGateway` sends the answer's JSON
 *   Schema as Ollama's `format`, which constrains generation. A model that
 *   cannot produce an invalid `action` will not.
 * * **Few-shot retrieval.** The golden set is a corpus of sentence → step pairs
 *   the grammar already handles. The nearest handful, chosen by word overlap,
 *   go into the prompt. A small model is far better at "like these" than at
 *   "here are the rules".
 * * **Temperature 0 and a fixed seed**, in the gateway (REQ-COMP-7).
 * * **A confidence penalty.** A Tier 2 step is never confident. It carries a
 *   ceiling below any sensible `compile.confidenceThreshold`, so `yam lint`
 *   flags every one of them for a person to read (REQ-COMP-8's `W_LOW_CONFIDENCE`
 *   alongside `W_TIER2`).
 */
import { modelStepSchema, toRawStep, type ModelTier, type ModelTierAnswer } from "@svatah/yam-compiler";
import {
  GatewayRefusal,
  GatewayShapeError,
  GatewayUnavailable,
  localGateway,
  type Gateway,
  type LocalProvider,
} from "@svatah/yam-gateway";
import { diagnostic, VOCABULARY, type Diagnostic } from "@svatah/yam-spec";
import { conventionsBlock } from "./conventions.js";
import { readGoldenSet, type GoldenExample } from "./examples.js";

/** The prompt this tier is versioned by, in provenance (REQ-AGT-3). */
export const TIER2_PROMPT_VERSION = "c2-1";

/**
 * The ceiling a Tier 2 step's confidence is held under.
 *
 * Below `DEFAULT_CONFIG.compile.confidenceThreshold` (0.8) on purpose: a step a
 * small local model guessed at is one a person should look at before it is
 * committed, and the mechanism for saying so is the threshold that already
 * exists. A tier that reported 0.95 would be a tier that quietly turned lint off.
 */
export const TIER2_MAX_CONFIDENCE = 0.6;

/** How many examples go into a prompt. More is slower and, past a handful, worse. */
const SHOTS = 8;

export interface Tier2Options {
  readonly provider: LocalProvider;
  readonly endpoint: string;
  readonly model: string;
  /** The pinned digest; a mismatch fails the compile (REQ-COMP-3). */
  readonly digest?: string;
  /** `--allow-model-drift`: record the served digest, do not refuse on it. */
  readonly allowDigestDrift?: boolean;
  /** Injected by the tests and by `eval compiler --gateway fake`. */
  readonly gateway?: Gateway;
  /** The examples to retrieve from; the golden set by default. */
  readonly examples?: readonly GoldenExample[];
  readonly onCall?: (line: string) => void;
}

/**
 * The instruction block. Stable, so the gateway's cache key is stable.
 *
 * Written for a small model: what the job is, what the fields mean, and what not
 * to do. The vocabulary itself is not listed here — the schema carries it, and
 * repeating it in prose is how a prompt and a schema come to disagree.
 */
export const TIER2_SYSTEM_PROMPT = `You translate one sentence from a browser automation script into a JSON step.

The sentence describes a single action a person performs on a web page. Answer
with the step it means, and nothing else.

- "action" is the single verb the sentence performs.
- "target" is the noun phrase naming the element, copied from the sentence
  character for character: "the username field", not "username", not a selector.
- "args" holds literal argument values as plain strings: {"value": "hello"}.
- "argRefs" holds arguments that are references: a sentence writing {name} means
  {"kind":"var","value":"name"}; {data.a.b} means {"kind":"data","value":"a.b"};
  {input.n} means {"kind":"input","value":"n"}.
- "expect" is for a sentence that asserts or waits for something. "subject" is
  "target" when it is about the element, "page" when it is about the page or URL.
- "capture" is for a sentence that remembers a value under a name.

${conventionsBlock()}

Examples of the same job, done correctly:`;

/** One retrieved example, as the prompt shows it. */
function renderExample(example: GoldenExample): string {
  return `${example.text}\n${JSON.stringify(example.step)}`;
}

/**
 * Words a sentence is compared on: lower-cased, punctuation and quoted literals
 * removed.
 *
 * The literals are removed deliberately. "Type \\"alice\\" into the username
 * field" and "Type \\"bob\\" into the password field" are the same *shape*, and a
 * retrieval that scored on the quoted strings would rank by the accident of what
 * a test happened to type.
 */
export function shapeWords(text: string): string[] {
  return text
    .replace(/"[^"]*"/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
}

/**
 * The action a sentence's words suggest, from the project's own synonym
 * vocabulary (LLD §4.3, `actions.yaml` ported from `ActionSynonyms.java`).
 *
 * The vocabulary is the *grammar's* table of which words mean which action, and
 * it already knows that "reload" means `refresh` and "opens" means `navigate`.
 * A retrieval that ignored it would rank "Reload the current page" beside
 * whatever happened to share the word "page" — which is what it did, and why
 * that sentence came back with an invented target.
 *
 * A hint, not a decision: it biases which examples the model is shown, and the
 * model still chooses the action. A sentence the vocabulary has no word for gets
 * no hint and falls back to word overlap alone.
 */
export function suggestedAction(text: string): string | undefined {
  const words = shapeWords(text);
  const lower = text.toLowerCase();
  for (const verb of VOCABULARY) {
    for (const synonym of verb.synonyms) {
      // A multi-word synonym has to appear as a phrase; a single word has to be
      // a *word*, so "backdrop" does not mean `back`.
      const matched = synonym.includes(" ") ? lower.includes(synonym) : words.includes(synonym);
      if (matched) return verb.action;
    }
  }
  return undefined;
}

/**
 * The examples most like a sentence, best first.
 *
 * Three signals, in decreasing weight:
 *
 * * **The same action.** When the synonym vocabulary recognises a word in the
 *   sentence, examples of that action come first — the single strongest thing
 *   that can be known about a sentence before a model reads it.
 * * **Word overlap.** Jaccard over the shape words, which finds the sentences
 *   built the same way.
 * * **The same first word**, which is usually the verb.
 *
 * Deterministic ties broken by id, so the same sentence always gets the same
 * prompt and therefore the same answer (REQ-COMP-7).
 */
export function retrieve(
  text: string,
  examples: readonly GoldenExample[],
  count = SHOTS,
): GoldenExample[] {
  const wanted = new Set(shapeWords(text));
  const verb = shapeWords(text)[0];
  const action = suggestedAction(text);

  const scored = examples.map((example) => {
    const words = new Set(shapeWords(example.text));
    let shared = 0;
    for (const word of wanted) if (words.has(word)) shared += 1;
    const union = new Set([...wanted, ...words]).size;
    const overlap = union === 0 ? 0 : shared / union;
    const sameAction = action !== undefined && example.step["action"] === action ? 0.5 : 0;
    const sameVerb = verb !== undefined && shapeWords(example.text)[0] === verb ? 0.15 : 0;
    return { example, score: overlap + sameAction + sameVerb };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.example.id.localeCompare(b.example.id))
    .slice(0, count)
    .map((one) => one.example);
}

/**
 * Build the Tier 2 backend.
 *
 * Registered by the CLI when `config.compile.tier2` names a server and the
 * caller passed `--tier2`. Absent otherwise, which is what "compile is offline
 * by default" means in practice (REQ-NFR-3).
 */
export function tier2(options: Tier2Options): ModelTier {
  const examples = options.examples ?? readGoldenSet();
  const gateway =
    options.gateway ??
    localGateway({
      provider: options.provider,
      endpoint: options.endpoint,
      model: options.model,
      ...(options.digest === undefined ? {} : { digest: options.digest }),
      ...(options.allowDigestDrift === undefined
        ? {}
        : { allowDigestDrift: options.allowDigestDrift }),
      ...(options.onCall === undefined ? {} : { onCall: options.onCall }),
    });

  return {
    tier: 2,
    async compile(text, context): Promise<ModelTierAnswer | undefined> {
      const shots = retrieve(text, examples);
      const diagnostics: Diagnostic[] = [];

      let answer;
      try {
        answer = await gateway.ask({
          promptVersion: TIER2_PROMPT_VERSION,
          system: `${TIER2_SYSTEM_PROMPT}\n\n${shots.map(renderExample).join("\n\n")}`,
          user: text,
          answer: modelStepSchema,
        });
      } catch (error) {
        /*
         * A model that refused, answered outside its schema, or is not there
         * passes the sentence on rather than failing the compile: Tier 3
         * is next, and a sentence nothing could place ends as `E_NO_MATCH`,
         * which is the same answer it would have had with no tier at all.
         *
         * A *digest mismatch* is the exception and is rethrown: it means the
         * weights moved under a pinned project, and continuing would put a lie
         * in the provenance (REQ-COMP-3).
         */
        if (error instanceof GatewayUnavailable && /digest/.test(error.message)) throw error;
        if (
          error instanceof GatewayUnavailable ||
          error instanceof GatewayShapeError ||
          error instanceof GatewayRefusal
        ) {
          diagnostics.push(
            diagnostic(
              "W_TIER2",
              `The local model could not place "${text}": ${error.message.split("\n")[0]}`,
              { file: context.file, line: context.line },
            ),
          );
          options.onCall?.(`tier 2 declined "${text}": ${error.message.split("\n")[0]}`);
          return undefined;
        }
        throw error;
      }

      return {
        raw: toRawStep(answer.value),
        provenance: answer.provenance,
        confidence: TIER2_MAX_CONFIDENCE,
        ...(diagnostics.length === 0 ? {} : { diagnostics }),
      };
    },
  };
}
