/**
 * The run directory (REQ-RUN-9, LLD §8.6).
 *
 * "A run directory holds `results.jsonl`, `summary.json`, `audit.jsonl`,
 * screenshots, and adapter traces; exit code is non-zero on failure, healed, or
 * aborted."
 *
 * Files, in a directory, in the project — not a database and not a service.
 * `runs/<id>/` can be attached to a CI job, committed to a bug report, diffed
 * against another run, and read by a foreign runtime's conformance harness
 * (REQ-STD-2). That is worth more than any query interface.
 *
 * Results are appended as they happen rather than written at the end, so a run
 * that is killed still leaves everything it got through.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  canonicalJson,
  checkpointSchema,
  SCHEMA_VERSION,
  type AuditLine,
  type Checkpoint,
  type StepResult,
  type Summary,
} from "@svatah/yam-schema";

/** Non-zero on failed, healed or aborted (REQ-RUN-9, LLD §15). */
export const EXIT = {
  ok: 0,
  failed: 1,
  healed: 6,
  someUnrepaired: 7,
  aborted: 11,
  /** `run --resume`: the plan or bindings hash does not match the checkpoint. */
  hashMismatch: 12,
} as const;

export interface RunDirectory {
  readonly path: string;
  result(result: StepResult): void;
  audit(line: AuditLine): void;
  checkpoint(checkpoint: Checkpoint): void;
  /** Where a screenshot for a step goes, relative to the run directory. */
  screenshot(name: string): string;
  summary(summary: Summary): void;
}

/** Open (creating) a run directory. */
export function openRunDirectory(outputDir: string, runId: string): RunDirectory {
  const path = join(outputDir, runId);
  mkdirSync(join(path, "screenshots"), { recursive: true });

  const append = (file: string, value: unknown): void => {
    appendFileSync(join(path, file), `${JSON.stringify(value)}\n`, "utf8");
  };

  return {
    path,
    result: (result) => append("results.jsonl", result),
    audit: (line) => append("audit.jsonl", line),
    checkpoint: (checkpoint) => {
      const file = join(path, "checkpoints", `${safe(checkpoint.stepId)}.json`);
      mkdirSync(dirname(file), { recursive: true });
      // Written whole, so a run killed mid-write leaves no half a checkpoint
      // for `--resume` to trust (LLD §8.6: "written atomically").
      writeFileSync(`${file}.tmp`, `${canonicalJson(checkpoint)}\n`, "utf8");
      renameSync(`${file}.tmp`, file);
    },
    screenshot: (name) => join(path, "screenshots", `${safe(name)}.png`),
    summary: (summary) => {
      writeFileSync(join(path, "summary.json"), `${canonicalJson(summary)}\n`, "utf8");
    },
  };
}

/** A step id is a story name and a number; neither is safe as a file name. */
function safe(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Did a policy abort the flow these results belong to (LLD §8.3, Draft 2.7)?
 *
 * `compensate:<story>` is the only policy that aborts: `stop` and `continue`
 * leave the run `failed`. Since Draft 2.7 the compensating story's steps keep
 * their own statuses, so no step is labelled `aborted` any more and the abort
 * has to be read off the failing step's `policyApplied` — which is an object
 * (`{ compensate: "…" }`) exactly when the policy was a compensation.
 *
 * Stated as a function on `results.jsonl` rather than as internal executor
 * state on purpose: the Playwright Test host's reporter, the runtime
 * conformance suite, and a foreign runtime all have the results file and
 * nothing else, and all three have to agree on when a run is `aborted`.
 */
export function abortedByPolicy(results: readonly StepResult[]): boolean {
  return results.some((result) => {
    const policy = result.failure?.policyApplied;
    return typeof policy === "object" && policy !== null;
  });
}

/** The totals and the exit code a summary carries (REQ-RUN-9). */
export function summarise(
  results: readonly StepResult[],
): { totals: Summary["totals"]; exitCode: number } {
  const totals = {
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    healed: results.filter((r) => r.status === "healed").length,
    aborted: results.filter((r) => r.status === "aborted").length,
  };

  const exitCode =
    totals.aborted > 0 || abortedByPolicy(results)
      ? EXIT.aborted
      : totals.failed > 0
        ? EXIT.failed
        : totals.healed > 0
          ? EXIT.healed
          : EXIT.ok;

  return { totals, exitCode };
}

/**
 * Read one step's checkpoint out of a run directory (REQ-AUTO-3, T5.1).
 *
 * `undefined` rather than an exception when it is not there: `--resume` walks
 * backwards looking for the most recent checkpoint before the step it was asked
 * to start at, and "no checkpoint for this step" is the normal answer for most
 * of the steps it looks at. A file that exists and will not parse *is* an
 * exception — a half-written checkpoint is exactly what resume must not trust,
 * and they are written atomically so a half-written one means something else
 * went wrong.
 */
export function readCheckpoint(runDir: string, stepId: string): Checkpoint | undefined {
  const file = join(runDir, "checkpoints", `${safe(stepId)}.json`);
  if (!existsSync(file)) return undefined;
  return checkpointSchema.parse(JSON.parse(readFileSync(file, "utf8"))) as Checkpoint;
}

/** A checkpoint for a step (REQ-AUTO-2). */
export function checkpointFor(parts: Omit<Checkpoint, "schemaVersion">): Checkpoint {
  return { schemaVersion: SCHEMA_VERSION, ...parts } as Checkpoint;
}
