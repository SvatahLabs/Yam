/**
 * The grounding eval (T3.4, REQ-REC-10, REQ-PKG-4, LLD §16).
 *
 * "Grounding eval of at least 150 cases; accuracy at least 95 percent on the
 * sample application; report published."
 *
 * A case is a phrase, a page, and the element it means. The eval opens the page,
 * runs the same `ground()` the recorder runs, and asks one question of the
 * answer: *is that the element the phrase meant?*
 *
 * ## The ground-truth key, and why the surface cannot see it
 *
 * `apps/sample-web` stamps every interactive element with `data-yam-eval`, a
 * key that is identical across all twenty variants, and
 * `bindings.ignoreAttributes` makes the surface blind to it — the eval reads it
 * with a page script, going around the surface rather than through it (LLD §16).
 * Otherwise the label would be the best locator on the page and the eval would be
 * measuring itself.
 *
 * Without a key reader every case is `unchecked` rather than `correct`. An eval
 * that cannot check its answers publishes no number.
 *
 * ## Why absent cases are half the point
 *
 * A model that never answers null scores well on a set where every phrase names
 * something. The set has cases where it does not — a phrase borrowed from another
 * page — and answering one of those with a reference is a `false-positive`, which
 * is the failure that costs the most in production: an automation that clicks the
 * closest-looking control, confidently, every night.
 */
import type { Gateway } from "@svatah/yam-gateway";
import type { AgentSurface } from "@svatah/yam-surface";
import { ground, type GroundOptions } from "./ground.js";

export interface GroundingCase {
  readonly id: string;
  /** The page path, e.g. `/login`. */
  readonly page: string;
  /** The sample application's variant, when the case is on one. */
  readonly variant?: number;
  readonly phrase: string;
  readonly expect: "present" | "absent";
  /** The ground-truth key of the element meant. Absent cases have none. */
  readonly element?: string;
  readonly role?: string;
  readonly name?: string;
  /** Where the phrase came from: generated, or a fixture flow. */
  readonly source?: string;
}

export type GroundingEvalOutcome =
  /** The phrase was grounded to the element it meant, or correctly refused. */
  | "correct"
  /** Grounded to a different element. The failure that matters most. */
  | "wrong-element"
  /** A phrase that named something on the page came back null. */
  | "missed"
  /** A phrase that named nothing came back with a reference. */
  | "false-positive"
  /** Grounded, and the key could not be read, so the answer was not checked. */
  | "unchecked"
  /** The recorder's own refusals, reported rather than folded into a miss. */
  | "unverified"
  | "low-confidence"
  | "refused";

export interface GroundingEvalResult {
  readonly id: string;
  readonly page: string;
  readonly variant?: number;
  readonly phrase: string;
  readonly expect: GroundingCase["expect"];
  readonly outcome: GroundingEvalOutcome;
  /** The ground-truth key of what the model chose. */
  readonly chose?: string;
  /** The ground-truth key the case expected. */
  readonly expected?: string;
  readonly confidence?: number;
  readonly why?: string;
  readonly message?: string;
  readonly snapshotTokens?: number;
}

export interface GroundingEvalReport {
  readonly at: string;
  readonly gateway: { readonly name: string; readonly model: string; readonly real: boolean };
  readonly cases: number;
  readonly results: readonly GroundingEvalResult[];
  readonly totals: Record<GroundingEvalOutcome, number>;
  /** correct / cases. REQ-REC-10's threshold is 0.95. */
  readonly accuracy: number;
  readonly threshold: number;
  readonly met: boolean;
  readonly usage: {
    readonly calls: number;
    readonly cacheHits: number;
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly costUsd: number;
  };
}

export interface GroundingEvalOptions {
  readonly cases: readonly GroundingCase[];
  /** Open a session on one page of one variant. */
  readonly open: (page: string, variant: number) => Promise<AgentSurface>;
  readonly close?: (surface: AgentSurface) => Promise<void>;
  readonly gateway: Gateway;
  readonly grounding?: Omit<GroundOptions, "gateway" | "snapshot">;
  /** Read an element's ground-truth key, around the surface (LLD §16). */
  readonly groundTruth?: (surface: AgentSurface, ref: string) => Promise<string | undefined>;
  readonly threshold?: number;
  readonly onProgress?: (message: string) => void;
}

export const GROUNDING_THRESHOLD = 0.95;

export async function runGroundingEval(
  options: GroundingEvalOptions,
): Promise<GroundingEvalReport> {
  const results: GroundingEvalResult[] = [];

  /*
   * Grouped by page and variant, so one browser session answers every case on a
   * page. Opening a session per case would multiply the eval's wall clock by
   * twenty for no change in what it measures.
   */
  const groups = new Map<string, GroundingCase[]>();
  for (const one of options.cases) {
    const key = `${one.page}|${one.variant ?? 0}`;
    groups.set(key, [...(groups.get(key) ?? []), one]);
  }

  for (const [key, group] of groups) {
    const [page, variant] = key.split("|") as [string, string];
    const surface = await options.open(page, Number(variant));

    try {
      // One snapshot for the page, reused by every case on it: the page does not
      // change between two questions about it, and grounding never acts.
      const snapshot = await surface.snapshot();

      for (const one of group) {
        const { decision } = await ground(
          { id: one.id, phrase: one.phrase },
          surface,
          { gateway: options.gateway, ...(options.grounding ?? {}), snapshot },
        );

        const chose =
          decision.ref === undefined
            ? undefined
            : await options.groundTruth?.(surface, decision.ref).catch(() => undefined);

        results.push({
          id: one.id,
          page: one.page,
          ...(one.variant === undefined ? {} : { variant: one.variant }),
          phrase: one.phrase,
          expect: one.expect,
          outcome: judge(one, decision.outcome, chose, options.groundTruth !== undefined),
          ...(chose === undefined ? {} : { chose }),
          ...(one.element === undefined ? {} : { expected: one.element }),
          ...(decision.confidence === undefined ? {} : { confidence: decision.confidence }),
          ...(decision.why === undefined ? {} : { why: decision.why }),
          ...(decision.message === undefined ? {} : { message: decision.message }),
          snapshotTokens: decision.snapshotTokens,
        });
      }
      options.onProgress?.(
        `${page}${variant === "0" ? "" : `?variant=${variant}`}: ${group.length} case(s)`,
      );
    } finally {
      await (options.close?.(surface) ?? surface.close()).catch(() => undefined);
    }
  }

  const totals = {
    correct: 0,
    "wrong-element": 0,
    missed: 0,
    "false-positive": 0,
    unchecked: 0,
    unverified: 0,
    "low-confidence": 0,
    refused: 0,
  } satisfies Record<GroundingEvalOutcome, number>;
  for (const result of results) totals[result.outcome] += 1;

  const threshold = options.threshold ?? GROUNDING_THRESHOLD;
  const accuracy = results.length === 0 ? 0 : totals.correct / results.length;
  const usage = options.gateway.usage();

  return {
    at: new Date().toISOString(),
    gateway: {
      name: options.gateway.name,
      model: options.gateway.model,
      real: options.gateway.real,
    },
    cases: results.length,
    results,
    totals,
    accuracy,
    threshold,
    met: accuracy >= threshold,
    usage: {
      calls: usage.calls,
      cacheHits: usage.cacheHits,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd: usage.costUsd,
    },
  };
}

/**
 * What one answer was.
 *
 * A grounded answer is `correct` only when the key of the element chosen equals
 * the key the case recorded. "It resolved" is not the question — Phase 1's
 * healing eval learned that the hard way (LLD §16, Draft 2.3) — and neither is
 * "it looks right".
 */
function judge(
  one: GroundingCase,
  outcome: string,
  chose: string | undefined,
  canCheck: boolean,
): GroundingEvalOutcome {
  if (one.expect === "absent") {
    // Only a null is right. A low-confidence refusal means the recorder saved
    // the day, not that the grounding was right, and folding the two together
    // would hide a model that guesses.
    if (outcome === "not-found") return "correct";
    if (outcome === "grounded") return "false-positive";
    return outcome as GroundingEvalOutcome;
  }

  if (outcome === "not-found") return "missed";
  if (outcome !== "grounded") return outcome as GroundingEvalOutcome;

  if (!canCheck || chose === undefined || one.element === undefined) return "unchecked";
  return chose === one.element ? "correct" : "wrong-element";
}
