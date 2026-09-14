#!/usr/bin/env node
/**
 * Privacy mode, as a command (T4.7, REQ-NFR-3, REQ-RUN-1, REQ-NFR-1).
 *
 *   node scripts/privacy-check.mjs
 *
 * Runs `compile`, `lint` and `run` with every connection that is not to this
 * machine refused, which is the same thing `docs/privacy.md` tells a reader to
 * do by hand. A failure here says *a command reached the network*, which is a
 * policy failure rather than a test failure, and the message names the host.
 *
 * It is a script rather than three lines in two CI files because there are two
 * CI files and they have to stay in step (P0-F5). It is not a substitute for
 * `packages/cli/test/privacy.test.ts`, which covers the cases a shell script
 * cannot — the negative control, the local-model endpoint, the identical plan.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startSampleApp } from "sample-web";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
// A `file:` URL: `--import` takes a module specifier, and a Windows path is
// read as a URL with the drive letter for its scheme.
const BLOCKER = pathToFileURL(join(ROOT, "scripts", "block-external-network.mjs")).href;
const OUT = mkdtempSync(join(tmpdir(), "yam-privacy-"));

function offline(args, env = {}) {
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        YAM_SAMPLE_PASSWORD: "qwerty123",
        YAM_SAMPLE_CARD_NUMBER: "5123456789012346",
        YAM_SAMPLE_CARD_CVV: "123",
        NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${BLOCKER}`].filter(Boolean).join(" "),
        ...env,
      },
    });
    child.stdout.on("data", (c) => (output += String(c)));
    child.stderr.on("data", (c) => (output += String(c)));
    child.on("close", (code) => done({ status: code ?? 1, output }));
  });
}

const app = await startSampleApp(0);
console.log(`sample-web on ${app.origin}`);

/**
 * `compile` and `lint` reach nothing at all; `run` reaches the application and
 * nothing else. The run's exit code is not asserted — `natural_language_login`
 * has one documented unsupported step (see `evals/conformance/runtime/README.md`)
 * — because what is under test is *what it reached*, not whether it passed.
 */
const checks = [
  { what: "compile", args: ["compile", "evals/fixtures", "--stable", "--out", join(OUT, "plan.json")], mustSucceed: true },
  { what: "lint", args: ["lint", "evals/fixtures"], mustSucceed: true },
  {
    what: "run",
    args: [
      "run",
      "evals/fixtures",
      "--host",
      "none",
      "--out",
      OUT,
      "--run-id",
      "privacy",
      "--flow",
      "flows/natural_language_login.flow",
      "--base-url",
      app.origin,
      "--input",
      "email=connected2atul@gmail.com",
      "--input",
      "password=qwerty123",
    ],
    mustSucceed: false,
  },
];

let failures = 0;
try {
  for (const check of checks) {
    const result = await offline(check.args);
    const blocked = /Blocked a \w+ connection to (\S+)/.exec(result.output);
    if (blocked !== null) {
      console.error(`${check.what}: REACHED ${blocked[1]}`);
      console.error(result.output.slice(-2000));
      failures += 1;
      continue;
    }
    if (check.mustSucceed && result.status !== 0) {
      console.error(`${check.what}: exited ${result.status} with the network blocked`);
      console.error(result.output.slice(-2000));
      failures += 1;
      continue;
    }
    console.log(`${check.what}: reached nothing beyond this machine`);
  }
} finally {
  await app.close();
}

if (failures > 0) {
  console.error(`\n${failures} command(s) reached beyond this machine (REQ-NFR-3).`);
  process.exit(1);
}
console.log("\nPrivacy mode holds: no step text left the machine.");
