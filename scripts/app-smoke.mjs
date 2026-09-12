#!/usr/bin/env node
/**
 * Launch the app, open a project, and quit (T3.6's Validate item).
 *
 *   pnpm --filter @svatah/yam-desktop smoke [-- <project>]
 *
 * "The app opens a fixture project and shows `GET /project` data; killing the
 * app stops the service." The other checks in `apps/desktop/test/` read a
 * configuration or drive the service; this is the one that starts Electron, so
 * it is the one that would notice a preload path that does not resolve in a
 * packaged build or an `index.html` the renderer cannot load.
 *
 * Headless: `YAM_APP_SMOKE` makes the main process open the project, print one
 * line, and exit. On Linux it needs a display — CI wraps it in `xvfb-run`.
 *
 * ## Against the packaged application when there is one (Draft 2.9 §13.6, T8.1)
 *
 * "The smoke check (`YAM_APP_SMOKE`) and `scripts/app-smoke.mjs` run against
 * the **packaged** application when one exists under `apps/desktop/out/`, and
 * against the unpackaged build otherwise, and say which."
 *
 * Phase 7's version always launched `node_modules/electron/cli.js`, which is a
 * development Electron running the app's sources. That build has the `RunAsNode`
 * fuse *on* and a CLI it can find in the workspace, so it passed while the
 * product a person downloads could not open a project at all (P7-F1). A check
 * that cannot fail the way the product fails is not a check.
 *
 * `YAM_CLI` is deliberately *not* set for a packaged run: the point is that
 * the application finds its own bundled CLI and resolves its own Node.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(ROOT, "apps", "desktop");
const args = process.argv.slice(2);
/*
 * `--windowed-path`: launch with the environment a *window* gets, not a shell.
 *
 * On macOS an app started from Finder inherits `launchd`'s, where `PATH` is
 * `/usr/bin:/bin:/usr/sbin:/sbin`. Homebrew's Node is not on that, nor is any
 * version manager's — so the first packaged launch reported no Node on a machine
 * that had one, while this check, which inherits the developer's shell, passed.
 *
 * A check that cannot fail the way the product fails is not a check; that is the
 * sentence at the top of this file, and this is the second time it applied.
 */
const windowed = args.includes("--windowed-path");
const project = resolve(ROOT, args.find((one) => !one.startsWith("--")) ?? "evals/fixtures");

/** The environment the app is launched with, minus what a window would not have. */
function launchEnvironment() {
  if (!windowed) return process.env;
  const kept = { ...process.env };
  /* `SHELL` stays: recovering the login shell's PATH is the thing under test. */
  delete kept["YAM_NODE"];
  return { ...kept, PATH: process.platform === "win32" ? kept["PATH"] : "/usr/bin:/bin:/usr/sbin:/sbin" };
}

const cli = join(ROOT, "packages", "cli", "dist", "bin.js");
if (!existsSync(cli)) {
  process.stderr.write("Run `pnpm -r build` first: the app spawns the built CLI.\n");
  process.exit(1);
}

/**
 * The packaged application for this host, when `electron-forge package` made one.
 *
 * The Linux and Windows executables are *found* rather than named: Forge derives
 * the file name from the packager configuration, and a guess that was wrong would
 * silently fall back to the unpackaged build — which is the failure mode T8.1
 * exists to remove. The macOS bundle has a fixed layout and is named.
 */
function packagedApp() {
  const out = join(APP_DIR, "out");
  if (!existsSync(out)) return undefined;
  const prefix = `Yam-${process.platform}-`;
  for (const dir of readdirSync(out).filter((one) => one.startsWith(prefix))) {
    const platformDir = join(out, dir);
    if (process.platform === "darwin") {
      const app = readdirSync(platformDir).find((one) => one.endsWith(".app"));
      if (app === undefined) continue;
      const binary = join(platformDir, app, "Contents", "MacOS", app.replace(/\.app$/, ""));
      if (existsSync(binary)) return binary;
      continue;
    }
    const entries = readdirSync(platformDir, { withFileTypes: true }).filter((one) => one.isFile());
    const binary =
      process.platform === "win32"
        ? entries.find((one) => one.name.toLowerCase().endsWith(".exe"))
        : entries.find((one) => !one.name.includes(".") && isExecutable(join(platformDir, one.name)));
    if (binary !== undefined) return join(platformDir, binary.name);
  }
  return undefined;
}

/** Whether a file has an execute bit, which is what marks the Linux binary. */
function isExecutable(path) {
  try {
    return (statSync(path).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

const packaged = packagedApp();
const entry = join(APP_DIR, ".vite", "build", "main.js");

if (packaged === undefined && !existsSync(entry)) {
  process.stderr.write(
    "No build yet. Run `pnpm --filter @svatah/yam-desktop package` first.\n",
  );
  process.exit(1);
}

process.stdout.write(
  packaged === undefined
    ? `yam smoke target=unpackaged (${entry})${windowed ? " path=windowed" : ""}\n`
    : `yam smoke target=packaged (${packaged})${windowed ? " path=windowed" : ""}\n`,
);

const child =
  packaged === undefined
    ? spawn(process.execPath, [join(ROOT, "node_modules", "electron", "cli.js"), APP_DIR], {
        cwd: APP_DIR,
        stdio: ["inherit", "pipe", "pipe"],
        env: {
          ...launchEnvironment(),
          YAM_APP_SMOKE: project,
          YAM_CLI: cli,
          YAM_A11Y: "1",
          ELECTRON_ENABLE_LOGGING: "1",
        },
      })
    : spawn(packaged, [], {
        cwd: APP_DIR,
        stdio: ["inherit", "pipe", "pipe"],
        env: {
          ...launchEnvironment(),
          YAM_APP_SMOKE: project,
          // No `YAM_CLI`, and no `YAM_NODE`: a packaged app has to find
          // its own CLI under `resources/` and its own Node on `PATH` (§13.6).
          YAM_CLI: "",
          YAM_A11Y: "1",
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
  process.stderr.write("yam smoke timed out after 120 s.\n");
  process.exit(1);
}, 120_000);

/*
 * The renderer's console reaches Electron's stderr under ELECTRON_ENABLE_LOGGING.
 * An uncaught error there is a broken window behind a main process that still
 * answers, which is what Draft 2.19's bridge rename produced and this smoke
 * passed: the project opened, the service ran, and the screen was blank. So the
 * output is echoed and read, and an uncaught renderer error fails the smoke.
 */
let uncaught = "";
const watch = (stream, sink) => {
  stream?.on("data", (chunk) => {
    const text = String(chunk);
    sink.write(text);
    const match = /Uncaught (?:Error|TypeError|ReferenceError)[^"\n]*/.exec(text);
    if (match !== null && uncaught === "") uncaught = match[0];
  });
};
watch(child.stdout, process.stdout);
watch(child.stderr, process.stderr);

const code = await new Promise((done) => child.on("exit", (value) => done(value ?? 1)));
clearTimeout(deadline);
if (code === 0 && uncaught !== "") {
  process.stderr.write(`yam smoke: the window opened but the renderer threw: ${uncaught}\n`);
  process.exit(1);
}
process.exit(code);
