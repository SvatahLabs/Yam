/**
 * The `Replayer` plugin (LLD §10, §12, Draft 2.3, REQ-HEAL-1).
 *
 * "`healer` defines `interface Replayer { toFailure(input, surface): Promise<
 * "reached" | "unreachable"> }`. Module (a)'s default restores the session state
 * recorded with the failure (URL, storage state) and returns `unreachable` when
 * the page needs a login that state does not carry. Module (b) registers a
 * runtime-backed implementation that replays the story to the failing step.
 * `healer` therefore never imports `runtime`."
 *
 * ## Why this is a plugin and not an import
 *
 * The healer is module (a). A plain Playwright user installs it without the flow
 * language, the compiler or the executor, and REQ-PKG-1 says module (a) has no
 * dependency on module (b) — so the healer cannot import `runtime` even though
 * repairing a run's failure means getting back to where the run was.
 *
 * Phase 1 resolved that by restoring the recorded URL and calling it replay,
 * which is honest for a `bind()` failure — a plain Playwright test's failure
 * carries the page it was on — and not honest for a flow, where the failing step
 * may be six steps into a booking. The plugin makes the difference visible: the
 * default says `unreachable` when it cannot get there, and module (b) registers
 * one that actually replays.
 *
 * ## `unreachable` is a real answer
 *
 * A repair verified on the wrong page is worse than no repair (REQ-HEAL-3). When
 * the replayer cannot reach the failing point, the healer reports the binding as
 * unrepaired and says why, rather than relocalizing against whatever happens to
 * be on screen.
 *
 * ## Where a replayer starts (Draft 2.4, LLD §10)
 *
 * "Both implementations must first put the session where the flow starts,
 * exactly as the executor does: open at the flow's base URL with the configured
 * storage state, then replay the prefix of steps before the failing one."
 *
 * That first move belongs to whoever opens the session — `HealOptions.open`,
 * which is the only party that knows the base URL and the storage state — so a
 * replayer is handed a session already at the flow's start and never has to
 * guess. What both replayers own is the rest: getting from there to the failing
 * step, and then *checking* they arrived (`reachedRecordedPage`). A failure at a
 * story's first step is `reached` only after that navigation, never on a blank
 * page, which is exactly what `svatah heal --run` used to get wrong.
 */
import type { AgentSurface } from "@svatah/surface";
import type { HealInput } from "./failures.js";

/**
 * Whether the replayer got back to the failing step, and if not, why.
 *
 * The bare strings are the whole of LLD §10's contract and every replayer may
 * return them. The object form exists for one reason (Draft 2.6): "an
 * `unreachable` caused by a missing input names it". A replay of
 * `Type {input.password} into the password field` that was never told the
 * password is not a mysterious failure to arrive — it is a missing argument, and
 * a report that says so is a report a person can act on.
 */
export type ReplayOutcome =
  | "reached"
  | "unreachable"
  | { readonly outcome: "unreachable"; readonly reason: string };

/** `unreachable` in either spelling. */
export function unreached(outcome: ReplayOutcome): boolean {
  return outcome !== "reached";
}

/** The explanation a replayer gave, when it gave one. */
export function reasonOf(outcome: ReplayOutcome): string | undefined {
  return typeof outcome === "object" ? outcome.reason : undefined;
}

/**
 * What a replayer needs beyond the failure itself (Draft 2.6, LLD §10).
 *
 * Replaying a story's prefix means running its steps, and a story with a
 * signature cannot run without its inputs. They are passed rather than read from
 * the run, because a run records only their *names* — the values may be secrets
 * and are never written down (REQ-NFR-6), so the caller supplies them again.
 */
export interface ReplayContext {
  readonly inputs?: Readonly<Record<string, unknown>>;
}

/**
 * Did the session actually land on the page the failure was recorded on?
 *
 * "`reached` must be verified by comparing the live URL path with the recorded
 * one before relocalization runs" (Draft 2.4, LLD §10). Paths rather than whole
 * URLs, because a query string may legitimately differ and an origin certainly
 * does — the sample application takes an ephemeral port.
 *
 * A failure that recorded no URL at all cannot be checked, and is taken at its
 * word: a non-web surface has no URL to compare, and refusing to heal it would
 * be refusing on a technicality.
 */
export async function reachedRecordedPage(
  input: { readonly url?: string; readonly state?: { readonly url?: string } },
  surface: AgentSurface,
): Promise<ReplayOutcome> {
  const wanted = input.state?.url ?? input.url;
  if (wanted === undefined) return "reached";

  const live = (await surface.state().catch(() => undefined))?.url;
  if (live === undefined) return "reached";

  return samePath(wanted, live) ? "reached" : "unreachable";
}

export interface Replayer {
  /** A name for the report, so it says how the page was reached. */
  readonly name: string;
  toFailure(
    input: HealInput,
    surface: AgentSurface,
    context?: ReplayContext,
  ): Promise<ReplayOutcome>;
}

/**
 * The default: restore the session state recorded with the failure.
 *
 * Enough for a `bind()` failure, which carries the URL the test was on and the
 * storage state that got it there. Not enough for a flow whose failing step is
 * six steps into a booking — and it says so rather than pretending, which is
 * what `unreachable` is for.
 */
export const SESSION_STATE_REPLAYER: Replayer = {
  name: "session-state",
  async toFailure(input: HealInput, surface: AgentSurface): Promise<ReplayOutcome> {
    const state = input.state ?? (input.url === undefined ? undefined : { kind: "web" as const, url: input.url });
    if (state === undefined) return "unreachable";

    try {
      await surface.restore(state);
    } catch {
      return "unreachable";
    }

    /*
     * Did it actually land there?
     *
     * A URL that redirects to a login page restores "successfully" and leaves
     * the session somewhere else entirely. Comparing the path is what tells the
     * difference between "restored" and "reached" (LLD §10, Draft 2.4).
     */
    return await reachedRecordedPage(input, surface);
  },
};

/** Two URLs naming the same path, whatever their origin or query. */
export function samePath(a: string, b: string): boolean {
  const path = (url: string): string => {
    try {
      return new URL(url).pathname.replace(/\/+$/, "");
    } catch {
      return url;
    }
  };
  return path(a) === path(b);
}

let registered: Replayer = SESSION_STATE_REPLAYER;

/**
 * Register module (b)'s runtime-backed replayer. `@svatah/cli` does this when
 * the executor is present; nothing else may.
 */
export function registerReplayer(replayer: Replayer): void {
  registered = replayer;
}

export function currentReplayer(): Replayer {
  return registered;
}

/** Put the default back. For tests, and for a CLI running without the runtime. */
export function clearReplayer(): void {
  registered = SESSION_STATE_REPLAYER;
}

/** Whether anything but the session-state default is registered. */
export function hasReplayer(): boolean {
  return registered !== SESSION_STATE_REPLAYER;
}
