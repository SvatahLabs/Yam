#!/usr/bin/env node
/**
 * Launch the ADE, open a project, and quit (T3.6's Validate item).
 *
 *   pnpm --filter @svatah/ade smoke [-- <project>]
 *
 * "The app opens a fixture project and shows `GET /project` data; killing the
 * app stops the service." The other checks in `apps/ade/test/` read a
 * configuration or drive the service; this is the one that starts Electron, so
 * it is the one that would notice a preload path that does not resolve in a
 * packaged build or an `index.html` the renderer cannot load.
 *
 * Headless: `SVATAH_ADE_SMOKE` makes the main process open the project, print one
 * line, and exit. On Linux it needs a display — CI wraps it in `xvfb-run`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADE = join(ROOT, "apps", "ade");
const project = resolve(ROOT, process.argv[2] ?? "evals/fixtures");

const cli = join(ROOT, "packages", "cli", "dist", "bin.js");
if (!existsSync(cli)) {
  process.stderr.write("Run `pnpm -r build` first: the ADE spawns the built CLI.\n");
  process.exit(1);
}

const electron = join(ROOT, "node_modules", "electron", "cli.js");
const entry = join(ADE, ".vite", "build", "main.js");
if (!existsSync(entry)) {
  process.stderr.write(
    "No build yet. Run `pnpm --filter @svatah/ade exec electron-forge package` first.\n",
  );
  process.exit(1);
}

const child = spawn(process.execPath, [electron, ADE], {
  cwd: ADE,
  stdio: "inherit",
  env: {
    ...process.env,
    SVATAH_ADE_SMOKE: project,
    SVATAH_CLI: cli,
    SVATAH_A11Y: "1",
    ELECTRON_ENABLE_LOGGING: "1",
  },
});

/*
 * A hard deadline, because an Electron that cannot start does not always say so.
 * A main process that throws during load leaves Electron's default window up and
 * the process alive for ever; without this, that reads as a hung CI job rather
 * than as a failure.
 */
const deadline = setTimeout(() => {
  child.kill("SIGKILL");
  process.stderr.write("svatah-ade smoke timed out after 120 s.\n");
  process.exit(1);
}, 120_000);

const code = await new Promise((done) => child.on("exit", (value) => done(value ?? 1)));
clearTimeout(deadline);
process.exit(code);
