/**
 * The target dictionary (REQ-COMP-5, LLD §4.3), for the part module (a) builds:
 * the phrases already recorded against each element.
 *
 * A phrase that means more than one element is ambiguous, and the dictionary
 * says so rather than picking one — `W_AMBIGUOUS_TARGET` is a warning a person
 * resolves, not something a resolver guesses at.
 */
import { describe, expect, it } from "vitest";
import { BindingsStore, Dictionary } from "../src/index.js";
import { entry } from "./fixtures.js";

function store(): BindingsStore {
  const s = BindingsStore.empty("/nowhere");
  s.put("login.username-field", entry(), "the username field");
  s.put("login.username-field", entry(), "the email field");
  s.put("login.sign-in-button", entry(), "the sign in button");
  s.put("booking.book-now-button", entry(), "the Book now button");
  return s;
}

describe("Dictionary", () => {
  it("resolves a recorded phrase to its element", () => {
    const dictionary = Dictionary.fromStore(store());
    expect(dictionary.lookup("the username field")).toEqual({
      ids: ["login.username-field"],
      status: "bound",
    });
    expect(dictionary.lookup("the email field").ids).toEqual(["login.username-field"]);
  });

  it("ignores case, articles and punctuation", () => {
    const dictionary = Dictionary.fromStore(store());
    for (const phrase of ["The Username Field", "username field", "  the  username   field  "]) {
      expect(dictionary.lookup(phrase).ids, phrase).toEqual(["login.username-field"]);
    }
  });

  it("resolves an element id directly, so bind() works before any phrase is recorded", () => {
    const s = BindingsStore.empty("/nowhere");
    s.put("login.password-field", entry());
    const dictionary = Dictionary.fromStore(s);
    expect(dictionary.lookup("login.password-field").status).toBe("bound");
  });

  it("reports an unknown phrase as unbound — what the recorder grounds", () => {
    const dictionary = Dictionary.fromStore(store());
    expect(dictionary.lookup("the forgotten password link")).toEqual({ ids: [], status: "unbound" });
  });

  it("reports a phrase that means two elements as ambiguous, naming both", () => {
    const s = store();
    s.addPhrase("login.sign-in-button", "the button");
    s.addPhrase("booking.book-now-button", "the button");

    const dictionary = Dictionary.fromStore(s);
    const lookup = dictionary.lookup("the button");
    expect(lookup.status).toBe("ambiguous");
    expect(lookup.ids).toEqual(["booking.book-now-button", "login.sign-in-button"]);

    expect(dictionary.ambiguous()).toEqual([
      { phrase: "button", ids: ["booking.book-now-button", "login.sign-in-button"] },
    ]);
  });

  it("has nothing ambiguous when every phrase means one element", () => {
    expect(Dictionary.fromStore(store()).ambiguous()).toEqual([]);
  });

  it("lists every phrase it knows, in the normalised form a lookup uses", () => {
    const phrases = Dictionary.fromStore(store()).phrases();
    expect(phrases).toContain("username field");
    expect(phrases).toContain("book now button");
    // Ids are keyed the same way, so the listing shows one entry per lookup key
    // rather than one per way of writing it.
    expect(phrases).toContain("login.username field");
    expect(phrases).toEqual([...phrases].sort());
  });
});
