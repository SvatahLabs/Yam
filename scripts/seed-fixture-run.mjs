#!/usr/bin/env node
/**
 * Put a run into the fixtures project, and take it out again (T11.1).
 *
 *   node scripts/seed-fixture-run.mjs            # writes evals/fixtures/runs/comp
 *   node scripts/seed-fixture-run.mjs --remove   # deletes it
 *   node scripts/seed-fixture-run.mjs --run-id x
 *
 * Two of the ADE's screens are *about* a run — Runs and Run — and
 * `scripts/record-desktop-tree.mjs` records their accessibility trees from the
 * real application, which means a real run has to be in the project while it
 * does. `evals/fixtures/runs/` is ignored by git and is empty in a fresh
 * checkout, so recording those two used to mean somebody had run something by
 * hand and remembered what.
 *
 * It is not left behind. Draft 2.12 §13.7 (P9-F5) says the screen fixtures are
 * recorded against a *copy* of the fixtures project and never the committed
 * one, and `tools/repo-checks/test/screen-fixtures.test.ts` fails when a `comp`
 * run turns up in `evals/fixtures/runs`. The recording recipe is therefore three
 * commands and the third is this one with `--remove`:
 *
 *   node scripts/seed-fixture-run.mjs
 *   node scripts/record-desktop-tree.mjs --shape both --screen results
 *   node scripts/record-desktop-tree.mjs --shape both --screen run
 *   node scripts/seed-fixture-run.mjs --remove
 *
 * The run itself is the `comp` run the artboards are drawn from: two stories of
 * `guards-and-compensation.flow` against `apps/sample-web`, exit 11, with a
 * compensating story. `tools/repo-checks/test/tui-pty.test.ts` makes the same
 * one, in its own temporary copy, for the same reason.
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};

const project = join(ROOT, "evals", "fixtures");
const runId = option("run-id", "comp");
const runs = join(project, "runs", runId);

if (args.includes("--remove")) {
  rmSync(runs, { recursive: true, force: true });
  process.stdout.write(`removed ${runs}\n`);
  process.exit(0);
}

const cli = join(ROOT, "packages", "cli", "dist", "bin.js");
if (!existsSync(cli)) {
  process.stderr.write("Run `pnpm -r build` first.\n");
  process.exit(2);
}

const { startSampleApp } = await import("sample-web");
const app = await startSampleApp(0);
process.stderr.write(`sample-web on ${app.origin}\n`);

/*
 * `--host none` and a child process, both deliberately.
 *
 * `apps/sample-web` runs *in this process*, so a synchronous spawn would block
 * the event loop that has to answer the run's own `page.goto` — every step then
 * fails with a navigation timeout against an application that is up.
 * `apps/ade/test/parity.test.ts` and `tools/repo-checks/test/tui-pty.test.ts`
 * both record the same trap.
 */
const code = await new Promise((done) => {
  let output = "";
  const child = spawn(
    process.execPath,
    [
      cli,
      "run",
      project,
      "--host",
      "none",
      "--flow",
      "flows/guards-and-compensation.flow",
      "--story",
      "I want to book and then fail",
      "--story",
      "cancel a booking",
      "--run-id",
      runId,
      "--base-url",
      app.origin,
    ],
    { cwd: ROOT },
  );
  child.stdout.on("data", (chunk) => (output += String(chunk)));
  child.stderr.on("data", (chunk) => (output += String(chunk)));
  child.on("close", (status) => {
    process.stderr.write(output.slice(-1200));
    done(status ?? 1);
  });
});

await app.close();

/*
 * Exit 11 is the *expected* answer: the flow aborts and a compensating story
 * runs (LLD §8.3), which is what makes this run worth recording a screen of.
 */
if (code !== 11) {
  process.stderr.write(`\n\`yam run\` exited ${code}, not 11 — nothing was recorded.\n`);
  process.exit(1);
}
process.stdout.write(`wrote ${runs} (exit ${code})\n`);
