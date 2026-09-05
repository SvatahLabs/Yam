/**
 * The shape of a surface conformance suite (LLD §14, REQ-SURF-3, REQ-STD-2).
 *
 * "For each sample app page, a script of surface calls with expected snapshot
 * invariants (roles present, names, states), expected `act` effects (URL change,
 * value change, dialog appears), and error types. Runs against any adapter via
 * `svatah surface conform --adapter <name>`."
 *
 * A suite is data, not code that happens to assert: every check carries what it
 * expected and what it saw, so the report a third party gets from a failing
 * adapter names the call, the expectation and the observation without them
 * reading the suite's source (REQ-STD-2 — the suite is published and runnable by
 * third parties).
 */
import type { AgentSurface } from "@svatah/surface";

/** One observation the suite made. */
export interface CheckResult {
  /** What was being checked, as a sentence: "the login page has a textbox named Username". */
  readonly description: string;
  readonly ok: boolean;
  readonly expected?: unknown;
  readonly actual?: unknown;
  /** Set when the check could not run at all — a call threw where it should not have. */
  readonly error?: string;
}

/** What a case is handed. */
export interface CaseContext {
  readonly surface: AgentSurface;
  /** Where the sample application is served. */
  readonly baseUrl: string;
  /** Record one observation. */
  check(description: string, ok: boolean, detail?: { expected?: unknown; actual?: unknown }): void;
  /** Record an equality observation, filling in expected and actual. */
  equals(description: string, actual: unknown, expected: unknown): void;
  /** Record that a call threw the error class the suite required. */
  throws(description: string, run: () => Promise<unknown>, errorName: string): Promise<void>;
}

export interface ConformanceCase {
  /** Stable id, cited by the report: `login.snapshot`. */
  readonly id: string;
  /** The sample page the case drives, for grouping in the report. */
  readonly page: string;
  /** One line saying what conformance this case establishes. */
  readonly description: string;
  /** Capability flags the case needs; skipped, not failed, when the adapter lacks one. */
  readonly requires?: readonly string[];
  run(context: CaseContext): Promise<void>;
}

export interface CaseReport {
  readonly id: string;
  readonly page: string;
  readonly description: string;
  readonly status: "passed" | "failed" | "skipped";
  /** Why it was skipped, when it was. */
  readonly skipReason?: string;
  readonly checks: readonly CheckResult[];
  readonly durationMs: number;
  /** Set when the case itself threw rather than a check failing. */
  readonly error?: string;
}

export interface ConformanceReport {
  readonly adapter: string;
  /**
   * What the adapter is actually driving, when it can say.
   *
   * "The BiDi suite passes" is not a result on its own: it matters whether that
   * was stock Firefox, a Playwright-downloaded build, or an endpoint someone
   * else was hosting (LLD §7.3, T4.1). An adapter reports it by exposing a
   * `browser(): string`; one that does not simply has no detail to publish.
   */
  readonly adapterDetail?: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly cases: readonly CaseReport[];
  readonly totals: {
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly checks: number;
    readonly failedChecks: number;
  };
  /** True when nothing failed. An adapter is "conformant" only then (REQ-SURF-3). */
  readonly conformant: boolean;
}
