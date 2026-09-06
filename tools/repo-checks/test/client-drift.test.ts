/**
 * T9.3 Validate — "a drift check that regenerates and diffs" and "regenerating
 * from a changed description fails the drift check" (REQ-SDK-1, LLD §13.8).
 *
 * > Nothing in it is hand-written that the description already states; a drift
 * > between the two fails the build.
 *
 * Two claims. The first is easy and worth checking on every commit: the three
 * committed clients are what the description generates *now*. The second is the
 * one that makes the first mean anything — a check that could not fail would
 * report "no drift" on a client written by hand.
 *
 * So the second is exercised against a **changed committed file** rather than a
 * changed description: the description is `packages/service/src/openapi.ts`, a
 * TypeScript module compiled into `dist/`, and editing it inside a test would
 * mean rebuilding the service package to see the effect. Changing what is on
 * disk on the *other* side of the comparison probes exactly the same equality,
 * in the direction a real drift arrives from — someone edited a generated file
 * — and the file is restored afterwards.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

const GENERATOR = fromRoot("scripts/generate-clients.mjs");

const CLIENTS = [
  { language: "ts", path: fromRoot("packages/sdk/src/generated.ts") },
  { language: "py", path: fromRoot("clients/python/svatah_yam/generated.py") },
  {
    language: "java",
    path: fromRoot("clients/java/src/main/java/com/svatah/yam/sdk/GeneratedClient.java"),
  },
];

/** Run the generator with `--check`; answer with its exit code and output. */
function drift(args: string[] = []): { code: number; output: string } {
  try {
    const stdout = execFileSync(process.execPath, [GENERATOR, "--check", ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

const restore: Array<{ path: string; text: string }> = [];
afterEach(() => {
  while (restore.length > 0) {
    const one = restore.pop()!;
    writeFileSync(one.path, one.text, "utf8");
  }
  // Whatever the test did, the tree is what it was.
  expect(drift().code, "the tree was left drifted").toBe(0);
});

describe("the committed clients are what the description generates (T9.3)", () => {
  it("passes on the tree as committed", () => {
    const result = drift();
    expect(result.code, result.output).toBe(0);
    expect(result.output).toMatch(/3 client\(s\) match the description: \d+ route\(s\)/);
  });

  it("generates a client for each of the three languages", () => {
    for (const one of CLIENTS) {
      const text = readFileSync(one.path, "utf8");
      expect(text, one.path).toContain("GENERATED FILE — do not edit.");
      // Every one of them carries the whole route table, so a route added to
      // the service reaches all three or none. The path is written differently
      // in each — a template literal, an f-string, string concatenation — so
      // the check is on the route's stable segments rather than on one form.
      expect(text, one.path).toContain("/results");
      expect(text, one.path).toContain("/bindings");
      expect(text, one.path).toContain("/openapi.json");
    }
  });

  it("carries the event kinds the description lists, in all three", () => {
    for (const one of CLIENTS) {
      const text = readFileSync(one.path, "utf8");
      expect(text, one.path).toContain("step.result");
      expect(text, one.path).toContain("record.decision");
      // `log` has no dot in it and was the kind an earlier parse dropped.
      expect(text, one.path).toContain('"log"');
    }
  });
});

describe("a drift fails the check (T9.3 Validate)", () => {
  for (const one of CLIENTS) {
    it(`fails when ${one.language} has been edited by hand`, () => {
      const before = readFileSync(one.path, "utf8");
      restore.push({ path: one.path, text: before });

      // The shape a real drift has: someone renamed a method rather than a route.
      writeFileSync(one.path, before.replace("getProject", "fetchProject"), "utf8");

      const result = drift();
      expect(result.code).toBe(1);
      expect(result.output).toContain("is not what the description generates");
      expect(result.output).toContain("`pnpm clients`");
    });
  }

  it("names the file that drifted, and only that one", () => {
    const one = CLIENTS[0]!;
    const before = readFileSync(one.path, "utf8");
    restore.push({ path: one.path, text: before });
    writeFileSync(one.path, `${before}\n// a line nobody generated\n`, "utf8");

    const result = drift();
    expect(result.code).toBe(1);
    expect(result.output).toContain("packages/sdk/src/generated.ts");
    expect(result.output).not.toContain("clients/python");
    expect(result.output).not.toContain("clients/java");
  });

  it("fails when a generated file is deleted outright", () => {
    const one = CLIENTS[1]!;
    const before = readFileSync(one.path, "utf8");
    restore.push({ path: one.path, text: before });
    writeFileSync(one.path, "", "utf8");

    const result = drift();
    expect(result.code).toBe(1);
    expect(result.output).toContain("clients/python/svatah_yam/generated.py");
  });
});

/**
 * P9-F2 — no compiled byte-code cache is tracked (T10.4).
 *
 * `clients/python` is a *generated* package that `scripts/smoke-clients.mjs`
 * imports on every run, and CPython writes a `__pycache__` beside every module
 * it imports. Two of those `.pyc` files were committed in Phase 9 and changed
 * on every smoke run, so the tree was dirty after a check that had done nothing
 * wrong. They are ignored and untracked now; this is what keeps them that way.
 */
describe("no compiled caches are tracked (P9-F2, T10.4)", () => {
  it("git knows about no __pycache__ and no .pyc", () => {
    const tracked = execFileSync("git", ["ls-files"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\n")
      .filter((one) => /(^|\/)__pycache__\/|\.pyc$/.test(one));
    expect(tracked, tracked.join("\n")).toEqual([]);
  });

  it("and .gitignore says so, so the next smoke run does not add them back", () => {
    const ignored = execFileSync(
      "git",
      ["check-ignore", "clients/python/svatah_yam/__pycache__/generated.cpython-314.pyc"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    ).trim();
    expect(ignored).toContain("__pycache__");
  });
});
