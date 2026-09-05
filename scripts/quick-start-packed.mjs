#!/usr/bin/env node
/**
 * The module (a) quick start, from the packed tarballs, in an empty Playwright
 * project (T7.6, REQ-PKG-1, REQ-PKG-2).
 *
 *   node scripts/quick-start-packed.mjs [--reuse] [--keep]
 *
 * ## Why this exists beside `scripts/quick-start.mjs`
 *
 * That one runs the quick start inside this workspace, where every `@svatah/*`
 * import resolves to a directory on disk through pnpm's links. It measures the
 * ten-minute budget honestly and it cannot measure the thing REQ-PKG-1 actually
 * promises: that a Playwright user who has never seen this repository can
 * `npm install` four packages and be running.
 *
 * A workspace hides exactly the failures that matter to that promise — a missing
 * `files` entry, a `dist` that was never built, a `workspace:*` that escaped
 * into a tarball, a dependency that only resolves because a sibling package
 * happens to be hoisted. So this one packs, installs into a directory outside
 * the repository with **no** relationship to it, and runs the quick start there.
 *
 * ## What is and is not "empty"
 *
 * The project is `npm init` plus `@playwright/test` plus the tarballs. It is not
 * a copy of `examples/plain-playwright`: the spec file is copied because a
 * reader copies it out of the README, and everything else — the config, the
 * package.json — is written here, minimal, the way the README describes it.
 *
 * The sample application is served from *this* repository and reached over
 * `SVATAH_BASE_URL`, which is what the example's own README says a real project
 * does: "a real project points `baseURL` at whatever it already runs". Pulling
 * `sample-web` into the empty project would put a workspace package back into
 * the thing being tested.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp } from "sample-web";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const RELEASE = join(ROOT, "release");
const BUDGET_MS = 10 * 60 * 1000;

/** The four packages REQ-PKG-1 says a Playwright user installs. */
const MODULE_A = [
  "@svatah/bindings",
  "@svatah/healer",
  "@svatah/playwright-test",
  "@svatah/bindings-cli",
];

/** The picks that stand in for a person clicking, so this runs headless. */
const PICK = JSON.stringify({
  "login.username-field": "username",
  "login.password-field": "password",
  "login.sign-in-button": "login-submit",
});

const say = (text) => process.stderr.write(`${text}\n`);

/* ── 1. the tarballs ──────────────────────────────────────────────────────── */

if (!args.includes("--reuse")) {
  say("── packing");
  const packed = spawnSync(process.execPath, [join(ROOT, "scripts", "release-dry-run.mjs")], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (packed.status !== 0) {
    say("The release dry run failed, so there is nothing to install from.");
    process.exit(packed.status ?? 1);
  }
}

const tarballs = new Map();
for (const file of readdirSync(RELEASE)) {
  if (!file.endsWith(".tgz")) continue;
  const manifest = JSON.parse(
    spawnSync("tar", ["-xzOf", join(RELEASE, file), "package/package.json"], {
      encoding: "utf8",
    }).stdout,
  );
  tarballs.set(manifest.name, join(RELEASE, file));
}
for (const name of MODULE_A) {
  if (!tarballs.has(name)) {
    say(`No tarball for ${name}. Run \`pnpm release:dry-run\` first.`);
    process.exit(1);
  }
}

/* ── 2. an empty project ──────────────────────────────────────────────────── */

const project = mkdtempSync(join(tmpdir(), "svatah-packed-"));
say(`── an empty project at ${project}`);

/*
 * Every `@svatah/*` tarball, not only the four: a tarball's dependencies name
 * versions no registry has, so the transitive ones have to be redirected too.
 * `overrides` is npm's way of saying "resolve this name to this file wherever it
 * appears", and it is what makes an install with nothing published possible.
 */
const overrides = Object.fromEntries([...tarballs].map(([name, file]) => [name, `file:${file}`]));

/* The Playwright version this workspace pins, so the peer range is satisfied. */
const playwrightVersion = JSON.parse(
  readFileSync(join(ROOT, "examples", "plain-playwright", "node_modules", "@playwright", "test", "package.json"), "utf8"),
).version;

writeFileSync(
  join(project, "package.json"),
  `${JSON.stringify(
    {
      name: "svatah-packed-quick-start",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: Object.fromEntries(MODULE_A.map((name) => [name, `file:${tarballs.get(name)}`])),
      devDependencies: { "@playwright/test": playwrightVersion },
      overrides,
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(project, "playwright.config.ts"),
  `import { defineConfig, devices } from "@playwright/test";

// The whole configuration a reader writes: a base URL and a project. Nothing
// here is Svatah-specific (REQ-PKG-2).
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: process.env["SVATAH_BASE_URL"],
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
`,
);

mkdirSync(join(project, "tests"), { recursive: true });
cpSync(
  join(ROOT, "examples", "plain-playwright", "tests", "login.spec.ts"),
  join(project, "tests", "login.spec.ts"),
);

/* ── 3. install, from the tarballs and the registry and nothing else ──────── */

/**
 * One step, awaited rather than `spawnSync`.
 *
 * `spawnSync` blocks this process's event loop, and the sample application is
 * served *by* this process — so a synchronous child could not be answered by
 * the server it was told to drive, and every `page.goto` came back
 * `net::ERR_ABORTED`. Async, and the loop stays free to serve.
 */
const step = async (name, command, commandArgs, env = {}) => {
  const started = Date.now();
  say(`\n── ${name}\n   ${command} ${commandArgs.join(" ")}`);
  const status = await new Promise((done) => {
    const child = spawn(command, commandArgs, {
      cwd: project,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("error", () => done(1));
    child.on("close", (code) => done(code ?? 1));
  });
  const ms = Date.now() - started;
  say(`   ${name}: ${(ms / 1000).toFixed(1)}s`);
  if (status !== 0) {
    say(`\nThe packed quick start failed at "${name}".`);
    if (!args.includes("--keep")) rmSync(project, { recursive: true, force: true });
    process.exit(status);
  }
  return ms;
};

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
await step("install", npm, ["install", "--no-audit", "--no-fund", "--loglevel", "error"]);
await step("browsers", npm, ["exec", "--", "playwright", "install", "chromium"]);

/* ── 4. the application this drives ───────────────────────────────────────── */

const app = await startSampleApp(0);
say(`\n── the sample application is at ${app.origin}`);

/* ── 5. record, run, heal — the reader's three steps ──────────────────────── */

const bindings = join(project, "bindings");
const shared = { SVATAH_BASE_URL: app.origin, SVATAH_BINDINGS: bindings, SVATAH_OUT: join(project, ".svatah") };

const started = Date.now();
try {
  await step("3. record the bindings", npm, ["exec", "--", "playwright", "test", "tests/login.spec.ts"], {
    ...shared,
    SVATAH_MODE: "record",
    SVATAH_PICK: PICK,
  });
  await step("4. run", npm, ["exec", "--", "playwright", "test", "tests/login.spec.ts"], {
    ...shared,
    SVATAH_MODE: "run",
  });
  await step("5. heal", npm, ["exec", "--", "playwright", "test"], { ...shared, SVATAH_MODE: "heal" });
} finally {
  await app.close();
}
const elapsed = Date.now() - started;

/* ── 6. the licences of what was installed (REQ-PKG-3) ───────────────────── */

/*
 * T7.6: "the licence check passes on the packed dependency trees". The
 * workspace's own check covers what this repository develops against; this is
 * what a reader actually installs, which is the tree the requirement is about.
 */
await step("licences of the installed tree (REQ-PKG-3)", process.execPath, [
  join(ROOT, "scripts", "check-licenses.mjs"),
  "--tree",
  project,
]);

/* ── 7. what it produced ──────────────────────────────────────────────────── */

const recorded = readdirSync(join(bindings, "login")).sort();
say(`\nRecorded ${recorded.length} binding(s) in the empty project: ${recorded.join(", ")}`);
if (recorded.length !== 3) {
  say("The quick start recorded a different number of bindings than the README describes.");
  process.exit(1);
}

say(
  `\nPacked quick start: ${(elapsed / 1000).toFixed(1)}s of a ${BUDGET_MS / 60000}-minute budget ` +
    `(REQ-PKG-2), on Node ${process.version}, from ${tarballs.size} tarball(s), with no credential.`,
);

if (args.includes("--keep")) say(`kept ${project}`);
else rmSync(project, { recursive: true, force: true });

if (elapsed > BUDGET_MS) {
  say("The packed quick start is over budget.");
  process.exit(1);
}
