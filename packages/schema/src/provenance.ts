import { z } from "zod";

/**
 * Provenance of a model-produced artifact (LLD §3.5).
 *
 * REQ-AGT-3 and REQ-STD-4: mandatory on Tier 2/3 steps, on bindings, on heal
 * entries and on proposals; schema validation rejects artifacts without it. The
 * refinements that enforce that live next to the artifacts themselves — see
 * `stepSchema` (ir.ts) and `bindingEntrySchema` (bindings.ts).
 *
 * A human decision is recorded with `model: "human"` rather than by omitting the
 * block, so every binding has an accountable origin — that is what the `bind()`
 * interactive picker writes (LLD §6.5).
 */
export const provenanceSchema = z
  .object({
    /** Model identifier, or the literal `"human"` for a human decision. */
    model: z.string().min(1),
    /** Pinned digest of a local model (LLD §3.5, REQ-COMP-3). */
    digest: z.string().min(1).optional(),
    /** Version of the prompt that produced this artifact. */
    promptVersion: z.string().min(1),
    /** ISO-8601 timestamp. */
    at: z.string().datetime({ offset: true }),
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
  })
  .strict();

export type Provenance = z.infer<typeof provenanceSchema>;

/** The `model` value that marks a human, rather than model, decision. */
export const HUMAN_PROVENANCE_MODEL = "human";

/** True when the provenance records a human decision rather than a model call. */
export function isHumanProvenance(p: Provenance): boolean {
  return p.model === HUMAN_PROVENANCE_MODEL;
}
