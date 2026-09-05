/**
 * Grounding one target phrase to one element (T3.2, REQ-REC-2, 3, 4, 6, 7,
 * REQ-AUTO-7, LLD §11, Draft 1 §9.2).
 *
 * ```
 * ground(target, surface, options):
 *   refuse if environment is production and --force-production was not given
 *   snapshot() → prune to the token budget → prompt g-1 → ref | null
 *   ref === null → not-found, and the recorder stops the session
 *   describe(ref) → synthesise candidates → dry-check → BindingEntry
 * ```
 *
 * ## The snapshot is the input; a screenshot is a fallback
 *
 * REQ-REC-2 is explicit: "grounding uses the surface `snapshot()` … as the
 * primary model input; screenshots only as a configured fallback when no
 * candidate is found." So a picture is taken only when the tree answered null
 * *and* `config.record.visionFallback` is on. That ordering is the difference
 * between an approach that works on a headless HTTP adapter and one that only
 * works on a browser someone is watching.
 *
 * ## Model output is a hypothesis, not a binding
 *
 * The model returns a reference into a snapshot. Everything after that is
 * model-free: `describe()` reads the element, synthesis proposes candidates and
 * drops the ones that match more than one element (REQ-REC-3), and the
 * dry-check resolves the best of them and confirms it lands back on the same
 * element. A binding is what survives that, not what the model said.
 *
 * The entry is written `verified: false`. Verification is REQ-REC-5's job — the
 * recorder performs the step with the top candidate and checks the expectation —
 * and calling a binding verified because a model was confident about it would
 * empty the word.
 */
import {
  contextHash,
  contextPattern,
  fingerprintOf,
  siteToolOf,
  synthesise,
  synthesiseSiteTool,
} from "@svatah/bindings";
import type { BindingEntry, Candidate, Provenance, Ref, Snapshot } from "@svatah/schema";
import type { AgentSurface } from "@svatah/surface";
import {
  GatewayRefusal,
  type Gateway,
  type GatewayImage,
} from "@svatah/gateway";
import { groundingAnswerSchema, PROMPT_VERSION, question, SYSTEM } from "./prompt.js";
import { prune } from "./prune.js";

/** What the recorder wants grounded: a phrase, and the id it compiled to. */
export interface GroundingTarget {
  /** The element id, e.g. `login.username-field`. */
  readonly id: string;
  /** The phrase from the flow, e.g. "the username field". */
  readonly phrase: string;
  /** The whole sentence, for context. */
  readonly sentence?: string;
}

export interface GroundOptions {
  readonly gateway: Gateway;
  /** `config.record.maxSnapshotTokens`. */
  readonly maxSnapshotTokens?: number;
  /** `config.record.visionFallback` (REQ-REC-2). */
  readonly visionFallback?: boolean;
  /** `config.environment` (REQ-AUTO-7). */
  readonly environment?: "test" | "staging" | "production";
  /** `--force-production`. */
  readonly forceProduction?: boolean;
  readonly testIdAttributes?: readonly string[];
  readonly ignoreAttributes?: readonly string[];
  /** `config.bindings.matchHost`. */
  readonly matchHost?: boolean;
  /** Below this, an answer is treated as a guess and refused. */
  readonly minConfidence?: number;
  /** Where a vision-fallback screenshot is written. Absent disables the fallback. */
  readonly screenshotPath?: () => string;
  /** Reads a written screenshot back, so the fallback works without a real disk in tests. */
  readonly readScreenshot?: (path: string) => Promise<GatewayImage>;
  /** A snapshot already taken, so a session loop does not take two per step. */
  readonly snapshot?: Snapshot;
}

/** Everything one grounding decision produced, for the record report (REQ-REC-8). */
export interface GroundingDecision {
  readonly id: string;
  readonly phrase: string;
  readonly outcome:
    | "grounded"
    | "not-found"
    | "unverified"
    | "low-confidence"
    | "refused"
    /**
     * The page declared the target as a WebMCP tool, so no model was asked
     * (T6.3, REQ-ADP-9). Distinct from `grounded` on purpose: a record report
     * that called it grounding would be claiming a model decision that never
     * happened, and REQ-REC-8's per-step tokens and cost would be zero with no
     * explanation.
     */
    | "declared";
  /** The reference the model chose, when it chose one. */
  readonly ref?: Ref;
  readonly why?: string;
  readonly confidence?: number;
  /** Estimated tokens in the snapshot actually sent (REQ-REC-8). */
  readonly snapshotTokens: number;
  readonly pruned: boolean;
  readonly usedVision: boolean;
  readonly cached: boolean;
  readonly provenance?: Provenance;
  /** The candidates synthesised from the chosen element. */
  readonly candidates?: readonly Candidate[];
  readonly message?: string;
}

export interface GroundingResult {
  readonly decision: GroundingDecision;
  /** Present only when the outcome is `grounded`. */
  readonly entry?: BindingEntry;
  /**
   * The snapshot text the model was shown (T5.7, REQ-ADE-4).
   *
   * "The ADE shows the snapshot excerpt … per target": a reviewer deciding
   * whether the model picked the right element needs to see what it was choosing
   * *from*. It is the same string the prompt carried, so what the reviewer reads
   * is what the model read, rather than a fresh snapshot taken afterwards of a
   * page that has since moved on.
   */
  readonly snapshot?: string;
}

/**
 * Recording against production is refused (REQ-AUTO-7, LLD §11).
 *
 * "Recording is refused against production unless overridden." Recording drives
 * the real application and performs every step to verify it — it books the
 * booking. The override exists because someone occasionally has to, and it is a
 * flag they type, not a config value that can be left on by accident.
 */
export class EnvironmentRefused extends Error {
  constructor(readonly environment: string) {
    super(
      `The project's environment is "${environment}", and recording performs every step it ` +
        "records against the real application. Pass --force-production to record here anyway " +
        "(REQ-AUTO-7).",
    );
    this.name = "EnvironmentRefused";
  }
}

/** Throws unless recording here is allowed. Called once per session, and here. */
export function assertRecordable(options: {
  environment?: string;
  forceProduction?: boolean;
}): void {
  if (options.environment === "production" && options.forceProduction !== true) {
    throw new EnvironmentRefused(options.environment);
  }
}

export const DEFAULT_MAX_SNAPSHOT_TOKENS = 8_000;
export const DEFAULT_MIN_CONFIDENCE = 0.5;

export async function ground(
  target: GroundingTarget,
  surface: AgentSurface,
  options: GroundOptions,
): Promise<GroundingResult> {
  assertRecordable(options);

  const snapshot = options.snapshot ?? (await surface.snapshot());
  const url = (await surface.state().catch(() => undefined))?.url;

  const pruned = prune(snapshot, {
    maxTokens: options.maxSnapshotTokens ?? DEFAULT_MAX_SNAPSHOT_TOKENS,
  });

  const base = {
    id: target.id,
    phrase: target.phrase,
    snapshotTokens: pruned.tokensEstimate,
    pruned: pruned.pruned,
  };

  let answer: Awaited<ReturnType<typeof askModel>>;
  try {
    answer = await askModel(target, pruned.text, url, options, false, pruned.pruned);
  } catch (error) {
    if (error instanceof GatewayRefusal) {
      return {
        decision: {
          ...base,
          outcome: "refused",
          usedVision: false,
          cached: false,
          message: error.message,
        },
      };
    }
    throw error;
  }

  let usedVision = false;

  /*
   * The vision fallback (REQ-REC-2).
   *
   * Only after the tree said null, only when it is configured, and only when the
   * adapter can take a screenshot at all. Three conditions rather than one
   * because each is a different kind of "no": the tree had an answer; the
   * project does not want pictures sent; the platform cannot produce one.
   */
  if (
    answer.value.ref === null &&
    options.visionFallback === true &&
    options.screenshotPath !== undefined &&
    options.readScreenshot !== undefined &&
    surface.capabilities().screenshot === true
  ) {
    const path = options.screenshotPath();
    await surface.screenshot(path, []);
    const image = await options.readScreenshot(path);
    usedVision = true;
    try {
      answer = await askModel(target, pruned.text, url, options, true, pruned.pruned, image);
    } catch (error) {
      if (error instanceof GatewayRefusal) {
        return {
          decision: {
            ...base,
            outcome: "refused",
            usedVision,
            cached: false,
            message: error.message,
          },
        };
      }
      throw error;
    }
  }

  const shared = {
    ...base,
    usedVision,
    cached: answer.cached,
    provenance: answer.provenance,
    why: answer.value.why,
    confidence: answer.value.confidence,
  };

  if (answer.value.ref === null) {
    return {
      decision: {
        ...shared,
        outcome: "not-found",
        message:
          `Nothing on ${url ?? "this page"} is "${target.phrase}"` +
          (pruned.overBudget
            ? ", and the snapshot was over the token budget, so the page may not have been " +
              "fully described. Raise record.maxSnapshotTokens and try again."
            : "."),
      },
    };
  }

  if (answer.value.confidence < (options.minConfidence ?? DEFAULT_MIN_CONFIDENCE)) {
    return {
      decision: {
        ...shared,
        outcome: "low-confidence",
        ref: answer.value.ref,
        message:
          `The model chose ${answer.value.ref} with confidence ` +
          `${answer.value.confidence.toFixed(2)}, which is a guess. ` +
          "Nothing was written; name the element more precisely, or record it by hand.",
      },
    };
  }

  /*
   * From here on there is no model.
   *
   * A reference is a handle into one snapshot, and it stops meaning anything the
   * moment the page changes. What goes in the store is what synthesis makes of
   * the element it points at: candidates that each resolve to exactly one
   * element, and to *this* one (REQ-REC-3).
   */
  const ref = answer.value.ref;
  let candidates: Candidate[];
  try {
    candidates = await synthesise(surface, ref, {
      ...(options.testIdAttributes === undefined
        ? {}
        : { testIdAttributes: options.testIdAttributes }),
      ...(options.ignoreAttributes === undefined
        ? {}
        : { ignoreAttributes: options.ignoreAttributes }),
    });
  } catch (error) {
    return {
      decision: {
        ...shared,
        outcome: "unverified",
        ref,
        message:
          `The model chose ${ref}, and the surface could not describe it: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          "A reference is only valid for the snapshot it came from.",
      },
    };
  }

  if (candidates.length === 0) {
    return {
      decision: {
        ...shared,
        outcome: "unverified",
        ref,
        message:
          `The model chose ${ref}, and nothing synthesised from it resolves to exactly one ` +
          "element. A binding that cannot be re-found is not a binding.",
      },
    };
  }

  /*
   * The dry-check.
   *
   * `synthesise` already verified each candidate one at a time. This asks the
   * question the resolver will ask at replay: does the *first* candidate — the
   * one a run will try first — resolve to exactly this element, right now? It
   * has caught the case where a candidate verified against a page that then
   * changed under a lazy render.
   */
  const found = await surface.locate(candidates[0]!).catch(() => [] as Ref[]);
  const description = await surface.describe(ref);
  if (found.length !== 1 || !(await isSameElement(surface, found[0]!, ref, description))) {
    return {
      decision: {
        ...shared,
        outcome: "unverified",
        ref,
        candidates,
        message:
          `The best candidate (${candidates[0]!.by}) resolved to ` +
          `${found.length} element(s) rather than to the one it was made from. ` +
          "The page changed while it was being described.",
      },
    };
  }

  const { hash } = contextHash(snapshot, ref);

  const entry: BindingEntry = {
    context: {
      pattern: contextPattern(url ?? "/", {
        ...(options.matchHost === undefined ? {} : { matchHost: options.matchHost }),
      }),
      hash,
      platform: surface.kind === "http" ? "web" : surface.kind,
    },
    candidates,
    fingerprint: fingerprintOf(description, {
      ...(options.ignoreAttributes === undefined
        ? {}
        : { ignoreAttributes: options.ignoreAttributes }),
    }),
    recordedAt: new Date().toISOString(),
    provenance: answer.provenance,
    // REQ-REC-5 sets this, by performing the step. Grounding has not acted.
    verified: false,
  };

  return {
    decision: { ...shared, outcome: "grounded", ref, candidates },
    entry,
    snapshot: snapshot.text,
  };
}

/**
 * A binding entry for an element a *person* chose (T5.7, REQ-ADE-4).
 *
 * The re-pick half of "accept, re-pick by clicking in the driven session, or
 * reject": the reviewer names a reference in the snapshot the model was shown,
 * and the entry is synthesised from that element by the same path a grounded one
 * takes — the same candidate ranking, the same fingerprint, the same context
 * hash. A hand-written locator would put something in the store that nothing
 * else in this project knows how to produce, and that no future re-record could
 * reproduce.
 *
 * The provenance says `human`, because that is what happened. A store entry that
 * claimed a model chose an element a person did is the one lie a review must not
 * be able to tell.
 */
export async function entryFor(
  surface: AgentSurface,
  ref: Ref,
  options: Omit<GroundOptions, "gateway" | "snapshot"> = {},
): Promise<BindingEntry> {
  const candidates = await synthesise(surface, ref, {
    ...(options.testIdAttributes === undefined
      ? {}
      : { testIdAttributes: options.testIdAttributes }),
    ...(options.ignoreAttributes === undefined
      ? {}
      : { ignoreAttributes: options.ignoreAttributes }),
  });
  if (candidates.length === 0) {
    throw new Error(
      `Nothing synthesised from ${ref} resolves to exactly one element. ` +
        "A binding that cannot be re-found is not a binding.",
    );
  }

  const description = await surface.describe(ref);
  const snapshot = await surface.snapshot();
  const { hash } = contextHash(snapshot, ref);
  const url = (await surface.state().catch(() => undefined))?.url;

  return {
    context: {
      pattern: contextPattern(url ?? "/", {
        ...(options.matchHost === undefined ? {} : { matchHost: options.matchHost }),
      }),
      hash,
      platform: surface.kind === "http" ? "web" : surface.kind,
    },
    candidates,
    fingerprint: fingerprintOf(description, {
      ...(options.ignoreAttributes === undefined
        ? {}
        : { ignoreAttributes: options.ignoreAttributes }),
    }),
    recordedAt: new Date().toISOString(),
    provenance: {
      model: "human",
      promptVersion: "review:re-pick",
      at: new Date().toISOString(),
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    },
    verified: false,
  };
}

async function askModel(
  target: GroundingTarget,
  snapshot: string,
  url: string | undefined,
  options: GroundOptions,
  withScreenshot: boolean,
  pruned: boolean,
  image?: GatewayImage,
): Promise<{
  value: { ref: string | null; why: string; confidence: number };
  provenance: Provenance;
  cached: boolean;
}> {
  return await options.gateway.ask({
    promptVersion: PROMPT_VERSION,
    system: SYSTEM,
    user: question({
      phrase: target.phrase,
      ...(target.sentence === undefined ? {} : { sentence: target.sentence }),
      elementId: target.id,
      ...(url === undefined ? {} : { url }),
      snapshot,
      ...(withScreenshot ? { withScreenshot: true } : {}),
      ...(pruned ? { pruned: true } : {}),
    }),
    answer: groundingAnswerSchema,
    ...(image === undefined ? {} : { images: [image] }),
  });
}

/**
 * Whether a reference the surface found is the element it was made from.
 *
 * `locate()` answers in the adapter's own references, which are not the
 * snapshot's — a candidate is resolved against the live page, not against a
 * picture of it. So identity is decided the way synthesis decides it: describe
 * both and compare the properties that make an element itself rather than make
 * it look similar.
 */
async function isSameElement(
  surface: AgentSurface,
  found: Ref,
  original: Ref,
  description: { tag: string; role: string; index: number; box: readonly number[] },
): Promise<boolean> {
  if (found === original) return true;
  const other = await surface.describe(found).catch(() => undefined);
  if (other === undefined) return false;
  return (
    other.tag === description.tag &&
    other.role === description.role &&
    other.index === description.index &&
    other.box.every((value, at) => value === description.box[at])
  );
}

/* ── WebMCP (T6.3, REQ-ADP-9, LLD §6.3) ───────────────────────────────────── */

/**
 * The binding for a target the page declares as a site tool.
 *
 * `Use the "book-slot" site tool` names a *tool*, not an element. There is
 * nothing for a model to look for and nothing for it to be wrong about: the
 * page either declares `book-slot` or it does not, and `locate` answers. So no
 * model is called, and the provenance says `webmcp:declaration` rather than
 * naming one.
 *
 * `undefined` when the page declares no such tool, which leaves the caller to
 * ground the phrase in the ordinary way — the sentence may name a control the
 * site describes some other way.
 *
 * ## The fingerprint of a thing with no element
 *
 * Empty, and deliberately so. A fingerprint exists for relocalization (LLD
 * §6.4): it describes where an element sat so a moved one can be found again. A
 * tool does not sit anywhere. Inventing a fingerprint from the page would make
 * relocalization score a binding it can never repair, and the honest answer to
 * "this tool is gone" is the fall-through to the locators, not a repair.
 */
export async function groundSiteTool(
  surface: AgentSurface,
  target: GroundingTarget,
  options: Pick<GroundOptions, "matchHost"> = {},
): Promise<GroundingResult | undefined> {
  /*
   * Only when the *phrase* names the tool — pattern 30's
   * `Use the "book-slot" site tool`, and nothing looser.
   *
   * An ordinary sentence like "Click the Book the slot button" names a control
   * that the page may *also* declare as a tool, and that case must go through
   * ordinary grounding so the locators end up in the binding behind the tool.
   * Taking this path for it produced a binding with a `webmcp` candidate and
   * nothing else — which resolved perfectly while the declaration was there and
   * had nothing to fall through to when it went, quietly removing the property
   * LLD §6.3 is about. `session.ts` prepends the tool in that case instead.
   */
  if (siteToolOf(target.phrase) === undefined) return undefined;

  const candidate = await synthesiseSiteTool(surface, target.phrase, target.id);
  if (candidate === undefined) return undefined;

  const url = (await surface.state().catch(() => undefined))?.url;
  const snapshot = await surface.snapshot();
  const at = new Date().toISOString();
  const tool = candidate.tool ?? "";

  const provenance: Provenance = {
    model: "webmcp:declaration",
    promptVersion: "webmcp-1",
    at,
    tokensIn: 0,
    tokensOut: 0,
  };

  const entry: BindingEntry = {
    context: {
      /*
       * The whole page's hash, not a landmark's: a tool belongs to the document
       * that declared it, and there is no element to take the nearest landmark
       * of. It is broader than a recorded element's context and will drift
       * sooner — which matters less here, because the resolver re-asks the page
       * whether the tool is declared on every resolution anyway.
       */
      pattern: contextPattern(url ?? "/", {
        ...(options.matchHost === undefined ? {} : { matchHost: options.matchHost }),
      }),
      hash: contextHash(snapshot).hash,
      platform: surface.kind === "http" ? "web" : surface.kind,
    },
    candidates: [candidate],
    fingerprint: {
      tag: "webmcp",
      attrs: { tool: candidate.tool ?? "" },
      text: "",
      neighbours: { before: [], after: [] },
      rolePath: [],
      box: [0, 0, 0, 0],
      index: 0,
    },
    recordedAt: at,
    provenance,
    /*
     * Verified at synthesis, unlike a grounded binding: `synthesiseSiteTool`
     * only answers when `locate` resolved the tool, which is the whole of what
     * "this binding can be re-found" means for a declaration.
     */
    verified: true,
  };

  return {
    entry,
    decision: {
      id: target.id,
      phrase: target.phrase,
      outcome: "declared",
      ref: tool,
      confidence: 1,
      why: `the page declares a "${tool}" site tool, so no model was asked`,
      // Nothing was sent and nothing was spent, which is the point.
      snapshotTokens: 0,
      pruned: false,
      usedVision: false,
      cached: false,
      provenance,
      candidates: [candidate],
    },
    snapshot: snapshot.text,
  };
}
