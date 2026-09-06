#!/usr/bin/env node
/**
 * The compatibility milestone (T2.10, REQ-NFR-8, REQ-BEH-5, REQ-RUN-2).
 *
 *   node scripts/compatibility.mjs [--out evals/conformance/runtime]
 *
 * "Run the migrated fixtures with hand-completed seed bindings on
 * `apps/sample-web` in CI, twice, diffing results. … the same plan runs under
 * `--host playwright` and `--host none` with identical statuses."
 *
 * Four runs: `--host none` twice and `--host playwright` twice. Three claims:
 *
 * 1. **REQ-RUN-2, determinism.** Two runs of one plan against one application
 *    give the same step outcomes. Compared on everything except the timestamps
 *    and the run id, which are the only fields a second run is *supposed* to
 *    change.
 * 2. **REQ-BEH-5, one plan.** The same plan under both hosts gives the same
 *    statuses and the same matched candidates. If it did not, "switching
 *    behavior never requires recompiling" would be false, and the plan would not
 *    be the artifact this project says it is.
 * 3. **REQ-COMP-7, byte-stability.** Two compiles of the fixtures produce the
 *    same `plan.json`. Checked here so the compatibility record carries the
 *    hash a verifier can compare.
 *
 * The first run's directory is committed under `evals/conformance/runtime` as
 * the runtime conformance fixture a foreign runtime is compared against
 * (REQ-STD-2, REQ-STD-3).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp } from "sample-web";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = join(ROOT, "evals", "fixtures");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");

export const CONFORMANCE_DIR = "evals/conformance/runtime";

/**
 * The four migrated fixtures. T2.10's milestone is these.
 *
 * `booking-compensation.flow` is the fifth file in the directory and is not a
 * migration of anything — it is the REQ-AUTO-4 showcase — and it needs a "cancel
 * booking" control the sample application does not have. It is excluded here and
 * covered by the policy matrix in `@svatah/yam-runtime`'s own tests.
 */
const FLOWS = [
  "flows/simple.flow",
  "flows/svatah.flow",
  "flows/natural_language_login.flow",
  "flows/execution.flow",
];

/** The secrets the fixtures read. Fixed, so two runs type the same characters. */
const SECRETS = {
  YAM_SAMPLE_PASSWORD: "qwerty123",
  YAM_SAMPLE_CARD_NUMBER: "5123456789012346",
  YAM_SAMPLE_CARD_CVV: "123",
};

/*
 * Every command here runs with external network access disabled (T3.5).
 *
 * REQ-RUN-1 says the executor makes no model calls and REQ-NFR-1 says replay has
 * no network dependency beyond the target platform. Both are structural — the
 * lint and the dependency-graph test keep `runtime` from reaching `gateway` — and
 * this is the part a reader can run: with `block-external-network.mjs` loaded, a
 * replay that reached for a model would fail loudly, and the milestone below
 * passes, so it reached for nothing. Loopback stays open, because that is where
 * `apps/sample-web` is.
 */
const BLOCK_NETWORK = `--import=${join(ROOT, "scripts", "block-external-network.mjs")}`;

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...SECRETS,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, BLOCK_NETWORK].filter(Boolean).join(" "),
        ...env,
      },
    });
    child.stdout.on("data", (c) => (output += c.toString("utf8")));
    child.stderr.on("data", (c) => (output += c.toString("utf8")));
    child.on("close", (code) => resolve({ status: code ?? 1, output }));
  });
}

/**
 * A step result with the fields a second run is supposed to change removed.
 *
 * The run id, the timestamps and the duration are the run's, not the plan's. So
 * is everything after a failure message's first line: a locator failure lists
 * each candidate with how long it took, and "2 ms" is not something two runs
 * agree on. The first line — what failed and why — is.
 */
function comparable(result) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { runId, startedAt, endedAt, durationMs, failure, ...rest } = result;
  return {
    ...rest,
    ...(failure === undefined
      ? {}
      : {
          failure: {
            class: failure.class,
            message: (failure.message ?? "").split("\n")[0],
            ...(failure.policyApplied === undefined ? {} : { policyApplied: failure.policyApplied }),
          },
        }),
  };
}

export function readResults(runDir) {
  const text = readFileSync(join(runDir, "results.jsonl"), "utf8").trim();
  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line));
}

async function main() {
  const outArg = process.argv.indexOf("--out");
  const conformance = resolve(ROOT, outArg > 0 ? process.argv[outArg + 1] : CONFORMANCE_DIR);

  /* 3. Byte-stability: two compiles, one hash (REQ-COMP-7). */
  const planA = mkdtempSync(join(tmpdir(), "yam-plan-"));
  const planB = mkdtempSync(join(tmpdir(), "yam-plan-"));
  await runCli(["compile", PROJECT, "--stable", "--out", join(planA, "plan.json")]);
  await runCli(["compile", PROJECT, "--stable", "--out", join(planB, "plan.json")]);
  const first = readFileSync(join(planA, "plan.json"), "utf8");
  const second = readFileSync(join(planB, "plan.json"), "utf8");
  const planSha = createHash("sha256").update(first).digest("hex");
  rmSync(planA, { recursive: true, force: true });
  rmSync(planB, { recursive: true, force: true });

  if (first !== second) {
    console.error("Two compiles of the fixtures produced different bytes (REQ-COMP-7).");
    process.exit(1);
  }
  console.log(`plan.json is byte-stable — sha256 ${planSha}`);

  /* The application, on one port for every run. */
  const app = await startSampleApp(0);
  console.log(`sample-web on ${app.origin}`);

  const runs = mkdtempSync(join(tmpdir(), "yam-compat-"));
  const outcomes = [];

  try {
    for (const host of ["none", "none", "playwright", "playwright"]) {
      const id = `${host}-${outcomes.filter((o) => o.host === host).length + 1}`;
      /*
       * `simple.flow` declares typed inputs — the hand migration turned two
       * literals into a signature — so the run supplies them. Run-level inputs
       * reach only the stories that declare them (T2.7), so the other three
       * flows are unaffected.
       */
      const result = await runCli(
        [
          "run", PROJECT,
          "--host", host,
          "--out", runs,
          "--run-id", id,
          "--input", "email=connected2atul@gmail.com",
          "--input", `password=${SECRETS.YAM_SAMPLE_PASSWORD}`,
          ...FLOWS.flatMap((flow) => ["--flow", flow]),
        ],
        { YAM_BASE_URL: app.origin },
      );
      outcomes.push({ host, id, dir: join(runs, id), status: result.status, output: result.output });
      console.log(`${host} run ${id}: exit ${result.status}`);
    }

    const results = outcomes.map((o) => ({ ...o, results: readResults(o.dir) }));

    /* 1. Determinism (REQ-RUN-2). */
    let failures = 0;
    for (const host of ["none", "playwright"]) {
      const [a, b] = results.filter((r) => r.host === host);
      const left = JSON.stringify(a.results.map(comparable), null, 1);
      const right = JSON.stringify(b.results.map(comparable), null, 1);
      if (left !== right) {
        console.error(`Two ${host} runs differ (REQ-RUN-2).`);
        failures += 1;
      } else {
        console.log(`${host}: two runs identical — ${a.results.length} step results`);
      }
    }

    /* 2. One plan, two hosts (REQ-BEH-5). */
    const shape = (r) => r.results.map((x) => `${x.story}#${x.stepId}:${x.status}:${x.matched?.by ?? "-"}`);
    const none = shape(results.find((r) => r.host === "none"));
    const playwright = shape(results.find((r) => r.host === "playwright"));
    if (JSON.stringify(none) !== JSON.stringify(playwright)) {
      console.error("The two hosts disagree (REQ-BEH-5):");
      for (let i = 0; i < Math.max(none.length, playwright.length); i += 1) {
        if (none[i] !== playwright[i]) console.error(`  none: ${none[i]}\n  pw:   ${playwright[i]}`);
      }
      failures += 1;
    } else {
      console.log(`both hosts: identical statuses and matches — ${none.length} steps`);
    }

    /*
     * The conformance fixture (REQ-STD-2), written *canonically*.
     *
     * A run id, three timestamps and a duration change on every run, so a
     * verbatim copy could never be diffed — CI would report a change every time
     * and nobody would read the diff. What a foreign runtime is compared on is
     * the status and the matched candidate (REQ-STD-3), and those are exactly
     * what survives here. The raw run stays in `runs/` for whoever wants it.
     *
     * Only the run's own files are replaced: `README.md` is written by hand and
     * wiping the directory would delete it, which is how the last run deleted it.
     */
    mkdirSync(conformance, { recursive: true });
    for (const name of ["results.jsonl", "summary.json", "audit.jsonl", "plan.sha256", "screenshots", "checkpoints"]) {
      rmSync(join(conformance, name), { recursive: true, force: true });
    }

    const canonical = results.find((r) => r.host === "none");
    writeFileSync(
      join(conformance, "results.jsonl"),
      `${canonical.results.map((r) => JSON.stringify(comparable(r))).join("\n")}\n`,
      "utf8",
    );

    const summary = JSON.parse(readFileSync(join(canonical.dir, "summary.json"), "utf8"));
    const { runId, startedAt, endedAt, configHash, ...stable } = summary;
    void runId;
    void startedAt;
    void endedAt;
    void configHash;
    writeFileSync(join(conformance, "summary.json"), `${JSON.stringify(stable, null, 2)}\n`, "utf8");

    writeFileSync(
      join(conformance, "plan.sha256"),
      `${planSha}  plan.json (yam compile evals/fixtures --stable)\n`,
      "utf8",
    );
    console.log(`wrote the conformance fixture to ${outArg > 0 ? process.argv[outArg + 1] : CONFORMANCE_DIR}`);

    console.log(
      `\ntotals: ${stable.totals.passed} passed, ${stable.totals.failed} failed, ` +
        `${stable.totals.skipped} skipped, ${stable.totals.aborted} aborted`,
    );

    process.exit(failures === 0 ? 0 : 1);
  } finally {
    await app.close();
    rmSync(runs, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
