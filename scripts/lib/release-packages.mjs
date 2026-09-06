/**
 * Which packages a release is made of (T7.6, T8.5).
 *
 * Extracted so that `scripts/publish.mjs` can ask the question without *running*
 * `scripts/release-dry-run.mjs`: importing that module packs every
 * tarball as a side effect, so a publish script that imported it printed the
 * pack's output before its own and could never be read as a dry run of one
 * thing (T8.5). A module that only answers questions has no side effect to
 * inherit.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The three sets of T7.6, by the package each one starts from. */
export const SETS = {
  "module-a": ["@svatah/yam-bindings", "@svatah/yam-healer", "@svatah/yam-playwright-test", "@svatah/yam-bindings-cli"],
  cli: ["@svatah/yam"],
  schema: ["@svatah/yam-schema"],
};

/** Every workspace package, by name, with its directory and manifest. */
export function workspacePackages() {
  const byName = new Map();
  for (const dir of readdirSync(join(ROOT, "packages"))) {
    const manifestPath = join(ROOT, "packages", dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    byName.set(manifest.name, { dir: join(ROOT, "packages", dir), manifest });
  }
  return byName;
}

/** A set's packages plus everything they depend on, in this workspace. */
export function closureOf(roots, byName) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length > 0) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    const entry = byName.get(name);
    if (entry === undefined) continue;
    seen.add(name);
    for (const dependency of Object.keys(entry.manifest.dependencies ?? {})) {
      if (byName.has(dependency)) stack.push(dependency);
    }
  }
  return [...seen].sort();
}

/**
 * Dependencies before dependents.
 *
 * npm does not require it — a registry will take `@svatah/yam` before
 * `@svatah/yam-schema` — but a publish that fails halfway is far easier to finish by
 * hand when what is already up is a consistent prefix.
 */
export function inDependencyOrder(names, byName) {
  const out = [];
  const done = new Set();
  const visit = (name) => {
    if (done.has(name) || !byName.has(name)) return;
    done.add(name);
    for (const dependency of Object.keys(byName.get(name).manifest.dependencies ?? {})) {
      if (byName.has(dependency)) visit(dependency);
    }
    out.push(name);
  };
  for (const name of [...names].sort()) visit(name);
  return out;
}

/** Every package a release publishes, in the order it publishes them. */
export function publishablePackages(byName = workspacePackages()) {
  const everything = [...new Set(Object.values(SETS).flatMap((roots) => closureOf(roots, byName)))];
  return inDependencyOrder(everything, byName).filter(
    (name) => byName.get(name).manifest.private !== true,
  );
}

/** The tarball `pnpm release:dry-run` writes for a package. */
export function tarballName(name, version) {
  return `${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
}
