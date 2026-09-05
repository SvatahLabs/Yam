import { z } from "zod";
import { provenanceSchema } from "./provenance.js";
import { SCHEMA_VERSION } from "./version.js";

/* ── Candidates (LLD §3.3) ────────────────────────────────────────────────── */

/** Web candidate kinds. */
export const WEB_CANDIDATE_KINDS = [
  "role",
  "label",
  "placeholder",
  "testid",
  "text",
  "altText",
  "title",
  "css",
  "xpath",
  "id",
  "name",
] as const;

/** Mobile candidate kinds (Appium). */
export const MOBILE_CANDIDATE_KINDS = ["accessibilityId", "resourceId"] as const;

/**
 * Desktop candidate kinds (Windows UIA, macOS AX).
 * `controlPath` looks like `Window[name]/Pane[2]/Button[name]`.
 */
export const DESKTOP_CANDIDATE_KINDS = ["automationId", "controlPath"] as const;

/** A tool the page declared through WebMCP; preferred over locators at replay (REQ-ADP-9). */
export const WEBMCP_CANDIDATE_KIND = "webmcp" as const;

/** Last resort: the element's box centre. */
export const COORDS_CANDIDATE_KIND = "coords" as const;

export const CANDIDATE_KINDS = [
  ...WEB_CANDIDATE_KINDS,
  ...MOBILE_CANDIDATE_KINDS,
  ...DESKTOP_CANDIDATE_KINDS,
  WEBMCP_CANDIDATE_KIND,
  COORDS_CANDIDATE_KIND,
] as const;

export const candidateKindSchema = z.enum(CANDIDATE_KINDS);
export type CandidateKind = z.infer<typeof candidateKindSchema>;

export const candidateSchema = z
  .object({
    by: candidateKindSchema,
    role: z.string().min(1).optional(),
    name: z.string().optional(),
    exact: z.boolean().optional(),
    /** The selector body for `css`, `xpath`, `id`, `testid`, …; or `"x,y"` for `coords`. */
    value: z.string().optional(),
    attribute: z.string().min(1).optional(),
    /** Disambiguates a candidate that legitimately matches more than one element. */
    nth: z.number().int().nonnegative().optional(),
    /** `webmcp` only: the declared tool name. */
    tool: z.string().min(1).optional(),
    /** `webmcp` only: step argument name → tool parameter name. */
    paramMap: z.record(z.string().min(1), z.string().min(1)).optional(),
    /** Synthesis score; the resolver tries candidates in the order stored. */
    score: z.number(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.by === WEBMCP_CANDIDATE_KIND && c.tool === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tool"],
        message: 'A "webmcp" candidate must name the declared tool (LLD §3.3).',
      });
    }
  });
export type Candidate = z.infer<typeof candidateSchema>;

/* ── Fingerprint (LLD §3.3) ───────────────────────────────────────────────── */

/** `[x, y, width, height]`. */
export const boxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type Box = z.infer<typeof boxSchema>;

export const fingerprintSchema = z
  .object({
    /** HTML tag, UIA ControlType, AX role or Appium class, per adapter. */
    tag: z.string().min(1),
    attrs: z.record(z.string().min(1), z.string()),
    /** The element's own text. */
    text: z.string(),
    neighbours: z
      .object({ before: z.array(z.string()), after: z.array(z.string()) })
      .strict(),
    /** Roles from the root down to the element. */
    rolePath: z.array(z.string()),
    box: boxSchema,
    /** Index among siblings of the same role. */
    index: z.number().int().nonnegative(),
  })
  .strict();
export type Fingerprint = z.infer<typeof fingerprintSchema>;

/* ── Binding entries and files (LLD §3.3) ─────────────────────────────────── */

export const bindingPlatformSchema = z.enum(["web", "mobile", "desktop"]);
export type BindingPlatform = z.infer<typeof bindingPlatformSchema>;

export const bindingContextSchema = z
  .object({
    /** URL or window-title pattern this entry applies to. */
    pattern: z.string().min(1),
    /** Structural hash of the surrounding subtree (LLD §6.2). */
    hash: z.string().min(1),
    viewport: z.tuple([z.number(), z.number()]).optional(),
    platform: bindingPlatformSchema,
  })
  .strict();
export type BindingContext = z.infer<typeof bindingContextSchema>;

/**
 * One recorded binding for one context.
 *
 * `provenance` is required: REQ-STD-4 rejects an artifact without it. A binding a
 * person picked interactively records `model: "human"` (LLD §6.5) rather than
 * omitting the block.
 */
export const bindingEntrySchema = z
  .object({
    context: bindingContextSchema,
    candidates: z.array(candidateSchema).min(1),
    fingerprint: fingerprintSchema,
    recordedAt: z.string().datetime({ offset: true }),
    provenance: provenanceSchema,
    /** Set once the recorder or healer performed the step and its expectation held. */
    verified: z.boolean(),
    /** Lineage kept by relocalization (LLD §6.4). */
    previous: z
      .array(z.object({ fingerprint: fingerprintSchema, provenance: provenanceSchema }).strict())
      .optional(),
  })
  .strict();
export type BindingEntry = z.infer<typeof bindingEntrySchema>;

export const bindingFileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    /** Element id, e.g. `login.username-field`. */
    id: z.string().min(1),
    /** Every phrase that resolves to this element. */
    phrases: z.array(z.string().min(1)),
    entries: z.array(bindingEntrySchema).min(1),
  })
  .strict();
export type BindingFile = z.infer<typeof bindingFileSchema>;
