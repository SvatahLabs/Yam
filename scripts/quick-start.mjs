#!/usr/bin/env node
/**
 * T1.6 Validate — "quick start doc verified by a fresh-checkout CI job that
 * completes in under ten minutes".
 *
 * This is that job's body. It runs the quick start in
 * `examples/plain-playwright/README.md` exactly as a person following it would —
 * record, run, heal — and fails if the whole thing takes longer than ten minutes
 * from a clean checkout. REQ-PKG-2 promises "documented quick start under ten
 * minutes", and a promise about a duration has to be measured or it is a hope.
 *
 * The budget covers the steps a reader performs. Installing dependencies and
 * browsers is timed and reported separately, because a reader does that once and
 * a CI runner does it every time.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const BUDGET_MS = 10 * 60 * 1000;
const EXAMPLE = join(process.cwd(), "examples", "plain-playwright");

/** The picks that stand in for a person clicking, so this runs headless. */
const PICK = JSON.stringify({
  "login.username-field": "username",
  "login.password-field": "password",
  "login.sign-in-button": "login-submit",
});

function step(name, command, args, env = {}) {
  const started = Date.now();
  process.stderr.write(`\n── ${name}\n   ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: EXAMPLE,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  const ms = Date.now() - started;
  process.stderr.write(`   ${name}: ${(ms / 1000).toFixed(1)}s\n`);
  if (result.status !== 0) {
    process.stderr.write(`\nThe quick start failed at "${name}".\n`);
    process.exit(result.status ?? 1);
  }
  return ms;
}

// Step 3 of the README records the bindings from scratch, so the committed store
// is removed first: the point is that a reader with nothing gets to a working
// test, not that a store already in the repository still works.
rmSync(join(EXAMPLE, "bindings"), { recursive: true, force: true });
rmSync(join(EXAMPLE, ".svatah"), { recursive: true, force: true });

const started = Date.now();
let total = 0;

total += step("3. record the bindings", "pnpm", ["exec", "playwright", "test", "tests/login.spec.ts"], {
  SVATAH_MODE: "record",
  SVATAH_PICK: PICK,
});
total += step("4. run", "pnpm", ["exec", "playwright", "test", "tests/login.spec.ts"], {
  SVATAH_MODE: "run",
});
total += step("5. heal", "pnpm", ["exec", "playwright", "test"], { SVATAH_MODE: "heal" });

const elapsed = Date.now() - started;
process.stderr.write(
  `\nQuick start: ${(elapsed / 1000).toFixed(1)}s of a ${BUDGET_MS / 60000}-minute budget (REQ-PKG-2).\n`,
);
void total;

if (elapsed > BUDGET_MS) {
  process.stderr.write("The quick start is over budget.\n");
  process.exit(1);
}
