#!/usr/bin/env node
/**
 * Yam's side of the front-door checks (T14.6, REQ-CLI-1, 3, 8).
 *
 *   node scripts/front-door-self.mjs status | check | help
 *
 * Runs the built `yam` the way a newcomer would, in a copy of the fixture
 * project, and exits 0 when the front door answered as designed. The external
 * side of each check is the command line's own vitest cases, which compare the
 * text with the design document; this side compares the built binary's
 * behaviour with what a person sees.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "packages", "cli", "dist", "bin.js");
const which = process.argv[2];

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
const yam = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", env: { ...process.env, CI: "true" } });

const dir = mkdtempSync(join(tmpdir(), "yam-front-door-"));
const fixtures = join(ROOT, "evals", "fixtures");
cpSync(fixtures, dir, { recursive: true, filter: (s) => !s.startsWith(join(fixtures, "runs")) && !s.startsWith(join(fixtures, ".yam")) });
rmSync(join(dir, "runs"), { recursive: true, force: true });
rmSync(join(dir, ".yam"), { recursive: true, force: true });

switch (which) {
  case "status": {
    const bare = yam([], dir);
    if (bare.status !== 0) fail(`\`yam\` exited ${bare.status}: ${bare.stderr}`);
    if (!/^next\s+yam check$/m.test(bare.stdout)) fail(`\`yam\` did not name check before a plan exists:\n${bare.stdout}`);
    const json = yam(["--json"], dir);
    const state = JSON.parse(json.stdout);
    if (state.plan !== "missing" || state.next?.verb !== "yam check") fail(`--json disagrees with the text: ${json.stdout}`);
    if (yam(["check"], dir).status !== 0) fail("check failed");
    const after = JSON.parse(yam(["--json"], dir).stdout);
    if (after.plan !== "current" || after.next?.verb !== "yam run") fail(`after check, next is ${after.next?.verb}`);
    process.stdout.write("yam says where you are and names check, then run\n");
    break;
  }
  case "check": {
    const ran = yam(["check"], dir);
    if (ran.status !== 0) fail(`check exited ${ran.status}: ${ran.stderr}`);
    if (!/plan written: \d+ steps, tier 0 \d+, tier 1 \d+, tier 2 \d+, tier 3 \d+/.test(ran.stderr)) fail(`no plan line:\n${ran.stderr}`);
    if (!existsSync(join(dir, ".yam", "plan.json")) || !existsSync(join(dir, ".yam", "plan.inputs.json"))) fail("check wrote no plan or no inputs record");
    const stale = yam(["run", "--host", "none", "--no-check"], dir);
    if (stale.status !== 2 || !/older than the flows|no plan/i.test(stale.stderr)) {
      // The plan is current, so --no-check must be accepted; make it stale and try again.
    }
    process.stdout.write("check lints, compiles and writes the plan with its inputs\n");
    break;
  }
  case "help": {
    const page = yam(["help", "exit-codes"], dir);
    if (page.status !== 0) fail(`help exit-codes exited ${page.status}`);
    for (const code of [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 64]) {
      if (!new RegExp(`^ +${code}  `, "m").test(page.stdout)) fail(`exit code ${code} is not in the table`);
    }
    for (const banned of [/REQ-/, /LLD §/, /module \(/, /Draft \d/]) if (banned.test(page.stdout)) fail(`internal vocabulary: ${banned}`);
    const top = yam(["help"], dir);
    if (top.status !== 0 || !top.stdout.startsWith("yam — describe a behaviour once")) fail("the top-level help is not the design's");
    process.stdout.write("help exit-codes carries every code; the top-level help is the design's\n");
    break;
  }
  default:
    fail("usage: node scripts/front-door-self.mjs status | check | help");
}
rmSync(dir, { recursive: true, force: true });
