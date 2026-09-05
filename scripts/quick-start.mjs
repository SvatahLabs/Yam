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
 *
 * ## It records into a temporary store, and proves it (P1-F3)
 *
 * Step 3 records bindings from scratch, so this used to delete
 * `examples/plain-playwright/bindings` and write new ones over it. That left the
 * working tree dirty every time anyone ran the quick start, and a check that
 * dirties the repository is a check people stop running. It also meant the
 * committed store — the thing a reader actually looks at — was whatever the last
 * run happened to produce.
 *
 * So the recording goes to a temporary directory outside the repository, and the
 * script asserts afterwards that `git status --porcelain examples/` is empty. The
 * assertion is the point: without it the property would hold until the next time
 * something wrote a file, and nobody would notice.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUDGET_MS = 10 * 60 * 1000;
const EXAMPLE = join(process.cwd(), "examples", "plain-playwright");

/** Where the quick start's own store goes, so the committed one is untouched. */
const WORKSPACE = mkdtempSync(join(tmpdir(), "svatah-quick-start-"));

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
    env: {
      ...process.env,
      SVATAH_BINDINGS: join(WORKSPACE, "bindings"),
      SVATAH_OUT: join(WORKSPACE, ".svatah"),
      ...env,
    },
  });
  const ms = Date.now() - started;
  process.stderr.write(`   ${name}: ${(ms / 1000).toFixed(1)}s\n`);
  if (result.status !== 0) {
    process.stderr.write(`\nThe quick start failed at "${name}".\n`);
    process.exit(result.status ?? 1);
  }
  return ms;
}

/** `git status --porcelain examples/`, or exit with why it could not be read. */
function exampleStatus() {
  const result = spawnSync("git", ["status", "--porcelain", "examples/"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(`\nCould not check the working tree: ${result.stderr ?? ""}\n`);
    process.exit(1);
  }
  return result.stdout.trim();
}

// Taken before, and compared after. Comparing against *empty* would fail for
// anyone with unrelated edits in `examples/` — including whoever is changing the
// example — and a check that fires on unrelated work gets switched off.
const statusBefore = exampleStatus();

// Step 3 of the README records the bindings from scratch. The temporary
// workspace starts empty, which is the reader's situation: nothing recorded yet.
// The committed store is not touched, and not read.
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

rmSync(WORKSPACE, { recursive: true, force: true });

/*
 * The quick start must leave no trace (P1-F3). This is checked, not assumed: a
 * fixture written to the wrong directory, a report dropped beside the tests, or
 * a store re-recorded in place would all show up here and nowhere else.
 */
const statusAfter = exampleStatus();
if (statusAfter !== statusBefore) {
  const before = new Set(statusBefore.split("\n"));
  const added = statusAfter
    .split("\n")
    .filter((line) => line !== "" && !before.has(line))
    .join("\n");
  process.stderr.write(
    `\nThe quick start changed files under examples/:\n${added}\n\n` +
      "It records into a temporary store precisely so it does not. Something wrote " +
      "into the repository — find it rather than committing the result.\n",
  );
  process.exit(1);
}
process.stderr.write(
  statusBefore === ""
    ? "examples/ is unchanged.\n"
    : "examples/ is unchanged by the quick start (it had uncommitted edits before it ran).\n",
);

if (elapsed > BUDGET_MS) {
  process.stderr.write("The quick start is over budget.\n");
  process.exit(1);
}
