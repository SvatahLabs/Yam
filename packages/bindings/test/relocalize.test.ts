/**
 * T1.5 Validate — "component tests on synthetic descriptions".
 *
 * Synthetic, because the interesting cases are the ones a real page makes hard
 * to arrange: two elements that score identically, a fingerprint that matches
 * nothing, a change to exactly one of the five measures. The variant measurement
 * — record on variant 0, relocalize on 1..20, at least 60 percent recovered — is
 * the browser half, in `packages/playwright-test/test/relocalize.spec.ts`.
 *
 * Refs: REQ-HEAL-1 (relocalize), LLD §6.4.
 */
import { describe, expect, it } from "vitest";
import type { ElementDescription, Fingerprint } from "@svatah/yam-schema";
import {
  attrSimilarity,
  boxProximity,
  decide,
  DEFAULT_MARGIN,
  DEFAULT_THRESHOLD,
  fingerprintOf,
  neighbourSimilarity,
  rank,
  relocalize,
  rolePathSimilarity,
  scoreAgainst,
  textSimilarity,
  WEIGHTS,
} from "../src/index.js";
import { StubSurface } from "./stub-surface.js";
import { buildSnapshot, structuralHash } from "@svatah/yam-surface";

const RECORDED: Fingerprint = {
  tag: "input",
  attrs: { id: "username", name: "username", type: "text", "data-testid": "username" },
  text: "",
  neighbours: { before: ["Sign in to your account", "Username"], after: ["Password", "Remember me"] },
  rolePath: ["main", "form"],
  box: [16, 120, 348, 34],
  index: 0,
};

function live(overrides: Partial<ElementDescription> = {}): ElementDescription {
  return {
    ref: "r5",
    role: "textbox",
    name: "Username",
    tag: "input",
    attrs: { id: "username", name: "username", type: "text", "data-testid": "username" },
    text: "",
    neighbours: { before: ["Sign in to your account", "Username"], after: ["Password", "Remember me"] },
    rolePath: ["main", "form"],
    box: [16, 120, 348, 34],
    index: 0,
    states: [],
    ...overrides,
  };
}

describe("the five measures (LLD §6.4)", () => {
  it("weights sum to one, in the proportions LLD §6.4 gives", () => {
    expect(WEIGHTS).toEqual({ attrs: 0.3, text: 0.25, neighbours: 0.2, rolePath: 0.15, box: 0.1 });
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("attribute similarity is Jaccard over key=value pairs", () => {
    expect(attrSimilarity({ id: "a" }, { id: "a" })).toBe(1);
    expect(attrSimilarity({}, {})).toBe(1);
    expect(attrSimilarity({ id: "a" }, { id: "b" })).toBe(0);
    // Two of three shared: 2 / (3 + 3 - 2).
    expect(attrSimilarity({ a: "1", b: "2", c: "3" }, { a: "1", b: "2", c: "9" })).toBeCloseTo(0.5);
  });

  it("text similarity is over words, so a renamed label scores better than a rewritten one", () => {
    expect(textSimilarity("Sign in", "Sign in")).toBe(1);
    expect(textSimilarity("", "")).toBe(1);
    expect(textSimilarity("Sign in", "")).toBe(0);
    expect(textSimilarity("Sign in", "Log in")).toBeGreaterThan(textSimilarity("Sign in", "Checkout"));
    expect(textSimilarity("Book a slot", "Book a car")).toBeCloseTo(2 / 3);
  });

  it("neighbour similarity weighs what is before and after equally", () => {
    expect(
      neighbourSimilarity(RECORDED.neighbours, {
        before: RECORDED.neighbours.before,
        after: RECORDED.neighbours.after,
      }),
    ).toBe(1);
    expect(
      neighbourSimilarity(RECORDED.neighbours, { before: RECORDED.neighbours.before, after: [] }),
    ).toBeCloseTo(0.5);
  });

  it("role-path similarity is over the suffix, where the roles say what an element is", () => {
    expect(rolePathSimilarity(["main", "form"], ["main", "form"])).toBe(1);
    // A wrapper added at the root: the suffix is intact, so the score is high.
    expect(rolePathSimilarity(["main", "form"], ["region", "main", "form"])).toBeCloseTo(2 / 3);
    // The element moved out of the form: the suffix is broken at once.
    expect(rolePathSimilarity(["main", "form"], ["main", "navigation"])).toBe(0);
    expect(rolePathSimilarity([], [])).toBe(1);
  });

  it("box proximity falls off over a viewport, not over pixels", () => {
    expect(boxProximity([16, 120, 348, 34], [16, 120, 348, 34])).toBe(1);
    const nudged = boxProximity([16, 120, 348, 34], [16, 140, 348, 34]);
    const moved = boxProximity([16, 120, 348, 34], [16, 900, 348, 34]);
    expect(nudged).toBeGreaterThan(0.9);
    expect(nudged).toBeGreaterThan(moved);
  });

  it("is forgiving about position but not about shape", () => {
    // A box is viewport-relative, so scrolling moves everything without anything
    // changing. Position is therefore half the measure and size is the other
    // half: an element that moved a long way but is still the same shape keeps a
    // moderate score, and one that changed shape does not.
    const movedFar = boxProximity([16, 120, 348, 34], [16, 900, 348, 34]);
    const reshaped = boxProximity([16, 120, 348, 34], [16, 120, 40, 20]);
    expect(movedFar).toBeGreaterThan(0.5);
    expect(reshaped).toBeLessThan(0.55);
    expect(reshaped).toBeLessThan(movedFar);

    // Moved *and* reshaped is the weakest of the three.
    expect(boxProximity([16, 120, 348, 34], [900, 900, 40, 20])).toBeLessThan(reshaped);
  });

  it("a resized element scores lower than one that only moved a little", () => {
    expect(boxProximity([16, 120, 348, 34], [16, 120, 40, 20])).toBeLessThan(
      boxProximity([16, 120, 348, 34], [30, 130, 348, 34]),
    );
  });
});

describe("scoring an element against a fingerprint", () => {
  it("scores an unchanged element at 1", () => {
    const score = scoreAgainst(RECORDED, live());
    expect(score.total).toBeCloseTo(1, 6);
  });

  it("survives a change to any single measure", () => {
    const changes: Array<[string, Partial<ElementDescription>]> = [
      ["the test id was dropped", { attrs: { id: "username", name: "username", type: "text" } }],
      ["the surrounding text was rewritten", { neighbours: { before: ["Log in"], after: ["Secret"] } }],
      ["a wrapper was added", { rolePath: ["main", "region", "form"] }],
      ["the field moved down the page", { box: [16, 420, 348, 34] }],
    ];
    for (const [what, change] of changes) {
      const score = scoreAgainst(RECORDED, live(change));
      expect(score.total, `${what}: scored ${score.total}`).toBeGreaterThan(DEFAULT_THRESHOLD);
    }
  });

  it("scores a different element well below the threshold", () => {
    const other = live({
      tag: "button",
      role: "button",
      attrs: { id: "login-submit", type: "submit" },
      text: "Sign In",
      neighbours: { before: ["Remember me"], after: [] },
      rolePath: ["navigation"],
      box: [900, 40, 80, 30],
    });
    expect(scoreAgainst(RECORDED, other).total).toBeLessThan(DEFAULT_THRESHOLD);
  });

  it("reports each measure, so a heal report can say why", () => {
    const score = scoreAgainst(RECORDED, live({ box: [900, 900, 40, 20], rolePath: ["navigation"] }));
    expect(Object.keys(score).sort()).toEqual(["attrs", "box", "neighbours", "rolePath", "text", "total"]);
    expect(score.attrs).toBe(1);
    expect(score.rolePath).toBe(0);
    expect(score.box).toBeLessThan(0.4);
    // Still above the threshold: the attributes are unchanged, and an element
    // whose id, name, type and test id all match is the same element however far
    // it moved. That is the weighting doing what LLD §6.4 asks of it.
    expect(score.total).toBeGreaterThan(DEFAULT_THRESHOLD);
  });
});

describe("the threshold and the margin (LLD §6.4)", () => {
  it("relocalizes when one element clears the threshold and the field", () => {
    const ranked = rank(RECORDED, [live(), live({ ref: "r9", attrs: {}, rolePath: [], box: [800, 800, 10, 10] })]);
    const decision = decide(ranked);
    expect(decision.outcome).toBe("relocalized");
    if (decision.outcome !== "relocalized") return;
    expect(decision.match.ref).toBe("r5");
  });

  it("refuses when nothing clears the threshold", () => {
    const decision = decide(rank(RECORDED, [live({ ref: "r9", attrs: {}, rolePath: [], text: "unrelated", neighbours: { before: [], after: [] }, box: [900, 900, 10, 10] })]));
    expect(decision.outcome).toBe("not-found");
    if (decision.outcome !== "not-found") return;
    expect(decision.best?.score.total).toBeLessThan(DEFAULT_THRESHOLD);
  });

  it("refuses when two elements are too close to tell apart", () => {
    // Two identical buttons: the fingerprint cannot say which is which, and
    // accepting the higher would be a coin toss dressed as a repair.
    const twin = live({ ref: "r6" });
    const decision = decide(rank(RECORDED, [live(), twin]));
    expect(decision.outcome).toBe("ambiguous");
    if (decision.outcome !== "ambiguous") return;
    expect(decision.margin).toBeLessThan(DEFAULT_MARGIN);
    expect([decision.best.ref, decision.runnerUp.ref].sort()).toEqual(["r5", "r6"]);
  });

  it("accepts when the runner-up is far enough behind", () => {
    const distant = live({ ref: "r6", attrs: {}, text: "Password", rolePath: ["navigation"], box: [600, 600, 20, 20] });
    expect(decide(rank(RECORDED, [live(), distant])).outcome).toBe("relocalized");
  });

  it("honours a threshold and a margin the caller sets", () => {
    const weak = live({ attrs: {}, neighbours: { before: [], after: [] }, rolePath: [] });
    expect(decide(rank(RECORDED, [weak])).outcome).toBe("not-found");
    expect(decide(rank(RECORDED, [weak]), { threshold: 0.2 }).outcome).toBe("relocalized");

    const twins = rank(RECORDED, [live(), live({ ref: "r6" })]);
    expect(decide(twins).outcome).toBe("ambiguous");
    expect(decide(twins, { margin: 0 }).outcome).toBe("relocalized");
  });

  it("refuses an empty page rather than throwing", () => {
    expect(decide([]).outcome).toBe("not-found");
  });

  it("tells a renamed desktop rail row from its section header by class (app.heal.renamed-control)", () => {
    /*
     * The macOS gate's case, as a desktop adapter describes it: the Flows rail
     * row is renamed "Editor", and directly above it is the Automations
     * section header — another current button, in the same place, among the
     * same neighbours. A desktop description carried no attribute on the
     * fingerprint's list, so the two were one score apart only by position
     * and the healer rightly refused (0.750 against 0.697 on the runner).
     * The classes Chromium publishes are what the web fingerprint already had.
     */
    const rail = (renamed: boolean): string[] => [
      "Surfaces section",
      "Surfaces",
      "Automations section",
      renamed ? "Editor" : "Flows",
      "Bindings",
      "API",
      "Data",
    ];
    const classes = ["sv-rail-heading sv-rail-section", "sv-rail-item", "sv-rail-heading sv-rail-section sv-rail-section-active", "sv-rail-item sv-rail-active", "sv-rail-item", "sv-rail-item", "sv-rail-item"];
    const described = (names: string[], at: number, withClasses: boolean): ElementDescription => ({
      ref: `r${at}`,
      role: "button",
      name: names[at]!,
      tag: "AXButton",
      attrs: { axRole: "AXButton" },
      text: names[at]!,
      neighbours: { before: names.slice(Math.max(0, at - 3), at), after: names.slice(at + 1, at + 4) },
      rolePath: ["window", "navigation", "button"],
      box: [8, 40 + at * 30, 184, 28],
      index: at,
      states: [],
      native: withClasses ? { stableClasses: classes[at]! } : {},
    });
    const heal = (withClasses: boolean) => {
      const recorded = fingerprintOf(described(rail(false), 3, withClasses));
      const renamed = rail(true);
      return decide(rank(recorded, renamed.map((_, at) => described(renamed, at, withClasses))));
    };

    // Right, and unable to say so: the best is the renamed row, and a
    // neighbouring button is within the margin of it.
    const without = heal(false);
    expect(without.outcome).toBe("ambiguous");
    if (without.outcome === "ambiguous") expect(without.best.description.name).toBe("Editor");

    const withClasses = heal(true);
    expect(withClasses.outcome).toBe("relocalized");
    if (withClasses.outcome === "relocalized") expect(withClasses.match.description.name).toBe("Editor");
  });

  it("ranks best first", () => {
    const ranked = rank(RECORDED, [
      live({ ref: "r9", attrs: {}, rolePath: [], box: [800, 800, 10, 10] }),
      live(),
    ]);
    expect(ranked.map((m) => m.ref)).toEqual(["r5", "r9"]);
    expect(ranked[0]!.score.total).toBeGreaterThan(ranked[1]!.score.total);
  });
});

describe("relocalize over a surface", () => {
  function surfaceWith(descriptions: ElementDescription[]): StubSurface {
    const nodes = descriptions.map((d, i) => ({
      ref: d.ref,
      role: d.role,
      states: [] as never[],
      depth: i === 0 ? 0 : 1,
      ...(d.name === undefined ? {} : { name: d.name }),
    }));
    return new StubSurface({
      snapshot: buildSnapshot(nodes[0]?.ref ?? "r0", nodes, structuralHash(nodes)),
      descriptions: Object.fromEntries(descriptions.map((d) => [d.ref, d])),
    });
  }

  it("finds the element the fingerprint describes", async () => {
    const surface = surfaceWith([
      live({ ref: "r1", role: "button", attrs: { id: "submit" }, text: "Sign In", rolePath: ["main"], box: [16, 300, 100, 30] }),
      live({ ref: "r5" }),
    ]);
    const result = await relocalize(surface, RECORDED);
    expect(result.outcome).toBe("relocalized");
    if (result.outcome !== "relocalized") return;
    expect(result.match.ref).toBe("r5");
  });

  it("narrows to the recorded role first, and widens when nothing of that role fits", async () => {
    // The control was a textbox and is now a searchbox — variant 11's change.
    const surface = surfaceWith([
      live({ ref: "r1", role: "textbox", attrs: {}, rolePath: [], neighbours: { before: [], after: [] }, box: [900, 900, 10, 10] }),
      live({ ref: "r5", role: "searchbox" }),
    ]);
    const result = await relocalize(surface, RECORDED, { preferRole: "textbox" });
    expect(result.outcome).toBe("relocalized");
    if (result.outcome !== "relocalized") return;
    expect(result.match.ref).toBe("r5");
  });

  it("returns not-found when the element really has gone", async () => {
    const surface = surfaceWith([
      live({ ref: "r1", role: "button", attrs: { id: "x" }, text: "Elsewhere", neighbours: { before: [], after: [] }, rolePath: ["navigation"], box: [900, 900, 20, 20] }),
    ]);
    expect((await relocalize(surface, RECORDED)).outcome).toBe("not-found");
  });

  it("returns ambiguous rather than picking one of two identical elements", async () => {
    const surface = surfaceWith([live({ ref: "r5" }), live({ ref: "r6" })]);
    const result = await relocalize(surface, RECORDED);
    expect(result.outcome).toBe("ambiguous");
  });

  it("gives the whole ranking, so a report can show what was considered", async () => {
    const surface = surfaceWith([
      live({ ref: "r1", role: "button", attrs: {}, text: "Sign In", rolePath: ["main"], box: [16, 300, 100, 30] }),
      live({ ref: "r5" }),
    ]);
    const result = await relocalize(surface, RECORDED);
    expect(result.ranked).toHaveLength(2);
    expect(result.ranked[0]!.score.total).toBeGreaterThanOrEqual(result.ranked[1]!.score.total);
  });
});
