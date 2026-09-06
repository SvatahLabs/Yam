/**
 * The recorder as module (a)'s two plugins (T3.3, LLD §10, §6.5, §11).
 *
 * "Implements `Regrounder` for the healer and the `bind()` record mode."
 *
 * Module (a) — the bindings store, the healer, `bind()` — must work with no
 * model at all (REQ-PKG-1). It defines two holes and works without them filled:
 * healing is relocalization plus an honest count of what it could not repair,
 * and `bind()` records by a person clicking. Module (b) fills both with the same
 * `ground()` the recorder uses for a flow, so a project that installs the flow
 * language does not get a second, subtly different grounding.
 *
 * Registration is the CLI's and the host's job, never a package's own import
 * side effect: which of the two modules is installed is a fact about the
 * project, and the thing that knows it is the thing the project ran.
 */
import type { AgentSurface } from "@svatah/yam-surface";
import type { BindingEntry } from "@svatah/yam-schema";
import type { Gateway } from "@svatah/yam-gateway";
import { ground, type GroundOptions } from "./ground.js";

/** Everything both plugins need. The caller supplies the gateway and the config. */
export interface PluginOptions extends Omit<GroundOptions, "gateway" | "snapshot"> {
  readonly gateway: Gateway;
  /** Called with a one-line account of each decision, for a report or a log. */
  readonly onDecision?: (line: string) => void;
}

/**
 * The healer's `Regrounder` (LLD §10, REQ-HEAL-1's model half).
 *
 * Reached only when relocalization could not place a fingerprint, which is the
 * ordering REQ-HEAL-1 asks for: "by fingerprint relocalization first (no model),
 * then one model re-grounding call per element if configured". One call, and
 * `null` when it could not — a repair that did not happen, not an error.
 *
 * The phrase is what the healer knows and the model needs. When a store has none
 * — a `bind()` id recorded before phrases were kept — the id is used, because
 * `login.username-field` still reads as a description of an element, which is
 * the whole reason ids are written that way.
 */
export function recorderRegrounder(options: PluginOptions): {
  readonly name: string;
  ground(
    request: { id: string; phrase?: string; entry: BindingEntry },
    surface: AgentSurface,
  ): Promise<BindingEntry | null>;
} {
  return {
    name: `recorder:${options.gateway.name}`,
    async ground(request, surface): Promise<BindingEntry | null> {
      const result = await ground(
        { id: request.id, phrase: request.phrase ?? phraseFromId(request.id) },
        surface,
        options,
      );
      options.onDecision?.(`${request.id}: ${result.decision.outcome}`);
      if (result.entry === undefined) return null;

      /*
       * A re-grounded binding is not verified.
       *
       * The healer verifies it — REQ-HEAL-3, "a repaired binding is verified by
       * re-running the failed story before inclusion" — and marking it here
       * would be the recorder vouching for a step it did not run.
       */
      return { ...result.entry, verified: false };
    },
  };
}

/**
 * `bind()`'s record mode (LLD §6.5).
 *
 * Module (a) records by opening the page and waiting for a person to click. That
 * is the right default for a plain Playwright project and a poor one in CI. With
 * the flow language installed there is a model and a phrase, so the same
 * grounding a flow gets is available to a `bind("login.username-field", "the
 * username field")`.
 *
 * `null` falls back to the picker rather than failing: a person at a keyboard is
 * a better answer than an error, and the fallback is what makes registering this
 * safe.
 */
export function recorderBindGrounder(options: PluginOptions): {
  readonly name: string;
  ground(
    request: { id: string; phrase?: string },
    surface: AgentSurface,
  ): Promise<BindingEntry | null>;
} {
  return {
    name: `recorder:${options.gateway.name}`,
    async ground(request, surface): Promise<BindingEntry | null> {
      const result = await ground(
        { id: request.id, phrase: request.phrase ?? phraseFromId(request.id) },
        surface,
        options,
      );
      options.onDecision?.(`${request.id}: ${result.decision.outcome}`);
      // `bind()` hands the test a locator and the test does the acting, so this
      // is not verified either (REQ-REC-5).
      return result.entry === undefined ? null : { ...result.entry, verified: false };
    },
  };
}

/**
 * `login.username-field` → "the username field".
 *
 * A last resort, for a store that recorded no phrase. Element ids are written as
 * `<context>.<element>` in words precisely so they still read as descriptions,
 * and the alternative — refusing to ground because nobody typed a sentence — is
 * worse than grounding from the name the project chose.
 */
export function phraseFromId(id: string): string {
  const last = id.split(".").pop() ?? id;
  return `the ${last.split("-").join(" ")}`;
}
