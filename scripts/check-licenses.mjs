#!/usr/bin/env node
// REQ-PKG-3 / REQ-NFR-10: every dependency must be permissive-licensed and the
// project itself Apache-2.0.
//
// Uses pnpm's own `pnpm licenses list --json`, so the check adds no dependency of
// its own. Exits non-zero and prints the offending packages when anything outside
// the allowlist appears.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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
  const raw = execFileSync("pnpm", ["licenses", "list", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

const report = pnpmLicenses();
const offenders = [];
let inspected = 0;

for (const [license, entries] of Object.entries(report)) {
  for (const entry of entries) {
    inspected += 1;
    if (!isAllowed(license)) {
      offenders.push({ name: entry.name, versions: entry.versions?.join(", ") ?? "", license });
    }
  }
}

// The project's own licence.
const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
if (rootPkg.license !== "Apache-2.0") {
  offenders.push({ name: "svatah (this project)", versions: rootPkg.version, license: rootPkg.license });
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
console.log(`Licence check OK — ${inspected} package(s), ${seen.length} distinct licence(s):`);
for (const l of seen) console.log(`  ${l}`);
