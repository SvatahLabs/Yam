/**
 * T2.2 — normalisation and the target dictionary (REQ-COMP-5, LLD §4.3).
 *
 * Validate: "normalisation table; ambiguity yields `W_AMBIGUOUS_TARGET`."
 *
 * The normalisation table is the interesting half. It is lossy on purpose: "the
 * Sign In button", "Sign-in button" and "sign in button" must all name one
 * element, because otherwise the store holds three entries for one control and
 * each is recorded, healed and reviewed separately.
 */
import { describe, expect, it } from "vitest";
import { elementId, normaliseWords, parseTargets, TargetDictionary } from "../src/index.js";

describe("normalisation (the table)", () => {
  it.each([
    ["the sign in button", "sign-in-button"],
    ["The Sign In Button", "sign-in-button"],
    ["Sign-in button", "sign-in-button"],
    ["  the   sign in   button  ", "sign-in-button"],
    ["a username field", "username-field"],
    ["an email input", "email-input"],
    ["the CVV field", "cvv-field"],
    ["Book now button", "book-now-button"],
    ["the “schedule build” heading", "schedule-build-heading"],
    ["row 2 of the bookings table", "row-2-of-the-bookings-table"],
    ["the 3rd result", "3rd-result"],
  ])("%s → %s", (phrase, id) => {
    expect(elementId(phrase)).toBe(id);
  });

  it("keeps a one-word article, because `the` alone is somebody's element name", () => {
    // Dropping it would leave an empty id, which is worse than a silly one.
    expect(elementId("the")).toBe("the");
  });

  it("normaliseWords touches case and whitespace and nothing else", () => {
    // A sentence's punctuation decides which grammar pattern it hits, so the
    // sentence normaliser must not remove any of it.
    expect(normaliseWords('  Type "a,b"   into  the field ')).toBe('type "a,b" into the field');
  });
});

describe("the dictionary (REQ-COMP-5)", () => {
  it("resolves a phrase a binding was recorded for", () => {
    const dictionary = new TargetDictionary();
    dictionary.addBindings([
      { id: "login.username-field", phrases: ["the username field", "the email box"] },
    ]);
    expect(dictionary.resolve("the username field")).toEqual({
      id: "login.username-field",
      status: "bound",
    });
    expect(dictionary.resolve("The Email Box").status).toBe("bound");
  });

  it("resolves a phrase declared in targets.yaml", () => {
    const dictionary = new TargetDictionary();
    dictionary.addTargets({ "sign-in-button": ["the sign in button", "the login button"] });
    expect(dictionary.resolve("the login button").id).toBe("sign-in-button");
  });

  it("gives an unknown phrase an id derived from itself, and remembers it", () => {
    // Two steps naming the same unbound phrase must produce one id, or the
    // recorder would ground the same element twice into two bindings.
    const dictionary = new TargetDictionary();
    const first = dictionary.resolve("the Book now button");
    expect(first).toEqual({ id: "book-now-button", status: "unbound" });

    const second = dictionary.resolve("The book NOW button");
    expect(second.id).toBe("book-now-button");
    expect(dictionary.list().map((e) => e.id)).toEqual(["book-now-button"]);
  });

  it("can resolve without remembering, for a lint that must not mutate", () => {
    const dictionary = new TargetDictionary();
    dictionary.resolve("the Book now button", { remember: false });
    expect(dictionary.list()).toEqual([]);
  });

  it("reports W_AMBIGUOUS_TARGET when a phrase names more than one element", () => {
    const dictionary = new TargetDictionary();
    dictionary.addTargets({ "header.search": ["the search box"], "sidebar.search": ["the search box"] });

    const { resolution, diagnostic } = dictionary.resolveWithDiagnostic("the search box", {
      file: "flows/a.flow",
      line: 7,
    });

    expect(resolution.status).toBe("ambiguous");
    expect(resolution.candidates).toEqual(["header.search", "sidebar.search"]);
    expect(diagnostic?.code).toBe("W_AMBIGUOUS_TARGET");
    // A warning, not an error: the step still compiles against one of them, and
    // the person decides. Failing the compile would make an ambiguity in one
    // flow block every other flow in the project.
    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.message).toContain("header.search");
    expect(diagnostic?.message).toContain("sidebar.search");
    expect(diagnostic?.line).toBe(7);
  });

  it("produces no diagnostic for a phrase that is merely unbound", () => {
    // Unbound is the normal state before the recorder has run (REQ-REC-1).
    const dictionary = new TargetDictionary();
    expect(dictionary.resolveWithDiagnostic("the new thing", { file: "f", line: 1 }).diagnostic)
      .toBeUndefined();
  });

  it("lets a recorded phrase outrank one that was only inferred", () => {
    const dictionary = new TargetDictionary();
    dictionary.resolve("the username field");
    expect(dictionary.list()[0]!.source).toBe("inferred");
    dictionary.addBindings([{ id: "username-field", phrases: ["the username field"] }]);
    expect(dictionary.list()[0]!.source).toBe("bindings");
  });

  it("keeps a binding that has no phrase, because an id alone is addressable", () => {
    // `bind("login.username-field")` with no phrase is the documented form after
    // the first record (LLD §6.5).
    const dictionary = new TargetDictionary();
    dictionary.addBindings([{ id: "login.username-field", phrases: [] }]);
    expect(dictionary.has("login.username-field")).toBe(true);
  });

  it("produces the `targets` map a plan carries", () => {
    const dictionary = new TargetDictionary();
    dictionary.addTargets({ b: ["second"], a: ["first", "also first"] });
    expect(dictionary.toPlanTargets()).toEqual({
      a: { phrases: ["also first", "first"] },
      b: { phrases: ["second"] },
    });
  });
});

describe("targets.yaml", () => {
  it("accepts a phrase or a list of phrases", () => {
    const { targets, diagnostics } = parseTargets(
      { "sign-in-button": "the sign in button", "username-field": ["a", "b"] },
      "targets.yaml",
    );
    expect(diagnostics).toEqual([]);
    expect(targets).toEqual({ "sign-in-button": ["the sign in button"], "username-field": ["a", "b"] });
  });

  it("reports anything else", () => {
    expect(parseTargets({ x: 3 }, "targets.yaml").diagnostics.map((d) => d.code)).toEqual([
      "E_SYNTAX",
    ]);
    expect(parseTargets(["a"], "targets.yaml").diagnostics.map((d) => d.code)).toEqual(["E_SYNTAX"]);
  });

  it("accepts an empty file", () => {
    expect(parseTargets(null, "targets.yaml")).toEqual({ targets: {}, diagnostics: [] });
  });
});
