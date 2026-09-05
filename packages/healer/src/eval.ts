/**
 * The healing eval (REQ-HEAL-5, T1.5, T1.8).
 *
 * "Healing eval over at least 20 deliberate UI changes; relocalization alone at
 * least 60 percent, with one model call at least 85 percent; results published
 * per release with the method."
 *
 * ## The method, in full
 *
 * Bindings are recorded for every interactive element on every page of the sample
 * application at variant 0. Each of the twenty variants is then loaded on the
 * pages it changes, and every binding recorded on those pages is examined.
 *
 * **Recording is done with test-id attributes disabled.** An application that
 * carries a `data-testid` on every control barely needs healing: a binding
 * anchored on one survives almost every front-end change, and measuring on that
 * population would flatter the result into meaninglessness. The number below is
 * therefore taken on the harder and more representative population — an
 * application with no test ids, which is what most applications that need
 * bindings at all look like. `withTestIds` in the report is the same run on the
 * easier population, for contrast.
 *
 * Three things are counted, and the report gives all three:
 *
 * * **Locator cases.** Every (candidate, variant) pair. A candidate has *broken*
 *   when it no longer identifies exactly one element. This is what the twenty
 *   variants were built to attack — T0.5 required each to break at least one
 *   class of locator candidate — and it says which kinds survive which changes.
 * * **Bindings that stopped resolving.** A whole bundle failing is the loud
 *   failure: the step cannot run. In practice a synthesised bundle carries five
 *   to eight independent candidates and a single-property change rarely takes
 *   them all, which is a real and favourable result about synthesis rather than
 *   about healing.
 * * **Degraded bindings — the cases this eval's number is about.** A binding at
 *   least one of whose candidates has broken. It still resolves, but it has lost
 *   redundancy and the healer's job is to re-synthesise it.
 *
 * ## What counts as recovered (Draft 2.3)
 *
 * **Recovered** means two things together: the element relocalization proposed
 * carries the *same ground-truth key* as the element the binding was recorded
 * on, and a candidate re-synthesised from it resolves back to exactly one
 * element.
 *
 * The first half is the one Draft 2.3 added, and it is the half that makes the
 * number mean anything. Phase 1 required only the second, which proves a
 * proposal is *findable* — not that it is *right*. A healer that confidently
 * relocalized "Sign in" onto "Sign up" would have scored a recovery. So the
 * sample application labels every interactive element with a key that is
 * identical on every variant (LLD §16), the eval records the key at variant 0,
 * and afterwards it compares. Different key, `wrong-element`, whatever the
 * score was.
 *
 * The label is read with a page script, around the surface rather than through
 * it, and `bindings.ignoreAttributes` strips it from `describe()`, from
 * `native`, from synthesis and from fingerprints. Otherwise it would be the
 * strongest locator on the page and the eval would be measuring its own answer
 * key.
 *
 * The second half is still required, and still separately reported: a proposal
 * whose key matches but which nothing can re-synthesise a unique candidate for
 * is `unverified`, not recovered. It is not a wrong element, and calling it one
 * would be as misleading in the other direction (REQ-HEAL-3).
 *
 * No model is involved anywhere. `usedModel` is always false in Phase 1; the
 * model half of REQ-HEAL-5 arrives with the `Regrounder` plugin in Phase 3.
 */
import type { AgentSurface } from "@svatah/surface";
import type { BindingEntry, Candidate, Fingerprint } from "@svatah/schema";
import { fingerprintOf, relocalize, synthesise, type RelocalizeResult } from "@svatah/bindings";

/** A binding recorded at variant 0. */
export interface EvalBinding {
  /** `<page>::<element identity>` — stable across variants, unlike a reference. */
  readonly id: string;
  readonly page: string;
  readonly role: string;
  readonly name?: string;
  readonly candidates: readonly Candidate[];
  readonly fingerprint: Fingerprint;
  /**
   * The element's ground-truth key at variant 0 (LLD §16). `undefined` when the
   * application does not label the element — those cases are counted separately
   * rather than assumed correct.
   */
  readonly truth?: string;
}

/** One binding on one variant. */
export interface EvalCase {
  readonly bindingId: string;
  readonly page: string;
  readonly variant: number;
  /**
   * `intact` — every candidate still identifies the element.
   *
   * The rest are the outcomes of asking relocalization to find a degraded
   * binding again:
   *
   * * `recovered` — the proposal's ground-truth key matches, and a
   *   re-synthesised candidate resolves uniquely to it.
   * * `wrong-element` — relocalization proposed a *different* element.
   * * `unverified` — the key matches but nothing re-synthesised from the
   *   proposal resolves uniquely, or the element carries no key to compare.
   * * `not-found` / `ambiguous` — relocalization declined to propose.
   */
  readonly outcome:
    | "intact"
    | "recovered"
    | "not-found"
    | "ambiguous"
    | "wrong-element"
    | "unverified";
  /** Candidate kinds that stopped identifying the element. */
  readonly brokenCandidates: readonly Candidate["by"][];
  /** True when no candidate resolved at all — the step could not have run. */
  readonly unresolvable: boolean;
  readonly score?: number;
  readonly runnerUpScore?: number;
  /** The kind of candidate a verified repair re-synthesised. */
  readonly repairedBy?: Candidate["by"];
  /** The ground-truth key of the element relocalization proposed. */
  readonly proposedTruth?: string;
  /** The key the binding was recorded on, when they differ. */
  readonly expectedTruth?: string;
}

export interface VariantResult {
  readonly variant: number;
  readonly title: string;
  /** (candidate, variant) pairs examined and broken. */
  readonly locatorCases: number;
  readonly brokenLocators: number;
  /** Bindings that lost at least one candidate. */
  readonly degraded: number;
  readonly recovered: number;
  readonly notFound: number;
  readonly ambiguous: number;
  readonly wrongElement: number;
  readonly unverified: number;
  /** Bindings that stopped resolving entirely. */
  readonly unresolvable: number;
  /** `recovered / degraded`, or `null` when the variant degraded nothing. */
  readonly rate: number | null;
}

export interface HealingEvalReport {
  readonly at: string;
  readonly method: string;
  readonly population: "no-test-ids" | "with-test-ids";
  readonly bindings: number;
  readonly cases: readonly EvalCase[];
  readonly variants: readonly VariantResult[];
  readonly totals: {
    readonly locatorCases: number;
    readonly brokenLocators: number;
    readonly degraded: number;
    readonly recovered: number;
    readonly notFound: number;
    readonly ambiguous: number;
    readonly wrongElement: number;
    readonly unverified: number;
    readonly unresolvable: number;
  };
  /** Which candidate kinds broke, and how often. */
  readonly brokenByKind: Readonly<Record<string, number>>;
  /** The relocalize-only recovery rate — the number REQ-HEAL-5 asks for. */
  readonly relocalizeOnly: number;
  readonly threshold: number;
  readonly meetsThreshold: boolean;
  readonly usedModel: boolean;
}

/** REQ-HEAL-5: "relocalization alone at least 60 percent". */
export const RELOCALIZE_THRESHOLD = 0.6;

export const METHOD = [
  "Bindings are recorded for every interactive element on every sample page at variant 0.",
  "The headline number is taken with test-id attributes disabled: an application that carries",
  "a data-testid on every control barely needs healing, and measuring on it would flatter the",
  "result. The same run with test ids enabled is reported alongside it. Each variant is then",
  "loaded on the pages it changes. A candidate has broken when it no longer identifies exactly",
  "one element. A binding is degraded when at least one of its candidates has broken, and those",
  "are the cases this number is about.",
  "Recovered means two things together: the element relocalization proposed carries the same",
  "ground-truth key as the element the binding was recorded on, AND a candidate re-synthesised",
  "from that element resolves back to exactly one element. The key is a data-svatah-eval",
  "attribute the sample application stamps on every interactive element, identical across all",
  "variants; the eval reads it with a page script outside the surface, and",
  "bindings.ignoreAttributes strips it from describe(), from native, from synthesis and from",
  "fingerprints, so it can never help relocalization find anything. A proposal with a different",
  "key is wrong-element however high it scored; one whose key matches but which cannot be",
  "re-synthesised into a unique candidate is unverified, not recovered. No model is involved.",
].join(" ");

export interface HealingEvalOptions {
  /** Open a session on one page of one variant. */
  open: (page: string, variant: number) => Promise<AgentSurface>;
  close?: (surface: AgentSurface) => Promise<void>;
  pages: readonly string[];
  /** Variant id → the pages it changes, from `apps/sample-web`'s VARIANTS.md. */
  variants: ReadonlyArray<{ id: number; title: string; pages: readonly string[] }>;
  /**
   * Record with test-id attributes. Default false — see the method above.
   */
  withTestIds?: boolean;
  /**
   * Read an element's ground-truth key (LLD §16, Draft 2.3).
   *
   * Supplied by the caller rather than taken through the surface, because the
   * whole point is that the surface cannot see the label: the CLI reads it with
   * a page script. Without it the eval still runs, but every proposal is
   * `unverified` rather than `recovered` — the number is not published from a
   * run that could not check its answers.
   */
  groundTruth?: (surface: AgentSurface, ref: string) => Promise<string | undefined>;
  threshold?: number;
  margin?: number;
  onProgress?: (message: string) => void;
}

/** Record bindings for every interactive element on every page, at variant 0. */
export async function recordBaseline(
  options: Pick<
    HealingEvalOptions,
    "open" | "close" | "pages" | "withTestIds" | "onProgress" | "groundTruth"
  >,
): Promise<EvalBinding[]> {
  const synthesisOptions = options.withTestIds === true ? {} : { testIdAttributes: [] };
  const bindings: EvalBinding[] = [];

  for (const page of options.pages) {
    const surface = await options.open(page, 0);
    try {
      const snapshot = await surface.snapshot({ interactiveOnly: true });
      for (const node of snapshot.nodes) {
        if (node.states.includes("hidden")) continue;
        const description = await surface.describe(node.ref).catch(() => undefined);
        if (description === undefined) continue;
        const candidates = await synthesise(surface, node.ref, synthesisOptions);
        if (candidates.length === 0) continue;

        const truth = await options.groundTruth?.(surface, node.ref).catch(() => undefined);

        bindings.push({
          id: `${page}::${identity(description)}`,
          page,
          role: description.role,
          ...(description.name === undefined ? {} : { name: description.name }),
          candidates,
          fingerprint: fingerprintOf(description),
          ...(truth === undefined ? {} : { truth }),
        });
      }
      options.onProgress?.(`recorded ${bindings.filter((b) => b.page === page).length} on ${page}`);
    } finally {
      await (options.close?.(surface) ?? surface.close()).catch(() => undefined);
    }
  }
  return bindings;
}

/** The eval (REQ-HEAL-5). */
export async function runHealingEval(options: HealingEvalOptions): Promise<HealingEvalReport> {
  const baseline = await recordBaseline(options);
  const byPage = new Map<string, EvalBinding[]>();
  for (const binding of baseline) {
    byPage.set(binding.page, [...(byPage.get(binding.page) ?? []), binding]);
  }

  const cases: EvalCase[] = [];
  const locatorCases = new Map<number, { examined: number; broken: number }>();

  for (const variant of options.variants) {
    locatorCases.set(variant.id, { examined: 0, broken: 0 });
    for (const page of variant.pages) {
      const bindings = byPage.get(page);
      if (bindings === undefined || bindings.length === 0) continue;

      const surface = await options.open(page, variant.id);
      try {
        for (const binding of bindings) {
          const result = await runCase(surface, binding, variant.id, options);
          cases.push(result.case);
          const counter = locatorCases.get(variant.id)!;
          counter.examined += binding.candidates.length;
          counter.broken += result.case.brokenCandidates.length;
        }
      } finally {
        await (options.close?.(surface) ?? surface.close()).catch(() => undefined);
      }
      options.onProgress?.(`variant ${variant.id} on ${page}`);
    }
  }

  return summarise(baseline, cases, options.variants, locatorCases, options.withTestIds === true);
}

async function runCase(
  surface: AgentSurface,
  binding: EvalBinding,
  variant: number,
  options: HealingEvalOptions,
): Promise<{ case: EvalCase }> {
  const broken: Candidate["by"][] = [];
  let anyResolved = false;

  for (const candidate of binding.candidates) {
    const refs = await surface.locate(candidate).catch(() => []);
    if (refs.length === 1) anyResolved = true;
    else broken.push(candidate.by);
  }

  const base = {
    bindingId: binding.id,
    page: binding.page,
    variant,
    brokenCandidates: broken,
    unresolvable: !anyResolved,
  } as const;

  if (broken.length === 0) return { case: { ...base, outcome: "intact" } };

  const result: RelocalizeResult = await relocalize(surface, binding.fingerprint, {
    preferRole: binding.role,
    ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
    ...(options.margin === undefined ? {} : { margin: options.margin }),
  });

  const runnerUp = result.ranked[1];

  if (result.outcome === "not-found") {
    const best = result.ranked[0];
    return {
      case: {
        ...base,
        outcome: "not-found",
        ...(best === undefined ? {} : { score: round(best.score.total) }),
      },
    };
  }
  if (result.outcome === "ambiguous") {
    return {
      case: {
        ...base,
        outcome: "ambiguous",
        score: round(result.best.score.total),
        runnerUpScore: round(result.runnerUp.score.total),
      },
    };
  }

  /*
   * The ground-truth check comes first, because it is the one that can say the
   * repair is *wrong*. Verification can only say it is unusable.
   */
  const proposedTruth = await options.groundTruth?.(surface, result.match.ref).catch(() => undefined);
  const scores = {
    score: round(result.match.score.total),
    ...(runnerUp === undefined ? {} : { runnerUpScore: round(runnerUp.score.total) }),
  };

  if (binding.truth !== undefined && proposedTruth !== undefined && proposedTruth !== binding.truth) {
    return {
      case: {
        ...base,
        outcome: "wrong-element",
        ...scores,
        proposedTruth,
        expectedTruth: binding.truth,
      },
    };
  }

  const synthesisOptions = options.withTestIds === true ? {} : { testIdAttributes: [] };
  const repaired = await synthesise(surface, result.match.ref, synthesisOptions).catch(() => []);
  const verified =
    repaired.length > 0 && (await surface.locate(repaired[0]!).catch(() => [])).length === 1;

  // A key that could not be read on both sides leaves the comparison unmade, so
  // the case is `unverified` even when re-synthesis worked. Counting it as a
  // recovery would be assuming the answer.
  const compared = binding.truth !== undefined && proposedTruth !== undefined;

  return {
    case: {
      ...base,
      outcome: verified && compared ? "recovered" : "unverified",
      ...scores,
      ...(proposedTruth === undefined ? {} : { proposedTruth }),
      ...(verified && repaired[0] !== undefined ? { repairedBy: repaired[0].by } : {}),
    },
  };
}

function summarise(
  baseline: readonly EvalBinding[],
  cases: readonly EvalCase[],
  variants: HealingEvalOptions["variants"],
  locatorCases: ReadonlyMap<number, { examined: number; broken: number }>,
  withTestIds: boolean,
): HealingEvalReport {
  const results: VariantResult[] = variants.map((variant) => {
    const mine = cases.filter((c) => c.variant === variant.id);
    const degradedCases = mine.filter((c) => c.outcome !== "intact");
    const recovered = degradedCases.filter((c) => c.outcome === "recovered").length;
    const counter = locatorCases.get(variant.id) ?? { examined: 0, broken: 0 };
    return {
      variant: variant.id,
      title: variant.title,
      locatorCases: counter.examined,
      brokenLocators: counter.broken,
      degraded: degradedCases.length,
      recovered,
      notFound: degradedCases.filter((c) => c.outcome === "not-found").length,
      ambiguous: degradedCases.filter((c) => c.outcome === "ambiguous").length,
      wrongElement: degradedCases.filter((c) => c.outcome === "wrong-element").length,
      unverified: degradedCases.filter((c) => c.outcome === "unverified").length,
      unresolvable: mine.filter((c) => c.unresolvable).length,
      rate: degradedCases.length === 0 ? null : recovered / degradedCases.length,
    };
  });

  const degraded = cases.filter((c) => c.outcome !== "intact");
  const recovered = degraded.filter((c) => c.outcome === "recovered").length;

  const brokenByKind: Record<string, number> = {};
  for (const one of cases) {
    for (const kind of one.brokenCandidates) brokenByKind[kind] = (brokenByKind[kind] ?? 0) + 1;
  }

  return {
    at: new Date().toISOString(),
    method: METHOD,
    population: withTestIds ? "with-test-ids" : "no-test-ids",
    bindings: baseline.length,
    cases,
    variants: results,
    totals: {
      locatorCases: results.reduce((n, v) => n + v.locatorCases, 0),
      brokenLocators: results.reduce((n, v) => n + v.brokenLocators, 0),
      degraded: degraded.length,
      recovered,
      notFound: degraded.filter((c) => c.outcome === "not-found").length,
      ambiguous: degraded.filter((c) => c.outcome === "ambiguous").length,
      wrongElement: degraded.filter((c) => c.outcome === "wrong-element").length,
      unverified: degraded.filter((c) => c.outcome === "unverified").length,
      unresolvable: cases.filter((c) => c.unresolvable).length,
    },
    brokenByKind: Object.fromEntries(
      Object.entries(brokenByKind).sort(([, a], [, b]) => b - a),
    ),
    relocalizeOnly: degraded.length === 0 ? 0 : recovered / degraded.length,
    threshold: RELOCALIZE_THRESHOLD,
    meetsThreshold: degraded.length > 0 && recovered / degraded.length >= RELOCALIZE_THRESHOLD,
    usedModel: false,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** A key for an element that survives a reload and a variant, unlike a reference. */
function identity(described: {
  tag: string;
  role: string;
  name?: string;
  index: number;
  attrs: Record<string, string>;
}): string {
  const id = described.attrs["data-testid"] ?? described.attrs["id"] ?? described.attrs["name"] ?? "";
  return `${described.tag}${id === "" ? "" : `#${id}`}[${described.role}]${
    described.name === undefined ? "" : ` "${described.name}"`
  }@${described.index}`;
}

/** An entry a heal proposal would write, built from a relocalization. */
export function entryFrom(
  previous: BindingEntry,
  candidates: readonly Candidate[],
  fingerprint: Fingerprint,
  contextHash: string,
): BindingEntry {
  return {
    ...previous,
    context: { ...previous.context, hash: contextHash },
    candidates: [...candidates],
    fingerprint,
    verified: false,
    // Lineage: what this binding used to be, so a reviewer sees the repair rather
    // than only its result (LLD §6.4).
    previous: [
      ...(previous.previous ?? []),
      { fingerprint: previous.fingerprint, provenance: previous.provenance },
    ],
  };
}
