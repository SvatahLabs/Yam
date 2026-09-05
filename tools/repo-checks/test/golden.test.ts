/**
 * T0.6 Validate — "Every golden entry validates" and "the doc names every
 * `Action` value".
 *
 * Refs: REQ-LANG-12, REQ-COMP-9, LLD §4.2.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { ACTIONS, PREDICATE_KINDS, stepSchema } from "@svatah/schema";
import { fromRoot } from "../src/repo.js";
import { materialise, readGolden, type GoldenEntry } from "../src/golden.js";

const GOLDEN_PATH = fromRoot("evals", "compiler", "golden.jsonl");
const entries: GoldenEntry[] = readGolden(GOLDEN_PATH);
const tier1 = entries.filter((e) => e.tier === 1);

const doc = readFileSync(fromRoot("docs", "flow-language.md"), "utf8");

describe("evals/compiler/golden.jsonl (REQ-COMP-9)", () => {
  it("has at least 120 tier 1 entries", () => {
    expect(tier1.length).toBeGreaterThanOrEqual(120);
  });

  it("has unique, sequential ids", () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });

  it("has unique sentences", () => {
    const texts = entries.map((e) => e.text);
    const seen = new Map<string, string>();
    for (const entry of entries) {
      const prior = seen.get(entry.text);
      expect(prior, `${entry.id} repeats the sentence from ${String(prior)}`).toBeUndefined();
      seen.set(entry.text, entry.id);
    }
    expect(texts.length).toBe(entries.length);
  });

  it.each(entries.map((e) => [e.id, e.text] as const))(
    "%s (%s) materialises into a valid step",
    (id) => {
      const entry = entries.find((e) => e.id === id)!;
      const result = stepSchema.safeParse(materialise(entry));
      expect(
        result.success ? null : JSON.stringify(result.error.issues),
        `${id} does not validate against ir.schema.json`,
      ).toBeNull();
    },
  );

  it("carries no sigil, inline locator or v1/v2 variable form (REQ-LANG-4)", () => {
    for (const entry of entries) {
      expect(entry.text, `${entry.id} uses a v1 action sigil`).not.toMatch(/\+[a-zA-Z ]+\+/);
      expect(entry.text, `${entry.id} uses a v1 locator sigil`).not.toMatch(/~[^~]+~/);
      expect(entry.text, `${entry.id} uses a v1 data sigil`).not.toMatch(/\*[^*]+\*/);
      expect(entry.text, `${entry.id} uses a v1 variable form`).not.toMatch(/#[A-Za-z][\w.]*#/);
      expect(entry.text, `${entry.id} embeds a locator type`).not.toMatch(
        /\b(xpath|cssSelector|linkText|partialLinkText|className|tagName):/,
      );
    }
  });

  /**
   * P0-F3 — Draft 2.2: a Tier 0 `target` placeholder is a TargetRef under
   * `custom.targets`. The mistake the correction names is encoding it as a
   * literal in `params`, which the recorder never grounds and the resolver never
   * resolves.
   *
   * `stepSchema` rejects the double encoding; this asserts the positive shape on
   * the committed data, so a golden entry cannot quietly go back to literals.
   */
  it("encodes every Tier 0 target placeholder as a TargetRef (LLD §5, Draft 2.2)", () => {
    const customEntries = entries.filter((e) => e.step.action === "custom");
    expect(customEntries.length).toBeGreaterThan(0);

    /** Dotted, kebab-cased: what a target phrase normalises to (docs §4). */
    const ELEMENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

    for (const entry of customEntries) {
      const custom = entry.step.custom;
      expect(custom, `${entry.id} has action "custom" but no custom block`).toBeDefined();
      for (const [name, ref] of Object.entries(custom!.params)) {
        expect(
          ref.kind === "literal" && ELEMENT_ID.test(ref.value),
          `${entry.id}: custom.params.${name} is the literal "${
            ref.kind === "literal" ? ref.value : ""
          }", which is shaped like an element id. A target placeholder belongs in custom.targets.`,
        ).toBe(false);
      }
      for (const [name, target] of Object.entries(custom!.targets ?? {})) {
        expect(target.status, `${entry.id}: custom.targets.${name} is already bound`).toBe(
          "unbound",
        );
        expect(target.phrase.length, `${entry.id}: custom.targets.${name} has no phrase`).toBeGreaterThan(0);
      }
    }
  });

  it("covers every pattern in docs/flow-language.md", () => {
    const covered = new Set(entries.map((e) => e.pattern));
    for (let pattern = 1; pattern <= 30; pattern += 1) {
      expect(covered, `no golden entry for pattern ${pattern}`).toContain(pattern);
    }
  });

  it("gives every pattern at least two examples (REQ-LANG-12)", () => {
    const counts = new Map<number, number>();
    for (const entry of entries) counts.set(entry.pattern, (counts.get(entry.pattern) ?? 0) + 1);
    for (let pattern = 1; pattern <= 30; pattern += 1) {
      expect(counts.get(pattern) ?? 0, `pattern ${pattern} has fewer than two examples`).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(ACTIONS)("covers the `%s` action", (action) => {
    expect(entries.some((e) => e.step.action === action)).toBe(true);
  });

  it("only emits `custom` from tier 0, which no grammar can produce", () => {
    for (const entry of entries) {
      if (entry.step.action === "custom") expect(entry.tier).toBe(0);
      if (entry.tier === 0) expect(entry.step.action).toBe("custom");
    }
  });

  it("exercises every predicate kind an expectation or guard can carry", () => {
    const kinds = new Set<string>();
    for (const entry of entries) {
      if (entry.step.expect) kinds.add(entry.step.expect.predicate.kind);
      if (entry.step.guard) kinds.add(entry.step.guard.predicate.kind);
    }
    for (const kind of PREDICATE_KINDS) {
      expect(kinds, `no golden entry uses the \`${kind}\` predicate`).toContain(kind);
    }
  });

  it("exercises every kind of value reference", () => {
    const seen = new Set<string>();
    const VALUE_REF_KINDS = new Set(["literal", "var", "data", "input", "template"]);
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      const kind = record["kind"];
      if (typeof kind === "string" && VALUE_REF_KINDS.has(kind)) seen.add(kind);
      for (const child of Object.values(record)) walk(child);
    };
    for (const entry of entries) walk(entry.step);
    for (const kind of ["literal", "var", "data", "input", "template"]) {
      expect(seen, `no golden entry uses a \`${kind}\` value reference`).toContain(kind);
    }
  });

  it("includes a secret-bearing step, so redaction has a case to exercise", () => {
    const hasSecret = JSON.stringify(entries).includes('"secret":true');
    expect(hasSecret).toBe(true);
  });
});

describe("docs/flow-language.md (REQ-LANG-12)", () => {
  it.each(ACTIONS)("names the `%s` action", (action) => {
    expect(doc).toContain(`\`${action}\``);
  });

  it.each(PREDICATE_KINDS)("names the `%s` predicate", (kind) => {
    expect(doc).toContain(`\`${kind}\``);
  });

  it("documents patterns 1 through 30, each with at least two examples", () => {
    for (let pattern = 1; pattern <= 30; pattern += 1) {
      expect(doc, `no section for pattern ${pattern}`).toMatch(
        new RegExp(`^### Pattern ${pattern} — `, "m"),
      );
    }
    const sections = doc.split(/^### Pattern /m).slice(1);
    expect(sections).toHaveLength(30);
    for (const section of sections) {
      const heading = section.split("\n")[0] ?? "";
      // Two "compiles to:" blocks per pattern is the two-examples requirement.
      const compiles = section.match(/compiles to:/g) ?? [];
      expect(compiles.length, `pattern "${heading}" shows fewer than two examples`).toBeGreaterThanOrEqual(2);
    }
  });

  it("every example in the doc is a golden entry", () => {
    const known = new Set(entries.map((e) => e.text));
    for (const match of doc.matchAll(/^`(.+?)` compiles to:$/gm)) {
      expect(known, `the doc shows "${match[1]}", which is not in golden.jsonl`).toContain(match[1]);
    }
  });

  it("documents the block grammar, signatures, guards, variables and custom steps", () => {
    for (const heading of [
      "## 1. File structure",
      "## 2. Story signatures",
      "## 3. Variables",
      "## 4. Targets",
      "## 5. Sentence patterns",
      "## 6. Custom typed steps",
      "## 7. The IR action vocabulary",
      "## 8. Migrating v1 and v2 flows",
      "## 9. Lint",
    ]) {
      expect(doc, `docs/flow-language.md is missing "${heading}"`).toContain(heading);
    }
  });

  it("has a migration row for the sigils and variable forms v3 removes", () => {
    for (const removed of ["`+action+`", "`*value*`", "`$[key:value]$`", "`#var#`", "`var : name`"]) {
      expect(doc, `the migration table does not mention ${removed}`).toContain(removed);
    }
  });

  it("maps the legacy Java action names onto v3 sentences", () => {
    for (const legacy of [
      "moveToElementAndClick",
      "explicitWaitForElementVisibility",
      "assertMultipleSelectionNotSupported",
      "acceptAndValidateAlertText",
      "validateRectangle",
      "deselectByValue",
      "executeAsyncScript",
    ]) {
      expect(doc, `the migration table does not map \`${legacy}\``).toContain(legacy);
    }
  });
});

/**
 * Every block header in a legacy v1/v2 flow: `story : Name`, `scenario:Name`,
 * `compose : Name`, `test : Name`. The legacy files are inconsistent about the
 * spaces around the colon, so the pattern tolerates any.
 *
 * P0-F2: the migration check derives its expectations from this, not from a list
 * a person maintains, so a renamed scenario cannot be made to pass by editing the
 * test alongside the fixture.
 */
function legacyBlockNames(flowText: string): string[] {
  const names: string[] = [];
  for (const line of flowText.split("\n")) {
    const match = /^\s*(story|scenario|compose|test|run)\s*:\s*(\S.*?)\s*$/i.exec(line);
    if (match !== null) names.push(match[2]!);
  }
  return names;
}

describe("evals/fixtures/flows (REQ-NFR-8)", () => {
  const fixtures = [
    "simple.flow",
    "svatah.flow",
    "execution.flow",
    "natural_language_login.flow",
    "booking-compensation.flow",
  ];

  it.each(fixtures)("%s is hand-migrated to v3", (name) => {
    const path = fromRoot("evals", "fixtures", "flows", name);
    expect(existsSync(path), `${name} is missing`).toBe(true);
    // Comment lines are stripped first, exactly as the reader does (REQ-LANG-3):
    // these files explain their own migration, so the header names the forms v3 removes.
    const flow = readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|#)/.test(line))
      .join("\n");

    expect(flow, `${name} still uses a v1 action sigil`).not.toMatch(/\+[a-zA-Z ]+\+/);
    expect(flow, `${name} still uses a v1 locator sigil`).not.toMatch(/~[^~\n]+~/);
    expect(flow, `${name} still uses a v1 data sigil`).not.toMatch(/\*[^*\n]+\*/);
    expect(flow, `${name} still uses a v1 variable form`).not.toMatch(/#[A-Za-z][\w.]*#/);
    expect(flow, `${name} still embeds a locator type`).not.toMatch(
      /\b(xpath|cssSelector|linkText|partialLinkText|className|tagName):/,
    );
    expect(flow, `${name} has no block header`).toMatch(/^(story|scenario|compose|test|run)[ (:]/m);
  });

  /**
   * The four migrations, each paired with the legacy original the names are
   * derived from. `booking-compensation.flow` has no original and is absent here
   * deliberately — it is a new fixture for REQ-AUTO-4, not a migration (P0-F2).
   */
  const MIGRATIONS: Array<[string, string]> = [
    ["simple.flow", "simple.flow"],
    ["svatah.flow", "svatah.flow"],
    ["execution.flow", "execution.flow"],
    ["natural_language_login.flow", "natural_language_login.flow"],
  ];

  it.each(MIGRATIONS)(
    "%s preserves every story and scenario name of the original",
    (fixture, original) => {
      const legacy = readFileSync(
        fromRoot("legacy", "src", "test", "resources", "sample", original),
        "utf8",
      );
      const expected = legacyBlockNames(legacy);
      expect(
        expected.length,
        `no block headers were parsed out of legacy/.../${original}`,
      ).toBeGreaterThan(0);

      const flow = readFileSync(fromRoot("evals", "fixtures", "flows", fixture), "utf8");
      for (const name of expected) {
        expect(flow, `${fixture} lost the name "${name}" from the original`).toContain(name);
      }
    },
  );

  it("execution.flow has one step per original step, in order", () => {
    // The original is v2: every step line carries an +action+ sigil, and the
    // `//` lines are comments. The migration must be one v3 sentence per such
    // line, in the same order and under the same scenario (P0-F2).
    const legacy = readFileSync(
      fromRoot("legacy", "src", "test", "resources", "sample", "execution.flow"),
      "utf8",
    );
    const v3 = readFileSync(fromRoot("evals", "fixtures", "flows", "execution.flow"), "utf8");

    /** Scenario name → number of step lines, for a legacy file. */
    const legacyCounts = new Map<string, number>();
    let current: string | null = null;
    for (const line of legacy.split("\n")) {
      const header = /^\s*(story|scenario|compose|test|run)\s*:\s*(\S.*?)\s*$/i.exec(line);
      if (header !== null) {
        current = header[2]!;
        legacyCounts.set(current, 0);
        continue;
      }
      if (current === null) continue;
      if (line.trim() === "" || /^\s*\/\//.test(line)) continue;
      legacyCounts.set(current, legacyCounts.get(current)! + 1);
    }

    /** Scenario name → number of step lines, for the v3 migration. */
    const v3Counts = new Map<string, number>();
    current = null;
    for (const line of v3.split("\n")) {
      const header = /^(story|scenario|compose|test|run)\s*(\([^)]*\))?\s*:\s*(\S.*?)\s*$/i.exec(line);
      if (header !== null) {
        current = header[3]!;
        v3Counts.set(current, 0);
        continue;
      }
      if (current === null) continue;
      if (line.trim() === "" || /^\s*(\/\/|#)/.test(line)) continue;
      v3Counts.set(current, v3Counts.get(current)! + 1);
    }

    expect([...v3Counts.keys()]).toEqual([...legacyCounts.keys()]);
    for (const [name, count] of legacyCounts) {
      expect(v3Counts.get(name), `scenario "${name}" changed step count`).toBe(count);
    }
  });

  it("booking-compensation.flow carries the abort policy execution.flow no longer does", () => {
    const compensation = readFileSync(
      fromRoot("evals", "fixtures", "flows", "booking-compensation.flow"),
      "utf8",
    );
    expect(compensation).toContain("onFailure=compensate:cancel booking");
    expect(compensation).toMatch(/^scenario[^\n]*:\s*cancel booking\s*$/m);
    expect(compensation).toMatch(/^compose:/m);
    expect(compensation).toMatch(/^test:/m);

    // …and execution.flow is a plain migration again: no policy metadata, no
    // compose or run block, no scenario the original did not have. Comment lines
    // are stripped first — the file's header explains what moved out of it.
    const execution = readFileSync(fromRoot("evals", "fixtures", "flows", "execution.flow"), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|#)/.test(line))
      .join("\n");
    expect(execution).not.toContain("onFailure");
    expect(execution).not.toContain("cancel booking");
    expect(execution).not.toMatch(/^compose:/m);
    expect(execution).not.toMatch(/^test:/m);
  });

  it("ships the run data and the named API request the flows reference", () => {
    const data = readFileSync(fromRoot("evals", "fixtures", "data.yaml"), "utf8");
    expect(data).toContain("secrets:");
    // Secrets are ${ENV} indirections, never literals (REQ-NFR-6).
    expect(data).toMatch(/password:\s*"\$\{[A-Z_]+\}"/);
    expect(existsSync(fromRoot("evals", "fixtures", "api", "active-count.yaml"))).toBe(true);
  });
});
