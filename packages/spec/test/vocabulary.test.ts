/**
 * T2.2 — the action vocabulary (REQ-COMP-5, REQ-RUN-10, LLD §4.3).
 *
 * Validate: "Every Java synonym resolves; normalisation table; ambiguity yields
 * `W_AMBIGUOUS_TARGET`."
 *
 * The first of those is checked against `ActionSynonyms.java` itself rather than
 * against a copied list. A port that is verified against a transcription of what
 * was ported verifies the transcription; reading the original is the only way the
 * check means anything, and it is why the Java project is kept in `legacy/`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { ACTIONS } from "@svatah/schema";
import { generateActionsYaml, VERBS, VOCABULARY, VerbTrie } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

/* ── the legacy source, read and parsed ───────────────────────────────────── */

const JAVA = readFileSync(
  join(ROOT, "legacy", "src", "main", "java", "com", "svatah", "automator", "mappers", "ActionSynonyms.java"),
  "utf8",
);

/**
 * `mapper.setValuesInLowerCase(XMapper.name, "a", "b", …)` → `{ name, synonyms }`.
 *
 * The Java lower-cases every value at registration (`setValuesInLowerCase`), so
 * the comparison is on lower-cased strings on both sides.
 */
function legacyVerbs(): Array<{ legacy: string; synonyms: string[] }> {
  const out = new Map<string, Set<string>>();
  const call = /setValuesInLowerCase\(\s*\w+\.(\w+)\s*,\s*([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(JAVA)) !== null) {
    const name = match[1]!;
    const synonyms = [...match[2]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!.toLowerCase());
    const existing = out.get(name) ?? new Set<string>();
    for (const synonym of synonyms) existing.add(synonym);
    out.set(name, existing);
  }
  return [...out.entries()].map(([legacy, synonyms]) => ({ legacy, synonyms: [...synonyms] }));
}

const LEGACY = legacyVerbs();

describe("the port reads the original (REQ-RUN-10)", () => {
  it("finds the legacy verbs, so the checks below are not vacuous", () => {
    // The Java registers the same list twice, for desktop and for android; the
    // parse above merges them by name, which is why this is 66 and not 132.
    expect(LEGACY.length).toBeGreaterThanOrEqual(60);
    expect(LEGACY.flatMap((v) => v.synonyms).length).toBeGreaterThanOrEqual(200);
  });

  it("the desktop and android lists are identical, which is why one vocabulary covers both", () => {
    // The method bodies, not the constructor's calls to them.
    const desktopAt = JAVA.indexOf("private void setDesktopMappers");
    const androidAt = JAVA.indexOf("private void setAndroidMappers");
    expect(desktopAt).toBeGreaterThan(0);
    expect(androidAt).toBeGreaterThan(desktopAt);
    const desktop = JAVA.slice(desktopAt, androidAt);
    const android = JAVA.slice(androidAt);
    const names = (source: string): string[] =>
      [...source.matchAll(/setValuesInLowerCase\(\s*\w+\.(\w+)\s*,\s*([^)]*)\)/g)]
        .map((m) => `${m[1]!}: ${[...m[2]!.matchAll(/"([^"]*)"/g)].map((s) => s[1]).join("|")}`);
    expect(names(android)).toEqual(names(desktop));
  });
});

describe("every Java synonym resolves (T2.2 Validate)", () => {
  it.each(LEGACY.map((v) => [v.legacy, v.synonyms] as const))(
    "%s: every synonym resolves to one verb",
    (legacy, synonyms) => {
      for (const synonym of synonyms) {
        const verb = VERBS.verbFor(synonym);
        expect(verb, `"${synonym}" (${legacy}) resolves to no verb`).toBeDefined();
        expect(
          verb!.legacy,
          `"${synonym}" resolves to ${verb!.legacy}, not to ${legacy}`,
        ).toBe(legacy);
      }
    },
  );

  it("every legacy verb has an entry", () => {
    const ported = new Set(VOCABULARY.map((v) => v.legacy));
    const missing = LEGACY.map((v) => v.legacy).filter((name) => !ported.has(name));
    expect(missing, `not ported: ${missing.join(", ")}`).toEqual([]);
  });

  it("adds no verb the legacy did not have", () => {
    // New *sentences* are the grammar's business (T2.4). The vocabulary is the
    // port, and a verb here that the Java never had would be one nobody checked.
    const legacy = new Set(LEGACY.map((v) => v.legacy));
    const extra = VOCABULARY.map((v) => v.legacy).filter((name) => !legacy.has(name));
    expect(extra, `not in ActionSynonyms.java: ${extra.join(", ")}`).toEqual([]);
  });

  it("every verb compiles to an action the IR has (REQ-RUN-10)", () => {
    for (const verb of VOCABULARY) {
      expect(ACTIONS as readonly string[], `${verb.legacy} → ${verb.action}`).toContain(verb.action);
    }
  });
});

describe("the verb trie", () => {
  it("takes the longest match, not the first", () => {
    // `select` and `select by index` are both synonyms. Matching `select` would
    // leave "by index" as a stray phrase and the step would select the wrong way.
    expect(VERBS.match("select by index 2 in the month list")?.verb.legacy).toBe("selectByIndex");
    expect(VERBS.match('select "August" in the month list')?.verb.legacy).toBe(
      "selectByVisibleText",
    );
    expect(VERBS.match("click and hold the handle")?.verb.legacy).toBe("clickAndHold");
    expect(VERBS.match("click the handle")?.verb.legacy).toBe("click");
    expect(VERBS.match("scroll to top of the page")?.verb.legacy).toBe("scrollToTop");
  });

  it("reports what it consumed and what is left", () => {
    const match = VERBS.match("double click the Book now button")!;
    expect(match.synonym).toBe("double click");
    expect(match.words).toBe(2);
    expect(match.rest).toBe("the book now button");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(VERBS.match("  DOUBLE   Click  the button ")?.verb.legacy).toBe("doubleClick");
  });

  it("finds a verb that is not the first word, and says what came before", () => {
    // The legacy sentences put the subject first: "user +clicks+ the ~x~".
    const found = VERBS.find("user clicks the sign in button")!;
    expect(found.verb.legacy).toBe("click");
    expect(found.before).toBe("user");
    expect(found.rest).toBe("the sign in button");
  });

  it("matches nothing when the sentence has no verb it knows", () => {
    expect(VERBS.match("the username field")).toBeUndefined();
    expect(VERBS.find("the username field")).toBeUndefined();
  });

  it("refuses a vocabulary where two verbs claim one synonym", () => {
    // Whichever won would depend on declaration order, and the loser's sentences
    // would compile to the wrong action — silently.
    expect(
      () =>
        new VerbTrie([
          { legacy: "a", action: "click", synonyms: ["poke"] },
          { legacy: "b", action: "hover", synonyms: ["poke"] },
        ]),
    ).toThrow(/claimed by both/);
  });
});

describe("actions.yaml (the published artifact)", () => {
  const committed = readFileSync(join(HERE, "..", "actions.yaml"), "utf8");

  it("on disk matches what the generator produces", () => {
    expect(committed).toBe(generateActionsYaml());
  });

  it("parses, and holds every verb with its synonyms", () => {
    const parsed = parse(committed) as { verbs: Array<{ legacy: string; synonyms: string[] }> };
    expect(parsed.verbs.map((v) => v.legacy)).toEqual(VOCABULARY.map((v) => v.legacy));
    expect(parsed.verbs.flatMap((v) => v.synonyms).sort()).toEqual(
      VOCABULARY.flatMap((v) => v.synonyms).sort(),
    );
  });

  it("says it is generated, so nobody edits it by hand", () => {
    expect(committed).toContain("GENERATED from packages/spec/src/vocabulary.ts");
  });
});

describe("what the port changed, and why", () => {
  it.each([
    ["contextClick", "rightClick"],
    ["clickAndHold", "pressAndHold"],
    ["moveToElement", "hover"],
    ["moveToElementAndClick", "hoverAndClick"],
    ["wait", "sleep"],
    ["getText", "read"],
    ["executeScript", "evaluate"],
  ] as const)("%s became %s", (legacy, action) => {
    expect(VOCABULARY.find((v) => v.legacy === legacy)?.action).toBe(action);
  });

  it("collapses the forty assert/validate methods onto expect plus a predicate", () => {
    const expectations = VOCABULARY.filter((v) => v.action === "expect");
    expect(expectations.length).toBeGreaterThan(15);
    for (const verb of expectations) {
      expect(verb.predicate, `${verb.legacy} has no predicate`).toBeDefined();
    }
    expect(VOCABULARY.find((v) => v.legacy === "assertNotDisplayed")?.predicate).toBe("hidden");
    expect(VOCABULARY.find((v) => v.legacy === "assertNotSelected")?.negate).toBe(true);
    expect(VOCABULARY.find((v) => v.legacy === "validateTitle")?.subject).toBe("page");
  });

  it("collapses the select family onto one action and a `by` argument", () => {
    expect(VOCABULARY.find((v) => v.legacy === "selectByIndex")?.args).toEqual({ by: "index" });
    expect(VOCABULARY.find((v) => v.legacy === "selectByValue")?.args).toEqual({ by: "value" });
    expect(VOCABULARY.find((v) => v.legacy === "selectByVisibleText")?.args).toEqual({
      by: "label",
    });
  });

  it("keeps acceptAndValidateAlertText one step: it acts and expects", () => {
    // REQ-COMP-1: every sentence yields exactly one IR step. `Step` carries both
    // an action and an `expect`, so this needs no second step.
    const verb = VOCABULARY.find((v) => v.legacy === "acceptAndValidateAlertText")!;
    expect(verb.action).toBe("dialog");
    expect(verb.args).toEqual({ action: "accept" });
    expect(verb.predicate).toBe("text");
    expect(verb.subject).toBe("dialog");
  });

  it("keeps the two API verbs apart by whether the session's cookies go with them", () => {
    expect(VOCABULARY.find((v) => v.legacy === "INVOKE")?.args).toEqual({
      withSessionCookies: true,
    });
    expect(VOCABULARY.find((v) => v.legacy === "INVOKE_WITHOUT_COOKIE")?.args).toEqual({
      withSessionCookies: false,
    });
  });
});
