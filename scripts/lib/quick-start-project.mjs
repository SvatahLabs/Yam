/**
 * The module (a) quick start in an empty project, twice over (T7.6, T12.5,
 * REQ-PKG-1, REQ-PKG-2).
 *
 * Two scripts run the same five minutes of a reader's life and differ in one
 * line — where the four packages come from:
 *
 *   `scripts/quick-start-packed.mjs`    from tarballs this checkout just packed
 *   `scripts/quick-start-registry.mjs`  from the registry, by version
 *
 * Everything after `npm install` is identical, and it has to be: the claim
 * REQ-PKG-2 makes is about the *reader's* experience, and two copies of it
 * would be two claims that drift. So the scaffolding, the three steps, the
 * licence check over the installed tree and the ten-minute budget live here,
 * and each script decides only what to depend on.
 *
 * ## What is and is not "empty"
 *
 * `npm init` plus `@playwright/test` plus the four packages. Not a copy of
 * `examples/plain-playwright`: the spec file is copied because a reader copies
 * it out of the README, and everything else — the config, the package.json — is
 * written here, minimal, the way the README describes it.
 *
 * The sample application is served from *this* repository and reached over
 * `SVATAH_BASE_URL`, which is what the example's own README says a real project
 * does. Pulling `sample-web` into the empty project would put a workspace
 * package back into the thing being tested.
 */
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** REQ-PKG-2's budget: "documented quick start under ten minutes". */
export const BUDGET_MS = 10 * 60 * 1000;

/** The four packages REQ-PKG-1 says a Playwright user installs. */
export const MODULE_A = [
  "@svatah/bindings",
  "@svatah/healer",
  "@svatah/playwright-test",
  "@svatah/bindings-cli",
];

/** The picks that stand in for a person clicking, so this runs headless. */
export const PICK = JSON.stringify({
  "login.username-field": "username",
  "login.password-field": "password",
  "login.sign-in-button": "login-submit",
});

export const say = (text) => process.stderr.write(`${text}\n`);

export const npm = process.platform === "win32" ? "npm.cmd" : "npm";

/** The Playwright version this workspace pins, so the peer range is satisfied. */
export function playwrightVersion() {
  return JSON.parse(
    readFileSync(
      join(ROOT, "examples", "plain-playwright", "node_modules", "@playwright", "test", "package.json"),
      "utf8",
    ),
  ).version;
}

/**
 * An empty Playwright project that depends on module (a), and nothing else.
 *
 * `dependencies` is the caller's — `{ "@svatah/bindings": "0.1.0" }` from the
 * registry, or a `file:` path per tarball — and `overrides` is how a tarball
 * install redirects the *transitive* `@svatah/*` names a registry does not have.
 * A registry install passes none, which is the point of the difference.
 */
export function scaffold({ prefix, dependencies, overrides = {} }) {
  const project = mkdtempSync(join(tmpdir(), prefix));
  say(`── an empty project at ${project}`);

  writeFileSync(
    join(project, "package.json"),
    `${JSON.stringify(
      {
        name: "svatah-quick-start",
        version: "0.0.0",
        private: true,
        type: "module",
        dependencies,
        devDependencies: { "@playwright/test": playwrightVersion() },
        ...(Object.keys(overrides).length === 0 ? {} : { overrides }),
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
  return project;
}

/**
 * One step, awaited rather than `spawnSync`.
 *
 * `spawnSync` blocks this process's event loop, and the sample application is
 * served *by* this process — so a synchronous child could not be answered by
 * the server it was told to drive, and every `page.goto` came back
 * `net::ERR_ABORTED`. Async, and the loop stays free to serve.
 */
export async function step(project, name, command, commandArgs, env = {}) {
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
  return { status, ms };
}

/**
 * Install, record, run, heal, and check the licences of what was installed.
 *
 * Returns the wall time of the reader's three steps — install and browsers are
 * not in it, because a reader has both already or waits for them once.
 */
export async function runQuickStart(project, { label, keep }) {
  const { startSampleApp } = await import("sample-web");

  const must = async (...args) => {
    const { status, ms } = await step(project, ...args);
    if (status !== 0) {
      say(`\nThe ${label} quick start failed at "${args[0]}".`);
      if (!keep) rmSync(project, { recursive: true, force: true });
      process.exit(status);
    }
    return ms;
  };

  await must("install", npm, ["install", "--no-audit", "--no-fund", "--loglevel", "error"]);
  await must("browsers", npm, ["exec", "--", "playwright", "install", "chromium"]);

  const app = await startSampleApp(0);
  say(`\n── the sample application is at ${app.origin}`);

  const bindings = join(project, "bindings");
  const shared = {
    SVATAH_BASE_URL: app.origin,
    SVATAH_BINDINGS: bindings,
    SVATAH_OUT: join(project, ".svatah"),
  };

  const started = Date.now();
  try {
    await must("3. record the bindings", npm, ["exec", "--", "playwright", "test", "tests/login.spec.ts"], {
      ...shared,
      SVATAH_MODE: "record",
      SVATAH_PICK: PICK,
    });
    await must("4. run", npm, ["exec", "--", "playwright", "test", "tests/login.spec.ts"], {
      ...shared,
      SVATAH_MODE: "run",
    });
    await must("5. heal", npm, ["exec", "--", "playwright", "test"], { ...shared, SVATAH_MODE: "heal" });
  } finally {
    await app.close();
  }
  const elapsed = Date.now() - started;

  /*
   * REQ-PKG-3 over the tree a reader actually installs, which is the tree the
   * requirement is about — not the workspace's own dependencies.
   */
  await must("licences of the installed tree (REQ-PKG-3)", process.execPath, [
    join(ROOT, "scripts", "check-licenses.mjs"),
    "--tree",
    project,
  ]);

  const recorded = readdirSync(join(bindings, "login")).sort();
  say(`\nRecorded ${recorded.length} binding(s) in the empty project: ${recorded.join(", ")}`);
  if (recorded.length !== 3) {
    say("The quick start recorded a different number of bindings than the README describes.");
    if (!keep) rmSync(project, { recursive: true, force: true });
    process.exit(1);
  }
  return elapsed;
}

/** Say how it went, tidy up, and exit non-zero when it was over budget. */
export function finish(project, elapsed, { label, keep, from }) {
  say(
    `\n${label} quick start: ${(elapsed / 1000).toFixed(1)}s of a ${BUDGET_MS / 60000}-minute ` +
      `budget (REQ-PKG-2), on Node ${process.version}, ${from}, with no credential.`,
  );
  if (keep) say(`kept ${project}`);
  else rmSync(project, { recursive: true, force: true });
  if (elapsed > BUDGET_MS) {
    say(`The ${label} quick start is over budget.`);
    process.exit(1);
  }
}
