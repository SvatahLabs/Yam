#!/usr/bin/env node
/**
 * The Yam-on-Yam suite, N times in a row, unattended (T00, SF-21).
 *
 *   node scripts/yam-on-yam-repeat.mjs [--times 10] [--out <dir>]
 *
 * Wave 4 left the suite passing without passing *every* time, and "it passes"
 * is a claim one run cannot make. This is the shape of the evidence that can:
 * the same suite, back to back, with **nothing cleaned between runs** beyond
 * what the suite itself does — because a suite that needs a fresh machine
 * between runs has not been fixed, it has been rescheduled.
 *
 * The summary is counted from each run's own `yam-on-yam.json` rather than from
 * what the runner printed. Wave 4's third verification defect was a per-pass
 * table typed by hand where every row was wrong; a summary that reads the
 * evidence cannot drift from it.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const times = Number(option("times") ?? 10);
const out = resolve(
  ROOT,
  option("out") ?? join("docs", "spec", "surface-first", "evidence", "wave-5"),
);
/*
 * `per-run/`, not `runs/`. A path segment called `runs` is what a Yam *project*
 * writes its run artifacts into, and `tools/repo-checks` refuses to let one be
 * committed (LLD §16) — rightly, and this evidence is not that.
 */
mkdirSync(join(out, "per-run"), { recursive: true });

const rows = [];
for (let n = 1; n <= times; n += 1) {
  const id = String(n).padStart(2, "0");
  const dir = join(out, "per-run", `run-${id}`);
  const startedAt = new Date().toISOString();
  const ran = spawnSync(process.execPath, [join(ROOT, "evals", "self", "yam-on-yam", "run.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, YAM_ON_YAM_EVIDENCE_DIR: dir },
    maxBuffer: 128 * 1024 * 1024,
  });
  writeFileSync(join(out, "per-run", `run-${id}.log`), `${ran.stdout ?? ""}${ran.stderr ?? ""}`, "utf8");

  const evidence = join(dir, "yam-on-yam.json");
  const report = existsSync(evidence) ? JSON.parse(readFileSync(evidence, "utf8")) : undefined;
  const row = {
    run: id,
    startedAt,
    exit: ran.status,
    ...(report === undefined
      ? { counts: null, note: "the run wrote no evidence file" }
      : { counts: report.counts }),
  };
  rows.push(row);
  const c = row.counts;
  console.log(
    `run ${id}  ${startedAt}  exit=${row.exit}  ` +
      (c === null
        ? row.note
        : `${c.passed} of ${c.reached} reached passed; ${c.failed} failed; ` +
          `${c.blocked} blocked; ${c.attempted} attempted`),
  );
}

/*
 * What the ten runs say *together*, which is the question. A denominator that
 * moved between runs is the defect SF-21's vocabulary exists to catch, so it is
 * asserted here rather than left for a reader to compare by eye.
 */
const attempted = new Set(rows.map((one) => one.counts?.attempted));
const failures = rows.filter((one) => (one.counts?.failed ?? 1) > 0);
const summary = {
  schemaVersion: "1.0.0",
  ranAt: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, node: process.version },
  times,
  runs: rows,
  sameAttemptedEveryRun: attempted.size === 1,
  attempted: [...attempted],
  runsWithAFailure: failures.map((one) => one.run),
};
writeFileSync(join(out, "ten-runs.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
writeFileSync(
  join(out, "ten-runs.txt"),
  `${rows
    .map((one) => {
      const c = one.counts;
      return (
        `run ${one.run}  ${one.startedAt}  exit=${one.exit}  ` +
        (c === null
          ? one.note
          : `${c.passed} of ${c.reached} reached passed; ${c.failed} failed; ` +
            `${c.blocked} blocked; ${c.attempted} attempted`)
      );
    })
    .join("\n")}\n`,
  "utf8",
);

/*
 * The last run's evidence, left at the top of the wave directory too.
 *
 * `scripts/coverage-report.mjs` reads `<wave>/yam-on-yam.json` and the
 * transcript beside it, and the honest answer to "which of the ten does the
 * coverage report describe" is *the last one* — the same code, the most recent
 * run. Copying it here rather than asking somebody to remember to is what stops
 * a coverage report being generated from a run nobody can point at.
 */
const last = join(out, "per-run", `run-${String(times).padStart(2, "0")}`);
if (existsSync(last)) {
  for (const name of readdirSync(last)) {
    copyFileSync(join(last, name), join(out, name));
  }
  console.log(`\nthe last run's evidence is also at ${relative(ROOT, out)}/`);
}

console.log(
  `\n${times} run(s): ` +
    `${summary.sameAttemptedEveryRun ? `the same ${[...attempted][0]} attempted every time` : `ATTEMPTED MOVED: ${[...attempted].join(", ")}`}; ` +
    `${failures.length === 0 ? "no failures" : `failures in run(s) ${failures.map((one) => one.run).join(", ")}`}`,
);
process.exit(failures.length === 0 && summary.sameAttemptedEveryRun ? 0 : 1);
