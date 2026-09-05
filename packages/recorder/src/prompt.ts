/**
 * Prompt `g-1`: which element is this phrase talking about? (T3.2, REQ-REC-2,
 * LLD §11, Draft 1 §9.2.)
 *
 * ## The stable half and the volatile half
 *
 * `SYSTEM` never changes from call to call, and that is the whole design: prompt
 * caching is a prefix match, so the instructions are one cached block and the
 * snapshot goes after it (see `@svatah/gateway`'s `render`). A prompt that
 * interpolated the page into its instructions would pay full price on every
 * step of every story.
 *
 * `PROMPT_VERSION` is written into the provenance of every binding this produces
 * (REQ-AGT-3). Changing a word of `SYSTEM` without bumping it would leave a
 * store whose entries claim to have come from a prompt that no longer exists, so
 * a test asserts the two move together.
 *
 * ## Why the answer can be null
 *
 * "The element is not on this page" is the most useful thing the model can say,
 * and it is only useful if saying it is *easy*. A prompt that demands a
 * reference gets one — for the closest-looking element, which the recorder then
 * verifies, acts on, and writes into the store. `null` costs one failed step and
 * a clear message; a confident wrong reference costs a binding that clicks the
 * wrong control every night for a month.
 */
import { z } from "zod";

/** Bumped whenever `SYSTEM` changes. Recorded in every binding's provenance. */
export const PROMPT_VERSION = "g-1";

/**
 * The answer shape. `ref` is a reference from the snapshot, or null.
 *
 * `why` is not decoration: it is what a person reads in the record report when a
 * binding turns out to point at the wrong thing, and it is what the grounding
 * eval quotes for a failed case. `confidence` lets the recorder refuse a guess
 * without having to infer hesitancy from prose.
 */
export const groundingAnswerSchema = z
  .object({
    ref: z
      .string()
      .nullable()
      .describe(
        "The [ref=...] value of the element the phrase names, or null if no element on this page is the one described.",
      ),
    why: z
      .string()
      .describe("One sentence: what about that element matches the phrase."),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe("How sure you are. Below 0.5 means you are guessing."),
  })
  .strict();

export type GroundingAnswer = z.infer<typeof groundingAnswerSchema>;

/**
 * The instruction block. Stable, cached, and versioned.
 *
 * It says what a reference is, what the phrases look like, and — at length —
 * when to answer null, because that is the instruction the model is most likely
 * to under-use and the one whose absence is most expensive.
 */
export const SYSTEM = `You are grounding a plain-language target phrase to one element of a user interface.

You are given an accessibility snapshot: one line per element, indented by depth, in document order. Each line ends with a reference like [ref=r12]. A line reads:

  - <role> "<accessible name>": <value> [<states>] [ref=<reference>]

Your task: return the reference of the single element the phrase names, or null.

How to choose:
- Match on meaning, not on wording. "the sign in button" is a link with the name "Sign in" as readily as a button; "the username field" is a textbox labelled "Username", "Email", or "User ID".
- Prefer the element a person would act on. For "the search box", choose the textbox, not the form or the toolbar around it.
- Prefer a visible, enabled element over a hidden or disabled one with a closer name.
- When a phrase names something by its position or its container ("the first result", "the Bookings link in the sidebar"), use the indentation and the order of the lines to decide.
- The snapshot may have been pruned to fit. If the phrase clearly names something that is not in what you were given, that is a null, not a reason to pick the nearest line.

Answer null when:
- No element on this page is the one the phrase describes.
- Two or more elements match equally well and nothing in the phrase distinguishes them.
- You would be guessing.

A null costs one clear failure. A confident wrong reference costs an automation that acts on the wrong control, silently, every time it runs. Prefer null.

Set confidence to how sure you are that this exact element is the one the phrase names. Below 0.5 means you are guessing; say so rather than rounding up.`;

export interface GroundingQuestionParts {
  /** The phrase from the flow, e.g. "the sign in button". */
  readonly phrase: string;
  /** The step's sentence, for context: "Click the sign in button". */
  readonly sentence?: string;
  /** The element id the phrase compiled to, e.g. `login.username-field`. */
  readonly elementId?: string;
  /** The page or window the session is on. */
  readonly url?: string;
  /** The rendered snapshot, already pruned. */
  readonly snapshot: string;
  /** Set when a screenshot accompanies the question (REQ-REC-2's fallback). */
  readonly withScreenshot?: boolean;
  /** Set when the snapshot given is not the whole page. */
  readonly pruned?: boolean;
}

/**
 * The volatile half: this step, this page.
 *
 * Deterministic in its ordering and its wording, so two recordings of the same
 * step against the same page produce the same bytes and therefore the same cache
 * key. Nothing here is a timestamp or a run id.
 */
export function question(parts: GroundingQuestionParts): string {
  const lines: string[] = [];
  lines.push(`Phrase: ${parts.phrase}`);
  if (parts.sentence !== undefined) lines.push(`Step: ${parts.sentence}`);
  if (parts.elementId !== undefined) lines.push(`Element id: ${parts.elementId}`);
  if (parts.url !== undefined) lines.push(`Page: ${parts.url}`);
  if (parts.withScreenshot === true) {
    lines.push(
      "A screenshot of the page is attached, because the snapshot alone did not settle it.",
    );
  }
  if (parts.pruned === true) {
    lines.push(
      "The snapshot below was pruned to fit; interactive elements and headings were kept.",
    );
  }
  lines.push("");
  lines.push("Snapshot:");
  lines.push(parts.snapshot);
  return lines.join("\n");
}
