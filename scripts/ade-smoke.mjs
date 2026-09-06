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
 *
 * ## Against the packaged application when there is one (Draft 2.9 §13.6, T8.1)
 *
 * "The smoke check (`SVATAH_ADE_SMOKE`) and `scripts/ade-smoke.mjs` run against
 * the **packaged** application when one exists under `apps/ade/out/`, and
 * against the unpackaged build otherwise, and say which."
 *
 * Phase 7's version always launched `node_modules/electron/cli.js`, which is a
 * development Electron running the ADE's sources. That build has the `RunAsNode`
 * fuse *on* and a CLI it can find in the workspace, so it passed while the
 * product a person downloads could not open a project at all (P7-F1). A check
 * that cannot fail the way the product fails is not a check.
 *
 * `SVATAH_CLI` is deliberately *not* set for a packaged run: the point is that
 * the application finds its own bundled CLI and resolves its own Node.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
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

/** The packaged application for this host, when `electron-forge package` made one. */
function packagedApp() {
  const out = join(ADE, "out");
  if (!existsSync(out)) return undefined;
  const candidates =
    process.platform === "darwin"
      ? readdirSync(out)
          .filter((one) => one.startsWith("Svatah ADE-darwin-"))
          .map((one) => join(out, one, "Svatah ADE.app", "Contents", "MacOS", "Svatah ADE"))
      : process.platform === "win32"
        ? readdirSync(out)
            .filter((one) => one.startsWith("Svatah ADE-win32-"))
            .map((one) => join(out, one, "Svatah ADE.exe"))
        : readdirSync(out)
            .filter((one) => one.startsWith("Svatah ADE-linux-"))
            .map((one) => join(out, one, "svatah-ade"));
  return candidates.find((one) => existsSync(one));
}

const packaged = packagedApp();
const entry = join(ADE, ".vite", "build", "main.js");

if (packaged === undefined && !existsSync(entry)) {
  process.stderr.write(
    "No build yet. Run `pnpm --filter @svatah/ade package` first.\n",
  );
  process.exit(1);
}

process.stdout.write(
  packaged === undefined
    ? `svatah-ade smoke target=unpackaged (${entry})\n`
    : `svatah-ade smoke target=packaged (${packaged})\n`,
);

const child =
  packaged === undefined
    ? spawn(process.execPath, [join(ROOT, "node_modules", "electron", "cli.js"), ADE], {
        cwd: ADE,
        stdio: "inherit",
        env: {
          ...process.env,
          SVATAH_ADE_SMOKE: project,
          SVATAH_CLI: cli,
          SVATAH_A11Y: "1",
          ELECTRON_ENABLE_LOGGING: "1",
        },
      })
    : spawn(packaged, [], {
        cwd: ADE,
        stdio: "inherit",
        env: {
          ...process.env,
          SVATAH_ADE_SMOKE: project,
          // No `SVATAH_CLI`, and no `SVATAH_NODE`: a packaged ADE has to find
          // its own CLI under `resources/` and its own Node on `PATH` (§13.6).
          SVATAH_CLI: "",
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
