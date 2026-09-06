#!/usr/bin/env node
/**
 * Re-record the four migrated fixtures (T3.5, REQ-REC-1..9, REQ-NFR-8).
 *
 *   node scripts/record-fixtures.mjs                 # needs a credential
 *   node scripts/record-fixtures.mjs --gateway fake  # from the eval's cases
 *   node scripts/record-fixtures.mjs --dry-run --out <dir>
 *
 * Phase 2 seeded `evals/fixtures/bindings` by pointing at elements by hand and
 * synthesising candidates against the live page (its K4). That is the recorder's
 * *output shape* without the recorder, and this is the milestone that replaces it
 * with the recorder's actual output: every binding grounded, performed, and
 * verified by a step that passed.
 *
 * ## The four flows do not finish, and that is the point
 *
 * Each carries exactly one documented step the sample application cannot satisfy
 * — a `<datalist>` option a browser will not let you click, a flow that never
 * navigates to the page it asserts on (`evals/conformance/runtime/README.md`).
 * A recording stops there, and writes what the steps before it proved. So the
 * store this produces is exactly the set of bindings a passing step verified,
 * and the four failures stay visible rather than being recorded around.
 *
 * ## The report
 *
 * `evals/fixtures/record-report.json` merges the four sessions: every step, its
 * grounding decision, the snapshot size, the tokens, the cost and the candidate
 * the step resolved through (REQ-REC-8). It names the gateway, so a reader can
 * tell a recording made by a model from one made from the eval's committed
 * answers.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp } from "sample-web";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};
const dryRun = argv.includes("--dry-run");
const gateway = flagValue("gateway");

/** The four migrated fixtures. `booking-compensation.flow` is not one (D12). */
const FLOWS = [
  "flows/simple.flow",
  "flows/svatah.flow",
  "flows/natural_language_login.flow",
  "flows/execution.flow",
];

/** The secrets the fixtures read. Fixed, so two recordings type the same characters. */
const SECRETS = {
  YAM_SAMPLE_PASSWORD: "qwerty123",
  YAM_SAMPLE_CARD_NUMBER: "5123456789012346",
  YAM_SAMPLE_CARD_CVV: "123",
};

/** `simple.flow` declares typed inputs; the others take none. */
const INPUTS = ["--input", "email=connected2atul@gmail.com", "--input", `password=${SECRETS.YAM_SAMPLE_PASSWORD}`];

const project = dryRun
  ? mkdtempSync(join(tmpdir(), "yam-record-fixtures-"))
  : join(ROOT, "evals", "fixtures");

if (dryRun) {
  for (const name of ["bindings", "flows", "api", "steps", "var"]) {
    const from = join(ROOT, "evals", "fixtures", name);
    if (existsSync(from)) cpSync(from, join(project, name), { recursive: true });
  }
  for (const name of ["data.yaml", "yam.config.yaml"]) {
    cpSync(join(ROOT, "evals", "fixtures", name), join(project, name));
  }
  process.stderr.write(`dry run into ${project}\n`);
}

const app = await startSampleApp(0);
process.stderr.write(`sample-web on ${app.origin}\n`);

function record(flow) {
  return new Promise((done) => {
    let output = "";
    const child = spawn(
      process.execPath,
      [
        CLI,
        "record",
        project,
        "--rebind",
        "--flow",
        flow,
        ...INPUTS,
        ...(gateway === undefined ? [] : ["--gateway", gateway]),
      ],
      { env: { ...process.env, ...SECRETS, YAM_BASE_URL: app.origin } },
    );
    child.stdout.on("data", (c) => (output += String(c)));
    child.stderr.on("data", (c) => {
      output += String(c);
      process.stderr.write(String(c));
    });
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

const sessions = [];
try {
  for (const flow of FLOWS) {
    process.stderr.write(`\n── ${flow}\n`);
    const result = await record(flow);
    const report = JSON.parse(readFileSync(join(project, "record-report.json"), "utf8"));
    sessions.push({ flow, exit: result.code, report });
  }
} finally {
  await app.close();
}

/*
 * One merged report, because the four sessions are one milestone.
 *
 * `record-report.json` in the project is overwritten by each session — that is
 * right for `yam record`, which reports on the session it just ran — so the
 * merge happens here and is what gets committed.
 */
const merged = {
  at: new Date().toISOString(),
  milestone: "T3.5 — the four migrated fixtures, recorded",
  gateway: sessions[0]?.report.gateway,
  flows: sessions.map(({ flow, exit, report }) => ({
    flow,
    exit,
    complete: report.complete,
    stoppedBecause: report.stoppedBecause,
    written: report.written,
    totals: report.totals,
    steps: report.steps,
  })),
  totals: sessions.reduce(
    (sum, { report }) => ({
      steps: sum.steps + report.totals.steps,
      grounded: sum.grounded + report.totals.grounded,
      reused: sum.reused + report.totals.reused,
      failed: sum.failed + report.totals.failed,
      modelCalls: sum.modelCalls + report.totals.modelCalls,
      cacheHits: sum.cacheHits + report.totals.cacheHits,
      tokensIn: sum.tokensIn + report.totals.tokensIn,
      tokensOut: sum.tokensOut + report.totals.tokensOut,
      costUsd: sum.costUsd + report.totals.costUsd,
      written: sum.written + report.written.length,
    }),
    { steps: 0, grounded: 0, reused: 0, failed: 0, modelCalls: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, written: 0 },
  ),
};

const reportPath = join(project, "record-report.json");
writeFileSync(reportPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

process.stderr.write(
  `\n${merged.totals.written} binding(s) written across ${FLOWS.length} flow(s); ` +
    `${merged.totals.modelCalls} model call(s), $${merged.totals.costUsd.toFixed(4)}.\n` +
    `gateway: ${merged.gateway?.name} (real: ${merged.gateway?.real})\n` +
    `wrote ${reportPath}\n`,
);

if (dryRun) {
  const out = flagValue("out");
  if (out !== undefined) {
    cpSync(project, resolve(ROOT, out), { recursive: true });
    process.stderr.write(`copied to ${resolve(ROOT, out)}\n`);
  } else {
    process.stderr.write(`left at ${project}\n`);
  }
}

rmSync(join(project, ".yam", "record"), { recursive: true, force: true });
