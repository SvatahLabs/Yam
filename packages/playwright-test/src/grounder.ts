/**
 * `bind()`'s record-mode plugin (T3.3, LLD §6.5, §10, REQ-REC-11).
 *
 * The same shape as the healer's `Regrounder`, and for the same reason.
 * `playwright-test` is module (a): a plain Playwright user installs it without
 * the flow language, the compiler or a model gateway (REQ-PKG-1), so record mode
 * cannot import one. What module (a) ships is the picker — a person clicks the
 * element — which is the right answer at a keyboard and a poor one in CI.
 *
 * When module (b) is installed, `@svatah/host-playwright` registers the
 * recorder's implementation here, and `bind("login.username-field", "the
 * username field")` is grounded by exactly the same `ground()` a flow gets. One
 * grounding, two entry points; a second implementation would drift, and the
 * drift would be a `bind()` binding that disagrees with a flow's.
 *
 * Returning `null` falls back to the picker. That is what makes registering it
 * safe: a model that cannot see the element leaves a person able to point at it.
 */
import type { BindingEntry } from "@svatah/schema";
import type { AgentSurface } from "@svatah/surface";

/** What record mode knows about the element it is asked to bind. */
export interface BindGroundRequest {
  /** The element id, e.g. `login.username-field`. */
  readonly id: string;
  /** The phrase the test passed, when it passed one. */
  readonly phrase?: string;
}

export interface BindGrounder {
  /** A name, for the outcome and for a test that asks who answered. */
  readonly name: string;
  /** The entry, or `null` to fall back to the picker. */
  ground(request: BindGroundRequest, surface: AgentSurface): Promise<BindingEntry | null>;
}

/** The default: module (a) has no model, and says so by declining every request. */
export const NO_BIND_GROUNDER: BindGrounder = {
  name: "none",
  async ground(): Promise<BindingEntry | null> {
    return null;
  },
};

let registered: BindGrounder = NO_BIND_GROUNDER;

/**
 * Register module (b)'s grounder. `@svatah/host-playwright` does this when the
 * recorder is present; nothing else may.
 */
export function registerBindGrounder(grounder: BindGrounder): void {
  registered = grounder;
}

export function currentBindGrounder(): BindGrounder {
  return registered;
}

/** Put the default back. For tests, and for a project without module (b). */
export function clearBindGrounder(): void {
  registered = NO_BIND_GROUNDER;
}

/** Whether anything but the picker-only default is registered. */
export function hasBindGrounder(): boolean {
  return registered !== NO_BIND_GROUNDER;
}
