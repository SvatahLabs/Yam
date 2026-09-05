/**
 * T0.2 Validate — "a throwaway import from `bindings` to `compiler` and from
 * `runtime` to `gateway` each fails the lint".
 *
 * The test writes exactly those two throwaway files, runs eslint over each one,
 * asserts the boundary rule rejected it, and deletes the file again. It also
 * asserts the workspace is clean when the throwaway files are absent, so a
 * boundary rule that rejects everything cannot pass this test.
 *
 * Refs: LLD §1, REQ-SURF-2, REQ-PKG-1.
 */
import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

interface EslintMessage {
  ruleId: string | null;
  message: string;
  severity: number;
}
interface EslintResult {
  filePath: string;
  messages: EslintMessage[];
  errorCount: number;
}

/** Run eslint over one path and return its JSON results (eslint exits 1 on errors). */
function lint(targetPath: string): EslintResult[] {
  try {
    const out = execFileSync(
      "pnpm",
      ["exec", "eslint", "--format", "json", "--no-warn-ignored", targetPath],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(out) as EslintResult[];
  } catch (err) {
    const e = err as { stdout?: string };
    if (typeof e.stdout === "string" && e.stdout.trim().startsWith("[")) {
      return JSON.parse(e.stdout) as EslintResult[];
    }
    throw err;
  }
}

const BOUNDARY_RULES = new Set(["import/no-restricted-paths", "no-restricted-imports"]);

/** Every boundary error eslint reported for a file. */
function boundaryErrors(results: EslintResult[]): EslintMessage[] {
  return results
    .flatMap((r) => r.messages)
    .filter((m) => m.severity === 2 && m.ruleId !== null && BOUNDARY_RULES.has(m.ruleId));
}

const throwaways: string[] = [];

afterEach(() => {
  while (throwaways.length > 0) {
    const p = throwaways.pop()!;
    if (existsSync(p)) rmSync(p);
  }
});

/** Write a throwaway module in `pkg` that imports `forbidden`, and lint it. */
function lintForbiddenImport(pkg: string, forbidden: string): EslintMessage[] {
  const file = fromRoot("packages", pkg, "src", "__boundary_throwaway__.ts");
  throwaways.push(file);
  writeFileSync(
    file,
    `// Throwaway file written by tools/repo-checks; the boundary lint must reject it.\n` +
      `import * as forbidden from "@svatah/${forbidden}";\n` +
      `export const probe = forbidden;\n`,
  );
  return boundaryErrors(lint(file));
}

describe("import boundaries (LLD §1)", () => {
  it("rejects a throwaway import from bindings to compiler", () => {
    const errors = lintForbiddenImport("bindings", "compiler");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map((e) => e.message).join("\n")).toContain(
      "@svatah/bindings must not import @svatah/compiler",
    );
  });

  it("rejects a throwaway import from runtime to gateway", () => {
    const errors = lintForbiddenImport("runtime", "gateway");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map((e) => e.message).join("\n")).toContain(
      "@svatah/runtime must not import @svatah/gateway",
    );
  });

  it("rejects a throwaway import from playwright-test into the flow language", () => {
    const errors = lintForbiddenImport("playwright-test", "spec");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects a throwaway import of an adapter from above the surface", () => {
    const errors = lintForbiddenImport("workflow", "adapter-playwright");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("allows playwright-test to import adapter-playwright but no other adapter", () => {
    expect(lintForbiddenImport("playwright-test", "adapter-playwright")).toHaveLength(0);
    expect(lintForbiddenImport("playwright-test", "adapter-bidi").length).toBeGreaterThan(0);
  });

  it("allows cli to import an adapter (registration) and gateway", () => {
    expect(lintForbiddenImport("cli", "adapter-playwright")).toHaveLength(0);
    expect(lintForbiddenImport("cli", "gateway")).toHaveLength(0);
  });

  it("reports no boundary error anywhere in the workspace as committed", () => {
    const errors = boundaryErrors(lint(fromRoot("packages")));
    expect(errors).toEqual([]);
  });
});
