/**
 * T1.9 — module (a) is publishable, and it is module (a).
 *
 * "Publish `@svatah/bindings`, `@svatah/schema`, `@svatah/conformance`,
 * `@svatah/adapter-playwright` 0.1; README with the ten-minute quick start and
 * the published healing numbers."
 *
 * Validate: "`npm install` in a clean Playwright project works; module (a) has no
 * dependency on module (b) packages (test inspects the dependency tree)."
 *
 * The clean-install half needs a network and a browser and is recorded in the
 * Phase 1 progress file with the commands a verifier re-runs. What is here is
 * everything that can be checked from the repository: that each package is
 * publishable at all, that what it would publish is complete, and that the
 * dependency tree contains no module (b) package.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fromRoot } from "../src/repo.js";

/**
 * The packages HLD §12 publishes as module (a). Draft 2.3 added `bindings-cli`,
 * so that someone who installed module (a) alone still has a command line.
 */
const MODULE_A = [
  "schema",
  "surface",
  "adapter-playwright",
  "bindings",
  "healer",
  "playwright-test",
  "bindings-cli",
  "conformance",
] as const;

/**
 * Module (b), as HLD §12 lists it from Draft 2.3 on. `runtime` and the flow
 * host are on it; module (a) reaches replay through the healer's `Replayer`
 * plugin (LLD §10) rather than by importing either.
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

interface Manifest {
  name: string;
  version: string;
  license: string;
  type: string;
  main?: string;
  types?: string;
  exports?: Record<string, unknown>;
  files?: string[];
  engines?: Record<string, string>;
  publishConfig?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const manifest = (pkg: string): Manifest =>
  JSON.parse(readFileSync(fromRoot("packages", pkg, "package.json"), "utf8")) as Manifest;

describe("module (a) is publishable at 0.1.0 (T1.9)", () => {
  it.each(MODULE_A)("@svatah/%s declares what npm needs to publish it", (pkg) => {
    const m = manifest(pkg);
    expect(m.name).toBe(`@svatah/${pkg}`);
    expect(m.version).toBe("0.1.0");
    expect(m.license, "REQ-PKG-3: the project itself is Apache-2.0").toBe("Apache-2.0");
    expect(m.type, "the workspace is ESM (LLD §1)").toBe("module");
    expect(m.publishConfig?.["access"], "a scoped package needs public access").toBe("public");
    expect(m.engines?.["node"], "REQ-NFR-7: Node 22 LTS").toContain("22");

    // `files` is what a consumer receives. Missing `dist` would publish an empty
    // package that installs and then fails to import.
    expect(m.files ?? [], `@svatah/${pkg} publishes no dist`).toContain("dist");
    expect(m.exports?.["."], `@svatah/${pkg} has no entry point`).toBeDefined();
  });

  it("@svatah/schema publishes the JSON Schemas as well as the types (REQ-STD-1)", () => {
    const m = manifest("schema");
    expect(m.files).toContain("json");
    expect(m.exports?.["./json/*"]).toBe("./json/*");
    expect(existsSync(fromRoot("packages", "schema", "json", "ir.schema.json"))).toBe(true);
  });

  it("@svatah/playwright-test peers on the runner rather than depending on it", () => {
    const m = manifest("playwright-test");
    // A consumer's tests run under *their* @playwright/test. Depending on it
    // would install a second copy, and two runners in one project is a bug that
    // presents as fixtures mysteriously not existing.
    expect(m.dependencies?.["@playwright/test"]).toBeUndefined();
    expect(m.peerDependencies?.["@playwright/test"]).toBeDefined();
    expect(m.devDependencies?.["@playwright/test"]).toBeDefined();
  });

  it("every module (a) package is built before it could be packed", () => {
    for (const pkg of MODULE_A) {
      expect(
        existsSync(fromRoot("packages", pkg, "dist", "index.js")),
        `packages/${pkg}/dist is missing — run \`pnpm -r build\``,
      ).toBe(true);
    }
  });
});

describe("module (a) resolves no module (b) package (REQ-PKG-1)", () => {
  /** Every `@svatah/*` package reachable from `pkg` through any dependency field. */
  function closure(pkg: string): string[] {
    const seen = new Set<string>();
    const queue = [pkg];
    while (queue.length > 0) {
      const current = queue.pop()!;
      const m = manifest(current);
      for (const field of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ] as const) {
        for (const specifier of Object.keys(m[field] ?? {})) {
          const match = /^@svatah\/([^/]+)$/.exec(specifier);
          if (match === null) continue;
          const next = match[1]!;
          if (seen.has(next) || !existsSync(fromRoot("packages", next, "package.json"))) continue;
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return [...seen].sort();
  }

  it.each(MODULE_A)("@svatah/%s reaches no module (b) package", (pkg) => {
    const reached = closure(pkg).filter((p) => MODULE_B.includes(p));
    expect(reached, `@svatah/${pkg} reaches ${reached.join(", ")}`).toEqual([]);
  });

  it("the whole of module (a) is closed under its own dependencies", () => {
    // Anything module (a) reaches must itself be module (a), or the seven
    // packages T1.9 publishes would not be installable on their own.
    const reached = new Set(MODULE_A.flatMap((pkg) => closure(pkg)));
    for (const dependency of reached) {
      expect(
        MODULE_A as readonly string[],
        `module (a) reaches @svatah/${dependency}, which is not published with it`,
      ).toContain(dependency);
    }
  });

  it("no module (a) package brings a browser runner as a hard dependency", () => {
    // `playwright` is the adapter's business; `@playwright/test` is the
    // consumer's. Neither may be forced on someone who wanted only the schemas.
    for (const pkg of ["schema", "surface", "bindings", "healer", "conformance"] as const) {
      const deps = Object.keys(manifest(pkg).dependencies ?? {});
      expect(deps, `@svatah/${pkg} depends on a browser runner`).not.toContain("playwright");
      expect(deps).not.toContain("@playwright/test");
    }
  });
});

describe("the README carries the quick start and the numbers (T1.9)", () => {
  const readme = readFileSync(fromRoot("README.md"), "utf8");

  it("shows the one dependency and the one import", () => {
    expect(readme).toContain("npm install --save-dev @svatah/playwright-test");
    expect(readme).toContain('import { test, expect } from "@svatah/playwright-test";');
    expect(readme).toContain("examples/plain-playwright/README.md");
  });

  it("publishes the healing numbers, and links the method", () => {
    expect(readme).toContain("Relocalize-only recovery");
    expect(readme).toMatch(/\d+\.\d\s?%/);
    expect(readme).toContain("reports/eval-healing.md");
    expect(readme).toContain("pnpm eval:healing");
  });

  it("lists the packages module (a) publishes", () => {
    for (const pkg of MODULE_A) {
      expect(readme, `the README does not list @svatah/${pkg}`).toContain(`@svatah/${pkg}`);
    }
  });

  it("says a browser has to be installed before the tests run", () => {
    // The contract is four commands, and this is the one a newcomer skips.
    // `pnpm browsers` exists so it is a step rather than an incantation; the
    // longer form is documented beside it because that is what fails when the
    // step is missed.
    expect(readme).toContain("pnpm browsers");
    expect(readme).toContain("pnpm exec playwright install chromium");
  });

  it("provides `pnpm browsers` and a root Playwright to run it with", () => {
    const root = JSON.parse(readFileSync(fromRoot("package.json"), "utf8")) as Manifest & {
      scripts?: Record<string, string>;
    };
    expect(root.scripts?.["browsers"], "there is no `pnpm browsers` script").toContain(
      "playwright install",
    );
    expect(root.scripts?.["browsers"]).toContain("chromium");
    // Without this, `pnpm exec playwright` at the root resolves nothing and the
    // command in every error message and README is wrong from the repository
    // root — which is where a newcomer types it.
    expect(
      root.devDependencies?.["playwright"],
      "playwright is not a root dev dependency, so `pnpm exec playwright` fails at the root",
    ).toBeDefined();
  });

  it("documents the four-command contract in order", () => {
    const contract = ["pnpm install", "pnpm browsers", "pnpm -r build", "pnpm -r test"];
    let at = -1;
    for (const command of contract) {
      const next = readme.indexOf(command, at + 1);
      expect(next, `the README does not document \`${command}\` after the previous step`).toBeGreaterThan(at);
      at = next;
    }
  });
});

describe("every published package explains itself", () => {
  it.each(MODULE_A)("packages/%s has a README", (pkg) => {
    const path = join(fromRoot("packages", pkg), "README.md");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8").length, `packages/${pkg}/README.md is a stub`).toBeGreaterThan(400);
  });
});

/*
 * ────────────────────────────────────────────────────────────────────────────
 * T7.6 — the 0.1.0 release candidate
 * ────────────────────────────────────────────────────────────────────────────
 *
 * "Release candidate means packed tarballs, a release workflow that stops at the
 * artifact step, and a scripted quick start; no registry publish." What can be
 * checked here is the *shape* of that promise: one version everywhere, a
 * changelog that names it, the two scripts, and a release definition with no
 * publish in it. `pnpm release:dry-run` and `pnpm quick-start:packed` check the
 * rest by doing it.
 */
describe("the 0.1.0 release candidate (T7.6, REQ-PKG-1, 2, 3, 4)", () => {
  const rootManifest = JSON.parse(readFileSync(fromRoot("package.json"), "utf8")) as {
    version: string;
    scripts: Record<string, string>;
  };

  it("versions every publishable package at 0.1.0", () => {
    const wrong: string[] = [];
    for (const dir of readdirSync(fromRoot("packages"))) {
      const manifestPath = fromRoot("packages", dir, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        name: string;
        version: string;
        private?: boolean;
        license?: string;
      };
      if (manifest.private === true) continue;
      if (manifest.version !== "0.1.0") wrong.push(`${manifest.name}@${manifest.version}`);
      if (manifest.license !== "Apache-2.0") wrong.push(`${manifest.name}: ${manifest.license}`);
    }
    expect(wrong, "every published package is 0.1.0 and Apache-2.0").toEqual([]);
    expect(rootManifest.version).toBe("0.1.0");
  });

  it("has a changelog that names the version and what it does not do", () => {
    const changelog = readFileSync(fromRoot("CHANGELOG.md"), "utf8");
    expect(changelog).toContain("## [0.1.0]");
    // The decision, written down where a reader of the release finds it.
    expect(changelog).toContain("Nothing is published to a registry");
  });

  it("offers the two scripts the release candidate is made of", () => {
    expect(rootManifest.scripts["release:dry-run"]).toBe("node scripts/release-dry-run.mjs");
    expect(rootManifest.scripts["quick-start:packed"]).toBe("node scripts/quick-start-packed.mjs");
    expect(existsSync(fromRoot("scripts/release-dry-run.mjs"))).toBe(true);
    expect(existsSync(fromRoot("scripts/quick-start-packed.mjs"))).toBe(true);
  });

  it("ships the published contract with the schemas and the fixture", () => {
    /*
     * REQ-STD-1 and REQ-STD-2 together: a third party writing a runtime
     * downloads `@svatah/schema` for the schemas their artifacts must satisfy
     * *and* the fixture their results are compared against. Shipping one
     * without the other leaves them able to validate and unable to check.
     */
    const manifest = JSON.parse(
      readFileSync(fromRoot("packages/schema/package.json"), "utf8"),
    ) as { files: string[]; scripts: Record<string, string> };
    expect(manifest.files).toContain("json");
    expect(manifest.files).toContain("conformance");
    expect(manifest.scripts["generate"]).toContain("copy-conformance-fixture.mjs");
  });

  it("stops at the artifact step in both release definitions", () => {
    for (const file of [".github/workflows/release.yml", "bitbucket-pipelines.yml"]) {
      const text = readFileSync(fromRoot(file), "utf8");
      // Not one publish, anywhere. Adding one is a decision somebody makes on
      // purpose, not something that arrives with a copied step.
      expect(text, `${file} publishes to a registry`).not.toMatch(/^\s*-?\s*(run:\s*)?(pnpm|npm) publish/m);
    }
    const release = readFileSync(fromRoot(".github/workflows/release.yml"), "utf8");
    expect(release).toContain("pnpm release:dry-run");
    expect(release).toContain("pnpm quick-start:packed");
    // The three-OS installer matrix, and the reports on the release notes.
    expect(release).toContain("pnpm --filter @svatah/ade make");
    expect(release).toContain("files: reports/*.md");

    const bitbucket = readFileSync(fromRoot("bitbucket-pipelines.yml"), "utf8");
    expect(bitbucket).toContain("pnpm release:dry-run");
    expect(bitbucket).toContain("pnpm quick-start:packed");
  });
});
