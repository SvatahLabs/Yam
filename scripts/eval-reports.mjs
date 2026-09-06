#!/usr/bin/env node
// REQ-PKG-4: generate the per-release eval reports that `.github/workflows/release.yml`
// attaches to the release notes.
//
// Each suite becomes runnable in the task that builds it (T1.8 healing, T3.4 grounding,
// T4.4 compiler, T1.2/T4.1 conformance). Until then this script emits a report saying
// the suite is not yet runnable, naming the task that will make it so, rather than
// failing the release. Once `yam eval <suite>` exists, `runner` below is switched
// from null to the command.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SUITES = [
  {
    name: "compiler",
    threshold: "Tier 1 100%, Tier 2 ≥ 80%, end to end ≥ 95% (REQ-COMP-9, REQ-COMP-3)",
    task: "T4.4",
    /*
     * Runnable since T4.4, and Tier 2 needs a local model server.
     *
     * When one is configured and reachable, this measures the compiler. When one
     * is not, `--only tier1,tier0` measures the half that needs no model at all
     * and the report says which tiers it covered — a partial measurement that
     * says so beats a missing one, and beats a fake standing in for a model
     * whose accuracy is the entire point of the number.
     */
    runner: process.env.YAM_TIER2 === "1"
      ? ["node", "scripts/eval-compiler.mjs", "--report"]
      : ["node", "scripts/eval-compiler.mjs", "--only", "tier0,tier1", "--report"],
  },
  {
    name: "grounding",
    threshold: "accuracy ≥ 95% on the sample application (REQ-REC-10)",
    task: "T3.4",
    /*
     * Runnable since T3.4, and it needs a model.
     *
     * With `ANTHROPIC_API_KEY` set this measures grounding. Without one it runs
     * against the fake gateway, which measures the *harness* — the report says
     * so at the top, in bold, and that sentence is the only reason running it
     * unattended is acceptable at all.
     */
    runner: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
      ? ["node", "scripts/eval-grounding.mjs", "--report"]
      : ["node", "scripts/eval-grounding.mjs", "--gateway", "fake", "--report"],
  },
  {
    name: "healing",
    threshold: "relocalize-only ≥ 60%, with one model call ≥ 85% (REQ-HEAL-5)",
    task: "T1.8",
    /*
     * Runnable since T1.8; the model half since T3.4.
     *
     * `yam eval healing` registers the recorder's `Regrounder` when there is
     * a credential and `heal.useModel` allows it, so the same command measures
     * both numbers when a model is available and says the second is unmeasured
     * when one is not.
     */
    runner: ["node", "scripts/eval-healing.mjs", "--report"],
  },
  {
    name: "conformance",
    threshold: "every adapter passes the surface suite (REQ-SURF-3)",
    task: "T1.2",
    /*
     * Runnable since T4.1, which is the first phase with a second adapter to
     * compare against. It starts the sample application and drives BiDi through
     * both the surface suite and a fixture replay (`scripts/bidi-independence.mjs`).
     */
    runner: ["node", "scripts/adapter-conformance.mjs", "--report"],
  },
];

const outIndex = process.argv.indexOf("--out");
const outDir = resolve(ROOT, outIndex === -1 ? "reports" : (process.argv[outIndex + 1] ?? "reports"));
mkdirSync(outDir, { recursive: true });

const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const at = new Date().toISOString();

/** Suites that ran and missed their threshold. Reported at the end, not swallowed. */
const failed = [];

for (const suite of SUITES) {
  const target = join(outDir, `eval-${suite.name}.md`);
  if (suite.runner) {
    // Delegated to the CLI once the suite exists. A suite that misses its
    // threshold exits non-zero, and that has to reach the release: REQ-PKG-4
    // publishes the numbers, and a number nobody was told about is not published.
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(suite.runner[0], [...suite.runner.slice(1), target], {
      cwd: ROOT,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      console.error(`eval ${suite.name} is below its threshold (exit ${result.status}).`);
      failed.push(suite.name);
    }
    console.log(`wrote ${target}`);
    continue;
  }
  const dataDir = join(ROOT, "evals", suite.name);
  const present = existsSync(dataDir);
  writeFileSync(
    target,
    [
      `# Yam eval report — ${suite.name}`,
      "",
      `Version: ${version} · Generated: ${at}`,
      "",
      `**Threshold:** ${suite.threshold}`,
      "",
      `**Status:** not yet runnable. The ${suite.name} suite becomes runnable in task ${suite.task}`,
      "(see `docs/spec/tasks.md`); this report is a placeholder so the release workflow's",
      "attach step is exercised from Phase 0 onward.",
      "",
      `**Suite data directory:** \`evals/${suite.name}/\` — ${present ? "present" : "missing"}.`,
      "",
    ].join("\n"),
  );
  console.log(`wrote ${target}`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} eval suite(s) below threshold: ${failed.join(", ")}.`);
  console.error("The reports were written; the release should not ship on these numbers.");
  process.exit(1);
}
