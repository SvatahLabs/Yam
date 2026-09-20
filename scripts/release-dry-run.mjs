#!/usr/bin/env node
/**
 * The release candidate's tarballs, and what is in them (T7.6,
 * REQ-PKG-1, 2, 3, 4, REQ-STD-1, 2).
 *
 *   node scripts/release-dry-run.mjs [--out release] [--json]
 *
 * ## What "dry run" means here
 *
 * It packs, and it publishes nothing. `npm publish --dry-run` would print a file
 * list and stop; that is not enough for T7.6, whose Validate item is that the
 * **quick start runs from the tarballs** — so real files have to exist for
 * `scripts/quick-start-packed.mjs` to install. Nothing here contacts a registry,
 * and nothing here writes outside `--out`.
 *
 * `pnpm pack` rather than `npm pack`: pnpm rewrites `workspace:*` into the real
 * version on the way out, which is the whole reason the workspace protocol is
 * safe to use. An `npm pack` of these packages would ship `"@svatah/yam-schema":
 * "workspace:*"` to a registry that has never heard of the protocol.
 *
 * ## The three sets, and why they are separate
 *
 * - **Module (a)** — `@svatah/yam-bindings`, `@svatah/yam-healer`,
 *   `@svatah/yam-playwright-test`, `@svatah/yam-bindings-cli`: the adoption wedge. A
 *   Playwright user installs these and nothing else (REQ-PKG-1), which is the
 *   claim the packed quick start checks.
 * - **The `yam` CLI** — module (b), which is everything.
 * - **`@svatah/yam-schema`** — the published contract (REQ-STD-1): the generated
 *   JSON Schemas, and the conformance fixtures a third party needs to check
 *   their own runtime against (REQ-STD-2, LLD §14).
 *
 * Each set's *transitive* workspace dependencies are packed with it, because a
 * tarball whose dependencies are not on any registry cannot be installed on its
 * own — and being installable from the tarballs alone is the thing being tested.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SETS, closureOf, workspacePackages } from "./lib/release-packages.mjs";

export { SETS, closureOf };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/*
 * The version every tarball must carry, read rather than written down.
 *
 * This said `0.1.0`, so the first release after a bump failed with 35
 * problems about the version the bump had just set — and it failed in the job
 * that gates publishing, on a workspace that was otherwise ready.
 */
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const out = resolve(ROOT, option("out", "release"));
const asJson = args.includes("--json");

/*
 * The set definitions and the dependency closure live in `scripts/lib` so that
 * `scripts/publish.mjs` can ask which packages a release is made of without
 * importing this file and packing twenty-six tarballs as a side effect (T8.5).
 */
const byName = workspacePackages();

/* ── 1. pack ──────────────────────────────────────────────────────────────── */

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const everything = [...new Set(Object.values(SETS).flatMap((roots) => closureOf(roots, byName)))].sort();
const tarballs = new Map();

for (const name of everything) {
  const { dir, manifest } = byName.get(name);
  if (manifest.private === true) {
    process.stderr.write(`${name} is private and is not packed.\n`);
    continue;
  }
  const packed = spawnSync("pnpm", ["pack", "--pack-destination", out], {
    cwd: dir,
    encoding: "utf8",
  });
  if (packed.status !== 0) {
    process.stderr.write(`pnpm pack failed for ${name}:\n${packed.stdout}${packed.stderr}\n`);
    process.exit(1);
  }
  const file = packed.stdout.trim().split("\n").pop().trim();
  tarballs.set(name, resolve(out, file));
}

/* ── 2. what is in them ───────────────────────────────────────────────────── */

const contents = new Map();
for (const [name, file] of tarballs) {
  const listing = execFileSync("tar", ["-tzf", file], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line !== "" && !line.endsWith("/"))
    .map((line) => line.replace(/^package\//, ""))
    .sort();
  contents.set(name, listing);
}

/* ── 3. the claims T7.6 makes about them ──────────────────────────────────── */

const failures = [];
const claim = (ok, message) => {
  if (!ok) failures.push(message);
};

for (const [name, listing] of contents) {
  claim(listing.includes("package.json"), `${name}: no package.json`);
  claim(listing.includes("README.md"), `${name}: no README.md — a published package explains itself`);
  /*
   * Apache-2.0 §4(a): "You must give any other recipients of the Work a copy of
   * this License." The manifest saying `"license": "Apache-2.0"` is a label, not
   * a copy. Every one of these packages carried the label and none carried the
   * text, so every tarball was a licence breach the manifest check could not see.
   */
  claim(listing.includes("LICENSE"), `${name}: no LICENSE — the manifest claims Apache-2.0 and the tarball does not carry it`);
  claim(
    listing.some((file) => file.startsWith("dist/") && file.endsWith(".js")),
    `${name}: no built JavaScript`,
  );
  claim(
    listing.some((file) => file.endsWith(".d.ts")),
    `${name}: no type declarations`,
  );
  // Nothing from the workspace that a consumer must not receive.
  claim(!listing.some((file) => file.startsWith("test/")), `${name}: ships its tests`);
  claim(!listing.some((file) => file.endsWith(".tsbuildinfo")), `${name}: ships build state`);

  const manifest = JSON.parse(
    execFileSync("tar", ["-xzOf", tarballs.get(name), "package/package.json"], { encoding: "utf8" }),
  );
  claim(manifest.version === VERSION, `${name}: version is ${manifest.version}, not ${VERSION}`);
  claim(manifest.license === "Apache-2.0", `${name}: licence is ${manifest.license}`);
  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    // The one thing `pnpm pack` is for: no `workspace:` escapes into a tarball.
    claim(
      !String(range).startsWith("workspace:"),
      `${name}: dependency ${dependency} is still "${range}" — a registry cannot resolve that`,
    );
  }
}

/*
 * `@svatah/yam-schema` is the published contract (REQ-STD-1, T7.6): "the JSON Schema
 * files and the conformance fixtures included". Both are checked by name,
 * because both are things a third party downloads this package *for*.
 */
const schema = contents.get("@svatah/yam-schema") ?? [];
claim(
  schema.some((file) => file.startsWith("json/") && file.endsWith(".schema.json")),
  "@svatah/yam-schema: no generated JSON Schemas",
);
for (const required of [
  // The three a foreign runtime is held to (LLD §14): the step IR it executes,
  // and the two artifacts it writes.
  "json/ir.schema.json",
  "json/results.schema.json",
  "json/summary.schema.json",
]) {
  claim(schema.includes(required), `@svatah/yam-schema: ${required} is missing`);
}
for (const required of [
  "conformance/runtime/results.jsonl",
  "conformance/runtime/summary.json",
  "conformance/runtime/plan.sha256",
  // The README is what says the fixture is a *projection* and not itself valid
  // against the schemas beside it — the distinction that cost Phase 6 a false
  // conformance result (F2).
  "conformance/runtime/README.md",
]) {
  claim(schema.includes(required), `@svatah/yam-schema: ${required} is missing (REQ-STD-2, LLD §14)`);
}

/* ── 4. say what happened ─────────────────────────────────────────────────── */

const report = {
  packedAt: new Date().toISOString(),
  out,
  sets: Object.fromEntries(
    Object.entries(SETS).map(([set, roots]) => [set, closureOf(roots, byName)]),
  ),
  tarballs: Object.fromEntries(
    [...tarballs].map(([name, file]) => [
      name,
      {
        file: file.slice(out.length + 1),
        bytes: statSync(file).size,
        files: contents.get(name).length,
        contents: contents.get(name),
      },
    ]),
  ),
  failures,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  for (const [set, names] of Object.entries(report.sets)) {
    process.stdout.write(`\n${set}\n`);
    for (const name of names) {
      const one = report.tarballs[name];
      if (one === undefined) continue;
      process.stdout.write(`  ${one.file}  (${one.files} files, ${(one.bytes / 1024).toFixed(1)} KiB)\n`);
      for (const file of one.contents) process.stdout.write(`      ${file}\n`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} problem(s) with the packed tarballs:\n`);
  for (const one of failures) process.stderr.write(`  - ${one}\n`);
  process.exit(1);
}

process.stderr.write(`\n${tarballs.size} tarball(s) in ${out}; nothing was published.\n`);
