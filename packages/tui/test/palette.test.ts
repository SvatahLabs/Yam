/**
 * The palette's matching and ordering (TV-T13, TV-08).
 *
 * The old palette matched with `includes` and could not move its selection, so
 * `Enter` ran the first row whatever a person had in mind and an action four
 * rows down was reachable only by typing until it was first. What is asserted
 * here is the arithmetic: that a subsequence finds what a person meant, that
 * what they are doing when they type raises a score, and that an action which
 * cannot run is listed with the reason rather than hidden.
 */
import { describe, expect, it } from "vitest";
import { ACTIONS, type ScreenStateBase } from "@svatah/yam-screens";
import { moveSelection, rowsFor, score } from "../src/palette.js";

const state = (over: Record<string, unknown> = {}): ScreenStateBase =>
  ({ screen: "session", title: "", subtitle: "", status: "", sources: ["x"], ...over }) as ScreenStateBase;

describe("a subsequence, not a substring", () => {
  it("finds what the initials meant", () => {
    expect(score("hl", "Heal run comp")).toBeDefined();
    expect(score("hrc", "Heal run comp")).toBeDefined();
    expect(score("zzz", "Heal run comp")).toBeUndefined();
  });

  it("prefers the start of a word to the middle of one", () => {
    const start = score("r", "Run the flow")!.score;
    const middle = score("r", "Perform the action")!.score;
    expect(start).toBeGreaterThan(middle);
  });

  it("prefers characters typed together", () => {
    const together = score("run", "Run the flow")!.score;
    const scattered = score("run", "Recheck unavailable now")!.score;
    expect(together).toBeGreaterThan(scattered);
  });

  it("says which characters it matched, for the highlight", () => {
    expect(score("he", "Heal")!.hits).toEqual([0, 1]);
  });

  it("matches everything on an empty query", () => {
    expect(score("", "anything")).toEqual({ score: 0, hits: [] });
  });
});

describe("what the palette offers, and in what order (TV-08)", () => {
  it("lists an action it cannot run, with the reason", () => {
    /*
     * An action that vanishes teaches nothing, and a person who typed its name
     * deserves to be told why rather than left wondering if they misremembered.
     */
    const rows = rowsFor(ACTIONS, { query: "act", state: state() });
    const act = rows.find((one) => one.id === "surface.act");
    expect(act, "surface.act is not offered at all").toBeDefined();
    expect(act!.available).toBe(false);
    expect(act!.why).toBeDefined();
  });

  it("puts everything that can run above everything that cannot", () => {
    const rows = rowsFor(ACTIONS, { query: "", state: state() });
    const lastAvailable = rows.map((one) => one.available).lastIndexOf(true);
    const firstUnavailable = rows.findIndex((one) => !one.available);
    expect(firstUnavailable, "nothing is unavailable in this fixture").toBeGreaterThan(-1);
    expect(lastAvailable, "an available action sorted below an unavailable one").toBeLessThan(
      firstUnavailable,
    );
  });

  it("puts what was just run at the top of an empty query", () => {
    const rows = rowsFor(ACTIONS, { query: "", state: state(), recents: ["go.settings"] });
    expect(rows[0]!.id).toBe("go.settings");
  });

  it("finds by the CLI command as well as the label", () => {
    const rows = rowsFor(ACTIONS, { query: "yam heal", state: state() });
    expect(rows.some((one) => one.id.startsWith("heal."))).toBe(true);
  });

  it("offers nothing for a query nothing matches", () => {
    expect(rowsFor(ACTIONS, { query: "qzx", state: state() })).toEqual([]);
  });
});

describe("the selection moves, and stops at the ends", () => {
  it("clamps rather than wrapping", () => {
    expect(moveSelection(0, -1, 5)).toBe(0);
    expect(moveSelection(4, 1, 5)).toBe(4);
    expect(moveSelection(2, 1, 5)).toBe(3);
    expect(moveSelection(0, 1, 0)).toBe(0);
  });
});
