/**
 * `yam workflow run <story>` (T5.2, REQ-BEH-2, REQ-AUTO-5, 7, LLD §13.2, §15).
 *
 * T5.2's Validate list:
 *
 * 1. **A story with a signature runs as a function and returns typed outputs.**
 *    Against the sample application, through the installed command line, with the
 *    outputs on stdout as JSON so the command composes.
 * 2. **A non-idempotent story is refused in a `production` config without the
 *    override.** Exit 10, nothing run, and a message that says both ways out.
 *
 * Plus the two things that make a workflow different from a test and would be
 * easy to lose: checkpoints and audit are on whatever the project's config says
 * (LLD §13.2), and a secret an output happens to carry does not reach
 * `summary.json`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import type { AuditLine, Summary } from "@svatah/yam-schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const YAM = join(ROOT, "packages", "cli", "dist", "bin.js");

const CARD = "5123456789012346";

let app: SampleServer;
const projects: string[] = [];

function scaffold(environment: "test" | "production" = "test"): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-workflow-"));
  projects.push(dir);
  for (const entry of ["bindings", "flows", "api", "data.yaml", "yam.config.yaml"]) {
    cpSync(join(FIXTURES, entry), join(dir, entry), { recursive: true });
  }
  writeFileSync(
    join(dir, "yam.config.yaml"),
    readFileSync(join(dir, "yam.config.yaml"), "utf8")
      .replace("environment: test", `environment: ${environment}`)
      .replace(/^ {2}baseUrl: .*$/m, `  baseUrl: "${app.origin}"`),
    "utf8",
  );
  return dir;
}

function cli(args: readonly string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((done) => {
    let out = "";
    let err = "";
    const child = spawn(process.execPath, [YAM, ...args], {
      cwd,
      env: {
        ...process.env,
        YAM_BASE_URL: app.origin,
        YAM_SAMPLE_PASSWORD: "qwerty123",
        YAM_SAMPLE_CARD_NUMBER: CARD,
        YAM_SAMPLE_CARD_CVV: "123",
      },
    });
    child.stdout.on("data", (chunk) => (out += String(chunk)));
    child.stderr.on("data", (chunk) => (err += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, out, err }));
  });
}

beforeAll(async () => {
  if (!existsSync(YAM)) throw new Error("Run `pnpm -r build` first.");
  app = await startSampleApp(0);
}, 120_000);

afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("a story with a signature runs as a function (REQ-BEH-2, REQ-AUTO-5)", () => {
  it("returns its declared outputs as JSON on stdout", async () => {
    const project = scaffold();
    const result = await cli(
      ["workflow", "run", "Book a slot", ".", "--input", "location=Indiranagar", "--run-id", "w1"],
      project,
    );

    expect(result.code, result.err).toBe(0);
    // stdout is *only* the outputs, so the command composes with `jq`.
    expect(JSON.parse(result.out)).toEqual({ booking: "Slot booked.", place: "Indiranagar" });
    expect(result.out.trim().startsWith("{")).toBe(true);
  }, 240_000);

  it("uses an input's default when it is not supplied", async () => {
    // `date: string = "2026-09-03"`. A signature with a default is a function
    // with an optional argument, and leaving it out has to work.
    const project = scaffold();
    const result = await cli(
      ["workflow", "run", "Book a slot", ".", "--input", "location=Koramangala", "--run-id", "w2"],
      project,
    );
    expect(result.code, result.err).toBe(0);
    expect(JSON.parse(result.out).place).toBe("Koramangala");
  }, 240_000);

  it("refuses to start without an input that has no default", async () => {
    const project = scaffold();
    const result = await cli(["workflow", "run", "Book a slot", ".", "--run-id", "w3"], project);
    expect(result.code).not.toBe(0);
    // Which input, on stderr, where the person running it is looking.
    expect(result.err).toContain('needs an input "location"');
  }, 240_000);

  it("names the stories that exist when asked for one that does not", async () => {
    const project = scaffold();
    const result = await cli(["workflow", "run", "Book a table", "."], project);
    expect(result.code).toBe(64);
    expect(result.err).toContain("Book a slot");
  }, 240_000);

  it("records the run as `workflow`, with checkpoints and audit on", async () => {
    /*
     * The fixture project sets `checkpoints: false`, and a workflow turns it on
     * regardless (LLD §13.2): a test that is not checkpointed can be re-run from
     * the start, and a workflow that got halfway through cannot.
     */
    const project = scaffold();
    expect(readFileSync(join(project, "yam.config.yaml"), "utf8")).toContain(
      "checkpoints: false",
    );

    await cli(
      ["workflow", "run", "Book a slot", ".", "--input", "location=Indiranagar", "--run-id", "w4"],
      project,
    );

    const summary = JSON.parse(
      readFileSync(join(project, "runs", "w4", "summary.json"), "utf8"),
    ) as Summary;
    expect(summary.behavior).toBe("workflow");
    expect(summary.outputs).toEqual({ "Book a slot.booking": "Slot booked.", "Book a slot.place": "Indiranagar" });

    expect(readdirSync(join(project, "runs", "w4", "checkpoints")).length).toBeGreaterThan(0);
    expect(existsSync(join(project, "runs", "w4", "audit.jsonl"))).toBe(true);
  }, 240_000);

  it("resumes, like any other run (REQ-AUTO-3)", async () => {
    const project = scaffold();
    await cli(
      ["workflow", "run", "Book a slot", ".", "--input", "location=Indiranagar", "--run-id", "w5"],
      project,
    );

    const results = readFileSync(join(project, "runs", "w5", "results.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { stepId: string });

    const resumed = await cli(
      [
        "workflow",
        "run",
        "Book a slot",
        ".",
        "--input",
        "location=Indiranagar",
        "--resume",
        "w5",
        "--from",
        results[results.length - 1]!.stepId,
        "--run-id",
        "w6",
      ],
      project,
    );
    expect(resumed.code, resumed.err).toBe(0);

    /*
     * The *whole* signature comes back, not just what the resumed part
     * captured: `booking` was captured before the interruption and came back
     * with the checkpoint's scope. That is what makes a resumed workflow usable
     * as a function rather than as a fragment.
     *
     * `place` is re-read by the step that resumes, and it is empty — the
     * location field was typed into before the interruption, and restoring a web
     * session is "URL and storage state" (LLD §8.1), which does not restore an
     * unsubmitted form. That is a real property of resume rather than a defect
     * here, and asserting it is how it stays visible.
     */
    const outputs = JSON.parse(resumed.out) as Record<string, string>;
    expect(outputs["booking"]).toBe("Slot booked.");
    expect(outputs).toHaveProperty("place");
    expect(outputs["place"]).toBe("");
  }, 240_000);
});

describe("the environment policy (REQ-AUTO-7, LLD §15 exit 10)", () => {
  it("refuses a non-idempotent story in production", async () => {
    const project = scaffold("production");
    const result = await cli(
      ["workflow", "run", "Pay for a slot", ".", "--input", `card=${CARD}`, "--run-id", "p1"],
      project,
    );

    expect(result.code).toBe(10);
    expect(result.err).toContain("idempotent");
    expect(result.err).toContain("--allow-side-effects");
    // Nothing ran: a refusal is not a failed run.
    expect(existsSync(join(project, "runs", "p1", "results.jsonl"))).toBe(false);
  }, 240_000);

  it("runs an idempotent story in production without ceremony", async () => {
    const project = scaffold("production");
    const result = await cli(
      ["workflow", "run", "Book a slot", ".", "--input", "location=Indiranagar", "--run-id", "p2"],
      project,
    );
    expect(result.code, result.err).toBe(0);
  }, 240_000);

  it("runs a non-idempotent story when the caller says they meant it", async () => {
    const project = scaffold("production");
    const result = await cli(
      [
        "workflow",
        "run",
        "Pay for a slot",
        ".",
        "--input",
        `card=${CARD}`,
        "--allow-side-effects",
        "--run-id",
        "p3",
      ],
      project,
    );
    expect(result.code, result.err).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ paid: CARD });
  }, 240_000);
});

describe("a secret an output carries stays out of the run directory (REQ-NFR-6)", () => {
  it("returns it to the caller and redacts it in summary.json and the audit", async () => {
    /*
     * `Pay for a slot` declares `card: secret` and reads it back off the form as
     * an output. The caller supplied the card number and may have it back on
     * stdout; `runs/<id>/summary.json` is a file people attach to bug reports
     * and may not.
     */
    const project = scaffold();
    const result = await cli(
      [
        "workflow",
        "run",
        "Pay for a slot",
        ".",
        "--input",
        `card=${CARD}`,
        "--run-id",
        "s1",
      ],
      project,
    );
    expect(result.code, result.err).toBe(0);
    expect(JSON.parse(result.out).paid).toBe(CARD);

    const dir = join(project, "runs", "s1");
    expect(readFileSync(join(dir, "summary.json"), "utf8")).not.toContain(CARD);
    expect(readFileSync(join(dir, "results.jsonl"), "utf8")).not.toContain(CARD);
    expect(readFileSync(join(dir, "audit.jsonl"), "utf8")).not.toContain(CARD);

    // The audit still records that an input was given, by name (REQ-AUTO-6).
    const audit = readFileSync(join(dir, "audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as AuditLine);
    expect(audit.some((line) => line.kind === "run")).toBe(true);
  }, 240_000);
});
