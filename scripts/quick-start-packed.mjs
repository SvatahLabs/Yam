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
 * ## And beside `scripts/quick-start-registry.mjs`
 *
 * That one installs the same four packages *by version from the registry*, once
 * the owner has published (T12.5). It is the same five minutes; the difference
 * is one line of `package.json`, and both share everything after `npm install`
 * through `scripts/lib/quick-start-project.mjs` — two copies of a claim about a
 * reader's experience would be two claims that drift.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  MODULE_A,
  ROOT,
  finish,
  runQuickStart,
  say,
  scaffold,
} from "./lib/quick-start-project.mjs";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const RELEASE = join(ROOT, "release");

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

/*
 * Every `@svatah/*` tarball, not only the four: a tarball's dependencies name
 * versions no registry has, so the transitive ones have to be redirected too.
 * `overrides` is npm's way of saying "resolve this name to this file wherever it
 * appears", and it is what makes an install with nothing published possible.
 */
const project = scaffold({
  prefix: "svatah-packed-",
  dependencies: Object.fromEntries(MODULE_A.map((name) => [name, `file:${tarballs.get(name)}`])),
  overrides: Object.fromEntries([...tarballs].map(([name, file]) => [name, `file:${file}`])),
});

/* ── 3. the reader's five minutes ─────────────────────────────────────────── */

const elapsed = await runQuickStart(project, { label: "Packed", keep });
finish(project, elapsed, { label: "Packed", keep, from: `from ${tarballs.size} tarball(s)` });
