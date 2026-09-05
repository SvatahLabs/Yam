/**
 * The parts of synthesis and fingerprinting that are pure functions over an
 * `ElementDescription` (REQ-REC-3, REQ-REC-4, LLD §3.3).
 *
 * The browser-backed half of T1.4 — every interactive element on every sample
 * page, fingerprints across a reload, and the committed bundle snapshot — is in
 * `packages/playwright-test/test/synthesis.spec.ts`, which is the one package the
 * dependency graph lets `@svatah/bindings` and the Playwright adapter meet in
 * (LLD §1).
 */
import { describe, expect, it } from "vitest";
import type { ElementDescription } from "@svatah/schema";
import { candidatesFor, fingerprintOf, looksGenerated, synthesise } from "../src/index.js";
import { StubSurface } from "./stub-surface.js";

function described(overrides: Partial<ElementDescription> = {}): ElementDescription {
  return {
    ref: "r5",
    role: "textbox",
    name: "Username",
    tag: "input",
    attrs: {
      id: "username",
      name: "username",
      type: "text",
      placeholder: "you@example.com",
      "data-testid": "username",
      class: "field-input",
      style: "outline: none",
    },
    text: "",
    neighbours: { before: ["Username"], after: ["Password"] },
    rolePath: ["main", "form"],
    box: [16, 120, 348, 34],
    index: 0,
    states: ["required"],
    native: {
      tag: "input",
      cssPath: '[data-testid="username"]',
      xpath: "//*[@data-testid='username']",
      stableClasses: "field-input",
    },
    ...overrides,
  };
}

describe("the generated-value heuristic", () => {
  it("recognises the shapes frameworks produce", () => {
    for (const value of [
      ":r3:",
      ":R2h6:",
      "ember1042",
      "mui-1234",
      "radix-:r1:",
      "sc-hAxLzW",
      "css-1x2y3z",
      "_3fF4aQ",
      "a1b2c3d4e5",
      "field_128394",
    ]) {
      expect(looksGenerated(value), `"${value}" should look generated`).toBe(true);
    }
  });

  it("leaves an id a person wrote alone", () => {
    for (const value of [
      "username",
      "login-submit",
      "slot-date",
      "expiry-month",
      "user_name_header",
      "h1",
      "nav2",
    ]) {
      expect(looksGenerated(value), `"${value}" should not look generated`).toBe(false);
    }
  });
});

describe("candidatesFor (REQ-REC-3)", () => {
  it("ranks by how much of the application has to change to break the candidate", () => {
    const candidates = candidatesFor(described());
    expect(candidates.map((c) => c.by)).toEqual([
      "testid",
      "id",
      "role",
      "label",
      "placeholder",
      "name",
      "css",
      "xpath",
    ]);
    expect(candidates.map((c) => c.score)).toEqual(
      [...candidates.map((c) => c.score)].sort((a, b) => b - a),
    );
  });

  it("skips a generated id and a generated test id", () => {
    const candidates = candidatesFor(
      described({ attrs: { ...described().attrs, id: ":r3:", "data-testid": "css-1x2y3z" } }),
    );
    expect(candidates.some((c) => c.by === "id")).toBe(false);
    expect(candidates.some((c) => c.by === "testid")).toBe(false);
  });

  it("trusts the adapter when it says an id is generated", () => {
    const candidates = candidatesFor(
      described({ native: { ...described().native, idIsGenerated: "true" } }),
    );
    expect(candidates.some((c) => c.by === "id")).toBe(false);
  });

  it("scores a positional path below one anchored on identity", () => {
    const anchored = candidatesFor(described()).find((c) => c.by === "css")!;
    const positional = candidatesFor(
      described({
        native: {
          ...described().native,
          cssPath: 'body > main.hero > p:nth-of-type(2)',
          xpath: "//body/main[1]/p[2]",
        },
      }),
    ).find((c) => c.by === "css")!;
    expect(positional.score).toBeLessThan(anchored.score);
  });

  it("offers a text candidate only where the text is the element's label", () => {
    const link = described({ role: "link", tag: "a", text: "Sign in", attrs: {}, native: {} });
    expect(candidatesFor(link).some((c) => c.by === "text" && c.value === "Sign in")).toBe(true);

    const paragraph = described({ role: "paragraph", tag: "p", text: "Some prose", attrs: {}, native: {} });
    expect(candidatesFor(paragraph).some((c) => c.by === "text")).toBe(false);
  });

  it("offers a label candidate only for a form control", () => {
    expect(candidatesFor(described()).some((c) => c.by === "label")).toBe(true);
    const heading = described({ role: "heading", tag: "h1", attrs: {}, native: {} });
    expect(candidatesFor(heading).some((c) => c.by === "label")).toBe(false);
  });

  it("does not offer a role candidate for a generic element", () => {
    const generic = described({ role: "generic", attrs: {}, native: {} });
    expect(candidatesFor(generic).some((c) => c.by === "role")).toBe(false);
  });

  it("produces no duplicates", () => {
    const candidates = candidatesFor(
      described({ attrs: { ...described().attrs, "data-test": "username" } }),
    );
    const keys = candidates.map((c) => `${c.by}:${c.value ?? ""}:${c.name ?? ""}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives an element with nothing to bind to no candidates at all", () => {
    expect(
      candidatesFor(described({ role: "generic", name: undefined, text: "", attrs: {}, native: {} })),
    ).toEqual([]);
  });
});

describe("synthesise (REQ-REC-3, the uniqueness filter)", () => {
  it("drops every candidate that matches more than one element", async () => {
    const surface = new StubSurface({
      descriptions: { r5: described() },
      answers: {
        "testid:username": { kind: "refs", refs: ["r5", "r9"] },
        "id:username": { kind: "refs", refs: ["r5"] },
      },
      fallback: { kind: "refs", refs: [] },
    });
    const candidates = await synthesise(surface, "r5");
    expect(candidates.map((c) => c.by)).toEqual(["id"]);
  });

  it("drops a candidate that uniquely matches the wrong element", async () => {
    // Worse than matching nothing: it would resolve at replay and act on
    // something else. `describe` on the stub reports the same shape for every
    // reference, so a differing box is what marks the impostor.
    const surface = new StubSurface({
      descriptions: {
        r5: described(),
        impostor: described({ box: [999, 999, 10, 10] }),
      },
      answers: {
        "testid:username": { kind: "refs", refs: ["impostor"] },
        "id:username": { kind: "refs", refs: ["r5"] },
      },
      fallback: { kind: "refs", refs: [] },
    });
    const candidates = await synthesise(surface, "r5");
    expect(candidates.map((c) => c.by)).toEqual(["id"]);
  });

  it("survives a candidate that throws", async () => {
    const surface = new StubSurface({
      descriptions: { r5: described() },
      answers: {
        "testid:username": { kind: "throw", message: "no such engine" },
        "id:username": { kind: "refs", refs: ["r5"] },
      },
      fallback: { kind: "refs", refs: [] },
    });
    expect((await synthesise(surface, "r5")).map((c) => c.by)).toEqual(["id"]);
  });

  it("falls back to coordinates when nothing else can find the element", async () => {
    // An element with a box but nothing bindable: what a control painted on a
    // canvas looks like from above the surface.
    const surface = new StubSurface({
      descriptions: { r5: described({ box: [10, 20, 100, 40] }) },
      fallback: { kind: "refs", refs: [] },
    });
    expect(await synthesise(surface, "r5")).toEqual([{ by: "coords", value: "60,40", score: 0.2 }]);
  });

  it("offers no coordinates for an element with no box, rather than a meaningless point", async () => {
    const surface = new StubSurface({
      descriptions: { r5: described({ box: [0, 0, 0, 0] }) },
      fallback: { kind: "refs", refs: [] },
    });
    expect(await synthesise(surface, "r5")).toEqual([]);
  });

  it("skips verification when asked, for a dry synthesis", async () => {
    const surface = new StubSurface({
      descriptions: { r5: described() },
      fallback: { kind: "refs", refs: [] },
    });
    const candidates = await synthesise(surface, "r5", { verify: false });
    expect(candidates.length).toBeGreaterThan(0);
    expect(surface.located).toEqual([]);
  });
});

describe("fingerprintOf (REQ-REC-4, LLD §3.3)", () => {
  it("carries everything LLD §3.3 names", () => {
    const fingerprint = fingerprintOf(described());
    expect(fingerprint.tag).toBe("input");
    expect(fingerprint.text).toBe("");
    expect(fingerprint.neighbours).toEqual({ before: ["Username"], after: ["Password"] });
    expect(fingerprint.rolePath).toEqual(["main", "form"]);
    expect(fingerprint.box).toEqual([16, 120, 348, 34]);
    expect(fingerprint.index).toBe(0);
  });

  it("keeps the attributes that say which element this is", () => {
    expect(fingerprintOf(described()).attrs).toEqual({
      id: "username",
      name: "username",
      type: "text",
      placeholder: "you@example.com",
      "data-testid": "username",
      class: "field-input",
    });
  });

  it("leaves out style, and leaves out generated values", () => {
    const attrs = fingerprintOf(
      described({
        attrs: { ...described().attrs, id: ":r3:", style: "color: red" },
        native: { ...described().native, stableClasses: "field-input" },
      }),
    ).attrs;
    expect(attrs["style"]).toBeUndefined();
    expect(attrs["id"]).toBeUndefined();
  });

  it("takes the stable classes the adapter separated out, not every class", () => {
    const attrs = fingerprintOf(
      described({
        attrs: { ...described().attrs, class: "field-input css-1x2y3z sc-hAxLzW" },
        native: { ...described().native, stableClasses: "field-input" },
      }),
    ).attrs;
    expect(attrs["class"]).toBe("field-input");
  });

  it("does not share arrays with the description it came from", () => {
    const source = described();
    const fingerprint = fingerprintOf(source);
    fingerprint.rolePath.push("mutated");
    fingerprint.neighbours.before.push("mutated");
    expect(source.rolePath).toEqual(["main", "form"]);
    expect(source.neighbours.before).toEqual(["Username"]);
  });
});
