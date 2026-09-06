/**
 * Where a heal job's input comes from (LLD §12, REQ-HEAL-1).
 *
 * "Input comes either from a Yam run directory or from the `bind()` failure
 * lines written by host tests (`.yam/bind-failures.jsonl`), so module (a)
 * users heal without flows."
 *
 * Both shapes reduce to the same thing: an element id that would not resolve, the
 * page it would not resolve on, and what was tried. That is all the repair needs.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Candidate, SessionState, StepResult } from "@svatah/yam-schema";

/** One failure to repair. */
export interface HealInput {
  readonly id: string;
  readonly phrase?: string;
  /** Where this came from, for the report. */
  readonly source: "bind-failure" | "run";
  /** The URL the session was on when it failed. */
  readonly url?: string;
  readonly state?: SessionState;
  readonly tried: readonly Candidate["by"][];
  readonly contextDrift: boolean;
  /** The run's step, when the input was a run directory. */
  readonly stepId?: string;
  readonly story?: string;
  /** The flow the failing story belongs to, for a replayer that needs its base URL. */
  readonly flow?: string;
}

interface BindFailureLine {
  id: string;
  phrase?: string;
  at: string;
  contextDrift: boolean;
  recordedHash?: string;
  liveHash?: string;
  state?: SessionState;
  tried?: Array<{ by: Candidate["by"] }>;
}

/**
 * Read `.yam/bind-failures.jsonl`.
 *
 * The file is append-only and a test run appends to it every time, so the same
 * element can appear many times. Only the most recent line per element is
 * repaired: an older one describes a page that has since moved on.
 */
export function readBindFailures(outputDir: string): HealInput[] {
  const path = join(outputDir, "bind-failures.jsonl");
  if (!existsSync(path)) return [];

  const latest = new Map<string, HealInput>();
  for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
    if (line.trim() === "") continue;
    let parsed: BindFailureLine;
    try {
      parsed = JSON.parse(line) as BindFailureLine;
    } catch (cause) {
      throw new Error(`${path}:${index + 1} is not valid JSON.`, { cause });
    }
    if (typeof parsed.id !== "string" || parsed.id === "") continue;

    latest.set(parsed.id, {
      id: parsed.id,
      ...(parsed.phrase === undefined ? {} : { phrase: parsed.phrase }),
      source: "bind-failure",
      ...(parsed.state?.url === undefined ? {} : { url: parsed.state.url }),
      ...(parsed.state === undefined ? {} : { state: parsed.state }),
      tried: (parsed.tried ?? []).map((t) => t.by),
      contextDrift: parsed.contextDrift === true,
    });
  }
  return [...latest.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Read the `locator` failures out of a run directory (`runs/<id>/results.jsonl`).
 *
 * "The healer consumes a run, selects `locator` failures" (REQ-HEAL-1). The
 * executor that writes `results.jsonl` arrives in Phase 2 (T2.7), so in Phase 1
 * this path has no producer inside the repository — but the format is published
 * (`results.schema.json`), a foreign runtime can write it today, and the reader
 * is tested against the schema's own shape rather than against a file this
 * repository happens to produce.
 */
export function readRunFailures(runDir: string): HealInput[] {
  const path = join(runDir, "results.jsonl");
  if (!existsSync(path)) return [];

  const inputs: HealInput[] = [];
  for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
    if (line.trim() === "") continue;
    let result: StepResult;
    try {
      result = JSON.parse(line) as StepResult;
    } catch (cause) {
      throw new Error(`${path}:${index + 1} is not valid JSON.`, { cause });
    }
    // Only `locator` failures: a timeout, an assertion or a data error is not
    // something relocalization can repair, and offering to try would waste a
    // reviewer's attention (REQ-HEAL-1).
    if (result.status !== "failed" || result.failure?.class !== "locator") continue;

    const id = elementIdOf(result);
    if (id === undefined) continue;

    /*
     * The page the step failed on (Draft 2.4, LLD §3.4, §10).
     *
     * Until the executor recorded `failure.session`, a run failure reached the
     * healer with no state at all, so module (a)'s session-state replayer had
     * nowhere to restore to and answered `unreachable` for every one of them —
     * the defect F1 names. The state is what makes healing a run possible
     * without a plan.
     */
    const session = result.failure.session;

    inputs.push({
      id,
      source: "run",
      ...(session?.url === undefined ? {} : { url: session.url }),
      ...(session === undefined ? {} : { state: session }),
      tried: (result.failure.candidatesTried ?? []).map((c) => c.by),
      contextDrift: false,
      stepId: result.stepId,
      story: result.story,
      flow: result.flow,
    });
  }
  return inputs;
}

/**
 * The element id a failed step was resolving.
 *
 * `StepResult` records the step, not the target, so the id is taken from the
 * failure message the resolver wrote — which always names it in quotes, because
 * `LocatorError` builds its message from the id.
 */
function elementIdOf(result: StepResult): string | undefined {
  const match = /Could not resolve "([^"]+)"/.exec(result.failure?.message ?? "");
  return match?.[1];
}
