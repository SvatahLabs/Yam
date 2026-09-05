#!/usr/bin/env node
// REQ-PKG-4: generate the per-release eval reports that `.github/workflows/release.yml`
// attaches to the release notes.
//
// Each suite becomes runnable in the task that builds it (T1.8 healing, T3.4 grounding,
// T4.4 compiler, T1.2/T4.1 conformance). Until then this script emits a report saying
// the suite is not yet runnable, naming the task that will make it so, rather than
// failing the release. Once `svatah eval <suite>` exists, `runner` below is switched
// from null to the command.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SUITES = [
  { name: "compiler", threshold: "Tier 1 exact match 100%, end to end ≥ 95% (REQ-COMP-9)", task: "T4.4", runner: null },
  { name: "grounding", threshold: "accuracy ≥ 95% on the sample application (REQ-REC-10)", task: "T3.4", runner: null },
  { name: "healing", threshold: "relocalize-only ≥ 60%, with one model call ≥ 85% (REQ-HEAL-5)", task: "T1.8", runner: null },
  { name: "conformance", threshold: "every adapter passes the surface suite (REQ-SURF-3)", task: "T1.2", runner: null },
];

const outIndex = process.argv.indexOf("--out");
const outDir = resolve(ROOT, outIndex === -1 ? "reports" : (process.argv[outIndex + 1] ?? "reports"));
mkdirSync(outDir, { recursive: true });

const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const at = new Date().toISOString();

for (const suite of SUITES) {
  const target = join(outDir, `eval-${suite.name}.md`);
  if (suite.runner) {
    // Delegated to the CLI once the suite exists.
    const { execFileSync } = await import("node:child_process");
    execFileSync(suite.runner[0], suite.runner.slice(1), { cwd: ROOT, stdio: "inherit" });
    continue;
  }
  const dataDir = join(ROOT, "evals", suite.name);
  const present = existsSync(dataDir);
  writeFileSync(
    target,
    [
      `# Svatah eval report — ${suite.name}`,
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
