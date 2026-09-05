/**
 * Normalisation (LLD §4.3, `docs/flow-language.md` §4).
 *
 * Two normalisations, used for two different things, and keeping them apart
 * matters:
 *
 * * `normaliseWords` prepares a *sentence* for verb matching. It lower-cases and
 *   collapses whitespace and nothing else, because a step's words are what the
 *   grammar matches on and removing punctuation would change which pattern a
 *   sentence hits.
 * * `elementId` turns a *target phrase* into a stable element id. It is lossy on
 *   purpose: "the Sign In button", "Sign-in button" and "sign in button" all
 *   have to name one element, or the bindings store would hold three entries for
 *   one control and each would be recorded separately.
 */

/** Articles dropped from the front of a target phrase. */
const LEADING_ARTICLES = ["the", "a", "an"];

/** Lower-cased, whitespace collapsed. Nothing else. */
export function normaliseWords(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A target phrase's element id: the leading article dropped, lower-cased, every
 * run of non-alphanumeric characters replaced with a hyphen.
 *
 * "the sign in button" → `sign-in-button`.
 */
export function elementId(phrase: string): string {
  let words = normaliseWords(phrase).split(" ").filter((word) => word !== "");
  if (words.length > 1 && LEADING_ARTICLES.includes(words[0]!)) words = words.slice(1);
  return words
    .join("-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The form two phrases are compared by when deciding they name the same thing.
 *
 * The element id, which is exactly the point: two phrases name one element when
 * they normalise to one id.
 */
export function phraseKey(phrase: string): string {
  return elementId(phrase);
}
