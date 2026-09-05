/**
 * Running a surface conformance suite and reporting on it (LLD §14, REQ-SURF-3).
 *
 * An adapter is "conformant" only when the suite passes. What that means is
 * decided here and nowhere else: every case ran, every check held, and a case the
 * adapter's capabilities exclude was skipped rather than silently passed.
 */
import type { AgentSurface } from "@svatah/surface";
import { SURFACE_CASES } from "./cases.js";
import type {
  CaseContext,
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

/** The name of a thrown value's constructor, for the `throws` check. */
function errorName(value: unknown): string {
  if (value instanceof Error) return value.constructor.name;
  return typeof value;
}

async function runCase(
  testCase: ConformanceCase,
  options: RunOptions,
): Promise<CaseReport> {
  const started = Date.now();
  const checks: CheckResult[] = [];

  /*
   * A surface that will not open is a *failed case*, not a crash (T6.2).
   *
   * It used to be thrown from here, outside the `try`, so `svatah surface
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

    const context: CaseContext = {
      surface,
      baseUrl: options.baseUrl,
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
        try {
          const value = await run();
          checks.push({
            description,
            ok: false,
            expected: `${expectedName} thrown`,
            actual: `returned ${JSON.stringify(value)}`,
          });
        } catch (error) {
          const name = errorName(error);
          // `Error` means "anything, so long as it threw" — the suite requires a
          // named type only where the surface contract names one.
          const ok = expectedName === "Error" ? error instanceof Error : name === expectedName;
          checks.push({
            description,
            ok,
            expected: expectedName,
            actual: `${name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
          });
        }
      },
    };

    await testCase.run(context);

    const failed = checks.some((c) => !c.ok);
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

  const cases: CaseReport[] = [];
  for (const testCase of selected) cases.push(await runCase(testCase, options));

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
    startedAt,
    durationMs: Date.now() - started,
    cases,
    totals,
    conformant: totals.failed === 0 && totals.passed > 0,
  };
}
