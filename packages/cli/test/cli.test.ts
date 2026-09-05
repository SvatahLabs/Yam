/**
 * The CLI's contract (LLD §15): the commands it answers, and the exit codes it
 * answers with. CI decides what happened from an exit code, so each one is
 * asserted rather than assumed.
 *
 * `main` takes its argv and its streams, so the whole CLI is testable without
 * spawning a process.
 */
import { describe, expect, it } from "vitest";
import { boolOption, EXIT, main, parseArgs, stringOption, type CommandIo } from "../src/index.js";

function capture(): CommandIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (t) => stdout.push(t), err: (t) => stderr.push(t) };
}

describe("argument parsing", () => {
  it("separates the command words from the options", () => {
    const args = parseArgs(["surface", "conform", "--adapter", "playwright", "--json"]);
    expect(args.command).toEqual(["surface", "conform"]);
    expect(args.options).toEqual({ adapter: "playwright", json: true });
  });

  it("accepts --name=value", () => {
    expect(parseArgs(["--base-url=http://x"]).options).toEqual({ "base-url": "http://x" });
  });

  it("reads string and boolean options", () => {
    const args = parseArgs(["--adapter", "playwright", "--headed", "--json", "false"]);
    expect(stringOption(args, "adapter")).toBe("playwright");
    expect(stringOption(args, "headed")).toBeUndefined();
    expect(boolOption(args, "headed")).toBe(true);
    expect(boolOption(args, "json")).toBe(false);
    expect(boolOption(args, "absent")).toBe(false);
    expect(boolOption(args, "absent", true)).toBe(true);
  });
});

describe("the command table (LLD §15)", () => {
  it("prints usage and exits 64 when given nothing", async () => {
    const io = capture();
    expect(await main([], io)).toBe(EXIT.usage);
    expect(io.stdout.join("\n")).toContain("svatah surface conform");
  });

  it("prints usage and exits 0 for `help`", async () => {
    const io = capture();
    expect(await main(["help"], io)).toBe(EXIT.ok);
  });

  it("says which task builds a command that is not here yet", async () => {
    const io = capture();
    expect(await main(["repl"], io)).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain("T4.5");
    expect(io.stderr.join("\n")).toContain("docs/spec/tasks.md");
  });

  it("rejects an unknown command with the usage", async () => {
    const io = capture();
    expect(await main(["frobnicate"], io)).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain('Unknown command "frobnicate"');
  });

  it("rejects `surface` without a subcommand", async () => {
    const io = capture();
    expect(await main(["surface"], io)).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain("surface conform");
  });

  it("rejects `surface conform` without --adapter", async () => {
    const io = capture();
    expect(await main(["surface", "conform"], io)).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain("--adapter");
  });

  it("names what is registered when the adapter is not", async () => {
    const io = capture();
    expect(await main(["surface", "conform", "--adapter", "bidi"], io)).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain("playwright");
  });
});

describe("exit codes", () => {
  it("are the table in LLD §15", () => {
    expect(EXIT).toEqual({
      ok: 0,
      failed: 1,
      compileErrors: 2,
      modelUnavailable: 3,
      groundingFailed: 4,
      expectationFailed: 5,
      healed: 6,
      someUnrepaired: 7,
      unmapped: 8,
      refused: 10,
      aborted: 11,
      hashMismatch: 12,
      usage: 64,
    });
  });
});
