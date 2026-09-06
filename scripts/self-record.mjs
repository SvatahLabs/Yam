#!/usr/bin/env node
/**
 * Record `evals/self`'s flow against the ADE, and replay it (T11.3).
 *
 *   node scripts/self-record.mjs [--keep]
 *
 * The T11.3 Validate items, as a command:
 *
 *   > `svatah record --gateway fake` on a self flow against the ADE writes
 *   > every binding; the same flow replays.
 *
 * ## Against a copy, always
 *
 * `evals/self/bindings` is *seeded* — written by hand from `automationId`s,
 * with no model and no recording (LLD §13.9) — and this is the recorder, which
 * writes bindings of its own. Recording into the committed project would
 * replace a set somebody wrote deliberately with one a script produced, and the
 * two are different claims about the same files. So the project is copied to a
 * temporary directory, the copy is recorded and replayed, and the committed one
 * is untouched. `--keep` leaves the copy behind to be read.
 *
 * The bundle path is made absolute in the copy: `app.launch.bundle` is resolved
 * from the project root, and the copy's root is somewhere else.
 *
 * Exit 0 when every binding was written and the replay is green.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyProjectParts } from "./lib/self-project.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(ROOT, "packages", "cli", "dist", "bin.js");
const source = join(ROOT, "evals", "self");
const bundle = join(ROOT, "apps", "ade", "out", "Svatah ADE-darwin-arm64", "Svatah ADE.app");
const keep = process.argv.includes("--keep");

const project = mkdtempSync(join(tmpdir(), "svatah-self-record-"));
const skipped = copyProjectParts(source, project, ["flows", "steps", "api"]);
if (skipped.length > 0) {
  process.stderr.write(`the self project has no ${skipped.join(", ")}; copied without\n`);
}
cpSync(join(source, "data.yaml"), join(project, "data.yaml"));
mkdirSync(join(project, "bindings"), { recursive: true });

const config = readFileSync(join(source, "svatah.config.yaml"), "utf8").replace(
  /bundle: ".*"/,
  `bundle: ${JSON.stringify(bundle)}`,
);
writeFileSync(join(project, "svatah.config.yaml"), config, "utf8");

const executable = join(bundle, "Contents", "MacOS", "Svatah ADE");

/**
 * Stop the ADE, and do not come back until it is gone.
 *
 * A signal is a request and a quit is a request: an Electron application takes
 * a second or two to unwind, and the *next* launch then finds a process of that
 * name which owns no window — which is `no-window` on the first action and the
 * whole of P8-F1. Polling rather than sleeping, for the same reason the desktop
 * gate polls.
 */
const stop = () => {
  const alive = () =>
    (spawnSync("pgrep", ["-f", executable], { encoding: "utf8" }).stdout ?? "")
      .split("\n")
      .filter((one) => one.trim() !== "");
  if (alive().length === 0) return;
  spawnSync("osascript", ["-e", 'tell application id "com.electron.svatah-ade" to quit'], {
    encoding: "utf8",
  });
  for (let waited = 0; waited < 20_000 && alive().length > 0; waited += 250) {
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 250)"]);
  }
  if (alive().length > 0) {
    spawnSync("pkill", ["-f", executable], { encoding: "utf8" });
    for (let waited = 0; waited < 10_000 && alive().length > 0; waited += 250) {
      spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 250)"]);
    }
  }
};

const run = (what, extra) => {
  process.stderr.write(`\n$ svatah ${what} ${extra.join(" ")}\n`);
  const ran = spawnSync(process.execPath, [cli, what, project, ...extra], {
    encoding: "utf8",
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stderr.write(`${ran.stdout ?? ""}${ran.stderr ?? ""}`);
  return ran.status ?? 1;
};

stop();
const recorded = run("record", ["--gateway", "fake", "--flow", "flows/02-ade-screen.flow"]);
stop();
const replayed = run("run", ["--host", "none", "--flow", "flows/02-ade-screen.flow"]);
stop();

const written = readdirSync(join(project, "bindings"), { recursive: true }).filter((one) =>
  String(one).endsWith(".yaml"),
);
const kinds = new Set();
for (const file of written) {
  const text = readFileSync(join(project, "bindings", String(file)), "utf8");
  for (const match of text.matchAll(/^\s*- by: "([a-zA-Z]+)"$/gm)) kinds.add(match[1]);
}

/*
 * And the third Validate item: a variant-1 rename relocalizes, live.
 *
 * The variant renames the rail item and keeps its id; the id is the ground
 * truth and the relocalizer is blind to it (LLD §16), so what has to carry the
 * repair is the fingerprint the recorder just wrote. `--variant 1` on the
 * launch is the only difference from the replay above.
 */
const healed = spawnSync(
  process.execPath,
  [join(ROOT, "scripts", "self-relocalize.mjs"), "--project", project],
  { encoding: "utf8", cwd: ROOT },
);
process.stderr.write(`${healed.stdout ?? ""}${healed.stderr ?? ""}`);
stop();

process.stdout.write(
  `\nrecorded ${written.length} binding(s) — candidate kinds: ${[...kinds].sort().join(", ")}\n` +
    `record exit ${recorded}, replay exit ${replayed}, relocalize exit ${healed.status ?? 1}\n` +
    (keep ? `kept ${project}\n` : ""),
);
if (!keep) rmSync(project, { recursive: true, force: true });

/*
 * Three bindings, both desktop candidate kinds, and a green replay. Fewer than
 * three is a grounding that failed; a missing `automationId` is the defect
 * T11.3 is about — a desktop recording that came out with `role` and `text` and
 * nothing that survives a rewording.
 */
const ok =
  recorded === 0 &&
  replayed === 0 &&
  healed.status === 0 &&
  written.length >= 3 &&
  kinds.has("automationId") &&
  kinds.has("controlPath");
process.exit(ok ? 0 : 1);
