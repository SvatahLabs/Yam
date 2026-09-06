/**
 * Model-free relocalization (LLD §6.4, REQ-HEAL-1).
 *
 * When a binding stops resolving, the element has usually not gone: it has been
 * renamed, restyled, reordered or wrapped. The fingerprint recorded with the
 * binding describes what the element *was* in seven ways, and relocalization
 * scores every element now on the page against it. No model is involved — that is
 * the whole claim of REQ-HEAL-1's first half, and the number it produces is
 * published honestly (REQ-HEAL-5).
 *
 * The weights are LLD §6.4's:
 *
 *   0.30 · attrJaccard + 0.25 · textSim + 0.20 · neighbourSim
 * + 0.15 · rolePathSim + 0.10 · boxProximity
 *
 * with `heal.relocalizeThreshold` (0.72) and `heal.margin` (0.10). The margin is
 * as important as the threshold: two elements that both score 0.9 mean the
 * fingerprint cannot tell them apart, and accepting the higher one would be a
 * coin toss dressed as a repair. Two identical buttons is the case that has to
 * fail, and it is the one the eval checks (T1.5).
 *
 * Everything operates on `surface.describe()` output, so it works on any adapter.
 */
import type { ElementDescription, Fingerprint, Ref } from "@svatah/schema";
import type { AgentSurface } from "@svatah/surface";
import { fingerprintOf } from "./synthesis.js";

/** The weights of LLD §6.4. They sum to 1. */
export const WEIGHTS = {
  attrs: 0.3,
  text: 0.25,
  neighbours: 0.2,
  rolePath: 0.15,
  box: 0.1,
} as const;

/** `heal.relocalizeThreshold` — below this, nothing is proposed. */
export const DEFAULT_THRESHOLD = 0.72;
/** `heal.margin` — the best must beat the runner-up by this much. */
export const DEFAULT_MARGIN = 0.1;

/** How many elements are described and scored before giving up. */
export const DEFAULT_MAX_CANDIDATES = 300;

export interface Score {
  readonly total: number;
  readonly attrs: number;
  readonly text: number;
  readonly neighbours: number;
  readonly rolePath: number;
  readonly box: number;
}

export interface Match {
  readonly ref: Ref;
  readonly score: Score;
  readonly description: ElementDescription;
}

export interface RelocalizeOptions {
  threshold?: number;
  margin?: number;
  maxCandidates?: number;
  /** Consider only elements with this role first; widen if nothing clears. */
  preferRole?: string;
  /**
   * Attributes that must not influence the score
   * (`config.bindings.ignoreAttributes`, LLD §3.5). Defaults to the schema's
   * default, which is the healing eval's ground-truth label: scoring on it
   * would let the eval find the answer in the answer key.
   */
  ignoreAttributes?: readonly string[];
}

export type RelocalizeResult =
  | {
      readonly outcome: "relocalized";
      readonly match: Match;
      /** Everything scored, best first — the evidence for the proposal. */
      readonly ranked: readonly Match[];
    }
  | {
      /** Nothing scored above the threshold. */
      readonly outcome: "not-found";
      readonly ranked: readonly Match[];
      readonly best?: Match;
    }
  | {
      /**
       * Two or more elements are too close to tell apart. This is a refusal, not
       * a failure to try: accepting one would be a guess (LLD §6.4).
       */
      readonly outcome: "ambiguous";
      readonly ranked: readonly Match[];
      readonly best: Match;
      readonly runnerUp: Match;
      readonly margin: number;
    };

/* ── the five similarity measures ─────────────────────────────────────────── */

/** Jaccard over `key=value` pairs. */
export function attrSimilarity(a: Record<string, string>, b: Record<string, string>): number {
  const left = new Set(Object.entries(a).map(([k, v]) => `${k}=${v}`));
  const right = new Set(Object.entries(b).map(([k, v]) => `${k}=${v}`));
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const entry of left) if (right.has(entry)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Words, lower-cased, punctuation dropped. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== "");
}

/**
 * Dice similarity over word tokens, with an exact-match shortcut.
 *
 * Dice rather than Levenshtein: a renamed label is usually a changed word, not a
 * changed character, and "Sign in" → "Log in" should score better than a string
 * distance would give it.
 */
export function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const left = tokens(a);
  const right = tokens(b);
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;

  const pool = new Map<string, number>();
  for (const token of right) pool.set(token, (pool.get(token) ?? 0) + 1);
  let shared = 0;
  for (const token of left) {
    const count = pool.get(token) ?? 0;
    if (count > 0) {
      shared += 1;
      pool.set(token, count - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

/** Neighbour text, before and after weighted equally. */
export function neighbourSimilarity(
  a: Fingerprint["neighbours"],
  b: ElementDescription["neighbours"],
): number {
  const before = textSimilarity(a.before.join(" "), b.before.join(" "));
  const after = textSimilarity(a.after.join(" "), b.after.join(" "));
  return (before + after) / 2;
}

/**
 * Longest common *suffix* of the two role paths, as a fraction of the longer.
 *
 * The suffix, because the roles nearest the element are the ones that say what it
 * is; the ones near the root say where the page's chrome is, and a layout change
 * rewrites those without moving the element at all.
 */
/**
 * The roles that say nothing about *where* an element is (T11.1).
 *
 * A `<div>` is a `group`, and a page is made of them: the number of them above
 * an element is a fact about somebody's stylesheet, not about the element. They
 * are dropped before the paths are compared, so what is left is the landmark
 * ancestry and the roles that mean something — which is the same reasoning LLD
 * §13.6 gives for the ADE carrying landmark roles at all ("screen containers
 * carry landmark roles so `controlPath` candidates are short and stable").
 */
const ANONYMOUS_ROLES: ReadonlySet<string> = new Set([
  "group",
  "generic",
  "none",
  "presentation",
]);

/** The path with the anonymous containers removed. */
const significant = (path: readonly string[]): readonly string[] =>
  path.filter((one) => !ANONYMOUS_ROLES.has(one));

/**
 * How alike two ancestries are: the longest common *suffix*, over the roles
 * that mean something.
 *
 * A suffix and not a set, because the element's own role and the landmark
 * immediately above it are what say "the same kind of place"; a shared `window`
 * eleven levels up is true of everything on the screen.
 *
 * The anonymous containers are dropped first, and that is not a nicety
 * (T11.1). A `<div>` inserted anywhere near the leaf used to take this measure
 * from 1 to 0.08 — one shared role out of twelve — so wrapping a control in a
 * panel looked exactly like moving it to another screen. Two things found it:
 * Radix's portal, which permanently adds a level above the whole application
 * the first time a menu opens, and LLD §16's variant 2, which moves the Record
 * screen's gateway into a different panel and asks for it to be relocalized
 * "with the same weights and threshold as the web healing eval". With the
 * containers counted, that variant could score at most 0.66 against a threshold
 * of 0.72 however good the healer was — a variant no model-free repair could
 * survive, which measures the variant rather than the healer.
 *
 * It is still a *suffix* over significant roles, so it does not become
 * generous: a button proposed for a combobox shares nothing, whatever its
 * ancestry.
 */
export function rolePathSimilarity(a: readonly string[], b: readonly string[]): number {
  const left = significant(a);
  const right = significant(b);
  if (left.length === 0 && right.length === 0) return a.length === 0 && b.length === 0 ? 1 : 1;
  let shared = 0;
  while (
    shared < left.length &&
    shared < right.length &&
    left[left.length - 1 - shared] === right[right.length - 1 - shared]
  ) {
    shared += 1;
  }
  return shared / Math.max(left.length, right.length);
}

/**
 * How near two boxes are, in both position and size.
 *
 * Falls off over a viewport-ish distance rather than over pixels: an element that
 * moved 20 px is almost certainly the same element, one that moved 900 px is a
 * different part of the page. Weighted lowest of the five for the same reason a
 * positional locator is ranked last — a reflow moves everything.
 */
export function boxProximity(
  a: Fingerprint["box"],
  b: ElementDescription["box"],
): number {
  const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
  const position = 1 / (1 + distance / 400);

  const areaA = Math.max(1, a[2] * a[3]);
  const areaB = Math.max(1, b[2] * b[3]);
  const size = Math.min(areaA, areaB) / Math.max(areaA, areaB);

  return position * 0.5 + size * 0.5;
}

/** Score one live element against a recorded fingerprint (LLD §6.4). */
export function scoreAgainst(
  fingerprint: Fingerprint,
  description: ElementDescription,
  options: Pick<RelocalizeOptions, "ignoreAttributes"> = {},
): Score {
  const live = fingerprintOf(description, options);
  const attrs = attrSimilarity(fingerprint.attrs, live.attrs);
  const text = textSimilarity(fingerprint.text, live.text);
  const neighbours = neighbourSimilarity(fingerprint.neighbours, live.neighbours);
  const rolePath = rolePathSimilarity(fingerprint.rolePath, live.rolePath);
  const box = boxProximity(fingerprint.box, live.box);

  return {
    attrs,
    text,
    neighbours,
    rolePath,
    box,
    total:
      WEIGHTS.attrs * attrs +
      WEIGHTS.text * text +
      WEIGHTS.neighbours * neighbours +
      WEIGHTS.rolePath * rolePath +
      WEIGHTS.box * box,
  };
}

/** Rank a set of already-described elements against a fingerprint. */
export function rank(
  fingerprint: Fingerprint,
  descriptions: readonly ElementDescription[],
  options: Pick<RelocalizeOptions, "ignoreAttributes"> = {},
): Match[] {
  return descriptions
    .map((description) => ({
      ref: description.ref,
      description,
      score: scoreAgainst(fingerprint, description, options),
    }))
    .sort((a, b) => b.score.total - a.score.total);
}

/**
 * Decide from a ranking, applying the threshold and the margin.
 *
 * Separated from the collection so it can be tested on synthetic descriptions
 * without a browser, and so the healer can re-decide over a ranking it already
 * has.
 */
export function decide(
  ranked: readonly Match[],
  options: { threshold?: number; margin?: number } = {},
): RelocalizeResult {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const margin = options.margin ?? DEFAULT_MARGIN;

  const best = ranked[0];
  if (best === undefined || best.score.total < threshold) {
    return best === undefined ? { outcome: "not-found", ranked } : { outcome: "not-found", ranked, best };
  }

  const runnerUp = ranked[1];
  if (runnerUp !== undefined && best.score.total - runnerUp.score.total < margin) {
    return {
      outcome: "ambiguous",
      ranked,
      best,
      runnerUp,
      margin: best.score.total - runnerUp.score.total,
    };
  }

  return { outcome: "relocalized", match: best, ranked };
}

/**
 * Find the element a fingerprint describes, on the page as it is now.
 *
 * Candidate collection is two-pass: elements of the same role first, because a
 * button is very rarely relocalized as a textbox, and the whole tree only if
 * nothing of that role clears the threshold. That keeps the usual case to a few
 * `describe()` calls while leaving the unusual one — a control whose role
 * changed, which is variant 11 and variant 12 — reachable.
 */
export async function relocalize(
  surface: AgentSurface,
  fingerprint: Fingerprint,
  options: RelocalizeOptions = {},
): Promise<RelocalizeResult> {
  const max = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const snapshot = await surface.snapshot();

  const role = options.preferRole;
  const sameRole = role === undefined ? [] : snapshot.nodes.filter((n) => n.role === role);

  const describeAll = async (refs: readonly string[]): Promise<ElementDescription[]> => {
    const out: ElementDescription[] = [];
    for (const ref of refs.slice(0, max)) {
      const description = await surface.describe(ref).catch(() => undefined);
      if (description !== undefined) out.push(description);
    }
    return out;
  };

  if (sameRole.length > 0) {
    const ranked = rank(fingerprint, await describeAll(sameRole.map((n) => n.ref)), options);
    const decision = decide(ranked, options);
    if (decision.outcome !== "not-found") return decision;
  }

  const everything = snapshot.nodes.filter((n) => !n.states.includes("hidden")).map((n) => n.ref);
  return decide(rank(fingerprint, await describeAll(everything), options), options);
}
