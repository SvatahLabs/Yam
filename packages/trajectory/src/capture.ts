/**
 * Capturing a trajectory (T4.6, REQ-BEH-4, LLD §13.4).
 *
 * > Capture: the MCP raw-surface tools (`surface.snapshot|act|read|check`)
 * > require an `intent` string per call; the CLI writes `trajectory.jsonl` lines
 * > `{ seq, intent, call, snapshotHash, ref, describe }`.
 *
 * This is the capture half. The compile half — turning a trajectory into a story
 * draft, a plan fragment and `verified: false` bindings under `proposals/` — is
 * T5.5, and the shape written here is what it will read.
 *
 * ## Why `intent` is required rather than optional
 *
 * A trajectory of surface calls with no intents is a log. What makes it
 * *compilable* is that each call says what the agent was trying to do — "sign in
 * as the enterprise user", not "click r14" — because the sentence a step
 * compiles from is the intent and nothing else could be (LLD §13.4: "the intent
 * becomes the sentence after normalisation through the synonym vocabulary").
 *
 * So the MCP tools take it as a required parameter. An agent that cannot say
 * what it is doing is an agent whose exploration cannot become a deterministic
 * tool, which is the whole of REQ-BEH-4.
 *
 * ## Why the description is captured at the time of the call
 *
 * "candidates and fingerprints are synthesised at capture time (no model)". A
 * reference is stable within a snapshot and lost on navigation, so an element
 * described an hour later is a different element or none at all. `describe` is
 * read when the call is made, which is the only moment it means anything.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { canonicalJsonCompact, elementDescriptionSchema, refSchema } from "@svatah/schema";

/** Which surface call a line records. */
export const trajectoryCallSchema = z.enum(["snapshot", "act", "read", "check"]);
export type TrajectoryCall = z.infer<typeof trajectoryCallSchema>;

export const trajectoryLineSchema = z
  .object({
    /** 1-based, and the order the calls were made in. */
    seq: z.number().int().positive(),
    /** What the agent said it was doing. Required (LLD §13.4). */
    intent: z.string().min(1),
    call: trajectoryCallSchema,
    at: z.string().min(1),
    /** The arguments the call was made with, less the intent. */
    args: z.record(z.string().min(1), z.unknown()).optional(),
    /**
     * The structural hash of the page as it was (LLD §6.2).
     *
     * What lets the compiler group calls that happened on one screen, and what
     * tells it a navigation happened between two that it cannot see otherwise.
     */
    snapshotHash: z.string().optional(),
    /**
     * The URL the call was made on (T5.5).
     *
     * LLD §13.4 lists `{ seq, intent, call, snapshotHash, ref, describe }` and
     * this is one more, for one reason: a binding entry is keyed by a *context*,
     * and a context is a URL pattern plus a structural hash (LLD §3.3, §6.2).
     * The hash is here; without the URL the compiler would have to invent the
     * pattern, and a proposal's binding would be addressed to a page nobody
     * could name. Optional, so a trajectory captured before this — or by a
     * non-web adapter, which has no URL — still reads and still compiles.
     */
    url: z.string().optional(),
    /** The reference the call acted on, when it acted on one. */
    ref: refSchema.optional(),
    /**
     * Everything synthesis and fingerprinting need about that element, read at
     * the moment of the call — the only moment a reference means anything.
     */
    describe: elementDescriptionSchema.optional(),
    /** What the call returned, for `read` and `check`. */
    result: z.unknown().optional(),
    /** Set when the call threw. A trajectory records what happened, not what worked. */
    error: z.string().optional(),
  })
  .strict();

export type TrajectoryLine = z.infer<typeof trajectoryLineSchema>;

/**
 * Append-only, one JSON object per line, flushed per call.
 *
 * Flushed rather than buffered because the interesting trajectories are the ones
 * that end badly: an agent that crashed, or was killed, or drove the application
 * into a state nobody expected. A writer that lost the last twenty calls would
 * lose exactly the ones worth reading.
 */
export class TrajectoryWriter {
  private seq = 0;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  /** How many lines this writer has written. */
  get count(): number {
    return this.seq;
  }

  /**
   * Record one call.
   *
   * Canonical JSON with sorted keys and no whitespace, so two captures of the
   * same calls are the same bytes and a trajectory diffs like every other
   * artifact this project writes — and so one line is one object, which is what
   * JSON-lines means (LLD §3, `canonicalJsonCompact`).
   */
  write(line: Omit<TrajectoryLine, "seq" | "at"> & { at?: string }): TrajectoryLine {
    this.seq += 1;
    const full = trajectoryLineSchema.parse({
      seq: this.seq,
      at: line.at ?? new Date().toISOString(),
      ...line,
    });
    appendFileSync(this.path, `${canonicalJsonCompact(full)}\n`, "utf8");
    return full;
  }
}

/** Read a `trajectory.jsonl`, validating every line (REQ-STD-1). */
export function readTrajectory(path: string): TrajectoryLine[] {
  const lines = readFileSync(path, "utf8").split("\n");
  const out: TrajectoryLine[] = [];
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (cause) {
      throw new Error(`${path}:${index + 1} is not valid JSON`, { cause });
    }
    const parsed = trajectoryLineSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `${path}:${index + 1} is not a valid trajectory line:\n` +
          parsed.error.issues
            .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("\n"),
      );
    }
    out.push(parsed.data);
  });
  return out;
}

/**
 * Whether a trajectory is well formed: sequential, intent-carrying, and in order.
 *
 * The three properties T5.5's compiler will depend on, checked here so a capture
 * that broke one of them is a failure at capture time rather than a puzzle a
 * phase later.
 */
export function checkTrajectory(lines: readonly TrajectoryLine[]): string[] {
  const problems: string[] = [];
  lines.forEach((line, index) => {
    if (line.seq !== index + 1) problems.push(`line ${index + 1} has seq ${line.seq}`);
    if (line.intent.trim() === "") problems.push(`line ${index + 1} has an empty intent`);
    if (index > 0 && line.at < lines[index - 1]!.at) {
      problems.push(`line ${index + 1} is timestamped before the one before it`);
    }
  });
  return problems;
}
