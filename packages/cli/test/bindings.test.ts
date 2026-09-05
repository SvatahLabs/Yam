/**
 * `svatah bindings list|show|verify|prune` (T1.6, LLD §15).
 *
 * `verify` needs a browser and a running application and is exercised end to end
 * in the Phase 1 progress record; what is here is everything that does not:
 * reading a store, reporting it, refusing what it cannot find, and deciding what
 * `prune` would remove.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT, main, type CommandIo } from "../src/index.js";

function capture(): CommandIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (t) => stdout.push(t), err: (t) => stderr.push(t) };
}

let dir: string;

const BINDING = `entries:
  - candidates:
      - attribute: "data-testid"
        by: "testid"
        score: 0.98
        value: "username"
      - by: "id"
        score: 0.95
        value: "username"
    context:
      hash: "${"a".repeat(64)}"
      pattern: "http://127.0.0.1:4173/login"
      platform: "web"
    fingerprint:
      attrs:
        id: "username"
      box: [16, 120, 348, 34]
      index: 0
      neighbours:
        after: []
        before: ["Username"]
      rolePath: ["main", "form"]
      tag: "input"
      text: ""
    provenance:
      at: "2026-09-02T10:00:00.000Z"
      model: "human"
      promptVersion: "picker"
      tokensIn: 0
      tokensOut: 0
    recordedAt: "2026-09-02T10:00:00.000Z"
    verified: false
id: "login.username-field"
phrases:
  - "the username field"
schemaVersion: "1.0.0"
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "svatah-cli-"));
  mkdirSync(join(dir, "bindings", "login"), { recursive: true });
  writeFileSync(join(dir, "bindings", "login", "username-field.yaml"), BINDING, "utf8");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("bindings list", () => {
  it("says what the store holds, and its hash", async () => {
    const io = capture();
    expect(await main(["bindings", "list", "--dir", join(dir, "bindings")], io)).toBe(EXIT.ok);
    const out = io.stdout.join("\n");
    expect(out).toContain("1 binding in");
    expect(out).toContain("login.username-field");
    expect(out).toContain("2 candidates");
    expect(out).toContain("unverified");
    expect(out).toContain("human");
    expect(out).toContain("the username field");
  });

  it("says so when the store is empty rather than printing nothing", async () => {
    const io = capture();
    expect(await main(["bindings", "list", "--dir", join(dir, "absent")], io)).toBe(EXIT.ok);
    expect(io.stdout.join("\n")).toContain("No bindings in");
    expect(io.stdout.join("\n")).toContain("SVATAH_MODE=record");
  });

  it("answers as JSON when asked", async () => {
    const io = capture();
    await main(["bindings", "list", "--dir", join(dir, "bindings"), "--json"], io);
    const parsed = JSON.parse(io.stdout.join("\n")) as {
      hash: string;
      bindings: Array<{ id: string; candidates: number }>;
    };
    expect(parsed.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.bindings).toEqual([
      expect.objectContaining({ id: "login.username-field", candidates: 2 }),
    ]);
  });

  it("reports a phrase that means more than one element", async () => {
    mkdirSync(join(dir, "bindings", "booking"), { recursive: true });
    writeFileSync(
      join(dir, "bindings", "booking", "book-now.yaml"),
      BINDING.replace('id: "login.username-field"', 'id: "booking.book-now"'),
      "utf8",
    );
    const io = capture();
    await main(["bindings", "list", "--dir", join(dir, "bindings")], io);
    const out = io.stdout.join("\n");
    expect(out).toContain("W_AMBIGUOUS_TARGET");
    expect(out).toContain("booking.book-now, login.username-field");
  });

  it("reports a store it cannot read, rather than pretending it is empty", async () => {
    writeFileSync(join(dir, "bindings", "login", "broken.yaml"), "id: [unclosed\n", "utf8");
    const io = capture();
    expect(await main(["bindings", "list", "--dir", join(dir, "bindings")], io)).toBe(EXIT.failed);
    expect(io.stderr.join("\n")).toContain("not valid YAML");
  });
});

describe("bindings show", () => {
  it("prints the canonical YAML that is on disk", async () => {
    const io = capture();
    expect(
      await main(["bindings", "show", "login.username-field", "--dir", join(dir, "bindings")], io),
    ).toBe(EXIT.ok);
    expect(io.stdout.join("\n")).toContain('id: "login.username-field"');
    expect(io.stdout.join("\n")).toContain('by: "testid"');
  });

  it("needs an id", async () => {
    const io = capture();
    expect(await main(["bindings", "show", "--dir", join(dir, "bindings")], io)).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain("element id");
  });

  it("suggests a near miss", async () => {
    const io = capture();
    expect(await main(["bindings", "show", "username-field", "--dir", join(dir, "bindings")], io)).toBe(
      EXIT.failed,
    );
    expect(io.stderr.join("\n")).toContain("Did you mean login.username-field");
  });
});

describe("bindings prune", () => {
  it("finds a binding nothing refers to, and removes nothing without --apply", async () => {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "a.spec.ts"), 'await bind("login.something-else");\n', "utf8");

    const io = capture();
    expect(
      await main(
        ["bindings", "prune", "--dir", join(dir, "bindings"), "--used-in", join(dir, "tests")],
        io,
      ),
    ).toBe(EXIT.ok);
    const out = io.stdout.join("\n");
    expect(out).toContain("login.username-field");
    expect(out).toContain("Nothing removed");
    expect(out).toContain("--apply");
  });

  it("leaves a binding a test refers to", async () => {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "a.spec.ts"), 'await bind("login.username-field");\n', "utf8");

    const io = capture();
    await main(
      ["bindings", "prune", "--dir", join(dir, "bindings"), "--used-in", join(dir, "tests")],
      io,
    );
    expect(io.stdout.join("\n")).toContain("Every binding is referenced");
  });

  it("removes with --apply", async () => {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "a.spec.ts"), "// nothing\n", "utf8");

    const io = capture();
    await main(
      ["bindings", "prune", "--dir", join(dir, "bindings"), "--used-in", join(dir, "tests"), "--apply"],
      io,
    );
    expect(io.stdout.join("\n")).toContain("Removed.");

    const after = capture();
    await main(["bindings", "list", "--dir", join(dir, "bindings")], after);
    expect(after.stdout.join("\n")).toContain("No bindings in");
  });
});

describe("bindings verify", () => {
  it("refuses an adapter that is not registered", async () => {
    const io = capture();
    expect(
      await main(["bindings", "verify", "--dir", join(dir, "bindings"), "--adapter", "appium"], io),
    ).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain("playwright");
  });
});

describe("unknown subcommands", () => {
  it("names the four that exist", async () => {
    const io = capture();
    expect(await main(["bindings", "frobnicate"], io)).toBe(EXIT.usage);
    expect(io.stderr.join("\n")).toContain("list, show, verify or prune");
  });
});
