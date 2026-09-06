/**
 * Tier 1: the deterministic controlled grammar (REQ-COMP-2, LLD §4.2).
 *
 * "Tier 1 is a deterministic controlled grammar over the full action set with
 * the existing synonym vocabulary; offline; 1,000 steps in under 1 s."
 *
 * The parser is generated from `grammar/step.peggy`. This is the thin layer
 * around it: reject v1/v2 syntax first, parse, and hand the raw AST to `lower`.
 * Nothing here decides what a sentence means.
 */
import { diagnostic, type Diagnostic } from "@svatah/yam-spec";
import { parse, SyntaxError as PeggySyntaxError } from "./generated/step-parser.js";
import type { RawStep } from "./raw.js";
import { checkSigils } from "./sigils.js";

export interface Tier1Result {
  /** The raw step, when the sentence matched. */
  readonly raw?: RawStep;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Parse one sentence.
 *
 * A sentence that does not match is `E_NO_MATCH`, not a crash: an unrecognised
 * sentence is a normal thing for a person to write, and in a later phase it is
 * what Tier 2 gets handed (LLD §4.1).
 */
export function parseSentence(text: string, where: { file: string; line: number }): Tier1Result {
  const sigil = checkSigils(text, where);
  if (sigil !== undefined) return { diagnostics: [sigil] };

  try {
    return { raw: parse(text, { startRule: "Step" }) as RawStep, diagnostics: [] };
  } catch (error) {
    return { diagnostics: [noMatch(text, error, where)] };
  }
}

/** Parse a guard written on its own line, which the reader has already split off. */
export function parseGuard(
  text: string,
  mode: "onlyIf" | "unless",
  where: { file: string; line: number },
): {
  guard?: NonNullable<RawStep["guard"]>;
  diagnostics: readonly Diagnostic[];
} {
  const word = mode === "unless" ? "Unless" : "Only if";
  try {
    const parsed = parse(`${word} ${text}`, { startRule: "GuardOnly" }) as NonNullable<
      RawStep["guard"]
    >;
    return { guard: parsed, diagnostics: [] };
  } catch (error) {
    return { diagnostics: [noMatch(text, error, where)] };
  }
}

/**
 * "No pattern matched", with the column the parser gave up at.
 *
 * The column is the useful part. peggy's own "expected X but found Y" is written
 * for a grammar author; a flow author needs to know *where* the sentence stopped
 * making sense, which is almost always the word after the one they got wrong.
 */
function noMatch(text: string, error: unknown, where: { file: string; line: number }): Diagnostic {
  const column =
    error instanceof PeggySyntaxError || (error as { location?: unknown }).location !== undefined
      ? (error as PeggySyntaxError).location.start.column
      : undefined;

  return diagnostic(
    "E_NO_MATCH",
    column === undefined
      ? `No sentence pattern matches "${text}".`
      : `No sentence pattern matches "${text}" — it stops making sense at column ${column} ` +
        `("${text.slice(Math.max(0, column - 1), column + 19)}"). ` +
        "See docs/flow-language.md §5 for every pattern.",
    { ...where, source: text },
  );
}
