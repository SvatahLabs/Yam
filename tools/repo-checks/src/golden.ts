import { readFileSync } from "node:fs";
import { z } from "zod";
import { stepSchema, tierSchema, type Step } from "@svatah/schema";

/**
 * The compiler golden set (REQ-COMP-9, T0.6).
 *
 * An entry is a sentence plus the part of the compiled step the sentence
 * determines. The mechanical fields — `id`, `storyName`, `line`, `text`,
 * `timeoutMs` and `origin` — are filled in by the compiler for every step and
 * would be noise in the file, so `materialise` adds them before the entry is
 * validated against the published step schema.
 *
 * This lives in `tools/repo-checks` for Phase 0 because no compiler exists yet.
 * T4.4 builds `svatah eval compiler`, at which point the reader moves into
 * `@svatah/compiler` and this becomes a re-export.
 */

/** The distinctive part of a compiled step: what the sentence itself determines. */
const goldenStepSchema = stepSchema.innerType()
  .omit({ id: true, storyName: true, line: true, text: true, timeoutMs: true, origin: true })
  .partial()
  .required({ action: true })
  .strict();

export const goldenEntrySchema = z
  .object({
    /** `g-001` style, unique and stable so a report can cite one. */
    id: z.string().regex(/^g-\d{3,}$/),
    /** Which compiler tier is expected to produce this step (REQ-COMP-9). */
    tier: tierSchema,
    /** The `docs/flow-language.md` pattern number; 0 for a Tier 0 custom step. */
    pattern: z.number().int().min(0).max(30),
    /** The grammar rule or custom-step id expected in `origin.rule`. */
    rule: z.string().min(1),
    /** The sentence as an author would write it. */
    text: z.string().min(1),
    step: goldenStepSchema,
  })
  .strict();

export type GoldenEntry = z.infer<typeof goldenEntrySchema>;

/** Build the full `Step` a compiler would emit for an entry. */
export function materialise(entry: GoldenEntry, storyName = "Golden", line = 1): Step {
  return {
    id: `${storyName}/${entry.id}`,
    storyName,
    line,
    text: entry.text,
    timeoutMs: 10_000,
    origin: { tier: entry.tier, rule: entry.rule, confidence: 1 },
    ...entry.step,
  } as Step;
}

/** Read and parse a `golden.jsonl` file. Throws with the line number on bad input. */
export function readGolden(path: string): GoldenEntry[] {
  const lines = readFileSync(path, "utf8").split("\n");
  const entries: GoldenEntry[] = [];
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (cause) {
      throw new Error(`${path}:${index + 1} is not valid JSON`, { cause });
    }
    const parsed = goldenEntrySchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `${path}:${index + 1} is not a valid golden entry: ${JSON.stringify(parsed.error.issues)}`,
      );
    }
    entries.push(parsed.data);
  });
  return entries;
}
