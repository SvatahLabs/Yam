/**
 * The `Regrounder` plugin (LLD §10, REQ-HEAL-1).
 *
 * "Because `healer` is part of module (a) and must not depend on `gateway`, the
 * model re-grounding step is a plugin: `healer` defines
 * `interface Regrounder { ground(step, surface): Promise<BindingEntry | null> }`;
 * module (b) registers the recorder's implementation at CLI start; module (a)
 * alone runs relocalization only and reports the rest as unrepaired."
 *
 * The default is a no-op that returns `null`, which is what makes "module (a)
 * alone" true rather than aspirational: with nothing registered, healing is
 * relocalization and the residue is reported as unrepaired. It is never quietly
 * dropped, and the report says how many.
 */
import type { AgentSurface } from "@svatah/yam-surface";
import type { BindingEntry } from "@svatah/yam-schema";

/** What the healer knows about the element it is trying to re-find. */
export interface RegroundRequest {
  /** The element id, e.g. `login.username-field`. */
  readonly id: string;
  /** The phrase a person used for it, when one was recorded. */
  readonly phrase?: string;
  /** The binding as it stands, with the fingerprint relocalization could not place. */
  readonly entry: BindingEntry;
}

/**
 * The model half of REQ-HEAL-1, as an interface the healer depends on and module
 * (b) satisfies. Returning `null` means "I could not ground this either", which
 * is a repair that did not happen rather than an error.
 */
export interface Regrounder {
  /** A name for the report and the provenance. */
  readonly name: string;
  ground(request: RegroundRequest, surface: AgentSurface): Promise<BindingEntry | null>;
}

/**
 * The default: no model, no grounding, no pretence.
 *
 * Module (a) ships this and nothing else, so a heal run from a plain Playwright
 * project is relocalization plus an honest count of what it could not repair.
 */
export const NO_REGROUNDER: Regrounder = {
  name: "none",
  async ground(): Promise<BindingEntry | null> {
    return null;
  },
};

let registered: Regrounder = NO_REGROUNDER;

/**
 * Register the implementation module (b) provides. The CLI does this at start
 * when the recorder is present; nothing else may.
 */
export function registerRegrounder(regrounder: Regrounder): void {
  registered = regrounder;
}

/** The registered `Regrounder`, or the no-op default. */
export function currentRegrounder(): Regrounder {
  return registered;
}

/** Put the default back. For tests, and for a CLI that ran without a gateway. */
export function clearRegrounder(): void {
  registered = NO_REGROUNDER;
}

/** Whether anything but the no-op is registered — the report says so. */
export function hasRegrounder(): boolean {
  return registered !== NO_REGROUNDER;
}
