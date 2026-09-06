#!/usr/bin/env node
/**
 * Stage the `yam` CLI for the packaged app (T8.1, LLD §13.6).
 *
 *   node scripts/stage-app-cli.mjs [--out apps/desktop/.stage/yam]
 *
 * §13.6: "on project open, locate the bundled CLI (or a configured one)". Phase
 * 7 packaged an app with no CLI in it at all — `Resources/yam/bin.js` did not
 * exist — so a packaged app launched with no environment could not open a
 * project even before it tried to spawn one. `YAM_CLI` hid it: every test and
 * every gate set it, and none of them ran the product a person downloads.
 *
 * `pnpm deploy` is what produces a CLI that runs outside the workspace: it
 * writes the package with a real `node_modules` rather than pnpm's symlinks into
 * a store the packaged application will not carry. Electron Forge copies the
 * result in as an `extraResource`, so it lands beside `app.asar` and outside it
 * — the CLI is a program the app *spawns*, and a program inside an asar cannot
 * be spawned.
 *
 * What is deliberately *not* staged is a Node binary. §13.6's third place is "a
 * Node binary shipped beside the CLI under `resources/` when the packager
 * includes one", and this packager does not: shipping one would make the
 * `PATH`-emptied case of T8.1 pass for the wrong reason, and an application that
 * carries its own interpreter carries its own security updates too.
 */
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const at = args.indexOf("--out");
const out = resolve(at < 0 ? join(ROOT, "apps", "desktop", ".stage", "yam") : args[at + 1]);

if (!existsSync(join(ROOT, "packages", "cli", "dist", "bin.js"))) {
  process.stderr.write("Run `pnpm -r build` first: there is no CLI to stage.\n");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });

/*
 * `--legacy` because this workspace does not inject workspace packages, and
 * `--prod` because the app spawns the CLI and never builds it.
 */
const deploy = spawnSync(
  "pnpm",
  ["deploy", "--filter", "@svatah/yam", "--prod", "--legacy", out],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
);

if (deploy.status !== 0) {
  process.stderr.write(deploy.stdout ?? "");
  process.stderr.write(deploy.stderr ?? "");
  process.stderr.write(`\n\`pnpm deploy\` failed with ${deploy.status}.\n`);
  process.exit(1);
}

const entry = join(out, "dist", "bin.js");
if (!existsSync(entry)) {
  process.stderr.write(`\`pnpm deploy\` wrote nothing at ${entry}.\n`);
  process.exit(1);
}

process.stdout.write(`staged the yam CLI for packaging at ${out}\n`);
