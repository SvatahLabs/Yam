/**
 * `Dismiss the dialog` dismisses it (T7.3, P6-F4, Draft 2.8 LLD §3.2).
 *
 * The defect this exists for is worth stating exactly, because it survived two
 * phases and a full green suite. The grammar has always compiled pattern 21 to
 * `args: { action: "accept" | "dismiss" }`. The Playwright and BiDi adapters
 * read `args.accept` — a key no step has ever carried — found `undefined`, and
 * took their default, which was `true`. So every dialog was accepted, `Dismiss
 * the dialog` left the sample page saying `confirmed`, and *a flow expecting
 * `confirmed` after a dismiss passed* (K7; Phase 6 verification, F4).
 *
 * Nothing caught it because nothing crossed the seam. The compiler's golden
 * entries stop at the IR; the surface conformance suite calls `act("dialog", …)`
 * with the adapter's own spelling and never sees the IR at all. This test is the
 * only shape that could have caught it: a flow file, through the compiler,
 * through the runtime, through the adapter, to a page that says out loud which
 * button was pressed.
 *
 * It runs both directions on purpose. A test that only dismissed would pass
 * against an adapter that dismissed everything.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import type { StepResult } from "@svatah/schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SVATAH = join(ROOT, "packages", "cli", "dist", "bin.js");

let app: SampleServer;
const projects: string[] = [];

/**
 * A binding, hand-written rather than recorded.
 *
 * JSON *is* YAML, and the store reads `.yaml`, so the file is written with
 * `JSON.stringify` and named `.yaml` — which keeps the fixture readable without
 * a YAML writer in a test.
 *
 * The two controls this needs are on `/widgets` and the fixture project has no
 * bindings for them. Recording a pair here would drag a gateway into a test
 * about a dialog; a `testid` candidate and a fingerprint nobody scores is
 * enough, because what is under test is what the *adapter* does once the
 * resolver has found the element.
 */
const binding = (id: string, phrase: string, testId: string, tag: string): string =>
  JSON.stringify(
    {
      schemaVersion: "1.0.0",
      id,
      phrases: [phrase],
      entries: [
        {
          candidates: [{ by: "testid", attribute: "data-testid", value: testId, score: 0.98 }],
          context: { hash: "0".repeat(64), pattern: "/widgets", platform: "web" },
          fingerprint: {
            tag,
            attrs: { "data-testid": testId },
            text: "",
            neighbours: { before: [], after: [] },
            rolePath: ["main"],
            box: [0, 0, 10, 10],
            index: 0,
          },
          provenance: {
            at: "2026-09-04T00:00:00.000Z",
            model: "human",
            promptVersion: "hand-written:T7.3",
            tokensIn: 0,
            tokensOut: 0,
          },
          recordedAt: "2026-09-04T00:00:00.000Z",
          verified: true,
        },
      ],
    },
    null,
    2,
  );

/** A project with one flow: answer the confirm one way, then the other. */
function scaffold(flow?: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "svatah-dialog-"));
  projects.push(dir);
  mkdirSync(join(dir, "flows"), { recursive: true });
  mkdirSync(join(dir, "bindings", "widgets"), { recursive: true });

  writeFileSync(
    join(dir, "svatah.config.yaml"),
    `schemaVersion: "1.0.0"\napp:\n  baseUrl: "${app.origin}"\n`,
    "utf8",
  );
  writeFileSync(
    join(dir, "bindings", "widgets", "show-confirm.yaml"),
    binding("widgets.show-confirm", "the show confirm button", "show-confirm", "button"),
    "utf8",
  );
  writeFileSync(
    join(dir, "bindings", "widgets", "confirm-result.yaml"),
    binding("widgets.confirm-result", "the confirm result", "dialog-result", "output"),
    "utf8",
  );
  writeFileSync(
    join(dir, "flows", "dialogs.flow"),
    (
      flow ?? [
        "story: Answer the dialog both ways",
        '  Go to "/widgets"',
        "  Dismiss the dialog",
        "  Click the show confirm button",
        '  The confirm result should say "dismissed"',
        "  Accept the dialog",
        "  Click the show confirm button",
        '  The confirm result should say "confirmed"',
        "",
        "test: Answer the dialog both ways",
        "",
      ]
    ).join("\n"),
    "utf8",
  );
  return dir;
}

interface AuditLine {
  kind: string;
  armed?: boolean;
  answer?: string;
  detail?: { type?: string; message?: string };
}

const audit = (project: string, runId: string): AuditLine[] => {
  const text = readFileSync(join(project, "runs", runId, "audit.jsonl"), "utf8").trim();
  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line) as AuditLine);
};

function cli(args: readonly string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [SVATAH, ...args], { cwd });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

const results = (project: string, runId: string): StepResult[] => {
  const text = readFileSync(join(project, "runs", runId, "results.jsonl"), "utf8").trim();
  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line) as StepResult);
};

beforeAll(async () => {
  if (!existsSync(SVATAH)) throw new Error("Run `pnpm -r build` first.");
  app = await startSampleApp(0);
}, 120_000);

afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("pattern 21 against /widgets, end to end (T7.3, LLD §3.2)", () => {
  it("dismisses what it is told to dismiss and accepts what it is told to accept", async () => {
    const dir = scaffold();
    const run = await cli(["run", "--host", "none", "--run-id", "dialogs"], dir);
    const steps = results(dir, "dialogs");

    /*
     * The two assertions are the page's own words. `#confirm-result` is set by
     * `confirm(...) ? "confirmed" : "dismissed"` in `apps/sample-web`, so the
     * page is the witness and nothing here can agree with the adapter by
     * accident.
     */
    const said = (text: string): StepResult | undefined =>
      steps.find((one) => one.text.includes(`should say "${text}"`));

    expect(said("dismissed")?.status, JSON.stringify(steps.map((s) => [s.text, s.status, s.failure?.message]), null, 2)).toBe("passed");
    expect(said("confirmed")?.status).toBe("passed");
    expect(steps.every((one) => one.status === "passed")).toBe(true);
    expect(run.code).toBe(0);
  }, 180_000);

  /**
   * T8.3's Validate item, in one test: "a flow with the click before the dialog
   * step lints with `W_DIALOG_UNARMED` and its run's audit shows the unarmed
   * default".
   *
   * The two halves belong together. The lint says the flow is wrong; the audit
   * says what the run actually did about it. Either alone leaves the other
   * unproven — Phase 6 fixed the adapter and Phase 7 fixed the order, and the
   * flow in the reference still quietly accepted every dialog (P7-F3).
   */
  it("lints the click-then-dialog order and records the default it took", async () => {
    const dir = scaffold([
      "story: Cancelling asks first",
      '  Go to "/widgets"',
      "  Click the show confirm button",
      "  Dismiss the dialog",
      "",
      "test: Cancelling asks first",
      "",
    ]);

    const linted = await cli(["lint", "--json"], dir);
    const diagnostics = (JSON.parse(linted.output) as { diagnostics: Array<{ code: string }> })
      .diagnostics;
    expect(diagnostics.map((one) => one.code)).toContain("W_DIALOG_UNARMED");
    expect(diagnostics.map((one) => one.code)).toContain("W_DIALOG_NEVER_OPENED");

    await cli(["run", "--host", "none", "--run-id", "unarmed"], dir);

    /*
     * The page is the witness again: `confirm()` was answered before the
     * `dialog` step was reached, and the audit line is the only record that the
     * answer was a default rather than a decision.
     */
    const dialogs = audit(dir, "unarmed").filter((one) => one.kind === "dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toMatchObject({ kind: "dialog", armed: false, answer: "accept" });
    expect(dialogs[0]!.detail?.message).toBe("Are you sure?");
  }, 180_000);

  it("records an armed answer as armed, so the line is an account and not an alarm", async () => {
    const dir = scaffold();
    await cli(["run", "--host", "none", "--run-id", "armed"], dir);
    const dialogs = audit(dir, "armed").filter((one) => one.kind === "dialog");
    expect(dialogs.map((one) => [one.armed, one.answer])).toEqual([
      [true, "dismiss"],
      [true, "accept"],
    ]);
  }, 180_000);

  it("refuses a dialog step with no action rather than accepting one", async () => {
    /*
     * §3.2: "an adapter that defaults a missing `action` to accept is a defect."
     * The grammar cannot emit such a step, so this asks the adapter directly —
     * which is the only way the rule can be tested, and the only way it can stop
     * being true by accident.
     */
    const { PlaywrightSurface } = await import("@svatah/adapter-playwright");
    const surface = new PlaywrightSurface({ browser: "chromium", headless: true });
    await surface.open({ baseUrl: app.origin });
    try {
      await surface.act("navigate", undefined, { url: `${app.origin}/widgets` });
      await expect(surface.act("dialog", undefined, {})).rejects.toThrow(
        /needs args\.action of "accept" or "dismiss"/,
      );
    } finally {
      await surface.close();
    }
  }, 120_000);
});
