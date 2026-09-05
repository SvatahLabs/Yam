/**
 * T0.2 Validate — "a throwaway import from `bindings` to `compiler` and from
 * `runtime` to `gateway` each fails the lint".
 *
 * The test writes exactly those two throwaway files, runs eslint over each one,
 * asserts the boundary rule rejected it, and deletes the file again. It also
 * asserts the workspace is clean when the throwaway files are absent, so a
 * boundary rule that rejects everything cannot pass this test.
 *
 * P0-F1 (Draft 2.2, LLD §1) adds three more guards, because the two probes above
 * were the only shapes the original configuration actually caught:
 *
 *   * a *relative* import that reaches across a package directory
 *     (`../../gateway/src/index.js`) — it needs a resolver that understands that
 *     the `.js` an ESM specifier names is a `.ts` on disk, or
 *     `import/no-restricted-paths` never resolves it and skips it silently;
 *   * a *dynamic* `import()` of a restricted package — `no-restricted-imports`
 *     does not see import expressions at all;
 *   * a forbidden package *declared* in a `package.json` dependency field. With
 *     pnpm's strict isolation this is the guard that holds at run time: a package
 *     that does not declare `@svatah/gateway` cannot resolve it however it is
 *     written. The lint is the guard that names the rule; this test is the guard
 *     that makes the rule true.
 *
 * Refs: LLD §1 (Draft 2.2), REQ-SURF-2, REQ-PKG-1.
 */
import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fromRoot, REPO_ROOT } from "../src/repo.js";
import { BOUNDARIES } from "../../../eslint.config.js";

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

const BOUNDARY_RULES = new Set([
  "import/no-restricted-paths",
  "no-restricted-imports",
  "no-restricted-syntax",
]);

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

/** Write a throwaway module in `pkg` with `body`, lint it, and return the boundary errors. */
function lintThrowaway(pkg: string, body: string): EslintMessage[] {
  const file = fromRoot("packages", pkg, "src", "__boundary_throwaway__.ts");
  throwaways.push(file);
  writeFileSync(
    file,
    `// Throwaway file written by tools/repo-checks; the boundary lint must reject it.\n${body}`,
  );
  return boundaryErrors(lint(file));
}

/** A static import by package name — the ordinary shape. */
function lintForbiddenImport(pkg: string, forbidden: string): EslintMessage[] {
  return lintThrowaway(
    pkg,
    `import * as forbidden from "@svatah/${forbidden}";\nexport const probe = forbidden;\n`,
  );
}

/** A relative import that reaches straight into another package's `src/`. */
function lintForbiddenRelativeImport(pkg: string, forbidden: string): EslintMessage[] {
  return lintThrowaway(
    pkg,
    `import * as forbidden from "../../${forbidden}/src/index.js";\nexport const probe = forbidden;\n`,
  );
}

/** A dynamic `import()` of a restricted package. */
function lintForbiddenDynamicImport(pkg: string, forbidden: string): EslintMessage[] {
  return lintThrowaway(
    pkg,
    `export async function probe(): Promise<unknown> {\n` +
      `  return await import("@svatah/${forbidden}");\n` +
      `}\n`,
  );
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

  // ── P0-F1: the two bypasses the Phase 0 configuration let through ──────────

  it("rejects a relative import from runtime into gateway's source", () => {
    const errors = lintForbiddenRelativeImport("runtime", "gateway");
    expect(
      errors.length,
      "a relative import across a package boundary passed the lint: the TypeScript " +
        "import resolver is not configured (LLD §1, Draft 2.2)",
    ).toBeGreaterThan(0);
    expect(errors.map((e) => e.message).join("\n")).toContain(
      "@svatah/runtime must not import @svatah/gateway",
    );
  });

  it("rejects a relative import from bindings into the compiler's source", () => {
    expect(lintForbiddenRelativeImport("bindings", "compiler").length).toBeGreaterThan(0);
  });

  it("rejects a dynamic import() of gateway from runtime", () => {
    const errors = lintForbiddenDynamicImport("runtime", "gateway");
    expect(
      errors.length,
      "a dynamic import() of a restricted package passed the lint: no-restricted-imports " +
        "does not see import expressions (LLD §1, Draft 2.2)",
    ).toBeGreaterThan(0);
    expect(errors.map((e) => e.message).join("\n")).toContain(
      "@svatah/runtime must not import @svatah/gateway",
    );
  });

  it("rejects a dynamic import() of the compiler from bindings", () => {
    expect(lintForbiddenDynamicImport("bindings", "compiler").length).toBeGreaterThan(0);
  });

  it("rejects a relative dynamic import across a package boundary", () => {
    const errors = lintThrowaway(
      "runtime",
      `export async function probe(): Promise<unknown> {\n` +
        `  return await import("../../gateway/src/index.js");\n` +
        `}\n`,
    );
    expect(errors.length).toBeGreaterThan(0);
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

/**
 * P0-F1 — the guard that holds at run time (LLD §1, Draft 2.2).
 *
 * eslint reads source files. pnpm reads `package.json`. Under pnpm's strict
 * isolation a package can only resolve what it declares, so asserting that no
 * `package.json` declares a package the boundaries forbid makes the boundary true
 * of the installed tree, not just of the code as written.
 *
 * All four dependency fields are checked: a forbidden package under
 * `devDependencies` is just as resolvable from `src/` as one under
 * `dependencies`.
 */
describe("package.json dependency graph (LLD §1, Draft 2.2)", () => {
  const DEPENDENCY_FIELDS = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ] as const;

  interface PackageJson {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  }

  /** Every package directory under `packages/` that has a `package.json`. */
  const packageDirs = readdirSync(fromRoot("packages"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(fromRoot("packages", d.name, "package.json")))
    .map((d) => d.name)
    .sort();

  /** `from` → the set of package directory names it must not depend on. */
  const forbiddenBy = new Map<string, Map<string, string>>();
  for (const { from, to, why } of BOUNDARIES) {
    const forThis = forbiddenBy.get(from) ?? new Map<string, string>();
    forThis.set(to, why);
    forbiddenBy.set(from, forThis);
  }

  it("finds every package directory HLD §12 lists", () => {
    expect(packageDirs.length).toBeGreaterThanOrEqual(20);
  });

  it.each(packageDirs)("packages/%s declares no forbidden dependency", (dir) => {
    const manifest = JSON.parse(
      readFileSync(join(fromRoot("packages", dir), "package.json"), "utf8"),
    ) as PackageJson;
    const forbidden = forbiddenBy.get(dir);
    if (forbidden === undefined) return;

    for (const field of DEPENDENCY_FIELDS) {
      const declared = Object.keys(manifest[field] ?? {});
      for (const specifier of declared) {
        const match = /^@svatah\/([^/]+)$/.exec(specifier);
        if (match === null) continue;
        const why = forbidden.get(match[1]!);
        expect(
          why,
          `packages/${dir}/package.json declares "${specifier}" under ${field}. ` +
            `@svatah/${dir} must not depend on ${specifier}. ${why ?? ""}`,
        ).toBeUndefined();
      }
    }
  });

  it("module (a) resolves no module (b) package, transitively (REQ-PKG-1)", () => {
    /*
     * Module (b) as HLD §12 lists it from Draft 2.3 on. `runtime` is on it, and
     * stays on it: the tension Phase 1 recorded — LLD §1 drawing
     * `healer ─► runtime(replay)` while REQ-PKG-1 forbids module (a) depending
     * on (b) — is resolved by the `Replayer` plugin (LLD §10). The healer
     * declares the interface; module (b) registers a runtime-backed
     * implementation from the CLI. So the healer replays without importing the
     * executor, and this list needs no exception.
     *
     * `host-playwright` is here for the same reason: it *is* the executor's
     * Playwright host, which is why Draft 2.3 split it out of the module (a)
     * `playwright-test` package.
     */
    const MODULE_B = [
      "spec",
      "steps",
      "compiler",
      "gateway",
      "recorder",
      "runtime",
      "host-playwright",
      "trajectory",
      "workflow",
      "tool",
      "service",
      "migrate",
      "cli",
    ];
    /** The eight packages HLD §12 publishes as module (a) (Draft 2.3). */
    const MODULE_A = [
      "bindings",
      "healer",
      "playwright-test",
      "bindings-cli",
      "adapter-playwright",
      "surface",
      "schema",
      "conformance",
    ];

    const manifestOf = (dir: string): PackageJson =>
      JSON.parse(readFileSync(join(fromRoot("packages", dir), "package.json"), "utf8")) as PackageJson;

    /** Every `@svatah/*` package reachable from `dir` through any dependency field. */
    const closure = (dir: string): Set<string> => {
      const seen = new Set<string>();
      const queue = [dir];
      while (queue.length > 0) {
        const current = queue.pop()!;
        const manifest = manifestOf(current);
        for (const field of DEPENDENCY_FIELDS) {
          for (const specifier of Object.keys(manifest[field] ?? {})) {
            const match = /^@svatah\/([^/]+)$/.exec(specifier);
            if (match === null) continue;
            const next = match[1]!;
            if (seen.has(next) || !existsSync(fromRoot("packages", next, "package.json"))) continue;
            seen.add(next);
            queue.push(next);
          }
        }
      }
      return seen;
    };

    for (const dir of MODULE_A) {
      const reachable = [...closure(dir)].filter((d) => MODULE_B.includes(d));
      expect(
        reachable,
        `packages/${dir} reaches module (b) package(s): ${reachable.join(", ")}`,
      ).toEqual([]);
    }
  });
});
