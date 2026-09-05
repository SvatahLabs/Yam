import { z } from "zod";
import { bindingFileSchema } from "./bindings.js";
import { storySchema } from "./ir.js";
import { provenanceSchema } from "./provenance.js";
import { SCHEMA_VERSION } from "./version.js";

/**
 * A proposal written to `proposals/<date>/` by the trajectory compiler (HLD §6.6,
 * REQ-BEH-4) — a story draft plus a plan fragment plus unverified bindings, for a
 * person to review.
 *
 * The LLD names the artifact and its directory but does not give it a shape, so
 * this is the simplest envelope that carries what HLD §6.6 lists and satisfies
 * REQ-STD-4: a proposal is model output, so `provenance` is required, and its
 * bindings are written `verified: false` until a run confirms them.
 */
export const proposalSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** Proposal name, used as the file name under `proposals/<date>/`. */
    name: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    /** Model output: mandatory (REQ-AGT-3, REQ-STD-4). */
    provenance: provenanceSchema,
    /** The `.flow` text drafted from the trajectory; steps that would not compile appear as `// review:` comments. */
    flow: z.string(),
    /** The compiled fragment, when a Tier 1 compile of the draft succeeded. */
    story: storySchema.optional(),
    /** Bindings synthesised at capture time; always `verified: false` in a proposal. */
    bindings: z.array(bindingFileSchema),
    /** The trajectory file this proposal was compiled from. */
    sourceTrajectory: z.string().min(1).optional(),
    notes: z.array(z.string()).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    p.bindings.forEach((file, fileIndex) => {
      file.entries.forEach((entry, entryIndex) => {
        if (entry.verified) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["bindings", fileIndex, "entries", entryIndex, "verified"],
            message:
              "A proposal's bindings are unreviewed and must be written verified: false (REQ-BEH-4).",
          });
        }
      });
    });
  });
export type Proposal = z.infer<typeof proposalSchema>;
