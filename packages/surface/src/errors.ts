import type { FailureClass } from "@svatah/yam-schema";

/**
 * The typed errors adapters throw (LLD §2.3).
 *
 * Each one carries the failure class the executor records, so LLD §8.4's mapping
 * is data on the error rather than a switch statement above the surface. An error
 * an adapter does not classify becomes `unknown`, which is the honest outcome.
 */
export abstract class SurfaceError extends Error {
  /** The `FailureClass` the executor records for this error (LLD §8.4, REQ-RUN-8). */
  abstract readonly failureClass: FailureClass;

  /** The adapter that threw, when it is known. */
  readonly adapter?: string;

  constructor(message: string, options?: { cause?: unknown; adapter?: string }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    if (options?.adapter !== undefined) this.adapter = options.adapter;
  }
}

/**
 * A candidate matched no element, or matched more than one where exactly one was
 * required (LLD §6.3).
 *
 * The resolver in `@svatah/yam-bindings` raises its own richer `LocatorError`, which
 * adds the candidate list and the context-drift flag; this is the adapter-level
 * error it is built from.
 */
export class LocateError extends SurfaceError {
  override readonly failureClass = "locator" as const;
  /** How many elements the candidate matched, when the adapter counted them. */
  readonly matchCount?: number;

  constructor(message: string, options?: { cause?: unknown; adapter?: string; matchCount?: number }) {
    super(message, options);
    if (options?.matchCount !== undefined) this.matchCount = options.matchCount;
  }
}

/** The element was found but was not in a state that permits the action. */
export class ActionabilityError extends SurfaceError {
  override readonly failureClass = "timeout" as const;
}

/** An operation exceeded its configured timeout. */
export class TimeoutError extends SurfaceError {
  override readonly failureClass = "timeout" as const;
  readonly timeoutMs?: number;

  constructor(message: string, options?: { cause?: unknown; adapter?: string; timeoutMs?: number }) {
    super(message, options);
    if (options?.timeoutMs !== undefined) this.timeoutMs = options.timeoutMs;
  }
}

/** A `check()` predicate did not hold. Maps to the `assertion` failure class. */
export class CheckError extends SurfaceError {
  override readonly failureClass = "assertion" as const;
  readonly actual?: unknown;
  readonly expected?: unknown;

  constructor(
    message: string,
    options?: { cause?: unknown; adapter?: string; actual?: unknown; expected?: unknown },
  ) {
    super(message, options);
    if (options !== undefined && "actual" in options) this.actual = options.actual;
    if (options !== undefined && "expected" in options) this.expected = options.expected;
  }
}

/** A dialog was expected and absent, unexpected and present, or could not be handled. */
export class DialogError extends SurfaceError {
  override readonly failureClass = "dialog" as const;
}

/** Navigation failed, timed out, or landed somewhere unexpected. */
export class NavigationError extends SurfaceError {
  override readonly failureClass = "navigation" as const;
}

/** An `evaluate` or an injected script threw. */
export class ScriptError extends SurfaceError {
  override readonly failureClass = "script" as const;
}

/** The session could not be opened, was lost, or the driven process crashed. */
export class SessionError extends SurfaceError {
  override readonly failureClass = "infrastructure" as const;
}

/** A value was missing or of the wrong type (type validation, `{data.*}` lookups). */
export class DataError extends SurfaceError {
  override readonly failureClass = "data" as const;
}

/** Every surface error class, in the order LLD §2.3 lists them. */
export const SURFACE_ERRORS = [
  LocateError,
  ActionabilityError,
  TimeoutError,
  CheckError,
  DialogError,
  NavigationError,
  ScriptError,
  SessionError,
  DataError,
] as const;

/**
 * The failure class for any thrown value (LLD §8.4).
 *
 * Anything that is not a `SurfaceError` is `unknown`, so an adapter that leaks a
 * native error is visible in the results rather than silently miscategorised.
 */
export function failureClassOf(error: unknown): FailureClass {
  return error instanceof SurfaceError ? error.failureClass : "unknown";
}
