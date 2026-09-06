/**
 * T2.9 — migration (REQ-LANG-11).
 *
 * Validate: "`src/test/resources` migrates to flows compiling clean with equal
 * story names and step counts; candidate counts equal `&` alternatives; golden
 * output compared byte-for-byte."
 *
 * The unit-level half is here; the byte-for-byte comparison against the
 * committed output is `tools/repo-checks/test/migrate.test.ts`, and the
 * "compiles clean" half is there too, because it needs the compiler and
 * `@svatah/migrate` must not depend on it (LLD §1).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasInteriorPreposition,
  migrate,
  migrateData,
  parseLegacyStep,
  parseLocatorLine,
  phraseFor,
  readLegacyFlow,
  rewriteStep,
  valueFor,
} from "../src/index.js";

const LEGACY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "evals", "migrate", "source",
);

describe("reading a v2 line (REQ-LANG-11)", () => {
  it("takes the action, the locators, the data and the capture apart", () => {
    const step = parseLegacyStep(
      "user +saves text+ as var : enterprise  for ~xpath://h1~ on the Schedule Build Page",
      7,
    );
    expect(step.action).toBe("saves text");
    expect(step.locators).toEqual([{ by: "xpath", value: "//h1", raw: "xpath://h1" }]);
    expect(step.capture).toBe("enterprise");
    expect(step.prose).toBe("user as for on the Schedule Build Page");
  });

  it("keeps a commented-out step, marked as one", () => {
    // The two files have to read line for line, and a step someone deliberately
    // disabled is information.
    expect(parseLegacyStep("//user +clicks+ on ~docs link~", 3).commented).toBe(true);
  });

  it("splits a locator into its kind and its value", () => {
    expect(parseLegacyStep("+click+ ~link text : Sign In~", 1).locators[0]).toEqual({
      by: "link text",
      value: "Sign In",
      raw: "link text : Sign In",
    });
  });

  it("reads blocks, their kinds and their names", () => {
    const flow = readLegacyFlow("story : One\n+click+ ~a~\n\ncompose : Both\nOne\n\ntest : Both\n", "f");
    expect(flow.blocks.map((b) => `${b.kind}:${b.name}`)).toEqual([
      "story:One",
      "compose:Both",
      "test:Both",
    ]);
    expect(flow.blocks[1]!.names).toEqual(["One"]);
  });
});

describe("the target phrase", () => {
  it("prefers what the prose said over what the locator said", () => {
    expect(phraseFor("user on the login button using", { by: "xpath", value: "//input", raw: "" }))
      .toEqual({ phrase: "the login button", derived: false });
  });

  it("drops the connector that introduced the locator", () => {
    expect(phraseFor("on the next button defined by", undefined).phrase).toBe("the next button");
  });

  it("drops a trailing purpose clause", () => {
    expect(phraseFor("on the next button to go to date page", undefined).phrase).toBe(
      "the next button",
    );
  });

  it("drops a trailing page reference: it says where, not what", () => {
    expect(phraseFor("the sign in button on the home page", undefined).phrase).toBe(
      "the sign in button",
    );
  });

  it("keeps an interior preposition that is part of the name", () => {
    // "the sign in button" must not become "the sign button". There is no rule
    // that tells that apart from "the username in field", so neither is touched
    // and the reviewer is told.
    expect(phraseFor("the sign in button", undefined).phrase).toBe("the sign in button");
    expect(phraseFor("the username in field", undefined).phrase).toBe("the username in field");
  });

  it("flags a phrase with a preposition inside it, since it may be a seam", () => {
    expect(hasInteriorPreposition("the username in field")).toBe(true);
    expect(hasInteriorPreposition("the login button")).toBe(false);
  });

  it("derives from the locator, and says so, when the prose said nothing", () => {
    const result = phraseFor("user on", { by: "id", value: "username", raw: "id:username" });
    expect(result).toEqual({ phrase: "the username", derived: true });
  });

  it("marks an xpath-derived phrase as derived, because nobody would recognise it", () => {
    expect(phraseFor("", { by: "xpath", value: "//li[4]/a/p", raw: "" }).derived).toBe(true);
  });
});

describe("values", () => {
  it.each([
    ["qwerty123", '"qwerty123"'],
    ["#enterprise#", "{enterprise}"],
    ["#val", "{val}"],
    ["$email", "{data.email}"],
  ])("%s → %s", (raw, expected) => {
    expect(valueFor(raw)).toBe(expected);
  });
});

describe("rewriting a step", () => {
  it("uses the ported vocabulary rather than a mapping of its own", () => {
    // `+moves to element and click+` is `moveToElementAndClick` in
    // ActionSynonyms.java, which T2.2 mapped to `hoverAndClick`.
    const step = parseLegacyStep("user +moves to element and click+ ~dashboard link~", 1);
    expect(rewriteStep(step).sentence).toBe("Move to the dashboard link and click it");
  });

  it("maps an assertion onto an expectation", () => {
    const step = parseLegacyStep(
      "user +validates text+ on the heading using ~xpath://h1~ with *#enterprise#*",
      1,
    );
    expect(rewriteStep(step).sentence).toBe("The heading should say {enterprise}");
  });

  it("reports a second locator rather than dropping it silently", () => {
    const step = parseLegacyStep("+click+ the ~a~ and ~b~", 1);
    expect(rewriteStep(step).notes.join(" ")).toContain("second locator");
  });

  it("rewrites a v1 natural-language line, dropping the inline locator", () => {
    const step = parseLegacyStep("Click the login button with xpath://input[@value='Sign In']", 1);
    const result = rewriteStep(step);
    expect(result.sentence).toBe("Click the login button");
    expect(result.notes.join(" ")).toContain("REQ-LANG-4");
  });

  it("turns `Verify … appears` into an expectation, and says what it assumed", () => {
    const result = rewriteStep(parseLegacyStep("Verify the Schedule Build page appears", 1));
    expect(result.sentence).toBe("The Schedule Build should be visible");
    expect(result.notes.join(" ")).toContain("asserted a *page*");
  });
});

describe("locator files become seed bindings", () => {
  it("keeps one candidate per `&` alternative, in order (T2.9 Validate)", () => {
    // A migration that quietly dropped one would be a migration that lost a
    // fallback, and nothing downstream would ever say so.
    const parsed = parseLocatorLine(
      "login button = xpath://input[@value='Sign In'] & link text : Sign In & css selector : input.btn",
    )!;
    expect(parsed.id).toBe("login-button");
    expect(parsed.candidates.map((c) => c.by)).toEqual(["xpath", "text", "css"]);
    expect(parsed.candidates.map((c) => c.value)).toEqual([
      "//input[@value='Sign In']",
      "Sign In",
      "input.btn",
    ]);
  });

  it("scores by position, not by kind", () => {
    // A migrated locator has no evidence behind it. Scoring it as though it had
    // been synthesised would make an old xpath outrank a recorded test id.
    const parsed = parseLocatorLine("a = id:x & xpath://y")!;
    expect(parsed.candidates[0]!.score).toBeGreaterThan(parsed.candidates[1]!.score);
    expect(parsed.candidates[0]!.score).toBeLessThan(0.9);
  });

  it("reports an alternative it cannot map instead of dropping it silently", () => {
    expect(parseLocatorLine("a = id:x & something odd")!.unmapped).toEqual(["something odd"]);
  });

  it("turns an underscored key into a phrase", () => {
    expect(parseLocatorLine("Schedule_Build_Tab = xpath://li[4]")!.phrase).toBe(
      "the Schedule Build Tab",
    );
  });
});

describe("data files (REQ-NFR-6)", () => {
  it("turns anything that looks like a secret into an indirection", () => {
    // The old file had the value in plain text; carrying it across would make
    // the new one exactly as unsafe.
    const result = migrateData("user.email = a@b.c\nuser.password = qwerty123\n");
    expect(result.values).toEqual({
      user: { email: "a@b.c", password: "${SVATAH_USER_PASSWORD}" },
    });
    expect(result.secrets).toEqual(["user.password"]);
    expect(result.redacted).toEqual([{ key: "user.password", variable: "SVATAH_USER_PASSWORD" }]);
  });

  it("leaves an ordinary value alone", () => {
    expect(migrateData("baseUrl = http://x\n").values).toEqual({ baseUrl: "http://x" });
  });
});

describe("the whole legacy project (T2.9 Validate)", () => {
  const out = mkdtempSync(join(tmpdir(), "svatah-migrate-"));
  const result = migrate({ source: LEGACY, destination: out, at: "2026-09-02T00:00:00.000Z" });

  it("converts every step", () => {
    expect(result.unmapped).toBe(0);
  });

  it("preserves story names, exactly and in order", () => {
    const legacy = readLegacyFlow(
      readFileSync(join(LEGACY, "sample", "execution.flow"), "utf8"),
      "execution.flow",
    );
    const names = legacy.blocks.filter((b) => b.kind === "scenario").map((b) => b.name);
    const migrated = result.stories
      .filter((s) => s.file === "flows/execution.flow")
      .map((s) => s.name);
    expect(migrated).toEqual(names);
  });

  it("preserves step counts, per story", () => {
    for (const file of ["simple", "svatah", "execution", "natural_language_login"]) {
      const legacy = readLegacyFlow(
        readFileSync(join(LEGACY, "sample", `${file}.flow`), "utf8"),
        file,
      );
      for (const block of legacy.blocks) {
        if (block.kind === "compose" || block.kind === "test") continue;
        const expected = block.steps.filter((s) => !s.commented).length;
        const actual = result.stories.find(
          (s) => s.file === `flows/${file}.flow` && s.name === block.name,
        );
        expect(actual, `${file}: ${block.name}`).toBeDefined();
        expect(actual!.steps, `${file}: ${block.name}`).toBe(expected);
      }
    }
  });

  it("writes a seed binding per element the locator files named", () => {
    const bindings = result.files.filter((f) => f.startsWith("bindings/"));
    expect(bindings.length).toBeGreaterThanOrEqual(9);
  });

  it("leaves review notes, because migration is a draft", () => {
    expect(result.notes.length).toBeGreaterThan(0);
    expect(result.notes.some((n) => n.kind === "step")).toBe(true);
  });
});
