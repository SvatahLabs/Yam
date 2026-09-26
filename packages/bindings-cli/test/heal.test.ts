/**
 * `yam heal` (T1.7, LLD §15).
 *
 * The end-to-end repair — failure, heal, `git apply`, re-run — needs a browser
 * and is in `packages/playwright-test/test/heal-job.spec.ts`. What is here is the
 * command's own contract: what it accepts, what it writes, and what it exits
 * with, none of which needs a browser.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT, main, type CommandIo } from "../src/index.js";

function capture(): CommandIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (t) => stdout.push(t), err: (t) => stderr.push(t) };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "yam-heal-cli-"));
  mkdirSync(join(dir, ".yam"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("yam heal", () => {
  it("needs a source of failures", async () => {
    const io = capture();
    expect(await main(["heal"], io)).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain("--run <id> or --from-bind-failures");
  });

  it("says there is nothing to repair when there are no failures", async () => {
    const io = capture();
    expect(await main(["heal", "--from-bind-failures", "--out", join(dir, ".yam")], io)).toBe(
      EXIT.ok,
    );
    expect(io.stdout.join("\n")).toContain("Nothing to repair");
  });

  it("reads the bind-failure lines a run wrote", async () => {
    writeFileSync(
      join(dir, ".yam", "bind-failures.jsonl"),
      [
        JSON.stringify({
          id: "login.username-field",
          phrase: "the username field",
          at: "2026-09-02T10:00:00.000Z",
          contextDrift: false,
          state: { kind: "web", url: "http://127.0.0.1:4173/login" },
          tried: [{ by: "xpath", matched: 0, durationMs: 4 }],
        }),
        // The same element again, later: only the most recent line matters, since
        // an older one describes a page that has moved on.
        JSON.stringify({
          id: "login.username-field",
          at: "2026-09-02T11:00:00.000Z",
          contextDrift: true,
          state: { kind: "web", url: "http://127.0.0.1:4173/login?variant=3" },
          tried: [{ by: "xpath", matched: 0, durationMs: 4 }],
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const { readBindFailures } = await import("@svatah/yam-healer");
    const inputs = readBindFailures(join(dir, ".yam"));
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.url).toContain("variant=3");
    expect(inputs[0]!.contextDrift).toBe(true);
  });

  it("refuses an adapter that is not registered", async () => {
    writeFileSync(
      join(dir, ".yam", "bind-failures.jsonl"),
      JSON.stringify({ id: "a.b", at: "x", contextDrift: false, tried: [] }) + "\n",
      "utf8",
    );
    const io = capture();
    expect(
      await main(
        ["heal", "--from-bind-failures", "--out", join(dir, ".yam"), "--adapter", "uia"],
        io,
      ),
    ).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain("playwright");
  });

  it("reports a bind-failures file it cannot read", async () => {
    writeFileSync(join(dir, ".yam", "bind-failures.jsonl"), "{ not json\n", "utf8");
    const io = capture();
    expect(await main(["heal", "--from-bind-failures", "--out", join(dir, ".yam")], io)).toBe(
      EXIT.failed,
    );
    expect(io.stderr.join("\n")).toContain("not valid JSON");
  });

  it("finds nothing in a run directory that has no results", async () => {
    const io = capture();
    expect(await main(["heal", "--run", "01ABC", "--runs", join(dir, "runs")], io)).toBe(EXIT.ok);
    expect(io.stdout.join("\n")).toContain("Nothing to repair");
  });

  /*
   * `--json` is one JSON document on stdout, whatever the answer.
   *
   * "Nothing to repair" was written to stdout as a sentence, so the one run
   * with nothing to heal answered a JSON caller with `"No locator"… is not
   * valid JSON` — which is how a Windows nightly reported a fixture problem as
   * a parse error. The empty answer is a report like any other, with the
   * sentence on stderr where progress goes.
   */
  it("answers --json with an empty report, not a sentence, when there is nothing to repair", async () => {
    const io = capture();
    expect(await main(["heal", "--run", "01ABC", "--runs", join(dir, "runs"), "--json"], io)).toBe(EXIT.ok);
    const report = JSON.parse(io.stdout.join("\n")) as {
      inputs: number;
      results: unknown[];
      totals: { repaired: number; regrounded: number; unrepaired: number };
      applied: boolean;
    };
    expect(report).toMatchObject({
      inputs: 0,
      results: [],
      totals: { repaired: 0, regrounded: 0, unrepaired: 0 },
      applied: false,
    });
    expect(io.stderr.join("\n")).toContain("Nothing to repair");
  });

  it("selects only the locator failures out of a run's results", async () => {
    const runDir = join(dir, "runs", "01ABC");
    mkdirSync(runDir, { recursive: true });
    const line = (over: Record<string, unknown>) =>
      JSON.stringify({
        runId: "01ABC",
        behavior: "test",
        flow: "login.flow",
        story: "Validate login",
        stepId: "Validate login/1",
        line: 3,
        text: "Click the sign in button",
        status: "failed",
        startedAt: "2026-09-02T10:00:00.000Z",
        endedAt: "2026-09-02T10:00:01.000Z",
        durationMs: 1000,
        ...over,
      });

    writeFileSync(
      join(runDir, "results.jsonl"),
      [
        line({ status: "passed" }),
        line({
          failure: { class: "timeout", message: "Timeout 10000ms exceeded" },
        }),
        line({
          failure: {
            class: "locator",
            message: 'Could not resolve "login.sign-in-button" (the sign in button): 2 candidates tried',
            candidatesTried: [{ by: "testid", score: 0.9 }],
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const { readRunFailures } = await import("@svatah/yam-healer");
    const inputs = readRunFailures(runDir);
    // A timeout is not something relocalization can repair, and a passing step is
    // not a failure: only the `locator` failure is selected (REQ-HEAL-1).
    expect(inputs.map((i) => i.id)).toEqual(["login.sign-in-button"]);
    expect(inputs[0]!.source).toBe("run");
    expect(inputs[0]!.story).toBe("Validate login");
    expect(inputs[0]!.tried).toEqual(["testid"]);
  });

  it("writes the diff and the report where a reviewer will find them", async () => {
    // No repairs are possible without a browser, but the two files are written
    // either way — an empty diff and a report saying nothing was repaired is a
    // useful answer, and a missing file is not.
    const io = capture();
    writeFileSync(
      join(dir, ".yam", "bind-failures.jsonl"),
      JSON.stringify({
        id: "login.username-field",
        at: "2026-09-02T10:00:00.000Z",
        contextDrift: false,
        tried: [],
      }) + "\n",
      "utf8",
    );

    const code = await main(
      [
        "heal",
        "--from-bind-failures",
        "--out",
        join(dir, ".yam"),
        "--dir",
        join(dir, "bindings"),
      ],
      io,
    );

    expect(code).toBe(EXIT.someUnrepaired);
    expect(existsSync(join(dir, ".yam", "heal", "bindings.diff"))).toBe(true);
    expect(existsSync(join(dir, ".yam", "heal", "report.md"))).toBe(true);
    expect(io.stdout.join("\n")).toContain("no-binding");
    expect(io.stdout.join("\n")).toContain("0 repaired");
  });
});
