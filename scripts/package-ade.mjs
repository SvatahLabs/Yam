#!/usr/bin/env node
/**
 * Package the ADE, as the product or as the suite's own build (T11.1, P10-F7).
 *
 *   node scripts/package-ade.mjs            # apps/ade/out,      "Yam ADE"
 *   node scripts/package-ade.mjs --test     # apps/ade/out-test, "Yam ADE Test"
 *   node scripts/package-ade.mjs --make     # installers instead of a directory
 *
 * Electron Forge takes its configuration from a file and not from the command
 * line, so the only way to ask for a second identity is an environment
 * variable — and setting one inline in an npm script is not portable to
 * Windows, where the whole point of the desktop work is that it runs. One file
 * that sets it and spawns Forge is the portable version of `FOO=1 pnpm …`.
 *
 * Why the second identity exists: the Playwright cases and the desktop gate
 * both drive *a packaged ADE*, both stopped leftovers by executable path, and
 * both addressed the process called `Yam ADE`. Run at the same time — which
 * is what `pnpm -r test` beside a gate run is — each stopped the other's
 * application mid-case, and the Phase 10 verification saw exactly that. With
 * its own product name, bundle identifier and output directory, the suite's
 * build is invisible to the gate, to a person's own ADE, and to `pkill -f`.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADE = join(ROOT, "apps", "ade");
const args = process.argv.slice(2);
const test = args.includes("--test");
const command = args.includes("--make") ? "make" : "package";

for (const step of [["ensure-electron"], ["stage-cli"]]) {
  const ran = spawnSync("pnpm", ["run", ...step], { cwd: ADE, stdio: "inherit" });
  if (ran.status !== 0) process.exit(ran.status ?? 1);
}

const forge = spawnSync("pnpm", ["exec", "electron-forge", command], {
  cwd: ADE,
  stdio: "inherit",
  env: { ...process.env, ...(test ? { YAM_ADE_TEST_BUILD: "1" } : {}) },
});
process.exit(forge.status ?? 1);
