#!/usr/bin/env node
/**
 * Seed `evals/self`'s ADE bindings from the recorded desktop cases (T11.4,
 * LLD §13.9).
 *
 *   node scripts/seed-self-bindings.mjs
 *
 * > Its bindings for the ADE are seeded from `automationId`s with no model and
 * > no recording.
 *
 * `evals/grounding/desktop-cases.jsonl` already holds every control of the ADE
 * with its id, its role and the phrase a person would write — read from the
 * real application by `scripts/desktop-grounding-cases.mjs`. A binding seeded
 * from one of those is the id, the phrase, and nothing invented: no box nobody
 * measured, no neighbours nobody read, and `verified: false` until
 * `svatah bindings verify` says otherwise against a running ADE.
 *
 * Written by a script rather than by hand because there are eighty of them and
 * because a hand-copied id is a typo waiting to be a flake.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(ROOT, "evals", "self", "bindings", "ade");
const cases = ["desktop-cases.jsonl", "desktop-answers.jsonl"].flatMap((name) => {
  const path = join(ROOT, "evals", "grounding", name);
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((one) => one.trim() !== "")
      .map((one) => JSON.parse(one));
  } catch {
    return [];
  }
});

/** `AXButton` for a `button`; the fingerprint's `tag` is the native role. */
const NATIVE_ROLE = {
  button: "AXButton",
  link: "AXLink",
  textbox: "AXTextField",
  searchbox: "AXTextField",
  combobox: "AXComboBox",
  checkbox: "AXCheckBox",
  tab: "AXRadioButton",
  heading: "AXHeading",
};

/** `rail-flows` → `ade.rail-flows`, and one file per control. */
const byElement = new Map();
for (const one of cases) {
  if (one.expect !== "present" || one.element === undefined) continue;
  const found = byElement.get(one.element) ?? { ...one, phrases: [] };
  if (!found.phrases.includes(one.phrase)) found.phrases.push(one.phrase);
  byElement.set(one.element, found);
}

/*
 * A phrase that names two controls names neither.
 *
 * The generated phrase comes from a control's accessible name, and the ADE has
 * two that say the same thing: the rail's "Import prototype database" row and
 * the Import screen's button of that name. A store with both would compile
 * every sentence using it to `W_AMBIGUOUS_TARGET` — so the phrase is dropped
 * from *every* binding that shares it, and whatever hand-written phrase
 * `desktop-answers.jsonl` gives each one is what is left. Dropping it from all
 * of them rather than picking a winner is the point: a guess about which
 * control a person meant is the thing a lint warning exists to refuse.
 */
const owners = new Map();
for (const control of byElement.values()) {
  for (const phrase of control.phrases) {
    owners.set(phrase, (owners.get(phrase) ?? 0) + 1);
  }
}
const shared = [];
for (const control of byElement.values()) {
  const kept = control.phrases.filter((one) => (owners.get(one) ?? 0) === 1);
  if (kept.length !== control.phrases.length) {
    shared.push(...control.phrases.filter((one) => !kept.includes(one)));
  }
  control.phrases = kept;
}
for (const [element, control] of byElement) {
  if (control.phrases.length === 0) byElement.delete(element);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const template = (control) => `# Seeded from an \`automationId\`, with no model and no recording (LLD §13.9).
#
# Written by \`node scripts/seed-self-bindings.mjs\` from
# \`evals/grounding/desktop-cases.jsonl\`, which \`pnpm grounding:desktop-cases\`
# reads out of the real ADE. The ADE's controls all carry an id a rewording
# cannot break — LLD §13.7's accessibility contract requires one on every
# button, link, tab, field and row action — so a self-suite binding needs no
# grounding: the id *is* the answer.
#
# The fingerprint carries the role and the id and nothing invented: no box
# nobody measured, no neighbours nobody read. \`verified: false\` says the same
# thing in one word, and \`svatah bindings verify\` is what turns it true against
# a running ADE.
schemaVersion: "1.0.0"
id: "ade.${control.element}"
phrases:
${control.phrases.map((one) => `  - ${JSON.stringify(one)}`).join("\n")}
entries:
  - candidates:
      - by: "automationId"
        value: ${JSON.stringify(control.element)}
        score: 0.99
    context:
      platform: "desktop"
      pattern: ${JSON.stringify(control.window ?? "Svatah ADE")}
      hash: ${JSON.stringify(createHash("sha256").update(`seed:${control.element}`).digest("hex"))}
    fingerprint:
      tag: ${JSON.stringify(NATIVE_ROLE[control.role] ?? "AXUnknown")}
      attrs:
        automationId: ${JSON.stringify(control.element)}
      text: ${JSON.stringify(control.name ?? "")}
      neighbours:
        before: []
        after: []
      rolePath: []
      box: [0, 0, 0, 0]
      index: 0
    provenance:
      at: "2026-09-06T00:00:00.000Z"
      model: "none"
      promptVersion: "seeded"
      tokensIn: 0
      tokensOut: 0
      costUsd: 0
    recordedAt: "2026-09-06T00:00:00.000Z"
    verified: false
`;

for (const control of byElement.values()) {
  writeFileSync(join(out, `${control.element}.yaml`), template(control), "utf8");
}
process.stdout.write(
  `seeded ${byElement.size} binding(s) into ${out} ` +
    `(${readdirSync(out).length} file(s))\n` +
    (shared.length === 0
      ? ""
      : `  dropped ${[...new Set(shared)].length} phrase(s) that name more than one control: ` +
        `${[...new Set(shared)].join("; ")}\n`),
);
