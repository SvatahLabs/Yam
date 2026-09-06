#!/usr/bin/env node
/**
 * A deliberately wrong expectation makes the gate fail, with both pieces of
 * evidence (T11.5, REQ-SELF-2).
 *
 *   node scripts/self-parity-bite.mjs
 *
 * The Validate item:
 *
 *   > a deliberately wrong flow expectation makes it fail with both pieces of
 *   > evidence.
 *
 * A gate that answered "100 percent agreement" to a suite where one side was
 * broken would be a gate nobody should trust, and the only way to know it is
 * not one is to break a side on purpose and watch it say so.
 *
 * ## What is broken, and where
 *
 * A copy of `evals/self` — never the committed project — with one expectation
 * changed to something the ADE does not say: the Flows toolbar's title becomes
 * `"Frobnicate"`. The Playwright side is untouched, so it still passes; the two
 * sides then disagree about one check, and the gate must exit 1 and print both
 * verdicts with the evidence each side gave.
 *
 * Exit 0 when the gate bit — that is, when a *broken* suite made it fail.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyProjectParts } from "./lib/self-project.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(ROOT, "packages", "cli", "dist", "bin.js");
const source = join(ROOT, "evals", "self");
const bundle = join(ROOT, "apps", "ade", "out", "Svatah ADE-darwin-arm64", "Svatah ADE.app");
const keep = process.argv.includes("--keep");

const scratch = mkdtempSync(join(tmpdir(), "svatah-parity-bite-"));
const project = join(scratch, "self");
mkdirSync(project, { recursive: true });
const skipped = copyProjectParts(source, project, ["flows", "steps", "api", "bindings"]);
if (skipped.length > 0) {
  process.stderr.write(`the self project has no ${skipped.join(", ")}; copied without\n`);
}
cpSync(join(source, "data.yaml"), join(project, "data.yaml"));
writeFileSync(
  join(project, "svatah.config.yaml"),
  readFileSync(join(source, "svatah.config.yaml"), "utf8").replace(
    /bundle: ".*"/,
    `bundle: ${JSON.stringify(bundle)}`,
  ),
  "utf8",
);

/* ── the lie ──────────────────────────────────────────────────────────────── */

const flow = join(project, "flows", "02-ade-screen.flow");
const before = readFileSync(flow, "utf8");
const after = before.replace(
  'The toolbar title should contain "Flows"',
  'The toolbar title should contain "Frobnicate"',
);
if (after === before) {
  process.stderr.write(`Nothing to break in ${flow}: the expectation has been reworded.\n`);
  process.exit(2);
}
writeFileSync(flow, after, "utf8");

/*
 * One check, and it is the one whose two sides are both Svatah's own — the
 * accessibility tree and the DOM over CDP. Breaking the flow breaks *both*
 * sides of that one, which is not a disagreement; so the check the gate is
 * asked about is the ADE screen one, whose external side is a Playwright case
 * the lie cannot touch.
 */
const catalogue = join(scratch, "checks.yaml");
writeFileSync(
  catalogue,
  [
    "# A one-check catalogue over a *broken* copy of the self project, so the",
    "# gate can be shown to bite (T11.5). `scripts/self-parity-bite.mjs` writes",
    "# it; nothing reads it twice.",
    'schemaVersion: "1.0.0"',
    "checks:",
    '  - id: "ade.opens-into-the-new-flows-screen-not-the-eleven-tabs"',
    '    says: "opens into the new Flows screen, not the eleven tabs"',
    "    svatah:",
    '      source: "svatah"',
    '      project: "self"',
    '      name: "the ADE opens a project and shows its flows"',
    "    external:",
    '      source: "ade-playwright"',
    '      name: "opens into the new Flows screen, not the eleven tabs"',
    "",
  ].join("\n"),
  "utf8",
);

const report = join(scratch, "parity.md");
const ran = spawnSync(
  process.execPath,
  [cli, "eval", "self", "--catalogue", catalogue, "--report", report],
  { encoding: "utf8", cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
);
process.stderr.write(`${ran.stdout ?? ""}${ran.stderr ?? ""}`);

const text = readFileSync(report, "utf8");
const bit =
  ran.status === 1 &&
  /Not conformant/.test(text) &&
  /## Disagreements/.test(text) &&
  /ade\.opens-into-the-new-flows-screen/.test(text) &&
  // Both pieces of evidence: what Svatah saw, and what the external side saw.
  /Frobnicate/.test(text) &&
  /pass/.test(text.split("## Disagreements")[1]?.split("##")[0] ?? "");

process.stdout.write(
  bit
    ? "the gate bit: a wrong expectation is a disagreement, with both sides' evidence\n"
    : `the gate did NOT bite (exit ${ran.status ?? "none"}); the report is at ${report}\n`,
);
if (!keep) rmSync(scratch, { recursive: true, force: true });
else process.stderr.write(`kept ${scratch}\n`);
process.exit(bit ? 0 : 1);
