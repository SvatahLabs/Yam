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
import type { Fingerprint, Ref } from "@svatah/schema";
import type { AgentSurface } from "@svatah/surface";

/**
 * What the desktop healing cases need, and this package will not import
 * (Draft 2.8 LLD §16, T7.1).
 *
 * > a binding recorded at variant 0 must relocalize on both through the desktop
 * > adapter with the same weights and threshold as the web healing eval
 *
 * The relocalizer lives in `@svatah/bindings`, which this package does not
 * depend on and should not: the suite is published for third parties to run
 * against *their* adapter, and a conformance suite that dragged the healer in
 * with it would make that a bigger ask than it is. So it arrives the way the
 * executor's collaborators arrive (LLD §8) — injected by the CLI, which owns
 * the healer already. A run with no healer skips the healing cases rather than
 * passing them.
 */
export interface RecordedElement {
  /** The fingerprint taken at variant 0 (LLD §3.3). */
  readonly fingerprint: Fingerprint;
  /**
   * The ground truth: the element's `automationId`.
   *
   * The desktop equivalent of `apps/sample-web`'s `data-svatah-eval`
   * (LLD §16). It is read through `describe()` — which does not apply
   * `ignoreAttributes` — while the relocalizer is told to ignore it, so the
   * answer key cannot help the answer.
   */
  readonly key: string;
  /** The roles from the root down, so a moved control can be shown to have moved. */
  readonly rolePath: readonly string[];
}

/** What model-free relocalization answered (LLD §6.4). */
export interface HealOutcome {
  readonly outcome: "relocalized" | "not-found" | "ambiguous";
  readonly ref?: Ref;
  readonly score?: number;
}

export interface DesktopHealing {
  /** Which ADE variant this window is showing: 0 records, 1 and 2 relocalize. */
  readonly variant: number;
  /** Fingerprint one element, with the ground-truth attribute excluded. */
  fingerprint(surface: AgentSurface, ref: Ref): Promise<Fingerprint>;
  /** Model-free, with the web healing eval's weights and threshold (LLD §16). */
  relocalize(
    surface: AgentSurface,
    fingerprint: Fingerprint,
    preferRole: string,
  ): Promise<HealOutcome>;
  recall(id: string): RecordedElement | undefined;
  remember(id: string, value: RecordedElement): void;
}

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
  /** The healer, for the desktop healing cases; absent when none was injected. */
  readonly healing?: DesktopHealing;
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
  /**
   * Which ADE accessibility variants this case runs at (LLD §16); `[0]` by
   * default, which is every case that is not a healing case. A case is
   * *skipped* at the other variants rather than dropped, so one report can be
   * read against another and a missing case is visible.
   */
  readonly variants?: readonly number[];
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

/**
 * What the adapter's bridge cost, when it has one (Draft 2.8 §7.5).
 *
 * "The desktop conformance report records nodes read, wall time, and
 * milliseconds per node." An adapter publishes it by exposing `bridgeCost()`,
 * the same duck-typing `adapterDetail` uses; a browser adapter has no process
 * boundary to charge for and simply has none.
 *
 * `invocations: 0` means the numbers came from a *recorded* tree rather than a
 * live read, and the report says so instead of publishing a cost nothing paid.
 */
export interface BridgeCost {
  readonly nodes: number;
  readonly wallMs: number;
  readonly msPerNode: number;
  readonly invocations: number;
  /** macOS only: the Apple events one snapshot sent. The number §7.5 is about. */
  readonly appleEvents?: number;
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
  /** The costliest window read the suite made, when the adapter measures one. */
  readonly bridge?: BridgeCost;
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
