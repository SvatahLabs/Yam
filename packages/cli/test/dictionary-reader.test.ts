/**
 * P3-F1 — the target dictionary is built from parsed binding files (LLD §4.3,
 * Draft 2.5; REQ-COMP-5).
 *
 * Phase 3 built it by scanning the YAML text for `  - "…"`, which reads one of
 * the several ways YAML writes a list of strings. A phrase written unquoted,
 * single-quoted, in flow style, or at a different indentation vanished from the
 * dictionary while `bindings show` still listed it: every step naming it
 * compiled `unbound` and failed at replay with no candidates.
 *
 * These are the four spellings, plus the rule that makes the *file* rather than
 * its formatting the unit: what the store accepts is what the dictionary gets.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/index.js";
import { EXIT } from "@svatah/bindings-cli";

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function cli(...argv: string[]): Promise<Run> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    out: (text) => (out += `${text}\n`),
    err: (text) => (err += `${text}\n`),
  });
  return { code, out, err };
}

/** One entry, enough of one to satisfy the bindings schema. */
const ENTRY = `entries:
  - candidates:
      - by: "role"
        exact: true
        name: "Sign in"
        role: "button"
        score: 0.9
    context:
      hash: "${"a".repeat(64)}"
      pattern: "/login"
      platform: "web"
    fingerprint:
      attrs: {}
      box: [0, 0, 10, 10]
      index: 0
      neighbours:
        after: []
        before: []
      rolePath: ["main"]
      tag: "button"
      text: "Sign in"
    provenance:
      at: "2026-09-03T00:00:00.000Z"
      costUsd: 0
      model: "human"
      promptVersion: "human"
      tokensIn: 0
      tokensOut: 0
    recordedAt: "2026-09-03T00:00:00.000Z"
    verified: true
`;

/**
 * A project whose only step names the sign-in button, with the phrase list
 * written however the caller likes.
 */
function project(phrasesBlock: string): string {
  const dir = mkdtempSync(join(tmpdir(), "svatah-dict-"));
  mkdirSync(join(dir, "flows"), { recursive: true });
  mkdirSync(join(dir, "bindings", "login"), { recursive: true });

  writeFileSync(
    join(dir, "svatah.config.yaml"),
    'project: "dictionary-reader"\napp:\n  baseUrl: "http://127.0.0.1:4173"\n',
    "utf8",
  );
  writeFileSync(
    join(dir, "flows", "sign-in.flow"),
    'story: Sign in\n  Click on the sign in button\n\ntest: Sign in\n  Sign in\n',
    "utf8",
  );
  writeFileSync(
    join(dir, "bindings", "login", "sign-in-button.yaml"),
    `${ENTRY}id: "login.sign-in-button"\n${phrasesBlock}schemaVersion: "1.0.0"\n`,
    "utf8",
  );
  return dir;
}

/** The one step's target, as `svatah compile --json` reports it. */
async function targetOf(dir: string): Promise<{ ref: string; status: string }> {
  const { code, out } = await cli("compile", dir, "--stable", "--json");
  expect(code).toBe(EXIT.ok);
  const parsed = JSON.parse(out) as {
    plan: { stories: Array<{ steps: Array<{ target?: { ref: string; status: string } }> }> };
  };
  const target = parsed.plan.stories[0]?.steps[0]?.target;
  expect(target, "the step has a target").toBeDefined();
  return target!;
}

describe("the target dictionary reads parsed binding files (P3-F1, LLD §4.3)", () => {
  /*
   * Every one of these is the same document. YAML says so; a regular expression
   * over the text does not, which is the whole of the defect.
   */
  const spellings: ReadonlyArray<[string, string]> = [
    ["double-quoted, as the writer emits it", 'phrases:\n  - "the sign in button"\n'],
    ["unquoted", "phrases:\n  - the sign in button\n"],
    ["single-quoted", "phrases:\n  - 'the sign in button'\n"],
    ["flow style", 'phrases: ["the sign in button"]\n'],
    ["indented four spaces", 'phrases:\n    - "the sign in button"\n'],
    ["indented, unquoted, with a trailing comment", "phrases:\n    - the sign in button # recorded\n"],
  ];

  for (const [how, block] of spellings) {
    it(`binds a phrase written ${how}`, async () => {
      const target = await targetOf(project(block));
      expect({ ref: target.ref, status: target.status }).toEqual({
        ref: "login.sign-in-button",
        status: "bound",
      });
    });
  }

  it("still derives an id from the phrase when no binding claims it", async () => {
    // The negative control: `bound` above has to mean "a file declared this
    // phrase", not "the reader binds everything it is asked about".
    const target = await targetOf(project('phrases:\n  - "something else entirely"\n'));
    expect(target.status).toBe("unbound");
    expect(target.ref).toBe("sign-in-button");
  });

  it("refuses a binding file that will not parse, rather than losing its phrases", async () => {
    const dir = project('phrases:\n  - "the sign in button"\n');
    writeFileSync(join(dir, "bindings", "login", "broken.yaml"), "entries: [\n", "utf8");

    const { code, err } = await cli("compile", dir, "--stable");
    expect(code).toBe(EXIT.usage);
    expect(err).toContain("broken.yaml");
  });
});

describe("W_BINDING_NO_PHRASES (LLD §4.3, Draft 2.5)", () => {
  it("warns about a binding file that declares no phrases", async () => {
    const dir = project("phrases: []\n");
    const { code, out } = await cli("lint", dir, "--json");
    // A warning, not an error: the element is still addressable by id, which is
    // what `bind("login.sign-in-button")` does (LLD §6.5).
    expect(code).toBe(EXIT.ok);

    const { diagnostics } = JSON.parse(out) as {
      diagnostics: Array<{ code: string; severity: string; file: string; message: string }>;
    };
    const warning = diagnostics.find((d) => d.code === "W_BINDING_NO_PHRASES");
    expect(warning, JSON.stringify(diagnostics, null, 2)).toBeDefined();
    expect(warning!.severity).toBe("warning");
    expect(warning!.file).toBe("bindings/login/sign-in-button.yaml");
    expect(warning!.message).toContain("login.sign-in-button");
  });

  it("says nothing about a binding file that declares one", async () => {
    const { out } = await cli("lint", project('phrases:\n  - "the sign in button"\n'), "--json");
    const { diagnostics } = JSON.parse(out) as { diagnostics: Array<{ code: string }> };
    expect(diagnostics.filter((d) => d.code === "W_BINDING_NO_PHRASES")).toEqual([]);
  });
});
