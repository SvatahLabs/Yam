#!/usr/bin/env node
/**
 * The examples run (T5.6's Validate, REQ-AGT-4).
 *
 *   node scripts/examples-check.mjs
 *
 * An example nobody runs is documentation that drifts. Two of the four can be
 * run — `examples/cron/book.sh` and `examples/mcp-agent/` both drive the sample
 * application — and the two CI examples are workflow files for other people's
 * runners, so what can be checked about them is that they are valid YAML naming
 * the commands the README says they do.
 *
 * `plain-playwright` has its own suite (`pnpm quick-start`) and is not repeated
 * here.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { startSampleApp } from "sample-web";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SECRETS = {
  YAM_SAMPLE_PASSWORD: "qwerty123",
  YAM_SAMPLE_CARD_NUMBER: "5123456789012346",
  YAM_SAMPLE_CARD_CVV: "123",
};

function run(command, args, env = {}) {
  return new Promise((done) => {
    let output = "";
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...SECRETS, ...env },
    });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ status: code ?? 1, output }));
  });
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === "" ? "" : `\n${detail}`}`);
  if (!ok) failures += 1;
};

/* ── the two CI examples: valid YAML, naming the commands ─────────────────── */

for (const [file, wanted] of [
  ["examples/ci/github-actions.yml", ["yam compile --stable", "yam run --host playwright"]],
  ["examples/ci/gitlab-ci.yml", ["yam compile --stable", "yam run --host playwright"]],
]) {
  const text = readFileSync(join(ROOT, file), "utf8");
  let parsed;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    check(`${file} parses`, false, String(error));
    continue;
  }
  check(`${file} parses`, parsed !== null && typeof parsed === "object");
  for (const command of wanted) {
    check(`${file} runs \`${command}\``, text.includes(command));
  }
}

/* ── the two runnable examples ────────────────────────────────────────────── */

const app = await startSampleApp(0);
console.log(`sample-web on ${app.origin}`);

try {
  const cron = await run("bash", [join(ROOT, "examples", "cron", "book.sh")], {
    YAM_BASE_URL: app.origin,
    LOCATION: "Indiranagar",
  });
  check(
    "examples/cron/book.sh books a slot and prints the output",
    cron.status === 0 && /booked: Slot booked\./.test(cron.output),
    cron.output.slice(-1500),
  );

  const agent = await run(
    process.execPath,
    [join(ROOT, "examples", "mcp-agent", "call-a-tool.mjs"), "evals/fixtures"],
    { YAM_BASE_URL: app.origin },
  );
  check(
    "examples/mcp-agent calls a story as a tool over MCP",
    agent.status === 0 &&
      /book_a_slot → passed/.test(agent.output) &&
      /"booking":"Slot booked\."/.test(agent.output),
    agent.output.slice(-1500),
  );
} finally {
  await app.close();
}

if (failures > 0) {
  console.error(`\n${failures} example check(s) failed.`);
  process.exit(1);
}
console.log("\nEvery example runs.");
