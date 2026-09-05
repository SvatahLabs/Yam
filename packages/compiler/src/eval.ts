/**
 * The compiler eval (T4.3, T4.4, REQ-COMP-9, REQ-PKG-4).
 *
 * > Compiler golden set of at least 300 pairs; Tier 1 exact match 100 percent on
 * > its subset; end-to-end at least 95 percent; report published per release.
 *
 * One sentence, one expected step, one measured step, per tier. The measure is
 * **exact match** on the part of the step the sentence determines — the action,
 * the target phrase, the arguments, the expectation, the capture. The mechanical
 * fields are not compared: the step id is positional, the timeout comes from the
 * config, and `origin.provenance` is different on every run by construction, so
 * comparing them would be measuring the harness.
 *
 * The golden reader lives here rather than in `tools/repo-checks` as of T4.4, so
 * that the thing which *scores* the compiler and the thing which *checks the
 * corpus* read the same file with the same code.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  canonicalJson,
  stepSchema,
  tierSchema,
  type Step,
  type Tier,
} from "@svatah/schema";

/** The distinctive part of a compiled step: what the sentence itself determines. */
const goldenStepSchema = stepSchema
  .innerType()
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
    /**
     * The `docs/flow-language.md` pattern number.
     *
     * `0` when no grammar pattern applies: a Tier 0 custom step, or a Tier 2/3
     * paraphrase — a sentence the grammar deliberately refuses, which is what
     * gives a model tier anything to do.
     */
    pattern: z.number().int().min(0).max(30),
    /**
     * What `origin.rule` should say: the grammar rule, the custom step's id, or
     * — for a model tier, which has no rule — the action it produced.
     */
    rule: z.string().min(1),
    /** The sentence as an author would write it. */
    text: z.string().min(1),
    step: goldenStepSchema,
  })
  .strict();

export type GoldenEntry = z.infer<typeof goldenEntrySchema>;

/**
 * A stand-in provenance for a model tier's entry (REQ-STD-4).
 *
 * The schema requires provenance on any step whose tier is 2 or 3. A golden
 * entry is not a step a model produced — it is what the step should look like —
 * so the one it materialises with names itself. Nothing writes this to disk.
 */
export const GOLDEN_PROVENANCE = {
  model: "golden:expected",
  promptVersion: "golden",
  at: "1970-01-01T00:00:00.000Z",
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
} as const;

/** Build the full `Step` a compiler would emit for an entry. */
export function materialise(entry: GoldenEntry, storyName = "Golden", line = 1): Step {
  return {
    id: `${storyName}/${entry.id}`,
    storyName,
    line,
    text: entry.text,
    timeoutMs: 10_000,
    origin: {
      tier: entry.tier,
      rule: entry.rule,
      confidence: 1,
      ...(entry.tier === 2 || entry.tier === 3 ? { provenance: GOLDEN_PROVENANCE } : {}),
    },
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
        `${path}:${index + 1} is not a valid golden entry:\n` +
          parsed.error.issues
            .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("\n"),
      );
    }
    entries.push(parsed.data);
  });
  return entries;
}

/* ── scoring ──────────────────────────────────────────────────────────────── */

/**
 * The part of a step two compilers must agree on to have compiled the same
 * sentence the same way.
 *
 * Not the whole step. `id` is positional, `line` is where the sentence sat,
 * `timeoutMs` comes from the config, and `origin.provenance` names a model call
 * that happened once — none of which is a property of the *translation*.
 * `origin.tier` is kept, because which tier answered is exactly what a per-tier
 * report is about.
 */
export function comparable(step: Step): Record<string, unknown> {
  const { id: _id, storyName: _s, line: _l, text: _t, timeoutMs: _ms, origin, ...rest } = step as
    Step & Record<string, unknown>;
  return { ...rest, tier: origin.tier };
}

export interface CaseResult {
  readonly id: string;
  readonly tier: Tier;
  readonly text: string;
  readonly ok: boolean;
  /** What differed, for a report a person can act on. Absent when it matched. */
  readonly expected?: string;
  readonly actual?: string;
  /** Set when the sentence produced no step at all. */
  readonly error?: string;
}

export interface EvalReport {
  readonly at: string;
  /** Which gateway produced the model-tier answers; "(none)" when no tier ran. */
  readonly gateway: string;
  /** True only when a real model answered. A fake's numbers are not a model's. */
  readonly real: boolean;
  readonly cases: readonly CaseResult[];
  readonly byTier: Readonly<Record<string, { total: number; matched: number; rate: number }>>;
  readonly totals: { total: number; matched: number; rate: number };
}

/** Score one measured step against the golden entry it was measured for. */
export function scoreCase(entry: GoldenEntry, actual: Step | undefined, error?: string): CaseResult {
  if (actual === undefined) {
    return {
      id: entry.id,
      tier: entry.tier,
      text: entry.text,
      ok: false,
      expected: canonicalJson(comparable(materialise(entry))),
      ...(error === undefined ? {} : { error }),
    };
  }
  const expected = canonicalJson(comparable(materialise(entry)));
  const measured = canonicalJson(comparable(actual));
  return expected === measured
    ? { id: entry.id, tier: entry.tier, text: entry.text, ok: true }
    : { id: entry.id, tier: entry.tier, text: entry.text, ok: false, expected, actual: measured };
}

/** Roll a list of case results into per-tier and overall rates. */
export function summarise(
  cases: readonly CaseResult[],
  meta: { gateway: string; real: boolean; at?: string },
): EvalReport {
  const byTier: Record<string, { total: number; matched: number; rate: number }> = {};
  for (const one of cases) {
    const key = `tier${one.tier}`;
    const bucket = (byTier[key] ??= { total: 0, matched: 0, rate: 0 });
    bucket.total += 1;
    if (one.ok) bucket.matched += 1;
  }
  for (const bucket of Object.values(byTier)) {
    bucket.rate = bucket.total === 0 ? 0 : bucket.matched / bucket.total;
  }

  const matched = cases.filter((c) => c.ok).length;
  return {
    at: meta.at ?? new Date().toISOString(),
    gateway: meta.gateway,
    real: meta.real,
    cases,
    byTier,
    totals: {
      total: cases.length,
      matched,
      rate: cases.length === 0 ? 0 : matched / cases.length,
    },
  };
}
