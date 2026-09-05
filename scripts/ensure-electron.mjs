#!/usr/bin/env node
/**
 * Make sure Electron's runtime binary is on disk (T3.6).
 *
 * `electron`'s postinstall downloads the runtime, and under pnpm it does not
 * reliably run: `onlyBuiltDependencies` lists it, and a store hit still installs
 * the package without its binary. The failure is confusing — `electron-forge
 * package` gets a long way in and then cannot find an executable — and the fix
 * is one idempotent command, so the ADE's own scripts run it first rather than
 * leaving a person to discover it.
 *
 * `install.js` is Electron's own downloader: it checks `path.txt`, verifies the
 * checksum, and does nothing when the runtime is already there.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const require_ = createRequire(import.meta.url);

let root;
try {
  root = dirname(require_.resolve("electron/package.json"));
} catch {
  process.stderr.write("`electron` is not installed. Run `pnpm install` first.\n");
  process.exit(1);
}

if (existsSync(join(root, "path.txt"))) process.exit(0);

process.stderr.write("fetching the Electron runtime (first run only)…\n");
execFileSync(process.execPath, [join(root, "install.js")], { cwd: root, stdio: "inherit" });
