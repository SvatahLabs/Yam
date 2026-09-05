/**
 * Guards and compensation, end to end (T5.4, REQ-LANG-14, REQ-AUTO-1, 4).
 *
 * T5.4's Validate list, against the sample application through the installed
 * command line:
 *
 * 1. **A guarded step never acts when its guard is false**, and the audit shows
 *    no surface call for it. Not "the step was skipped" — that is what the
 *    result says, and a result is written by the same code that would have done
 *    the acting. The audit is the independent record: every surface call is
 *    logged by a proxy around the adapter, so a call the guard was supposed to
 *    prevent would be *there*, attributed to the step that made it.
 * 2. **A failed booking triggers "cancel booking"** — the compensating story
 *    runs with the failing story's scope, and the run ends `aborted` with the
 *    policy recorded on the failing step and in the audit.
 *
 * The three guard subjects the IR has are all exercised, because they take three
 * different paths through the executor: a page guard asks the surface, a scope
 * guard never touches it, and a target guard resolves the step's element first.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import type { AuditLine, StepResult, Summary } from "@svatah/schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const SVATAH = join(ROOT, "packages", "cli", "dist", "bin.js");
const FLOW = "flows/guards-and-compensation.flow";

let app: SampleServer;
const projects: string[] = [];

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), "svatah-guards-"));
  projects.push(dir);
  for (const entry of ["bindings", "flows", "api", "data.yaml"]) {
    cpSync(join(FIXTURES, entry), join(dir, entry), { recursive: true });
  }
  writeFileSync(
    join(dir, "svatah.config.yaml"),
    readFileSync(join(FIXTURES, "svatah.config.yaml"), "utf8").replace(
      /baseUrl: ".*"/,
      `baseUrl: "${app.origin}"`,
    ),
    "utf8",
  );
  return dir;
}

function cli(args: readonly string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [SVATAH, ...args], {
      cwd,
      env: {
        ...process.env,
        SVATAH_SAMPLE_PASSWORD: "qwerty123",
        SVATAH_SAMPLE_CARD_NUMBER: "5123456789012346",
        SVATAH_SAMPLE_CARD_CVV: "123",
      },
    });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

const lines = <T>(project: string, runId: string, file: string): T[] => {
  const text = readFileSync(join(project, "runs", runId, file), "utf8").trim();
  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line) as T);
};

const results = (project: string, runId: string): StepResult[] =>
  lines<StepResult>(project, runId, "results.jsonl");
const audit = (project: string, runId: string): AuditLine[] =>
  lines<AuditLine>(project, runId, "audit.jsonl");

beforeAll(async () => {
  if (!existsSync(SVATAH)) throw new Error("Run `pnpm -r build` first.");
  app = await startSampleApp(0);
}, 120_000);

afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("a guard that is false never acts (REQ-AUTO-1, T5.4)", () => {
  it("skips the step, and the audit has no surface call for it", async () => {
    const project = scaffold();
    const run = await cli(
      ["run", ".", "--host", "none", "--run-id", "g", "--story", "I want to see guards decide"],
      project,
    );
    expect(run.code, run.output).toBe(0);

    const steps = results(project, "g");
    const skipped = steps.filter((r) => r.status === "skipped");

    // Two guards are false: `Only if {status} is "Cancelled"` and
    // `Unless {status} is "Confirmed"`. Both name the cancel booking button.
    expect(skipped).toHaveLength(2);
    expect(skipped.every((r) => r.text.includes("cancel booking"))).toBe(true);
    // A clean guard skip carries no failure (LLD §8.3): the step was not
    // necessary, which is not the same as the step going wrong.
    expect(skipped.every((r) => r.failure === undefined)).toBe(true);

    /*
     * The independent record. Every surface call goes through a proxy that logs
     * it against the step that made it, so a click the guard was supposed to
     * prevent would appear here.
     */
    const surface = audit(project, "g").filter((line) => line.kind === "surface");
    const ids = new Set(skipped.map((r) => r.stepId));
    expect(surface.filter((line) => ids.has(line.stepId ?? ""))).toEqual([]);
    // And nothing anywhere in the run touched the element they name.
    expect(surface.filter((line) => JSON.stringify(line).includes("cancel"))).toEqual([]);
  }, 240_000);

  it("runs the step when the guard is true, on all three subjects", async () => {
    const project = scaffold();
    await cli(
      ["run", ".", "--host", "none", "--run-id", "g", "--story", "I want to see guards decide"],
      project,
    );

    const steps = results(project, "g");
    // `Only if the URL contains "/booking"` (page) and `Only if the Book now
    // button is visible` (target) are both true and both ran.
    const typed = steps.find((r) => r.text.includes("Indiranagar"));
    const clicked = steps.find((r) => r.text.includes("Book now"));
    expect(typed?.status).toBe("passed");
    expect(clicked?.status).toBe("passed");
    // And the story reached its expectation, so the guarded step really did act.
    expect(steps[steps.length - 1]?.status).toBe("passed");
  }, 240_000);

  it("refuses at compile time a guard about a different element", async () => {
    /*
     * The IR's guard has a subject and a predicate and no target of its own
     * (LLD §3.2), so a guard is a precondition on the step's own element. A
     * sentence naming a different one used to compile to a guard about the
     * step's element with the author's phrase thrown away — silently the wrong
     * question. It is a compile error naming both phrases (HLD principle 7).
     */
    const project = scaffold();
    writeFileSync(
      join(project, "flows", "bad-guard.flow"),
      `story: Guard about something else
  Only if the booking result is visible, Click the Book now button

test: Guard about something else
`,
      "utf8",
    );

    const compile = await cli(["compile", "."], project);
    expect(compile.code).toBe(2);
    expect(compile.output).toContain("E_GUARD_OTHER_TARGET");
    expect(compile.output).toContain("the booking result");
    expect(compile.output).toContain("the Book now button");
  }, 240_000);
});

describe("a failing story compensates and aborts (REQ-AUTO-4, T5.4)", () => {
  it("runs the compensating story and ends the run `aborted`", async () => {
    const project = scaffold();
    const run = await cli(
      [
        "run",
        ".",
        "--host",
        "none",
        "--run-id",
        "c",
        "--flow",
        FLOW,
        "--story",
        "I want to book and then fail",
      ],
      project,
    );

    // Exit 11 is `aborted` (LLD §15): distinct from 1, because a flow that
    // compensated is not simply a flow that failed.
    expect(run.code, run.output).toBe(11);

    const steps = results(project, "c");
    const failed = steps.find((r) => r.status === "failed");
    expect(failed?.text).toContain("pay button");
    expect(failed?.failure?.class).toBe("locator");
    // The policy is recorded *on* the failing step (LLD §8.3).
    expect(failed?.failure?.policyApplied).toEqual({ compensate: "cancel a booking" });

    const compensating = steps.filter((r) => r.story === "cancel a booking");
    expect(compensating.length).toBeGreaterThan(0);
    // Its steps ran, and are recorded as `aborted`: they happened, but as part
    // of an abort rather than as part of the flow's intent (REQ-RUN-7).
    expect(compensating.every((r) => r.status === "aborted")).toBe(true);

    const summary = JSON.parse(
      readFileSync(join(project, "runs", "c", "summary.json"), "utf8"),
    ) as Summary;
    expect(Object.values(summary.flows)[0]?.status).toBe("aborted");
    expect(summary.exitCode).toBe(11);
  }, 240_000);

  it("gives the compensating story the failing story's scope", async () => {
    /*
     * The whole point of running it with that scope (REQ-AUTO-4): a story that
     * cannot see what the failing one captured has nothing to cancel. The
     * compensating story's last step asserts against
     * `{I want to book and then fail.reference}`, so it passing at all is the
     * proof — and it is recorded as `aborted` because that is what the status of
     * a compensating step is.
     */
    const project = scaffold();
    await cli(
      ["run", ".", "--host", "none", "--run-id", "c", "--flow", FLOW, "--story", "I want to book and then fail"],
      project,
    );

    const steps = results(project, "c");
    const captured = steps.find((r) => r.captured?.["reference"] !== undefined);
    expect(captured?.captured?.["reference"]).toBe("BK-10428");

    const check = steps.find((r) => r.story === "cancel a booking" && r.text.includes("reference"));
    // `aborted` rather than `failed`: the expectation held.
    expect(check?.status).toBe("aborted");
    expect(check?.failure).toBeUndefined();
  }, 240_000);

  it("records the policy in the audit, not only in the results", async () => {
    const project = scaffold();
    await cli(
      ["run", ".", "--host", "none", "--run-id", "c", "--flow", FLOW, "--story", "I want to book and then fail"],
      project,
    );

    const policies = audit(project, "c").filter((line) => line.kind === "policy");
    expect(policies).toHaveLength(1);
    expect(policies[0]?.story).toBe("I want to book and then fail");
    expect((policies[0]?.detail as { policy: unknown }).policy).toEqual({
      compensate: "cancel a booking",
    });
  }, 240_000);

  it("attributes every surface call to the step that made it", async () => {
    /*
     * What makes the guard assertion above mean anything. The audit used to
     * label a step's calls with the *previous* step's id, because the position
     * was derived from the last result rather than set before the step — so a
     * guarded step appeared to have made the calls of the step after it.
     */
    const project = scaffold();
    await cli(
      ["run", ".", "--host", "none", "--run-id", "c", "--flow", FLOW, "--story", "I want to book and then fail"],
      project,
    );

    const surface = audit(project, "c").filter((line) => line.kind === "surface");
    const clicks = surface.filter(
      (line) => line.call?.method === "act" && line.call.action === "click",
    );
    // The compensating story's click is attributed to the compensating story.
    expect(clicks.some((line) => line.stepId?.startsWith("cancel a booking"))).toBe(true);
    // And nothing is attributed to a step that never ran.
    const known = new Set(results(project, "c").map((r) => r.stepId));
    expect(surface.every((line) => line.stepId === undefined || known.has(line.stepId))).toBe(true);
  }, 240_000);
});
