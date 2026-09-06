#!/usr/bin/env node
/**
 * Run the Python and Java smoke scripts against a live service (T9.3,
 * REQ-SDK-2).
 *
 *   pnpm clients:smoke                # both
 *   pnpm clients:smoke --only python  # one
 *
 * > the Python and Java clients each run one smoke script against a live
 * > service (`GET /project`, `POST /run`, events) in CI.
 *
 * This is the *harness*: it starts `apps/sample-web`, starts `svatah serve` on
 * a copy of the fixtures project exactly as the ADE spawns it, and runs each
 * smoke script with the url and token in the environment. The scripts
 * themselves start nothing, so the same command a person types against a
 * service they already have open is what runs here.
 *
 * A copy of the fixtures project, not the fixtures project: the run writes a
 * `runs/` directory, and a smoke script that dirtied the repository would be one
 * nobody could run twice.
 *
 * A toolchain that is not installed is a **skip with the reason**, never a pass:
 * "python3 is not on PATH" and "the client is broken" are different answers and
 * send a reader to different places.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp } from "sample-web";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
const FIXTURES = join(ROOT, "evals", "fixtures");
const TOKEN = "clients-smoke";
/** One story that passes on its own, so the smoke is about the client. */
const STORY = "book a slot";

const argv = process.argv.slice(2);
const only = (() => {
  const at = argv.indexOf("--only");
  return at < 0 ? undefined : argv[at + 1];
})();

if (!existsSync(CLI)) {
  process.stderr.write("Run `pnpm -r build` first.\n");
  process.exit(2);
}

const has = (command) => spawnSync(command, ["--version"], { encoding: "utf8" }).status === 0;

const app = await startSampleApp(0);
const project = mkdtempSync(join(tmpdir(), "svatah-clients-smoke-"));
let serve;
const results = [];

try {
  cpSync(FIXTURES, project, {
    recursive: true,
    filter: (from) => !from.includes(`${"runs"}`) && !from.includes("node_modules"),
  });
  writeFileSync(
    join(project, "svatah.config.yaml"),
    `schemaVersion: "1.0.0"
project: "clients-smoke"
environment: test
adapter: playwright
app: { baseUrl: "${app.origin}" }
flows: { dir: flows }
steps: { dir: steps }
bindings: { dir: bindings, testIdAttributes: ["data-testid", "data-test", "data-qa"] }
data: { file: data.yaml }
api: { dir: api }
run:
  workers: 1
  headless: true
  stepTimeoutMs: 10000
  candidateTimeoutMs: 2000
  screenshots: never
  trace: false
  outputDir: runs
  checkpoints: false
  audit: true
compile: { confidenceThreshold: 0.8 }
record: { model: "none", maxSnapshotTokens: 4000, visionFallback: false }
heal: { onFail: false, relocalizeThreshold: 0.72, margin: 0.1, useModel: false }
`,
    "utf8",
  );

  const handshake = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [CLI, "serve", project, "--port", "0", "--token", TOKEN],
      { cwd: ROOT, env: { ...process.env, SVATAH_BASE_URL: app.origin } },
    );
    serve = child;
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("`svatah serve` printed no handshake")), 30_000);
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const match = /^svatah serve listening url=(\S+) token=(\S+)$/m.exec(buffer);
      if (match !== null) {
        clearTimeout(timer);
        resolve({ url: match[1], token: match[2] });
      }
    });
    child.on("error", reject);
  });

  process.stderr.write(`service at ${handshake.url} on ${project}\n`);

  const environment = {
    ...process.env,
    SVATAH_SERVICE_URL: handshake.url,
    SVATAH_SERVICE_TOKEN: handshake.token,
    SVATAH_SMOKE_STORY: STORY,
  };

  /** Run one smoke script, inheriting stdio so its own output is the report. */
  const run = (name, command, args, options = {}) =>
    new Promise((done) => {
      process.stdout.write(`\n── ${name} ─────────────────────────────────────────\n`);
      const child = spawn(command, args, { cwd: ROOT, env: environment, stdio: "inherit", ...options });
      child.on("error", (error) => done({ name, status: "failed", why: error.message }));
      child.on("close", (code) =>
        done(code === 0 ? { name, status: "passed" } : { name, status: "failed", why: `exit ${code}` }),
      );
    });

  /* ── Python ─────────────────────────────────────────────────────────────── */

  if (only === undefined || only === "python") {
    if (!has("python3")) {
      results.push({ name: "python", status: "skipped", why: "python3 is not on PATH" });
    } else {
      results.push(await run("python", "python3", [join(ROOT, "clients/python/smoke.py")]));
    }
  }

  /* ── Java ───────────────────────────────────────────────────────────────── */

  if (only === undefined || only === "java") {
    if (!has("javac")) {
      results.push({ name: "java", status: "skipped", why: "javac is not on PATH" });
    } else {
      const classes = mkdtempSync(join(tmpdir(), "svatah-java-smoke-"));
      try {
        const compiled = spawnSync(
          "javac",
          [
            "-d",
            classes,
            join(ROOT, "clients/java/src/main/java/dev/svatah/sdk/GeneratedClient.java"),
            join(ROOT, "clients/java/Smoke.java"),
          ],
          { encoding: "utf8", cwd: ROOT },
        );
        process.stderr.write(compiled.stderr ?? "");
        if (compiled.status !== 0) {
          results.push({ name: "java", status: "failed", why: "javac refused the client" });
        } else {
          results.push(await run("java", "java", ["-cp", classes, "Smoke"]));
        }
      } finally {
        rmSync(classes, { recursive: true, force: true });
      }
    }
  }
} finally {
  serve?.kill("SIGTERM");
  await app.close();
  if (process.env["SVATAH_KEEP_WORKSPACE"] === "1") {
    process.stderr.write(`kept ${project}\n`);
  } else {
    rmSync(project, { recursive: true, force: true });
  }
}

process.stdout.write("\n");
for (const one of results) {
  process.stdout.write(
    `${one.status === "passed" ? "PASS" : one.status === "skipped" ? "SKIP" : "FAIL"}  ` +
      `${one.name}${one.why === undefined ? "" : ` — ${one.why}`}\n`,
  );
}

const failed = results.filter((one) => one.status === "failed");
process.exit(failed.length === 0 ? 0 : 1);
