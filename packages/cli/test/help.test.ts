/**
 * T14.3 — help: one screen, one command, one topic (REQ-CLI-2, 4, 7, 8, 9).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT } from "@svatah/yam-bindings-cli";
import { EXIT as RUNTIME_EXIT } from "@svatah/yam-runtime";
import { main } from "../src/index.js";
import { COMMANDS, EXIT_MEANINGS, NOUNS, TOP_LEVEL, TOPICS, exitCodesTopic, helpFor, topic, userFacingHelpText } from "../src/help.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    out: (text) => (out += `${text}\n`),
    err: (text) => (err += `${text}\n`),
  });
  return { code, out, err };
}

describe("the top-level help (REQ-CLI-2)", () => {
  it("is the design's text, verbatim", () => {
    const lld = readFileSync(join(ROOT, "docs", "spec", "lld.md"), "utf8");
    const block = /\*\*The top-level help\*\*[^\n]*\n\n```\n([\s\S]*?)```/.exec(lld);
    expect(block, "LLD §15.1 has the help block").toBeTruthy();
    expect(TOP_LEVEL.trimEnd()).toBe(block![1]!.trimEnd());
  });

  it("is one screen: the seven verbs in order, then how to go deeper", () => {
    const verbs = TOP_LEVEL.split("\n").filter((line) => /^ {2}yam [a-z]+ /.test(line)).map((line) => line.trim().split(/\s+/)[1]);
    expect(verbs.slice(0, 7)).toEqual(["init", "check", "record", "run", "heal", "ui", "serve"]);
    expect(TOP_LEVEL.split("\n").length).toBeLessThanOrEqual(16);
  });

  it("is what `yam help` prints, exit 0", async () => {
    const { code, out } = await cli("help");
    expect(code).toBe(EXIT.ok);
    expect(out.trimEnd()).toBe(TOP_LEVEL.trimEnd());
  });

  it("is what an unknown command prints, exit 64", async () => {
    const { code, err } = await cli("frobnicate");
    expect(code).toBe(EXIT.usage);
    expect(err).toContain('Unknown command "frobnicate"');
    expect(err).toContain("yam check");
  });
});

describe("per-command help (REQ-CLI-4)", () => {
  it.each(COMMANDS.map((one) => one.name))("`yam %s --help` prints that command and nothing else, exit 0", async (name) => {
    const { code, out } = await cli(...name.split(" "), "--help");
    expect(code).toBe(EXIT.ok);
    expect(out).toContain(`yam ${name}`);
    // No other command's options: a flag that only another command declares must not appear.
    const mine = new Set((COMMANDS.find((one) => one.name === name)?.options ?? []).map(([flag]) => flag.split(" ")[0]));
    for (const other of COMMANDS) {
      if (other.name === name || name.startsWith(`${other.name} `) || other.name.startsWith(`${name} `)) continue;
      for (const [flag] of other.options ?? []) {
        const bare = flag.split(" ")[0]!;
        if (mine.has(bare) || bare === "--json") continue;
        // Session options are referred to, not restated (REQ-CLI-7).
        if (["--base-url", "--storage-state", "--input", "--headed", "--out", "--run-id"].includes(bare)) continue;
        expect(out, `${name} --help mentions ${other.name}'s ${bare}`).not.toContain(`${bare} `);
      }
    }
    expect(out).toMatch(/Exit codes: /);
  });

  it("refers to the session options rather than restating them", () => {
    const run = helpFor(["run"])!;
    expect(run).toContain("see `yam help session`");
    expect(run).not.toContain("--base-url");
    expect(topic("session")).toContain("--base-url <url>");
    expect(topic("session")).toContain("YAM_INPUT_<NAME>");
  });

  it.each(NOUNS.map(([noun]) => noun))("`yam %s` alone lists its verbs", async (noun) => {
    const { code, err } = await cli(noun);
    expect(code).toBe(EXIT.usage);
    for (const one of COMMANDS.filter((c) => c.name.startsWith(`${noun} `))) expect(err).toContain(one.synopsis.split(" [")[0]);
  });
});

describe("help topics (REQ-CLI-8)", () => {
  it.each([...TOPICS])("`yam help %s` prints a page, exit 0", async (name) => {
    const { code, out } = await cli("help", name);
    expect(code).toBe(EXIT.ok);
    expect(out.length).toBeGreaterThan(200);
  });

  it("an unknown topic names the six", async () => {
    const { code, err } = await cli("help", "nonsense");
    expect(code).toBe(EXIT.usage);
    expect(err).toContain("exit-codes");
  });

  it("the exit-code table carries every code the executor and the commands can return", () => {
    const page = exitCodesTopic();
    for (const code of new Set([...Object.values(EXIT), ...Object.values(RUNTIME_EXIT)])) {
      expect(EXIT_MEANINGS.some(([c]) => c === code), `code ${code} has a meaning`).toBe(true);
      expect(page).toMatch(new RegExp(`^ +${code}  `, "m"));
    }
  });
});

describe("no internal vocabulary reaches a person (REQ-CLI-9)", () => {
  it("in the help, the topics, and init's output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-init-"));
    const init = await cli("init", dir);
    expect(init.code).toBe(EXIT.ok);
    expect(init.err).toContain("Initialised");
    expect(init.err).toContain("yam check");
    expect(init.err).toContain("yam record");
    const text = `${userFacingHelpText()}\n${init.err}`;
    for (const banned of [/module \(a\)/, /module \(b\)/, /LLD §/, /HLD §/, /REQ-[A-Z]+-\d/, /\bDraft \d/, /\bT\d+\.\d+\b/, /\bP\d+-F\d+\b/]) {
      expect(text, `contains ${banned}`).not.toMatch(banned);
    }
  });

  it("`yam init .` says this directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-init-dot-"));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const { err } = await cli("init");
      expect(err).toContain("Initialised this directory.");
    } finally {
      process.chdir(cwd);
    }
  });
});
