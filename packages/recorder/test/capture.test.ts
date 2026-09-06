/**
 * Draft 2.23 (REQ-REC-13) — the words a capture writes: the phrase for an
 * element, the input name for a secret, the page segment, and the flow file.
 */
import { describe, expect, it } from "vitest";
import type { ElementDescription } from "@svatah/yam-schema";
import { inputNameFor, pathOf, phraseFor, renderCapturedFlow, segmentOf } from "../src/capture.js";

const element = (over: Partial<ElementDescription>): ElementDescription => ({
  ref: "r1",
  role: "button",
  tag: "button",
  attrs: {},
  text: "",
  neighbours: { before: [], after: [] },
  rolePath: [],
  box: [0, 0, 10, 10],
  index: 0,
  states: [],
  ...over,
});

describe("the phrase for an element", () => {
  it("is the accessible name and the role's noun, as a person says it", () => {
    expect(phraseFor(element({ role: "button", name: "Sign In" }))).toBe("the sign in button");
    expect(phraseFor(element({ role: "textbox", tag: "input", name: "Username" }))).toBe("the username field");
    expect(phraseFor(element({ role: "link", name: "Book a slot" }))).toBe("the book a slot link");
    expect(phraseFor(element({ role: "combobox", tag: "select", name: "Slot times" }))).toBe("the slot times select");
    expect(phraseFor(element({ role: "checkbox", tag: "input", name: "Remember me" }))).toBe("the remember me checkbox");
  });
  it("does not say the noun twice, falls back through placeholder, text and test id, and caps the length", () => {
    expect(phraseFor(element({ role: "button", name: "New change button" }))).toBe("the new change button");
    expect(phraseFor(element({ role: "textbox", tag: "input", attrs: { placeholder: "Search…" } }))).toBe("the search field");
    expect(phraseFor(element({ role: "button", text: "Pay" }))).toBe("the pay button");
    expect(phraseFor(element({ role: "button", attrs: { "data-testid": "book-now-sticky" } }))).toBe("the book now sticky button");
    expect(phraseFor(element({ role: "button" }))).toBe("the button");
    expect(phraseFor(element({ role: "button", name: "one two three four five six seven eight" }))).toBe("the one two three four five six button");
  });
});

describe("names and segments", () => {
  it("makes an input name from a phrase and a segment from a URL", () => {
    expect(inputNameFor("the password field")).toBe("password");
    expect(inputNameFor("the card number field")).toBe("card_number");
    expect(inputNameFor("the 2fa code field")).toBe("value_2fa_code");
    expect(segmentOf("http://localhost:3000/")).toBe("home");
    expect(segmentOf("http://localhost:3000/login?next=/x")).toBe("login");
    expect(segmentOf("http://localhost:3000/Schedule-Build/42")).toBe("schedule-build");
    expect(segmentOf(undefined)).toBe("home");
    expect(pathOf("http://localhost:3000/login?next=/x")).toBe("/login?next=/x");
    expect(pathOf("http://localhost:3000")).toBe("/");
  });
});

describe("the flow file", () => {
  it("is a story with the sentences, its inputs, and a test block", () => {
    const text = renderCapturedFlow(
      { story: "Sign in", steps: ['Go to "/login"', 'Type "someone@example.com" into the username field', "Type {input.password} into the password field", "Click the sign in button", 'The URL should contain "/dashboard"'], inputs: { password: "secret" } },
      { baseUrl: "http://localhost:3000", at: new Date("2026-09-07T12:00:00Z") },
    );
    expect(text).toBe(
      [
        "// Recorded by a person on 2026-09-07 at http://localhost:3000.",
        "// Each sentence is what was done; edit it freely. Bindings live under bindings/.",
        "",
        "story: Sign in",
        "inputs: password: secret",
        '  Go to "/login"',
        '  Type "someone@example.com" into the username field',
        "  Type {input.password} into the password field",
        "  Click the sign in button",
        '  The URL should contain "/dashboard"',
        "",
        "test: Sign in",
        "",
      ].join("\n"),
    );
  });
});
