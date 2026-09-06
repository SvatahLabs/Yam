#!/usr/bin/env node
/**
 * The adapter conformance report (T4.1, REQ-SURF-3, REQ-PKG-4).
 *
 *   node scripts/adapter-conformance.mjs [--report reports/eval-conformance.md]
 *
 * Every adapter that can be driven on this machine, through the published
 * surface suite. Playwright always; BiDi when there is a browser that speaks the
 * protocol or an endpoint to attach to. An adapter that cannot be driven is
 * *named as skipped* rather than left out, because "conformant" and "not
 * measured" are different results and a report that could not tell them apart
 * would be one nobody could act on.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp } from "sample-web";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");

function run(args, env = {}) {
  return new Promise((done) => {
    let out = "";
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    child.stdout.on("data", (c) => (out += String(c)));
    child.stderr.on("data", (c) => (out += String(c)));
    child.on("close", (code) => done({ status: code ?? 1, out }));
  });
}

const reportAt = process.argv.indexOf("--report");
const reportPath = reportAt >= 0 ? process.argv[reportAt + 1] : undefined;

const { bidiAvailable } = await import(join(ROOT, "packages", "adapter-bidi", "dist", "index.js"));

const app = await startSampleApp(0);
const rows = [];
let failed = 0;

try {
  for (const adapter of ["playwright", "bidi"]) {
    if (adapter === "bidi" && !bidiAvailable()) {
      rows.push({
        adapter,
        status: "skipped",
        detail:
          "no WebDriver BiDi endpoint and no Gecko browser — `pnpm browsers` downloads one, " +
          "or set YAM_BIDI_URL",
      });
      continue;
    }
    const result = await run([
      "surface",
      "conform",
      "--adapter",
      adapter,
      "--base-url",
      app.origin,
      "--json",
    ]);
    let report;
    try {
      report = JSON.parse(result.out.slice(result.out.indexOf("{")));
    } catch {
      rows.push({ adapter, status: "failed", detail: result.out.slice(-400) });
      failed += 1;
      continue;
    }
    rows.push({
      adapter,
      status: report.conformant ? "conformant" : "failed",
      detail:
        `${report.totals.passed} passed, ${report.totals.failed} failed, ` +
        `${report.totals.skipped} skipped (${report.totals.checks} checks)` +
        (report.adapterDetail === undefined ? "" : ` — driving \`${report.adapterDetail}\``),
    });
    if (!report.conformant) failed += 1;
    console.log(`${adapter}: ${report.conformant ? "conformant" : "NOT conformant"}`);
  }
} finally {
  await app.close();
}

if (reportPath !== undefined) {
  const out = resolve(ROOT, reportPath);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    [
      "# Adapter conformance",
      "",
      `Run at ${new Date().toISOString()}.`,
      "",
      "An adapter is **conformant** only when every case in the published surface suite",
      "passes (REQ-SURF-3, LLD §14). A case whose capability the adapter declares `false`",
      "is skipped rather than failed — a phone has no windows, and refusing to report on",
      "one would be reporting on the wrong thing.",
      "",
      "| Adapter | Result | Detail |",
      "|---|---|---|",
      ...rows.map((r) => `| \`${r.adapter}\` | ${r.status} | ${r.detail} |`),
      "",
      "## Regenerate",
      "",
      "```bash",
      "node scripts/adapter-conformance.mjs --report reports/eval-conformance.md",
      "```",
      "",
      "`appium` is absent because it needs a device: see",
      "`packages/adapter-appium/README.md` for the emulator gate and its commands.",
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`wrote ${reportPath}`);
}

process.exit(failed > 0 ? 1 : 0);
