/**
 * Running a surface conformance suite and reporting on it (LLD §14, REQ-SURF-3).
 *
 * An adapter is "conformant" only when the suite passes. What that means is
 * decided here and nowhere else: every case ran, every check held, and a case the
 * adapter's capabilities exclude was skipped rather than silently passed.
 */
import type { AgentSurface } from "@svatah/yam-surface";
import { SURFACE_CASES } from "./cases.js";
import type {
  BridgeCost,
  CaseContext,
  DesktopHealing,
  CaseReport,
  CheckResult,
  ConformanceCase,
  ConformanceReport,
} from "./types.js";

export interface RunOptions {
  /** Where the sample application is served, without a trailing slash. */
  baseUrl: string;
  /** Name of the adapter under test, for the report. */
  adapter: string;
  /** Run only these case ids. */
  only?: readonly string[];
  /** The suite to run; the web suite by default. */
  cases?: readonly ConformanceCase[];
  /**
   * Which APP_DIR accessibility variant the application under test is showing
   * (LLD §16). Cases that do not declare this variant are skipped, so one
   * variant's report can be read against another's.
   */
  variant?: number;
  /** The healer the desktop healing cases need; injected, never imported. */
  healing?: DesktopHealing;
  /** Opened and closed per case, so one case cannot leak state into the next. */
  openSurface: () => Promise<AgentSurface>;
  closeSurface?: (surface: AgentSurface) => Promise<void>;
}

/** What the adapter says it is driving, when it says anything (LLD §7.3). */
function detailOf(surface: AgentSurface): string | undefined {
  const described = (surface as unknown as { browser?: () => string }).browser;
  if (typeof described !== "function") return undefined;
  try {
    return described.call(surface);
  } catch {
    return undefined;
  }
}

/**
 * What one case's session cost the bridge, when the adapter measures it
 * (Draft 2.8 §7.5).
 *
 * Read in `runCase`'s `finally`, because the surface is closed there and a
 * closed adapter has nothing left to report.
 */
function costOf(surface: AgentSurface): BridgeCost | undefined {
  const measured = (surface as unknown as { bridgeCost?: () => BridgeCost | undefined }).bridgeCost;
  if (typeof measured !== "function") return undefined;
  try {
    return measured.call(surface);
  } catch {
    return undefined;
  }
}

/** The name of a thrown value's constructor, for the `throws` check. */
function errorName(value: unknown): string {
  if (value instanceof Error) return value.constructor.name;
  return typeof value;
}

async function runCase(
  testCase: ConformanceCase,
  options: RunOptions,
  collect: (cost: BridgeCost) => void,
): Promise<CaseReport> {
  const started = Date.now();
  const checks: CheckResult[] = [];

  /*
   * A surface that will not open is a *failed case*, not a crash (T6.2).
   *
   * It used to be thrown from here, outside the `try`, so `yam surface
   * conform` printed a stack trace and no report. That was survivable while
   * every adapter's session failure meant "the browser did not launch"; the
   * desktop adapters made it wrong. A missing macOS Accessibility permission is
   * a normal, expected, user-fixable state, and the answer to it is a report
   * saying every case failed and why — which is a thing a person can read and a
   * CI job can attach.
   */
  let surface: AgentSurface;
  try {
    surface = await options.openSurface();
  } catch (error) {
    return {
      id: testCase.id,
      page: testCase.page,
      description: testCase.description,
      status: "failed",
      checks: [
        {
          description: "the surface opens",
          ok: false,
          expected: "a session",
          actual: error instanceof Error ? error.message : String(error),
        },
      ],
      durationMs: Date.now() - started,
      error: error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error),
    };
  }

  try {
    /*
     * A case that belongs to another app variant is skipped rather than
     * dropped (LLD §16): three passes over the same suite produce three reports
     * that line up case for case, and a case that quietly vanished from one of
     * them would be invisible.
     */
    const variant = options.variant ?? 0;
    const variants = testCase.variants ?? [0];
    if (!variants.includes(variant)) {
      return {
        id: testCase.id,
        page: testCase.page,
        description: testCase.description,
        status: "skipped",
        skipReason: `the case runs at APP_DIR variant ${variants.join(" and ")}, and this is ${variant}`,
        checks: [],
        durationMs: Date.now() - started,
      };
    }

    const missing = (testCase.requires ?? []).filter(
      (flag) => (surface.capabilities() as unknown as Record<string, boolean>)[flag] !== true,
    );
    if (missing.length > 0) {
      return {
        id: testCase.id,
        page: testCase.page,
        description: testCase.description,
        status: "skipped",
        skipReason: `the adapter does not have the ${missing.map((m) => `"${m}"`).join(", ")} capability`,
        checks: [],
        durationMs: Date.now() - started,
      };
    }

    let skipped: string | undefined;
    const context: CaseContext = {
      surface,
      baseUrl: options.baseUrl,
      ...(options.healing === undefined ? {} : { healing: options.healing }),
      skip(reason) {
        skipped = reason;
      },
      check(description, ok, detail) {
        checks.push({ description, ok, ...(detail ?? {}) });
      },
      equals(description, actual, expected) {
        checks.push({
          description,
          ok: JSON.stringify(actual) === JSON.stringify(expected),
          expected,
          actual,
        });
      },
      async throws(description, run, expectedName) {
        const names: readonly string[] = typeof expectedName === "string" ? [expectedName] : expectedName;
        const expected = names.join(" or ");
        try {
          const value = await run();
          checks.push({
            description,
            ok: false,
            expected: `${expected} thrown`,
            actual: `returned ${JSON.stringify(value)}`,
          });
        } catch (error) {
          const name = errorName(error);
          // `Error` means "anything, so long as it threw" — the suite requires a
          // named type only where the surface contract names one.
          const ok = names.includes("Error") ? error instanceof Error : names.includes(name);
          checks.push({
            description,
            ok,
            expected,
            actual: `${name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
          });
        }
      },
    };

    await testCase.run(context);

    /*
     * Skipped beats passed, and "no checks" is skipped (Draft 2.9 §7.5).
     *
     * A case that ran and observed nothing used to be reported `passed`, which
     * counted it towards "7 of 7" while establishing nothing, and the gate's
     * own count of a 0/0 case was the F4 the verifier could not read. Neither
     * answer was right: the case has no result, and that is what `skipped`
     * means everywhere else in this suite.
     */
    const failed = checks.some((c) => !c.ok);
    if (!failed && (skipped !== undefined || checks.length === 0)) {
      return {
        id: testCase.id,
        page: testCase.page,
        description: testCase.description,
        status: "skipped",
        skipReason: skipped ?? "the case made no checks on this adapter",
        checks,
        durationMs: Date.now() - started,
      };
    }
    return {
      id: testCase.id,
      page: testCase.page,
      description: testCase.description,
      status: failed ? "failed" : "passed",
      checks,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      id: testCase.id,
      page: testCase.page,
      description: testCase.description,
      status: "failed",
      checks,
      durationMs: Date.now() - started,
      error: error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error),
    };
  } finally {
    const cost = costOf(surface);
    if (cost !== undefined) collect(cost);
    await (options.closeSurface?.(surface) ?? surface.close()).catch?.(() => undefined);
  }
}

/** Run the suite against one adapter (REQ-SURF-3, REQ-STD-2). */
export async function runSurfaceConformance(options: RunOptions): Promise<ConformanceReport> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const all = options.cases ?? SURFACE_CASES;
  const selected =
    options.only === undefined ? all : all.filter((c) => options.only!.includes(c.id));

  /*
   * Ask the adapter what it is driving before the suite runs, in a session of
   * its own. It cannot be read from a case's session — each case opens and
   * closes one so that no case can leak state into the next — and a report that
   * says "bidi passed" without saying *against what* is not a result (LLD §7.3).
   */
  let adapterDetail: string | undefined;
  try {
    const probe = await options.openSurface();
    adapterDetail = detailOf(probe);
    await (options.closeSurface?.(probe) ?? probe.close()).catch?.(() => undefined);
  } catch {
    // A surface that will not open is the suite's problem to report, case by
    // case, with the error each one saw. Not here.
  }

  /*
   * The costliest read across every case, not the last and not a mean: §7.5's
   * budget is about the biggest window the suite touched, and the app's project
   * screen is that window.
   */
  let bridge: BridgeCost | undefined;
  const collect = (cost: BridgeCost): void => {
    if (
      bridge === undefined ||
      cost.nodes > bridge.nodes ||
      (cost.nodes === bridge.nodes && cost.wallMs > bridge.wallMs)
    ) {
      bridge = cost;
    }
  };

  const cases: CaseReport[] = [];
  for (const testCase of selected) cases.push(await runCase(testCase, options, collect));

  const totals = {
    passed: cases.filter((c) => c.status === "passed").length,
    failed: cases.filter((c) => c.status === "failed").length,
    skipped: cases.filter((c) => c.status === "skipped").length,
    checks: cases.reduce((n, c) => n + c.checks.length, 0),
    failedChecks: cases.reduce((n, c) => n + c.checks.filter((k) => !k.ok).length, 0),
  };

  return {
    adapter: options.adapter,
    ...(adapterDetail === undefined ? {} : { adapterDetail }),
    ...(bridge === undefined ? {} : { bridge }),
    startedAt,
    durationMs: Date.now() - started,
    cases,
    totals,
    conformant: totals.failed === 0 && totals.passed > 0,
  };
}
