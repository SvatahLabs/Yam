/**
 * The boundary between the model and its views (TV-01, TV-T10).
 *
 * > `packages/screens` may not describe a pane, a key or a colour;
 * > `packages/tui` may not compute a number, a status word or a label.
 *
 * That sentence was in three file headers and enforced by nobody, which is how
 * the model came to carry a `⌘↵` a terminal cannot be sent and how the cockpit
 * came to be held to the app's panes. It is a property of two directories, and
 * a property of two directories can be read.
 *
 * Every rule here is shown to bite, against a string written to break exactly
 * one of them — a check that answers "fine" to a good boundary and "fine" to a
 * bad one has said nothing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

/** Every source file of a package, without its tests or its build. */
function sourcesOf(dir: string): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (["node_modules", "dist", "test", "fixtures"].includes(entry.name)) continue;
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && statSync(path).isFile()) {
        out.push({ path: relative(REPO_ROOT, path), text: readFileSync(path, "utf8") });
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * The comments are not the code.
 *
 * Half of what these rules look for is *explained* in prose in both packages —
 * "a terminal cannot be sent a ⌘↵" is a sentence the model is allowed to
 * contain — so the check reads what runs and not what is written about it.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MODEL = sourcesOf(fromRoot("packages/screens/src")).map((one) => ({ ...one, text: code(one.text) }));
const COCKPIT = sourcesOf(fromRoot("packages/tui/src")).map((one) => ({ ...one, text: code(one.text) }));

/** A rule: what may not appear, and the words that would be it. */
interface Rule {
  readonly what: string;
  readonly pattern: RegExp;
}

/**
 * What the model may not say (TV-01).
 *
 * Keystrokes and colours. Not "the word pane in a comment": these are the shapes
 * a *value* takes — a modifier key, an escape sequence, a hexadecimal, a
 * terminal dimension — because a model that carries one has made a decision that
 * belongs to one renderer and imposed it on both.
 */
const MODEL_RULES: readonly Rule[] = [
  { what: "a modifier keystroke", pattern: /["'`][^"'`]*[⌘⇧⌥^][↵⏎A-Z][^"'`]*["'`]/u },
  { what: "an escape sequence", pattern: /\\u001b|\\x1b|\\e\[/ },
  { what: "a colour", pattern: /#[0-9a-fA-F]{6}\b|\bansi\d*\b|\btruecolor\b/ },
  { what: "a key table", pattern: /\bkeys\s*:\s*\[/ },
  { what: "a terminal dimension", pattern: /\bcolumns\b|\bterminal\b\s*[:=]/ },
];

/**
 * What the cockpit may not do (TV-01).
 *
 * Compute a status word or a label. The words a person reads are the model's:
 * a renderer that decided "passed" is a renderer the other one can disagree
 * with, which is the whole failure this specification exists to correct.
 */
const COCKPIT_RULES: readonly Rule[] = [
  { what: "a status word of its own", pattern: /["'](passed|failed|aborted|skipped|healed|unverified)["']/ },
  { what: "a service call", pattern: /\bfetch\s*\(|new\s+EventSource\b|XMLHttpRequest/ },
];

describe("the model describes no renderer (TV-01)", () => {
  for (const rule of MODEL_RULES) {
    it(`carries no ${rule.what}`, () => {
      const offenders = MODEL.filter((one) => rule.pattern.test(one.text)).map((one) => one.path);
      expect(offenders, `${rule.what} in: ${offenders.join(", ")}`).toEqual([]);
    });
  }
});

describe("the cockpit decides no word a person reads (TV-01)", () => {
  for (const rule of COCKPIT_RULES) {
    it(`contains no ${rule.what}`, () => {
      const offenders = COCKPIT.filter((one) => rule.pattern.test(one.text)).map((one) => one.path);
      expect(offenders, `${rule.what} in: ${offenders.join(", ")}`).toEqual([]);
    });
  }
});

describe("every rule bites (TV-T10)", () => {
  it("catches a keystroke put back into the model", () => {
    const rule = MODEL_RULES[0]!;
    expect(rule.pattern.test(`const key = "⌘↵";`)).toBe(true);
    expect(rule.pattern.test(`const label = "Perform the action";`)).toBe(false);
  });

  it("catches a colour put back into the model", () => {
    const rule = MODEL_RULES[2]!;
    expect(rule.pattern.test(`const colour = "#4fc48a";`)).toBe(true);
    expect(rule.pattern.test(`const tone = "pass";`)).toBe(false);
  });

  it("catches a key table put back into the model", () => {
    const rule = MODEL_RULES[3]!;
    expect(rule.pattern.test(`  keys: [{ action: "run.flow" }],`)).toBe(true);
    expect(rule.pattern.test(`  actions: [{ id: "run.flow" }],`)).toBe(false);
  });

  it("catches a status word invented by the cockpit", () => {
    const rule = COCKPIT_RULES[0]!;
    expect(rule.pattern.test(`const label = row.ok ? "passed" : "failed";`)).toBe(true);
    expect(rule.pattern.test(`const label = row.status.label;`)).toBe(false);
  });

  it("reads what runs rather than what is written about it", () => {
    /*
     * Both packages explain the boundary in prose, and the prose contains the
     * very words the rules look for. A check that read the comments would fail
     * on the sentence describing why it exists.
     */
    expect(code(`/* a terminal cannot be sent a "⌘↵" */\nconst x = 1;`)).not.toContain("⌘");
    expect(code(`// the colour is #4fc48a\nconst x = 1;`)).not.toContain("#4fc48a");
  });
});

/**
 * The rail is one rail (TV-A01, REQ-ADE-11, SF-16).
 *
 * `macros.mjs` drew the Flows-first rail of Draft 2.11 on every app artboard
 * until TV-A01 — two drafts after the product stopped having one. An artboard is
 * a claim about what the product looks like, and one describing navigation
 * nobody can reach is a claim that came untrue quietly. So the model's sections,
 * the app's rail and the design source are read together.
 */
describe("the rail the model declares is the rail that is drawn (TV-A01)", () => {
  it("draws the model's sections in the design source", async () => {
    const { SECTIONS } = (await import("@svatah/yam-screens")) as {
      SECTIONS: ReadonlyArray<{ id: string; label: string }>;
    };
    const macros = readFileSync(fromRoot("docs/spec/design/macros.mjs"), "utf8");
    const sidebar = macros.slice(macros.indexOf("const sidebar"), macros.indexOf("const topbar"));
    for (const section of SECTIONS) {
      expect(sidebar, `the artboards' rail has no ${section.label}`).toContain(`"${section.label}"`);
    }
  });

  it("names nothing in the design source the model has abandoned", () => {
    const macros = readFileSync(fromRoot("docs/spec/design/macros.mjs"), "utf8");
    const sidebar = macros.slice(macros.indexOf("const sidebar"), macros.indexOf("const topbar"));
    for (const gone of ["Bindings", "Agents and tools", "API", "Data", "Import prototype database"]) {
      expect(sidebar, `the artboards' rail still offers ${gone}`).not.toContain(`"${gone}"`);
    }
  });

  it("builds the app's rail from the model rather than from a list of its own", () => {
    const shell = readFileSync(fromRoot("apps/desktop/src/renderer/shell/Shell.tsx"), "utf8");
    expect(shell).toMatch(/SECTIONS\.map\(/);
  });
});
