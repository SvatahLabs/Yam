#!/usr/bin/env node
/**
 * Publish 0.1.0 — or, by default, say exactly what publishing would do (T8.5,
 * REQ-PKG-1, 2, 3, 4, REQ-STD-1, 2, LLD §16).
 *
 * ```
 * node scripts/publish.mjs                 # dry run: prints the commands, contacts nothing
 * node scripts/publish.mjs --publish       # the real thing; needs a manual trigger and a token
 * ```
 *
 * ## What this is for
 *
 * T8.5 splits the work between two people on purpose: "the implementer prepares
 * and dry-runs it; the owner triggers it." So this script has to be provable
 * *without* a token — a pipeline nobody can run until the day it matters is a
 * pipeline nobody has tested — and it has to be impossible to fire by accident.
 *
 * The dry run is therefore the default and the whole of it is real work: it
 * reads the packed tarballs, checks every version against `CHANGELOG.md`, orders
 * the packages so a dependency is published before its dependents, and prints
 * the exact `npm publish` command for each. The only thing it does not do is run
 * them.
 *
 * ## The three guards, and why each is separate
 *
 * `--publish` alone is not enough. All three of these must hold:
 *
 * 1. **`--publish` was passed.** A default that published would be a script that
 *    publishes when somebody runs it to see what it does.
 * 2. **A manual trigger.** A GitHub `workflow_dispatch` (Draft 2.18: GitHub Actions
 *    is the only CI). A push to a branch must never publish, and
 *    the guard is here rather than only in the YAML so that a copied step cannot
 *    lose it.
 * 3. **A publish identity.** Either the workflow's OIDC identity — npm's trusted
 *    publishing, which GitHub exposes as `ACTIONS_ID_TOKEN_REQUEST_URL` when the
 *    job has `id-token: write` (Draft 2.18, T13.1) — or, as the fallback, an
 *    `NPM_TOKEN` supplied as a secret. A token is read, used as an environment
 *    variable for the child process, and never written to a file, a log, or
 *    `.npmrc` — nothing in this repository has ever contained a credential and
 *    this is not where that changes (REQ-NFR-6). Provenance is attached when the
 *    identity is the workflow's, because then there is something to attest.
 *
 * A missing guard is an exit code and a sentence about which one, not a warning
 * followed by a publish.
 *
 * ## What is published
 *
 * The tarballs `pnpm release:dry-run` wrote — the same bytes the packed quick
 * start installed and the licence check checked — never a fresh `npm publish
 * <dir>`. Publishing a directory would publish whatever is on disk now; a
 * tarball is the artefact that was tested.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT, publishablePackages, tarballName, workspacePackages } from "./lib/release-packages.mjs";
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const releaseDir = resolve(ROOT, option("out", "release"));
const wantsPublish = args.includes("--publish");
const asJson = args.includes("--json");

const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

/* ── the packages, in an order a registry will accept ─────────────────────── */

const byName = workspacePackages();
const publishable = publishablePackages(byName);

/* ── the version, from the one file that is allowed to say it ─────────────── */

const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
const released = /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog)?.[1];
if (released === undefined) {
  die("CHANGELOG.md has no `## [x.y.z]` heading, so there is no version to publish.");
}

const wrongVersion = publishable.filter((name) => byName.get(name).manifest.version !== released);
if (wrongVersion.length > 0) {
  die(
    `These packages are not at ${released}, which CHANGELOG.md says is being released:\n  ` +
      wrongVersion.map((name) => `${name}@${byName.get(name).manifest.version}`).join("\n  ") +
      "\nEvery package in this workspace releases together (CHANGELOG.md).",
  );
}

/* ── the tarballs, which must already exist ───────────────────────────────── */

const tarballFor = (name) => join(releaseDir, tarballName(name, released));

const missing = publishable.filter((name) => !existsSync(tarballFor(name)));
if (missing.length > 0) {
  die(
    `No tarball for ${missing.length} package(s) under ${releaseDir}:\n  ` +
      missing.map((name) => tarballFor(name)).join("\n  ") +
      "\nRun `pnpm release:dry-run` first. This publishes the artefact that was tested, " +
      "never a fresh pack of whatever is on disk now.",
  );
}

/** The exact command each package would be published with. */
const commands = publishable.map((name) => ({
  name,
  version: released,
  tarball: tarballFor(name).slice(ROOT.length + 1),
  command: `npm publish ${tarballFor(name).slice(ROOT.length + 1)} --access public`,
}));

/* ── the three guards ─────────────────────────────────────────────────────── */

const manualTrigger = process.env["GITHUB_EVENT_NAME"] === "workflow_dispatch";
const hasToken = (process.env["NPM_TOKEN"] ?? "") !== "";
const hasOidc =
  process.env["GITHUB_ACTIONS"] === "true" && (process.env["ACTIONS_ID_TOKEN_REQUEST_URL"] ?? "") !== "";
const hasIdentity = hasToken || hasOidc;

const refusals = [];
if (!wantsPublish) refusals.push("`--publish` was not passed (this is a dry run)");
if (!manualTrigger) {
  refusals.push(
    "there is no manual trigger: this is not a GitHub `workflow_dispatch`",
  );
}
if (!hasIdentity) {
  refusals.push("there is no publish identity: neither trusted publishing (id-token) nor NPM_TOKEN");
}

if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        version: released,
        packages: commands.length,
        commands: commands.map((one) => one.command),
        wouldPublish: refusals.length === 0,
        refusals,
      },
      null,
      2,
    )}\n`,
  );
} else {
  process.stdout.write(
    `yam ${released} — ${commands.length} package(s) under @svatah, in dependency order.\n\n`,
  );
  for (const one of commands) process.stdout.write(`  ${one.command}\n`);
  process.stdout.write(
    "\nThen, from the release job:\n" +
      "  the app installers from apps/desktop/out/make/** and reports/*.md are attached to the release.\n\n",
  );
}

if (refusals.length > 0) {
  process.stderr.write(
    `Nothing was published. ${refusals.length === 1 ? "The reason" : "The reasons"}:\n  ` +
      refusals.map((one) => `• ${one}`).join("\n  ") +
      "\n\nT8.5: the implementer prepares and dry-runs this; the owner triggers it.\n",
  );
  // A dry run that did what it was asked exits 0. A `--publish` that could not
  // is a failure, and the difference is what a pipeline reads.
  process.exit(wantsPublish ? 1 : 0);
}

/* ── the real thing ───────────────────────────────────────────────────────── */

process.stderr.write(`publishing ${commands.length} package(s) at ${released}…\n`);
for (const one of commands) {
  const result = spawnSync(
    "npm",
    ["publish", tarballFor(one.name), "--access", "public", ...(hasOidc ? ["--provenance"] : [])],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        // A token, when that is the identity, reaches npm as an environment
        // variable and nothing else. No `.npmrc` is written, so nothing can be
        // left behind on the runner. Under trusted publishing npm mints its own
        // short-lived credential from the job's OIDC token.
        NPM_CONFIG_PROVENANCE: hasOidc ? "true" : "false",
        npm_config__auth: undefined,
        NODE_AUTH_TOKEN: hasOidc ? undefined : process.env["NPM_TOKEN"],
      },
    },
  );
  if (result.status !== 0) {
    die(
      `npm publish failed for ${one.name}. ${commands.indexOf(one)} package(s) were published ` +
        "before it; the rest are not. Fix the cause and re-run — npm refuses a version that " +
        "is already there, so a re-run is safe.",
    );
  }
}
process.stderr.write(`published ${commands.length} package(s) at ${released}.\n`);
