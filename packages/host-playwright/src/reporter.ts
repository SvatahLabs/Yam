/**
 * The Yam reporter (REQ-RUN-12, LLD §9.1).
 *
 * "Results are additionally written in the Yam schema by a reporter."
 *
 * *Additionally* is the word that matters. Playwright's own reporters keep doing
 * everything they do — the HTML report, the trace viewer, the terminal list —
 * and this writes `runs/<id>/results.jsonl` and `summary.json` beside them, in
 * the schema a foreign runtime's conformance harness reads (REQ-STD-2) and the
 * healer consumes (REQ-HEAL-1).
 *
 * ```ts
 * // playwright.config.ts
 * reporter: [["list"], ["@svatah/yam-host-playwright/reporter", { outputDir: "runs" }]]
 * ```
 *
 * ## Results come from the test, not from the reporter
 *
 * A reporter sees a test pass or fail; it does not see steps. So the fixture
 * attaches the Yam results to the test (`testInfo.attach`) and the reporter
 * collects them. That keeps one source of truth — the executor's own results —
 * rather than a second, thinner account reconstructed from Playwright's view.
 */
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import {
  canonicalJson,
  SCHEMA_VERSION,
  type StepResult,
  type Summary,
} from "@svatah/yam-schema";
import { abortedByPolicy, newRunId, summarise } from "@svatah/yam-runtime";

/** The attachment name the fixture uses and the reporter reads. */
export const RESULTS_ATTACHMENT = "yam-results";

export interface YamReporterOptions {
  /** Where run directories go. Default `runs`. */
  readonly outputDir?: string;
  /** Fix the run id, for a test that compares two runs byte for byte. */
  readonly runId?: string;
}

export default class YamReporter implements Reporter {
  private readonly outputDir: string;
  private readonly runId: string;
  private readonly results: StepResult[] = [];
  private startedAt = new Date();
  private planHash = "unknown";

  constructor(options: YamReporterOptions = {}) {
    this.outputDir = options.outputDir ?? "runs";
    this.runId = options.runId ?? newRunId();
  }

  onBegin(_config: FullConfig, _suite: Suite): void {
    this.startedAt = new Date();
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (attachment.name !== RESULTS_ATTACHMENT || attachment.body === undefined) continue;
      try {
        const parsed = JSON.parse(attachment.body.toString("utf8")) as {
          planHash?: string;
          results: StepResult[];
        };
        if (parsed.planHash !== undefined) this.planHash = parsed.planHash;
        this.results.push(...parsed.results);
      } catch {
        // A malformed attachment is not worth failing a run over; the run's own
        // outcome is Playwright's, and this file is the secondary account.
      }
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    const path = join(this.outputDir, this.runId);
    mkdirSync(path, { recursive: true });

    for (const one of this.results) {
      appendFileSync(join(path, "results.jsonl"), `${JSON.stringify(one)}\n`, "utf8");
    }

    const { totals, exitCode } = summarise(this.results);
    const flows: Summary["flows"] = {};
    for (const one of this.results) {
      const flow = (flows[one.flow] ??= { status: "passed", passed: 0, failed: 0, skipped: 0 });
      if (one.status === "passed") flow.passed += 1;
      if (one.status === "failed") flow.failed += 1;
      if (one.status === "skipped") flow.skipped += 1;
      if (one.status === "failed") flow.status = "failed";
      if (one.status === "aborted") flow.status = "aborted";
    }
    /*
     * A compensation aborts its flow (LLD §8.3, Draft 2.7), and since the
     * compensating story's steps keep their own statuses the abort is on the
     * failing step's `policyApplied`, not on any step's status. The standalone
     * executor reads it the same way; the two must not disagree about a flow
     * that ran under both.
     */
    for (const one of this.results) {
      if (abortedByPolicy([one]) && flows[one.flow] !== undefined) {
        flows[one.flow]!.status = "aborted";
      }
    }

    const summary: Summary = {
      schemaVersion: SCHEMA_VERSION,
      runId: this.runId,
      behavior: "test",
      planHash: this.planHash,
      bindingsHash: "none",
      configHash: "none",
      invoker: { kind: "ci", id: "playwright-test", via: "host" },
      startedAt: this.startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      flows,
      totals,
      // Playwright's own status wins when it is worse: a test that failed to
      // *start* produces no Yam results at all, and a summary saying
      // everything passed would be worse than no summary.
      exitCode: result.status === "passed" ? exitCode : Math.max(exitCode, 1),
    };
    writeFileSync(join(path, "summary.json"), `${canonicalJson(summary)}\n`, "utf8");
  }

  printsToStdio(): boolean {
    return false;
  }
}
