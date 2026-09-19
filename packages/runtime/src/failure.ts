/**
 * Failure classification (REQ-RUN-8, LLD §8.4).
 *
 * The class is what the healer selects on (`locator` failures, REQ-HEAL-1), what
 * a report groups by, and what a person reads first. Getting it from the error's
 * *type* rather than from its message is what makes it reliable: a message
 * changes when someone improves the wording, and a `catch` that pattern-matched
 * on text would silently start classifying everything as `unknown`.
 */
import {
  ActionabilityError,
  CheckError,
  DataError as SurfaceDataError,
  DialogError,
  LocateError,
  NavigationError,
  ScriptError,
  SessionError,
  TimeoutError,
  UnsupportedError,
} from "@svatah/yam-surface";
import type { FailureClass } from "@svatah/yam-schema";
import { DataError } from "./scope.js";

/** Thrown when a guard could not be evaluated (LLD §8.3). */
export class GuardError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

/** The class LLD §8.4 assigns to an error. */
export function classify(error: unknown): FailureClass {
  if (error instanceof LocateError) return "locator";
  if (error instanceof TimeoutError) return "timeout";
  if (error instanceof CheckError) return "assertion";
  if (error instanceof GuardError) return "guard";
  if (error instanceof DataError || error instanceof SurfaceDataError) return "data";
  if (error instanceof NavigationError) return "navigation";
  if (error instanceof DialogError) return "dialog";
  if (error instanceof ScriptError) return "script";
  if (error instanceof SessionError) return "infrastructure";
  // The adapter cannot do this at all; see `UnsupportedError`.
  if (error instanceof UnsupportedError) return "infrastructure";
  // An element that is present but not actionable — covered by a mask, disabled,
  // still moving — is a timing problem, which is what `timeout` means to a
  // person reading a report.
  if (error instanceof ActionabilityError) return "timeout";
  return "unknown";
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function stackOf(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/**
 * The candidates a locator failure tried, for `failure.candidatesTried`
 * (REQ-RUN-5: "reports every candidate tried on failure").
 *
 * Read structurally rather than by importing the resolver's `LocatorError`:
 * `runtime` depends on `bindings`, but a foreign resolver — or a host that
 * resolves its own way — should not have to subclass one particular error to
 * have its attempts recorded.
 */
export function candidatesTried(error: unknown): unknown[] | undefined {
  if (!(error instanceof LocateError)) return undefined;
  const detail = (error as unknown as { detail?: { tried?: Array<{ candidate?: unknown }> } }).detail;
  if (!Array.isArray(detail?.tried)) return undefined;
  return detail.tried.map((attempt) => attempt.candidate).filter((c) => c !== undefined);
}
