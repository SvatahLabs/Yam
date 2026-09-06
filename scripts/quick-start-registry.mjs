#!/usr/bin/env node
/**
 * The module (a) quick start, **from the registry, by version** (T12.5,
 * REQ-PKG-1, REQ-PKG-2, REQ-PKG-4).
 *
 *   node scripts/quick-start-registry.mjs [--version 0.1.0] [--keep]
 *
 * T12.5: "Add `scripts/quick-start-registry.mjs`, which installs the four
 * module (a) packages by version from the registry into an empty Playwright
 * project and runs the quick start." Its Validate: "the registry quick start
 * passes on Node 22 and the current LTS after the publish; **until the owner
 * publishes, the script runs in tarball mode and says so**".
 *
 * ## The two modes, and why the fallback is not a stub
 *
 * `scripts/quick-start-packed.mjs` already proves that four tarballs install
 * into an empty project and work. What this proves is the *last* thing nobody
 * can test before a publish: that the versions on the registry are installable
 * by name, that their dependency ranges resolve against what is published
 * beside them, and that no `workspace:*` or `file:` escaped into what was
 * uploaded.
 *
 * None of that can be asked of a registry that has nothing. So this asks first
 * — `npm view <name>@<version>` for each of the four — and when the answer is
 * "no such version" it says so plainly and runs the packed quick start instead,
 * exiting 0. That is not the same claim and the output does not pretend it is:
 * it prints which mode it took, and the report line names it.
 *
 * A publish is the owner's action (T12.5, and the decision recorded in the
 * Phase 12 prompt). This script is what makes verifying one a single command.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULE_A, ROOT, finish, npm, runQuickStart, say, scaffold } from "./lib/quick-start-project.mjs";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const at = args.indexOf("--version");
const version =
  at >= 0 && args[at + 1] !== undefined
    ? args[at + 1]
    : JSON.parse(readFileSync(join(ROOT, "packages", "bindings", "package.json"), "utf8")).version;

/* ── 1. is it published? ──────────────────────────────────────────────────── */

/**
 * What the registry says about one package at one version.
 *
 * `npm view` exits non-zero with `E404` when the name or the version is not
 * there, which is the answer rather than a failure. A network that is not there
 * is a *different* answer and is reported as one: a quick start that silently
 * fell back to tarballs because a proxy was down would publish "registry mode
 * unavailable" as if the packages were missing.
 */
function published(name) {
  const ran = spawnSync(npm, ["view", `${name}@${version}`, "version", "--json"], {
    encoding: "utf8",
  });
  const said = `${ran.stdout}${ran.stderr}`;
  if (ran.status === 0 && said.includes(version)) return { ok: true };
  if (/E404|is not in this registry|No match(es)? found/i.test(said)) {
    return { ok: false, why: `${name}@${version} is not published` };
  }
  return { ok: false, why: `${name}@${version}: ${said.trim().split("\n").slice(-2).join(" ")}` };
}

say(`── asking the registry about module (a) at ${version}`);
const answers = MODULE_A.map((name) => ({ name, ...published(name) }));
const missing = answers.filter((one) => !one.ok);

/* ── 2. tarball mode, when there is nothing to install ────────────────────── */

if (missing.length > 0) {
  say("");
  for (const one of missing) say(`   ${one.why}`);
  say(
    `\nRegistry mode is not available: ${missing.length} of ${MODULE_A.length} module (a) ` +
      `package(s) are not on the registry at ${version}.\n` +
      "Running the **tarball** quick start instead, which is the same five minutes from what\n" +
      "this checkout packs. It does not prove the published versions install by name — that is\n" +
      "what this script is for, and it needs a publish first (T12.5, the owner's action).\n",
  );
  const packed = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "quick-start-packed.mjs"), ...(keep ? ["--keep"] : [])],
    { cwd: ROOT, stdio: "inherit" },
  );
  say(
    packed.status === 0
      ? "\nquick-start-registry: **tarball mode**, green. Run again after `custom: publish`."
      : "\nquick-start-registry: tarball mode failed; the registry is not the reason.",
  );
  process.exit(packed.status ?? 1);
}

/* ── 3. registry mode ─────────────────────────────────────────────────────── */

say(`\nAll four module (a) packages are on the registry at ${version}.`);

/*
 * No `overrides`, and that absence is the test.
 *
 * The packed quick start redirects every `@svatah/*` name to a file, because a
 * tarball's dependencies name versions no registry has. Here nothing is
 * redirected: npm resolves `@svatah/healer`'s dependency on `@svatah/bindings`
 * out of the registry, and if what was published still says `workspace:*` — the
 * failure REQ-PKG-1 is most exposed to — the install fails here and nowhere
 * else.
 */
const project = scaffold({
  prefix: "svatah-registry-",
  dependencies: Object.fromEntries(MODULE_A.map((name) => [name, version])),
});

const elapsed = await runQuickStart(project, { label: "Registry", keep });
finish(project, elapsed, {
  label: "Registry",
  keep,
  from: `from the registry at ${version}`,
});
