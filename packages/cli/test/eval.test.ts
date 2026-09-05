/**
 * `svatah eval <suite>` (T1.8, LLD §15).
 *
 * The healing suite itself drives a browser and is run by `pnpm eval:healing`;
 * its committed output is checked in `tools/repo-checks/test/reports.test.ts`.
 * What is here is the command's contract: which suites it answers for, and what
 * it says about the ones it does not.
 */
import { describe, expect, it } from "vitest";
import { EXIT, main, type CommandIo } from "../src/index.js";

function capture(): CommandIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (t) => stdout.push(t), err: (t) => stderr.push(t) };
}

describe("svatah eval", () => {
  it("needs a suite", async () => {
    const io = capture();
    expect(await main(["eval"], io)).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain("healing, grounding, compiler or conformance");
  });

  it("names the task that builds a suite that is not runnable yet", async () => {
    for (const [suite, task] of [
      ["grounding", "T3.4"],
      ["compiler", "T4.4"],
      ["conformance", "T1.2"],
    ] as const) {
      const io = capture();
      expect(await main(["eval", suite], io)).toBe(EXIT.usage);
      expect(io.stderr.join("\n")).toContain(task);
    }
  });

  it("rejects a suite that does not exist", async () => {
    const io = capture();
    expect(await main(["eval", "vibes"], io)).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain('Unknown eval suite "vibes"');
  });

  it("says where to start the sample application when it cannot reach it", async () => {
    const io = capture();
    // Port 1 is reserved and nothing listens there.
    expect(
      await main(["eval", "healing", "--base-url", "http://127.0.0.1:1"], io),
    ).toBe(EXIT.failed);
    const message = io.stderr.join("\n");
    expect(message).toContain("/api/variants");
    expect(message).toContain("pnpm --filter sample-web start");
  });
});
