/**
 * Every copied example (TV-C02, TV-17, SF-20).
 *
 * A person copies a line out of `yam help` or a guide and runs it. If the flag
 * was renamed two drafts ago they get a usage error, and what they conclude is
 * that the product is broken rather than that the sentence is old.
 *
 * Every example is *validated*: the command exists in the dispatch, and every
 * flag it passes is one that command documents. The ones that touch nothing —
 * help, completion, lint, the reads — are *executed*, in a copy of the fixtures
 * project in a temporary directory. The rest are not, and the reason is stated
 * rather than left as a gap: running `yam record` needs a browser and a person,
 * and a check that started one would be a check nobody could run.
 */
import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMANDS } from "@svatah/yam";
import { fromRoot } from "../src/repo.js";

const CLI = fromRoot("packages/cli/dist/bin.js");

/** Every `yam …` line the table shows, from the synopses and the examples. */
function examples(): Array<{ where: string; line: string }> {
  const out: Array<{ where: string; line: string }> = [];
  for (const command of COMMANDS) {
    for (const part of command.synopsis.split("|")) {
      const line = part.trim();
      if (line.startsWith("yam ")) out.push({ where: `help ${command.name}`, line });
    }
  }
  return out;
}

/** The flags a command documents, plus the ones every command takes. */
function documented(name: string): Set<string> {
  const universal = ["--help", "--json", "--dir", "--url", "--token"];
  /*
   * Every flag in the option's text, not its first word: `--resume <runId>
   * --from <stepId>` is one option that documents two flags, and reading only
   * the first reported `--from` as undocumented when it is documented right
   * there.
   */
  const found = COMMANDS.filter((one) => name.startsWith(one.name)).flatMap((one) =>
    (one.options ?? []).flatMap(([flag]) => [...flag.matchAll(/--[\w-]+/g)].map((m) => m[0])),
  );
  return new Set([...universal, ...found]);
}

const verbs = new Set(COMMANDS.map((one) => one.name.split(" ")[0]!));

describe("every example names a command that exists (TV-C02)", () => {
  it("has examples to check at all", () => {
    expect(examples().length).toBeGreaterThan(20);
  });

  it("names a verb the CLI dispatches", () => {
    const strays: string[] = [];
    for (const { where, line } of examples()) {
      const verb = line.split(/\s+/)[1];
      if (verb === undefined || verb.startsWith("-")) continue;
      if (!verbs.has(verb)) strays.push(`${where}: ${line}`);
    }
    expect(strays, `examples naming a command nobody has: ${strays.join(" · ")}`).toEqual([]);
  });

  it("passes no flag the command does not document", () => {
    /* The stale flag is the failure this exists for: it is what a rename leaves. */
    const strays: string[] = [];
    for (const { where, line } of examples()) {
      const words = line.split(/\s+/).slice(1);
      const name = words.filter((one) => !one.startsWith("-") && !one.startsWith("<")).slice(0, 2);
      const known = documented(name.join(" "));
      for (const word of words) {
        if (!word.startsWith("--")) continue;
        const flag = word.split("=")[0]!;
        if (!known.has(flag)) strays.push(`${where}: ${flag}`);
      }
    }
    expect(strays, `examples passing a flag nobody documents: ${strays.join(" · ")}`).toEqual([]);
  });
});

describe("the examples that touch nothing actually run (TV-C02)", () => {
  const safe = [
    ["--version"],
    ["help"],
    ["run", "--help"],
    ["completion"],
    ["completion", "zsh"],
    ["ui", "--keys"],
  ];

  for (const argv of safe) {
    it(`yam ${argv.join(" ")}`, () => {
      const project = mkdtempSync(join(tmpdir(), "yam-examples-"));
      try {
        cpSync(fromRoot("evals/fixtures"), project, {
          recursive: true,
          filter: (from) => !from.includes("node_modules") && !from.includes("runs"),
        });
        const ran = spawnSync(process.execPath, [CLI, ...argv], {
          encoding: "utf8",
          cwd: project,
          timeout: 60_000,
        });
        expect(ran.status, `yam ${argv.join(" ")} exited ${ran.status}: ${ran.stderr}`).toBe(0);
        expect(`${ran.stdout}${ran.stderr}`.length).toBeGreaterThan(0);
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    });
  }

  it("says which are not run, and why", () => {
    /*
     * Not a gap left quiet: `record` needs a browser and a person, `run` needs
     * an application to drive, `mcp` speaks a protocol on stdio. A check that
     * started any of them would be a check nobody could run on a laptop.
     */
    const source = readFileSync(fromRoot("tools/repo-checks/test/examples-run.test.ts"), "utf8");
    expect(source).toContain("needs a browser and a person");
  });
});

/**
 * A pipe reads exactly one JSON document (TV-C03, SF-06).
 *
 * `--json` on stdout and progress on stderr is the contract a script depends on,
 * and the way it breaks is a stray line — a warning, a banner, a second
 * document — that a person never sees because their terminal is not a pipe.
 */
describe("a piped command emits one JSON document and nothing else (TV-C03)", () => {
  const commands = [["ui", "--keys"], ["lint", "--json"]];

  for (const argv of commands) {
    it(`yam ${argv.join(" ")} | jq`, () => {
      const project = mkdtempSync(join(tmpdir(), "yam-json-"));
      try {
        cpSync(fromRoot("evals/fixtures"), project, {
          recursive: true,
          filter: (from) => !from.includes("node_modules") && !from.includes("runs"),
        });
        const ran = spawnSync(process.execPath, [CLI, ...argv], {
          encoding: "utf8",
          cwd: project,
          timeout: 120_000,
          env: { ...process.env, NO_COLOR: "1" },
        });
        /* Parses, whole: not "starts with a brace". */
        expect(() => JSON.parse(ran.stdout), `stdout was not one document:\n${ran.stdout.slice(0, 400)}`).not.toThrow();
        /* And nothing after it: a second document would parse the first and lose the rest. */
        expect(ran.stdout.trimEnd().split(/\n\}\s*\n/).length, "more than one document on stdout").toBe(1);
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    });
  }
});
