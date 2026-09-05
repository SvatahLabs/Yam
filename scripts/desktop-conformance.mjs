#!/usr/bin/env node
/**
 * The desktop conformance run: launch the ADE, drive it, write the report
 * (T6.1, T6.2, LLD §14, §16, REQ-ADE-6).
 *
 *   node scripts/desktop-conformance.mjs --adapter ax   [--report reports/adapter-ax.md]
 *   node scripts/desktop-conformance.mjs --adapter uia  [--report reports/adapter-uia.md]
 *
 * One command, because the gate has three parts that are easy to get wrong
 * separately: the ADE has to be *packaged*, it has to be launched with
 * `SVATAH_A11Y=1` so Chromium publishes its accessibility tree, and the host
 * permission has to be in place. This checks all three, says which one is
 * missing, and only then runs the suite.
 *
 * Exit 0 when the adapter is conformant, 1 when it is not, 2 when the host is
 * not ready — three answers, because "the permission is not granted" and "the
 * adapter is wrong" send whoever reads it to different places.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};

const adapter = option("adapter", process.platform === "darwin" ? "ax" : "uia");
const report = option("report", join(ROOT, "reports", `adapter-${adapter}.md`));
const project = option("project", join(ROOT, "evals", "fixtures"));
const cli = join(ROOT, "packages", "cli", "dist", "bin.js");

const die = (code, message) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

if (!existsSync(cli)) die(2, "Run `pnpm -r build` first.");

/* ── 1. the host ──────────────────────────────────────────────────────────── */

const doctor = spawnSync(process.execPath, [cli, "surface", "doctor", "--adapter", adapter], {
  encoding: "utf8",
});
process.stderr.write(doctor.stdout ?? "");
if (doctor.status !== 0) {
  die(
    2,
    `\nThe host is not ready for the "${adapter}" adapter, so the conformance suite was not run.\n` +
      "Grant the permission above and run this again. Nothing was written to " +
      `${report}: a report from a run that could not start would be a result nobody took.`,
  );
}

/* ── 2. the ADE ───────────────────────────────────────────────────────────── */

const app =
  process.platform === "darwin"
    ? join(ROOT, "apps", "ade", "out", "Svatah ADE-darwin-arm64", "Svatah ADE.app", "Contents", "MacOS", "Svatah ADE")
    : join(ROOT, "apps", "ade", "out", `Svatah ADE-win32-x64`, "Svatah ADE.exe");

if (!existsSync(app)) {
  die(
    2,
    `The ADE is not packaged (${app}).\n` +
      "Run: pnpm --filter @svatah/ade exec electron-forge package",
  );
}

const ade = spawn(app, [], {
  stdio: "ignore",
  detached: false,
  env: {
    ...process.env,
    SVATAH_A11Y: "1",
    SVATAH_CLI: cli,
    SVATAH_ADE_SMOKE: "",
  },
});

const stop = () => {
  try {
    ade.kill("SIGTERM");
  } catch {
    // Already gone.
  }
};
process.on("exit", stop);

/* Give it time to open a window; the suite has nothing to read until then. */
await new Promise((done) => setTimeout(done, 8_000));

/* ── 3. the suite ─────────────────────────────────────────────────────────── */

const conform = spawnSync(
  process.execPath,
  [cli, "surface", "conform", "--adapter", adapter, "--process", "Svatah ADE", "--report", report],
  { encoding: "utf8", cwd: project },
);
process.stdout.write(conform.stdout ?? "");
process.stderr.write(conform.stderr ?? "");
stop();
process.exit(conform.status ?? 1);
