/**
 * T6.3's Validate, against the real sample page and the real command line
 * (REQ-ADP-9, LLD §6.3, §4.2 pattern 30).
 *
 * > On the WebMCP sample page, replay uses the declared tool; removing the
 * > declaration falls through to locators.
 *
 * Both halves are driven on **the same page**. `apps/sample-web`'s
 * `/site-tools` registers two `navigator.modelContext` tools over a form that
 * works perfectly well without them, and `?webmcp=off` takes the declaration
 * away and changes nothing else. So "falls through to the locators" is a claim
 * about one binding resolving two ways, which is what LLD §6.3 promises — not
 * about two different documents.
 *
 * The audit is the independent record throughout: a `locate` call names the
 * candidate it tried, so "the tool was preferred" and "the locators were used"
 * are things the run wrote down rather than things this test inferred.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { startSampleApp, type SampleServer } from "sample-web";
import { EXIT } from "@svatah/bindings-cli";
import type { AuditLine, BindingFile, StepResult } from "@svatah/schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SVATAH = join(ROOT, "packages", "cli", "dist", "bin.js");

let app: SampleServer;
const projects: string[] = [];

/**
 * Two sentences, and neither mentions WebMCP.
 *
 * That is deliberate: a flow author writes what they want done, and whether the
 * site publishes a tool for it is the site's business and the recorder's. The
 * `Use the "…" site tool` form (pattern 30) exists for naming a tool that has
 * no control, and is exercised separately below.
 */
const FLOW = `story: Book through the site
  Type "Indiranagar" into the tool location field
  Click the Book the slot button
  The site tools result should say "Booked Indiranagar on 2026-09-03."

test: Book through the site
`;

function scaffold(query = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "svatah-webmcp-"));
  projects.push(dir);
  mkdirSync(join(dir, "flows"), { recursive: true });
  mkdirSync(join(dir, "bindings"), { recursive: true });
  mkdirSync(join(dir, "api"), { recursive: true });
  writeFileSync(join(dir, "flows", "site-tools.flow"), FLOW, "utf8");
  writeFileSync(join(dir, "data.yaml"), "{}\n", "utf8");
  writeFileSync(
    join(dir, "svatah.config.yaml"),
    `schemaVersion: "1.0.0"
project: "webmcp"
environment: test
adapter: playwright
app: { baseUrl: "${app.origin}/site-tools${query}" }
flows: { dir: flows }
steps: { dir: steps }
bindings: { dir: bindings, testIdAttributes: ["data-testid"] }
data: { file: data.yaml }
api: { dir: api }
run:
  workers: 1
  headless: true
  stepTimeoutMs: 10000
  candidateTimeoutMs: 2000
  screenshots: never
  trace: false
  outputDir: runs
  checkpoints: false
  audit: true
compile: { confidenceThreshold: 0.8 }
record: { model: "none", maxSnapshotTokens: 4000, visionFallback: false }
heal: { onFail: false, relocalizeThreshold: 0.72, margin: 0.1, useModel: false }
`,
    "utf8",
  );
  return dir;
}

function cli(args: readonly string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [SVATAH, ...args], { cwd });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

const binding = (project: string, id: string): BindingFile =>
  parseYaml(
    readFileSync(join(project, "bindings", `${id.split(".").join("/")}.yaml`), "utf8"),
  ) as BindingFile;

const lines = <T>(project: string, runId: string, file: string): T[] => {
  const text = readFileSync(join(project, "runs", runId, file), "utf8").trim();
  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line) as T);
};

beforeAll(async () => {
  if (!existsSync(SVATAH)) throw new Error("Run `pnpm -r build` first.");
  app = await startSampleApp(0);
}, 120_000);

afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("a declared site tool is preferred, and falls through when it goes (T6.3)", () => {
  it("records the tool in front of the locators it also found", async () => {
    /*
     * The shape the whole feature turns on. Grounding runs as it always does
     * and produces locators; the declared tool is prepended, so the binding can
     * resolve two ways from one recording.
     */
    const project = scaffold();
    const record = await cli(["record", ".", "--gateway", "fake", "--rebind"], project);
    expect(record.code, record.output).toBe(EXIT.ok);

    const button = binding(project, "book-the-slot-button");
    const candidates = button.entries.at(-1)!.candidates;
    expect(candidates[0]!.by).toBe("webmcp");
    expect(candidates[0]!.tool).toBe("book-the-slot");
    /*
     * And there is a real bundle behind it, or there is nothing to fall through
     * to. This is the assertion the first implementation failed: it took the
     * tool-only path for an ordinary sentence and wrote a binding with one
     * candidate, which resolved perfectly until the declaration went away.
     */
    expect(candidates.filter((one) => one.by !== "webmcp").length).toBeGreaterThan(2);
    expect(candidates.some((one) => one.by === "testid")).toBe(true);
    expect(record.output).toContain("site tool");
  }, 300_000);

  it("uses the declared tool at replay", async () => {
    const project = scaffold();
    expect((await cli(["record", ".", "--gateway", "fake", "--rebind"], project)).code).toBe(
      EXIT.ok,
    );

    const run = await cli(["run", ".", "--host", "none", "--run-id", "on"], project);
    expect(run.code, run.output).toBe(EXIT.ok);

    const results = lines<StepResult>(project, "on", "results.jsonl");
    const click = results.find((one) => one.text.includes("Book the slot"))!;
    expect(click.status).toBe("passed");
    // The run wrote down which candidate matched, and it is the tool.
    expect(click.matched?.by).toBe("webmcp");
    expect(click.matched?.candidateIndex).toBe(0);

    /*
     * The independent record. The step still makes an `act` call — the surface
     * recognises the tool reference and calls the tool rather than clicking an
     * element — so what the audit shows is that the call was made against the
     * reference the *tool* resolved to, and the expectation after it passed,
     * which is the page having been changed by the tool.
     */
    const audit = lines<AuditLine>(project, "on", "audit.jsonl");
    const acted = audit.filter(
      (one) => one.call?.method === "act" && one.stepId === click.stepId,
    );
    expect(acted).toHaveLength(1);
    expect(acted[0]!.call?.ref).toBe(click.matched?.ref);
    // A tool reference, not an element one: `wN` is minted only by `locate` of
    // a `webmcp` candidate.
    expect(click.matched?.ref).toMatch(/^w\d+$/);
    expect(results.at(-1)!.status).toBe("passed");
  }, 300_000);

  it("falls through to the locators when the declaration is gone", async () => {
    /*
     * The same binding, recorded with the declaration present, run against the
     * same page with `?webmcp=off`. Nothing is re-recorded and nothing is
     * edited: the store still says "prefer the tool", the page no longer offers
     * it, and the locators behind it are used instead (LLD §6.3).
     */
    const project = scaffold();
    expect((await cli(["record", ".", "--gateway", "fake", "--rebind"], project)).code).toBe(
      EXIT.ok,
    );
    const recorded = binding(project, "book-the-slot-button").entries.at(-1)!.candidates;
    expect(recorded[0]!.by).toBe("webmcp");

    const run = await cli(
      [
        "run",
        ".",
        "--host",
        "none",
        "--run-id",
        "off",
        "--base-url",
        `${app.origin}/site-tools?webmcp=off`,
      ],
      project,
    );
    expect(run.code, run.output).toBe(EXIT.ok);

    const results = lines<StepResult>(project, "off", "results.jsonl");
    const click = results.find((one) => one.text.includes("Book the slot"))!;
    expect(click.status).toBe("passed");
    // Not the tool, and not index 0: a locator, from the same binding.
    expect(click.matched?.by).not.toBe("webmcp");
    expect(click.matched?.candidateIndex).toBeGreaterThan(0);

    // And the store was not touched, which is what "falls through" means.
    expect(binding(project, "book-the-slot-button").entries.at(-1)!.candidates).toEqual(recorded);
  }, 300_000);

  it("drives a tool that has no control at all, through pattern 30", async () => {
    /*
     * `Use the "cancel-the-booking" site tool` names a tool outright. There is
     * no element to ground and no locator to record behind it — so this binding
     * cannot fall through, which is correct: the sentence asked for the tool.
     */
    const project = scaffold();
    writeFileSync(
      join(project, "flows", "site-tools.flow"),
      `story: Cancel through the site
  Use the "cancel-the-booking" site tool
  The site tools result should say "No booking."

test: Cancel through the site
`,
      "utf8",
    );

    const record = await cli(["record", ".", "--gateway", "fake", "--rebind"], project);
    expect(record.code, record.output).toBe(EXIT.ok);

    const written = binding(project, "cancel-the-booking-site-tool");
    const entry = written.entries.at(-1)!;
    expect(entry.candidates).toHaveLength(1);
    expect(entry.candidates[0]).toMatchObject({ by: "webmcp", tool: "cancel-the-booking" });
    /*
     * And no model was asked. The record report says `declared` rather than
     * `grounded`, with zero tokens — a report that claimed a grounding would be
     * claiming a decision that never happened (REQ-REC-8).
     */
    const report = JSON.parse(readFileSync(join(project, "record-report.json"), "utf8")) as {
      steps: Array<{
        decision?: {
          outcome: string;
          provenance?: { model: string; tokensIn: number; tokensOut: number };
        };
      }>;
      totals: Record<string, number>;
    };
    const decided = report.steps.find((one) => one.decision?.outcome === "declared")!;
    expect(decided, JSON.stringify(report.steps)).toBeDefined();
    expect(decided.decision!.provenance?.model).toBe("webmcp:declaration");
    /*
     * The other step's target — the result element — *was* grounded, so this
     * run made one model call. What matters is that the tool's did not, which
     * `outcome: "declared"` and a zero-token provenance say.
     */
    expect(decided.decision!.provenance?.tokensIn).toBe(0);
    expect(decided.decision!.provenance?.tokensOut).toBe(0);

    const run = await cli(["run", ".", "--host", "none", "--run-id", "p30"], project);
    expect(run.code, run.output).toBe(EXIT.ok);
    const results = lines<StepResult>(project, "p30", "results.jsonl");
    expect(results[0]!.status).toBe("passed");
    expect(results[0]!.matched?.by).toBe("webmcp");
  }, 300_000);
});
