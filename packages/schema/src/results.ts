import { z } from "zod";
import { candidateKindSchema, candidateSchema } from "./bindings.js";
import { onFailureSchema } from "./ir.js";
import { sessionStateSchema } from "./surface.js";
import { SCHEMA_VERSION } from "./version.js";

/* ── Failure classes (LLD §3.4, §8.4, REQ-RUN-8) ──────────────────────────── */

export const FAILURE_CLASSES = [
  "locator",
  "timeout",
  "assertion",
  /** Added in Draft 2: the guard itself errored, e.g. an unresolved reference. */
  "guard",
  "data",
  "navigation",
  "dialog",
  "script",
  "infrastructure",
  "unknown",
] as const;
export const failureClassSchema = z.enum(FAILURE_CLASSES);
export type FailureClass = z.infer<typeof failureClassSchema>;

/* ── Behaviors and statuses ───────────────────────────────────────────────── */

export const behaviorSchema = z.enum(["test", "workflow", "tool"]);
export type Behavior = z.infer<typeof behaviorSchema>;

/** `aborted` was added in Draft 2 for the abort policies (REQ-AUTO-4). */
export const STEP_STATUSES = ["passed", "failed", "skipped", "healed", "aborted"] as const;
export const stepStatusSchema = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof stepStatusSchema>;

export const FLOW_STATUSES = ["passed", "failed", "healed", "aborted"] as const;
export const flowStatusSchema = z.enum(FLOW_STATUSES);
export type FlowStatus = z.infer<typeof flowStatusSchema>;

/* ── Invoker (LLD §3.4, REQ-AUTO-6) ───────────────────────────────────────── */

export const invokerSchema = z
  .object({
    kind: z.enum(["user", "ci", "agent"]),
    id: z.string().min(1),
    via: z.enum(["cli", "mcp", "host"]),
  })
  .strict();
export type Invoker = z.infer<typeof invokerSchema>;

/* ── Step result (LLD §3.4, REQ-RUN-7) ────────────────────────────────────── */

export const stepResultSchema = z
  .object({
    runId: z.string().min(1),
    behavior: behaviorSchema,
    flow: z.string().min(1),
    story: z.string().min(1),
    stepId: z.string().min(1),
    line: z.number().int().positive(),
    text: z.string(),
    status: stepStatusSchema,
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }),
    durationMs: z.number().nonnegative(),
    /** Which candidate resolved the target, so a foreign runtime can be compared (REQ-STD-3). */
    matched: z
      .object({
        ref: z.string().min(1),
        candidateIndex: z.number().int().nonnegative(),
        by: candidateKindSchema,
      })
      .strict()
      .optional(),
    captured: z.record(z.string().min(1), z.unknown()).optional(),
    failure: z
      .object({
        class: failureClassSchema,
        message: z.string(),
        /** Every candidate the resolver tried, in order (REQ-RUN-5). */
        candidatesTried: z.array(candidateSchema).optional(),
        screenshot: z.string().min(1).optional(),
        stack: z.string().optional(),
        policyApplied: onFailureSchema.optional(),
        /**
         * The surface state at failure (Draft 2.4, LLD §3.4).
         *
         * "The surface state at failure, so a healer can restore it without a
         * plan." A run directory that records only *what* failed leaves module
         * (a)'s session-state replayer with nowhere to go, which is why
         * `svatah-bindings heal --run` used to answer `unreachable` for every
         * flow failure.
         */
        session: sessionStateSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.status === "failed" && r.failure === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failure"],
        message: 'A step with status "failed" must record its failure class (REQ-RUN-8).',
      });
    }
  });
export type StepResult = z.infer<typeof stepResultSchema>;

/* ── Summary (LLD §3.4, REQ-RUN-9) ────────────────────────────────────────── */

export const summarySchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    runId: z.string().min(1),
    behavior: behaviorSchema,
    planHash: z.string().min(1),
    bindingsHash: z.string().min(1),
    configHash: z.string().min(1),
    invoker: invokerSchema,
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }),
    flows: z.record(
      z.string().min(1),
      z
        .object({
          status: flowStatusSchema,
          passed: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
          skipped: z.number().int().nonnegative(),
          trace: z.string().min(1).optional(),
        })
        .strict(),
    ),
    /** Workflow and tool behaviors return the invoked stories' outputs here. */
    outputs: z.record(z.string().min(1), z.unknown()).optional(),
    /**
     * The *names* of the inputs this run was given (Draft 2.6, LLD §10).
     *
     * Names, never values: an input may be a secret, and a run directory is a
     * thing people attach to bug reports (REQ-NFR-6). What the names buy is that
     * a later `svatah heal --run <id>` whose replay cannot get past
     * `Type {input.password}` can say *which* input it is missing, instead of
     * reporting `unreachable` and leaving the reader to guess.
     */
    inputs: z.array(z.string().min(1)).optional(),
    totals: z
      .object({
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        healed: z.number().int().nonnegative(),
        aborted: z.number().int().nonnegative(),
      })
      .strict(),
    /** Non-zero on failed, healed or aborted (REQ-RUN-9). */
    exitCode: z.number().int().nonnegative(),
  })
  .strict();
export type Summary = z.infer<typeof summarySchema>;

/* ── Audit (LLD §3.4, REQ-AUTO-6) ─────────────────────────────────────────── */

export const AUDIT_KINDS = [
  "run",
  "story",
  "surface",
  "input",
  "output",
  "policy",
  /*
   * Draft 2.9 LLD §3.2: "a dialog answered with no armed policy writes an audit
   * line `kind:"dialog", armed:false, answer:"accept"` so the default is never
   * silent." A dialog is answered by the adapter's own event handler, outside
   * any surface call, so nothing else in this file would ever mention it.
   */
  "dialog",
] as const;
export const auditKindSchema = z.enum(AUDIT_KINDS);
export type AuditKind = z.infer<typeof auditKindSchema>;

export const auditLineSchema = z
  .object({
    runId: z.string().min(1),
    at: z.string().datetime({ offset: true }),
    /** Monotonically increasing within a run (LLD §8.6). */
    seq: z.number().int().nonnegative(),
    kind: auditKindSchema,
    story: z.string().min(1).optional(),
    stepId: z.string().min(1).optional(),
    /** One line per surface call, with args already redacted (REQ-NFR-6). */
    call: z
      .object({
        method: z.string().min(1),
        action: z.string().min(1).optional(),
        ref: z.string().min(1).optional(),
        args: z.unknown().optional(),
      })
      .strict()
      .optional(),
    outcome: z.enum(["ok", "error"]).optional(),
    /** `kind: "dialog"`: whether a `dialog` step had armed this answer. */
    armed: z.boolean().optional(),
    /** `kind: "dialog"`: what the dialog was answered with. */
    answer: z.enum(["accept", "dismiss"]).optional(),
    error: z.string().optional(),
    durationMs: z.number().nonnegative().optional(),
    /** Redacted detail: run-level inputs, collected outputs, the policy applied. */
    detail: z.unknown().optional(),
  })
  .strict();
export type AuditLine = z.infer<typeof auditLineSchema>;

/* ── Checkpoint (LLD §3.4, REQ-AUTO-2) ────────────────────────────────────── */

/**
 * Enough state to resume a flow from this step (REQ-AUTO-3).
 *
 * Run data is deliberately absent: it is read-only and global, so it is re-read
 * from `data.yaml` on resume rather than copied into every checkpoint — which
 * also keeps secrets out of the run directory (LLD §3.4, REQ-NFR-6).
 */
export const checkpointSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    runId: z.string().min(1),
    flow: z.string().min(1),
    story: z.string().min(1),
    stepId: z.string().min(1),
    at: z.string().datetime({ offset: true }),
    /** Resume is refused when either hash differs from the current artifacts (REQ-AUTO-3). */
    planHash: z.string().min(1),
    bindingsHash: z.string().min(1),
    scope: z
      .object({
        inputs: z.record(z.string().min(1), z.unknown()),
        /** Story name → that story's captures. */
        captures: z.record(z.string().min(1), z.record(z.string().min(1), z.unknown())),
      })
      .strict(),
    session: sessionStateSchema,
  })
  .strict();
export type Checkpoint = z.infer<typeof checkpointSchema>;
