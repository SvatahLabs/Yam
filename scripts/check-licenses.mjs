#!/usr/bin/env node
// REQ-PKG-3 / REQ-NFR-10: every dependency must be permissive-licensed and the
// project itself Apache-2.0.
//
// Uses pnpm's own `pnpm licenses list --json`, so the check adds no dependency of
// its own. Exits non-zero and prints the offending packages when anything outside
// the allowlist appears.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execPnpmSync } from "./lib/pnpm.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `--tree <dir>` checks an installed `node_modules` instead of this workspace
 * (T7.6, REQ-PKG-3).
 *
 * REQ-PKG-3 is a promise about what someone *installs*, and this workspace is
 * not that: it carries every dev dependency the repository needs and resolves
 * `@svatah/*` through links. What a Playwright user ends up with is the tree
 * `scripts/quick-start-packed.mjs` builds from the tarballs, so that is the tree
 * the claim has to be checked against. It is walked directly rather than through
 * `pnpm licenses`, because the project it belongs to was installed with npm and
 * has no pnpm lockfile to read.
 */
const treeAt = (() => {
  const at = process.argv.indexOf("--tree");
  return at < 0 ? undefined : process.argv[at + 1];
})();

/**
 * Permissive licences accepted under REQ-PKG-3. The requirement names MIT,
 * Apache-2.0 and BSD; the rest of this list is the set of equally permissive
 * (or public-domain-equivalent) licences that appear in a normal Node toolchain.
 * Anything copyleft — GPL, LGPL, AGPL, MPL, EPL, CDDL, SSPL — is absent by design.
 */
const ALLOWED = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "ISC",
  "MIT",
  "MIT-0",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
  "Zlib",
]);

/**
 * Packages whose licence is permissive but whose `package.json` does not say so,
 * with the evidence and the reason each is accepted.
 *
 * Not a way to wave something through. A package earns a row only when its
 * licence text is *in the published tarball* and is one of the licences REQ-PKG-3
 * names — the metadata is missing, not the licence — and the row records where
 * to read it, so the next person can check rather than trust.
 *
 * The version is pinned deliberately: a later release that changed its licence
 * would fail this check again rather than inherit the exception.
 */
const METADATA_GAPS = [
  {
    name: "css-value",
    version: "0.0.1",
    licence: "MIT",
    // A transitive dependency of `webdriverio` (T4.2). Published in 2012 with no
    // `license` field; the MIT text is in `Readme.md` under "## License",
    // copyright TJ Holowaychuk.
    evidence: "node_modules/.pnpm/css-value@0.0.1/node_modules/css-value/Readme.md",
  },
];

/** Whether a package is one of the documented metadata gaps above. */
function isDocumentedGap(name, versions) {
  const gap = METADATA_GAPS.find((g) => g.name === name);
  if (gap === undefined) return false;
  const found = (versions ?? "").split(", ").filter((v) => v !== "");
  return found.length > 0 && found.every((v) => v === gap.version);
}

/** Split an SPDX expression and accept it when every alternative branch is allowed. */
function isAllowed(expression) {
  if (!expression) return false;
  const cleaned = expression.replace(/[()]/g, " ").trim();
  // "A OR B" passes when any branch is allowed; "A AND B" needs every term.
  if (/\bOR\b/i.test(cleaned)) {
    return cleaned
      .split(/\bOR\b/i)
      .some((branch) => isAllowed(branch.trim()));
  }
  if (/\bAND\b/i.test(cleaned)) {
    return cleaned
      .split(/\bAND\b/i)
      .every((branch) => isAllowed(branch.trim()));
  }
  return ALLOWED.has(cleaned.replace(/\+$/, ""));
}

function pnpmLicenses() {
  const raw = execPnpmSync(["licenses", "list", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

/**
 * Every installed package's declared licence, from an npm-installed tree.
 *
 * Same shape as `pnpm licenses list --json`, so everything below reads one
 * report and does not care which produced it.
 */
function treeLicenses(root) {
  const modules = join(root, "node_modules");
  if (!existsSync(modules)) {
    console.error(`No node_modules under ${root}. Install it before checking its licences.`);
    process.exit(2);
  }
  const byLicense = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name === ".bin" || entry.name === ".package-lock.json") continue;
      const full = join(dir, entry.name);
      if (entry.name.startsWith("@")) {
        walk(full);
        continue;
      }
      const manifestPath = join(full, "package.json");
      if (!existsSync(manifestPath)) continue;
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch {
        continue;
      }
      const license =
        typeof manifest.license === "string"
          ? manifest.license
          : (manifest.license?.type ?? manifest.licenses?.[0]?.type ?? "UNKNOWN");
      (byLicense[license] ??= []).push({
        name: manifest.name ?? entry.name,
        versions: [manifest.version ?? "0.0.0"],
      });
      const nested = join(full, "node_modules");
      if (existsSync(nested)) walk(nested);
    }
  };
  walk(modules);
  return byLicense;
}

const report = treeAt === undefined ? pnpmLicenses() : treeLicenses(treeAt);
const offenders = [];
const gaps = [];
let inspected = 0;

for (const [license, entries] of Object.entries(report)) {
  for (const entry of entries) {
    inspected += 1;
    if (isAllowed(license)) continue;
    const versions = entry.versions?.join(", ") ?? "";
    if (isDocumentedGap(entry.name, versions)) {
      gaps.push({ name: entry.name, versions });
      continue;
    }
    offenders.push({ name: entry.name, versions, license });
  }
}

// The project's own licence. A packed tree has no such project — it *is* the
// dependencies — so this is asked only of the workspace.
if (treeAt === undefined) {
  const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (rootPkg.license !== "Apache-2.0") {
    offenders.push({
      name: "yam (this project)",
      versions: rootPkg.version,
      license: rootPkg.license,
    });
  }
}

if (offenders.length > 0) {
  console.error(`Licence check FAILED — ${offenders.length} non-permissive package(s):\n`);
  for (const o of offenders) {
    console.error(`  ${o.name}@${o.versions}  ${o.license}`);
  }
  console.error("\nREQ-PKG-3 requires every dependency to be MIT, Apache-2.0 or BSD-style.");
  process.exit(1);
}

const seen = Object.keys(report).sort();
console.log(
  `Licence check OK — ${inspected} package(s) in ${treeAt === undefined ? "the workspace" : treeAt}, ` +
    `${seen.length} distinct licence(s):`,
);
for (const l of seen) console.log(`  ${l}`);

if (gaps.length > 0) {
  console.log(`\n${gaps.length} package(s) declare no licence but ship a permissive one:`);
  for (const gap of gaps) {
    const known = METADATA_GAPS.find((g) => g.name === gap.name);
    console.log(`  ${gap.name}@${gap.versions}  ${known.licence} — see ${known.evidence}`);
  }
}
