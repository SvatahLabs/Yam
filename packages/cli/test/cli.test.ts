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
    expect(io.stdout.join("\n")).toContain("yam surface conform");
  });

  it("prints usage and exits 0 for `help`", async () => {
    const io = capture();
    expect(await main(["help"], io)).toBe(EXIT.ok);
  });

  it("names the subcommand a built command wants, rather than a task", async () => {
    /*
     * `workflow` and `tool` were the last two entries in the "not built yet"
     * table, and Phase 5 built them (T5.2, T5.3), so the table is empty. What
     * `yam workflow` with no subcommand says now is what it takes — which is
     * the same rule as before applied to a command that exists: "not yet" and
     * "never" and "you left something out" are three different answers.
     */
    const io = capture();
    expect(await main(["workflow"], io)).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain("workflow run <story>");

    const tool = capture();
    expect(await main(["tool"], tool)).toBe(EXIT.usage);
    expect(tool.stderr.join("\n")).toContain("tool serve");
  });

  it("no longer promises later a command that is here now", async () => {
    // The stale half of the same rule: `repl` and `mcp` arrived in Phase 4,
    // `workflow` and `tool` in Phase 5, and a command line that still promised
    // any of them later would be lying.
    const io = capture();
    await main(["help"], io);
    for (const command of ["yam repl", "yam workflow run", "yam tool serve"]) {
      expect(io.stdout.join("\n")).toContain(command);
    }
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
    // `atspi` is HLD §12's Linux adapter, which is P3 and unscheduled; a command
    // line that just said "unknown" would leave the reader guessing whether they
    // had a typo or a missing phase.
    const io = capture();
    expect(await main(["surface", "conform", "--adapter", "atspi"], io)).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain("playwright");
  });

  it("registers every adapter this build ships, under `yam` (T4.1, T6.1, T6.2, LLD §1)", async () => {
    /*
     * `surface conform` and `bindings verify` are module (a) commands mounted
     * under `yam`, and module (a)'s own registration knows only Playwright —
     * it is what a plain Playwright user installs. Registering the rest from
     * `@svatah/yam` is what makes `--adapter bidi` reachable here while
     * `yam-bindings` stays module (a).
     */
    const io = capture();
    await main(["surface", "conform", "--adapter", "atspi"], io);
    const { listAdapters } = await import("@svatah/yam-surface");
    /*
     * The HTTP adapter is here too, since T12.7.
     *
     * It is still reached through the executor's injected API runner for an
     * `api` step (LLD §8), and that has not changed. What changed is that a
     * *project* may name it: `evals/self/http` is `adapter: http`, and a flow
     * whose every step is `Call the "…" API` or `Wait for the "…" API to answer
     * …` opens a session on it. `createSurface` has taken `http` since LLD §2.4
     * was written; nothing registered one, so `adapter: http` answered "No
     * adapter registered under \"http\"" — which reads like a missing install.
     */
    expect(listAdapters().sort()).toEqual(["appium", "ax", "bidi", "http", "playwright", "uia"]);
  });

  it("fails a desktop adapter on the wrong host with the host's reason, not `no such adapter`", async () => {
    /*
     * The desktop adapters are registered on every platform, not only on their
     * own (T6.1, T6.2). The difference matters: "no such adapter" sends someone
     * looking for a missing install, and the truth is that this machine cannot
     * host it. Which of the two applies here depends on where the tests run, so
     * both are checked by their message rather than by the platform.
     */
    const io = capture();
    const wrongHost = process.platform === "darwin" ? "uia" : "ax";
    expect(await main(["surface", "conform", "--adapter", wrongHost], io)).toBe(EXIT.failed);
    const said = [...io.stdout, ...io.stderr].join("\n");
    expect(said).not.toContain("No adapter registered");
    expect(said).toMatch(/runs on (Windows|macOS) only/);
  }, 120_000);
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
