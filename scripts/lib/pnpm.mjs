/**
 * Starting pnpm from a script, on every platform.
 *
 * `spawnSync("pnpm", …)` works on macOS and Linux and fails on Windows with
 * ENOENT. Node starts a program by its bare name only when it is an `.exe` or a
 * `.com`, and pnpm on a Windows runner is `pnpm.CMD` — so packaging the app and
 * checking licences could not run there, and nobody saw it because the Windows
 * build failed before either step.
 *
 * Under `pnpm run`, pnpm names itself in `npm_execpath`: a JavaScript file when
 * it was installed with npm, as it is on the runners, or an executable when it
 * is standalone. Either is started directly, with no shell and so no quoting of
 * paths. A script started without pnpm falls back to the name, through a shell
 * on Windows only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { basename } from "node:path";

function invocation(args) {
  const self = process.env["npm_execpath"];
  if (self !== undefined && /^pnpm/i.test(basename(self))) {
    return /\.[cm]?js$/i.test(self)
      ? { command: process.execPath, args: [self, ...args], shell: false }
      : { command: self, args, shell: false };
  }
  return { command: "pnpm", args, shell: process.platform === "win32" };
}

/** `spawnSync("pnpm", args, options)`, on Windows too. */
export function spawnPnpmSync(args, options = {}) {
  const run = invocation(args);
  return spawnSync(run.command, run.args, { ...options, shell: run.shell });
}

/** `execFileSync("pnpm", args, options)`, on Windows too. */
export function execPnpmSync(args, options = {}) {
  const run = invocation(args);
  return execFileSync(run.command, run.args, { ...options, shell: run.shell });
}
