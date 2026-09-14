#!/usr/bin/env node
/**
 * Compiles the fixture projects whose plans are committed.
 *
 * `@svatah/yam-host-playwright` needs a plan for its tests, and it must not depend on
 * the compiler to get one — LLD §1 forbids it, in devDependencies as much as
 * anywhere, because pnpm makes a devDependency resolvable from `src/` too. That
 * boundary is right: the host *consumes* a plan; it does not make one.
 *
 * So the plan is compiled here, from the repository root (which has no boundary
 * to keep), and committed. `tools/repo-checks/test/fixture-plans.test.ts` fails
 * if a committed plan differs from what this script would write, so a compiler
 * change cannot drift away from the host's tests.
 *
 *   node scripts/compile-fixtures.mjs [--check]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "@svatah/yam-compiler";
import { readProjectFrom } from "@svatah/yam-spec";
import { canonicalJson } from "@svatah/yam-schema";

/**
 * The repository root, resolved from this file.
 *
 * Paths below are relative to it rather than to the process's working
 * directory, so the script and the drift test that imports it agree wherever
 * either is run from.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every fixture project whose plan is committed, and where the plan goes. */
export const FIXTURE_PROJECTS = [
  {
    name: "host-playwright test project",
    root: "packages/host-playwright/test/project",
    plan: "packages/host-playwright/test/project/plan.json",
    projectName: "host-tests",
    bindingsDir: "bindings/login",
  },
];

/** A store's ids and phrases, read from the YAML without loading the store. */
function bindingsOf(root, dir) {
  const path = join(ROOT, root, dir);
  return readdirSync(path)
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => {
      const text = readFileSync(join(path, name), "utf8");
      const id = /^id: "(.+)"$/m.exec(text)?.[1] ?? name.replace(/\.yaml$/, "");
      const phrases = [...text.matchAll(/^ {2}- "(.+)"$/gm)].map((m) => m[1]);
      return { id, phrases };
    });
}

export function planFor(fixture) {
  const { project, diagnostics } = readProjectFrom({
    root: join(ROOT, fixture.root),
    flowsDir: "flows",
    bindings: bindingsOf(fixture.root, fixture.bindingsDir),
    env: {},
  });
  const readErrors = diagnostics.filter((d) => d.severity === "error");
  if (readErrors.length > 0) {
    throw new Error(`${fixture.name} does not read: ${readErrors.map((d) => d.message).join("; ")}`);
  }

  const compiled = compile({ project, projectName: fixture.projectName, stable: true });
  const errors = compiled.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    throw new Error(`${fixture.name} does not compile: ${errors.map((d) => d.message).join("; ")}`);
  }
  return `${canonicalJson(compiled.plan)}\n`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes("--check");
  let drifted = 0;

  for (const fixture of FIXTURE_PROJECTS) {
    const text = planFor(fixture);
    if (check) {
      const committed = readFileSync(join(ROOT, fixture.plan), "utf8");
      if (committed !== text) {
        console.error(`${fixture.plan} is stale — run \`node scripts/compile-fixtures.mjs\`.`);
        drifted += 1;
      }
      continue;
    }
    writeFileSync(join(ROOT, fixture.plan), text, "utf8");
    console.log(`wrote ${fixture.plan}`);
  }

  process.exit(drifted === 0 ? 0 : 1);
}
