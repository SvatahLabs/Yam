/**
 * The resolver (LLD §6.3, REQ-RUN-5).
 *
 * ```
 * resolve(target, surface, entries, opts):
 *   entry = entries matching (platform, pattern) first, else first
 *   if surface.capabilities().webmcp and entry has a webmcp candidate and the tool
 *      is currently declared → return { webmcp }
 *   for c in entry.candidates: refs = surface.locate(c) within candidateTimeoutMs
 *      if refs.length == 1 → return { ref, candidateIndex, by }
 *      if refs.length > 1 and c.nth != null → return refs[c.nth]
 *   throw LocatorError({ id, tried: candidates, state, contextDrift })
 * ```
 *
 * The "exactly one" rule is the whole of what makes replay deterministic: a
 * candidate that matches two elements is not a near miss, it is a candidate that
 * cannot say which element was meant, and taking the first would make the run
 * depend on document order.
 */
import type { BindingEntry, Candidate, Ref } from "@svatah/yam-schema";
import type { AgentSurface } from "@svatah/yam-surface";
import { contextHash } from "./context.js";
import { LocatorError, type CandidateAttempt } from "./errors.js";
import type { BindingsStore, EntrySelector } from "./store.js";

export interface ResolveOptions {
  /** Per-candidate timeout; `Config.run.candidateTimeoutMs`. */
  candidateTimeoutMs?: number;
  /** The phrase the caller used, for the error message. */
  phrase?: string;
  /**
   * Compute the live context hash to report drift on failure. Off by default:
   * it costs a snapshot, and the answer only matters when resolution failed.
   */
  reportDrift?: boolean;
  /** Narrow which entry applies. */
  selector?: EntrySelector;
}

export interface Resolution {
  readonly id: string;
  readonly ref: Ref;
  /** Index into `entry.candidates` of the one that matched. */
  readonly candidateIndex: number;
  readonly by: Candidate["by"];
  /** Set when a `webmcp` candidate was preferred over the locators (REQ-ADP-9). */
  readonly webmcp?: { tool: string; paramMap?: Record<string, string> };
  readonly entry: BindingEntry;
  readonly durationMs: number;
}

/** Default per-candidate timeout; `Config.run.candidateTimeoutMs`. */
export const DEFAULT_CANDIDATE_TIMEOUT_MS = 2000;

/** Race a locate against its timeout, so one bad candidate cannot hold up a step. */
async function locateWithin(
  surface: AgentSurface,
  candidate: Candidate,
  timeoutMs: number,
): Promise<Ref[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      surface.locate(candidate),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`candidate timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Resolve one element id against a live surface.
 *
 * No model, no network beyond the platform: this is the whole of what replay does
 * to find an element (REQ-RUN-1).
 */
export async function resolve(
  id: string,
  surface: AgentSurface,
  store: BindingsStore,
  options: ResolveOptions = {},
): Promise<Resolution> {
  const started = Date.now();
  const timeout = options.candidateTimeoutMs ?? DEFAULT_CANDIDATE_TIMEOUT_MS;

  const selector = options.selector ?? (await defaultSelector(surface));
  const entry = store.entryFor(id, selector);
  // The phrase the caller used, or the first one recorded against the element.
  // A failure names the element the way a person wrote it, not only by its id.
  const phrase = options.phrase ?? store.phrases(id)[0];
  if (entry === undefined) {
    throw new LocatorError({
      id,
      ...(phrase === undefined ? {} : { phrase }),
      tried: [],
      contextDrift: false,
      ...(await stateOf(surface)),
    });
  }

  const tried: CandidateAttempt[] = [];

  /* WebMCP preference (LLD §6.3, REQ-ADP-9). A declared site tool is preferred
     over any locator, because the site is telling us what the control does
     rather than where it is. Until an adapter reports the capability this is
     inert and resolution falls through to the locators behind it. */
  if (surface.capabilities().webmcp) {
    const index = entry.candidates.findIndex((c) => c.by === "webmcp");
    const webmcp = index >= 0 ? entry.candidates[index]! : undefined;
    if (webmcp?.tool !== undefined) {
      const refs = await locateWithin(surface, webmcp, timeout).catch(() => []);
      if (refs.length === 1) {
        return {
          id,
          ref: refs[0]!,
          candidateIndex: index,
          by: "webmcp",
          webmcp: {
            tool: webmcp.tool,
            ...(webmcp.paramMap === undefined ? {} : { paramMap: webmcp.paramMap }),
          },
          entry,
          durationMs: Date.now() - started,
        };
      }
      tried.push({
        candidate: webmcp,
        matched: refs.length,
        durationMs: 0,
        rejected: "the declared tool is not currently available",
      });
    }
  }

  for (let index = 0; index < entry.candidates.length; index += 1) {
    const candidate = entry.candidates[index]!;
    // A `webmcp` candidate is only ever honoured by the branch above; here it
    // would be an adapter that does not support it, and locating it would be a
    // guaranteed miss reported as an ordinary one.
    if (candidate.by === "webmcp") continue;

    const attemptStarted = Date.now();
    let refs: Ref[];
    try {
      refs = await locateWithin(surface, candidate, timeout);
    } catch (error) {
      tried.push({
        candidate,
        matched: 0,
        durationMs: Date.now() - attemptStarted,
        error: error instanceof Error ? error.message.split("\n")[0]! : String(error),
      });
      continue;
    }

    const durationMs = Date.now() - attemptStarted;

    if (refs.length === 1) {
      return {
        id,
        ref: refs[0]!,
        candidateIndex: index,
        by: candidate.by,
        entry,
        durationMs: Date.now() - started,
      };
    }

    if (refs.length > 1 && candidate.nth !== undefined) {
      const chosen = refs[candidate.nth];
      if (chosen !== undefined) {
        return {
          id,
          ref: chosen,
          candidateIndex: index,
          by: candidate.by,
          entry,
          durationMs: Date.now() - started,
        };
      }
      tried.push({
        candidate,
        matched: refs.length,
        durationMs,
        rejected: `matched ${refs.length}, and nth=${candidate.nth} is out of range`,
      });
      continue;
    }

    tried.push({
      candidate,
      matched: refs.length,
      durationMs,
      rejected:
        refs.length === 0
          ? "matched nothing"
          : `matched ${refs.length} elements and carries no nth, so it cannot say which was meant`,
    });
  }

  const drift = options.reportDrift === true ? await driftOf(surface, entry) : undefined;
  throw new LocatorError({
    id,
    ...(phrase === undefined ? {} : { phrase }),
    tried,
    contextDrift: drift?.drifted ?? false,
    recordedHash: entry.context.hash,
    ...(drift?.liveHash === undefined ? {} : { liveHash: drift.liveHash }),
    ...(await stateOf(surface)),
  });
}

/**
 * Try to resolve, and report rather than throw.
 *
 * `bindings verify` dry-resolves the whole store (LLD §15), which needs every
 * result and not just the first failure.
 */
export async function tryResolve(
  id: string,
  surface: AgentSurface,
  store: BindingsStore,
  options: ResolveOptions = {},
): Promise<{ ok: true; resolution: Resolution } | { ok: false; error: LocatorError }> {
  try {
    return { ok: true, resolution: await resolve(id, surface, store, options) };
  } catch (error) {
    if (error instanceof LocatorError) return { ok: false, error };
    throw error;
  }
}

/** The selector for the session's current context. */
async function defaultSelector(surface: AgentSurface): Promise<EntrySelector> {
  const state = await surface.state().catch(() => undefined);
  const platform =
    surface.kind === "mobile" ? "mobile" : surface.kind === "desktop" ? "desktop" : "web";
  return {
    ...(state?.url === undefined ? {} : { url: state.url }),
    platform,
  };
}

async function stateOf(surface: AgentSurface): Promise<{ state?: Awaited<ReturnType<AgentSurface["state"]>> }> {
  const state = await surface.state().catch(() => undefined);
  return state === undefined ? {} : { state };
}

/** Whether the page's shape has moved away from the one the entry was recorded on. */
async function driftOf(
  surface: AgentSurface,
  entry: BindingEntry,
): Promise<{ drifted: boolean; liveHash?: string }> {
  try {
    const snapshot = await surface.snapshot();
    const { hash } = contextHash(snapshot);
    return { drifted: hash !== entry.context.hash, liveHash: hash };
  } catch {
    return { drifted: false };
  }
}
