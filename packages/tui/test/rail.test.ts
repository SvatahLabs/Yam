/**
 * The rail strip (TV-14).
 *
 * The properties are the ones a person relies on: the current screen is always
 * on the row, the row never exceeds the terminal, and a row that has scrolled
 * says so.
 */
import { describe, expect, it } from "vitest";
import { RAIL_ENTRIES, railRow, screenForJump, walk } from "../src/rail.js";
import { SCREEN_IDS } from "@svatah/yam-screens";

const printed = (row: ReturnType<typeof railRow>): number => {
  const entries = row.entries.reduce((sum, one) => sum + one.key.length + 1 + one.label.length + 2, 0);
  return 1 + entries + (row.more.left ? 1 : 0) + (row.more.right ? 1 : 0);
};

describe("the strip always shows where you are", () => {
  it("keeps the current screen on the row at every width", () => {
    for (const entry of RAIL_ENTRIES) {
      for (let width = 20; width <= 200; width += 1) {
        const row = railRow(entry.screen, width);
        expect(
          row.entries.some((one) => one.current),
          `${entry.screen} at ${width}`,
        ).toBe(true);
      }
    }
  });

  it("never prints wider than the terminal", () => {
    for (const entry of RAIL_ENTRIES) {
      for (let width = 20; width <= 200; width += 1) {
        expect(printed(railRow(entry.screen, width)), `${entry.screen} at ${width}`).toBeLessThanOrEqual(width);
      }
    }
  });

  it("says when it has scrolled, and does not when it has not", () => {
    const narrow = railRow("settings", 40);
    expect(narrow.more.left || narrow.more.right).toBe(true);
    const wide = railRow("settings", 200);
    expect(wide.entries.length).toBe(RAIL_ENTRIES.length);
    expect(wide.more).toEqual({ left: false, right: false });
  });
});

describe("every destination is reachable", () => {
  it("gives each rail screen a jump key that names it back", () => {
    for (const entry of RAIL_ENTRIES) {
      expect(entry.key, entry.screen).not.toBe("");
      expect(screenForJump(entry.key)).toBe(entry.screen);
    }
  });

  /*
   * The strip sits above regions numbered `1`–`4`. It was numbered `1`–`9`
   * first, which put the same digits on the screen twice meaning two things —
   * the ambiguity TV-15 rejected for the mode strip, one row higher. This is
   * the rule that keeps it out.
   */
  it("uses no key a region is focused with", () => {
    for (const entry of RAIL_ENTRIES) expect("1234").not.toContain(entry.key);
  });

  it("gives no two destinations the same key", () => {
    const keys = RAIL_ENTRIES.map((one) => one.key);
    expect(new Set(keys).size, keys.join("")).toBe(keys.length);
  });

  it("walks the whole rail and returns to where it started", () => {
    let at = RAIL_ENTRIES[0]!.screen;
    for (let step = 0; step < RAIL_ENTRIES.length; step += 1) at = walk(at, 1);
    expect(at).toBe(RAIL_ENTRIES[0]!.screen);
  });

  /*
   * `run` and `heal` are reached by opening a row, not from the rail — the app
   * does not list them either. What must not happen is a screen that neither
   * renderer can reach, so this states which those two are rather than letting
   * the gap be silent.
   */
  it("leaves only the two screens the app also opens from a row", () => {
    const railed = new Set(RAIL_ENTRIES.map((one) => one.screen));
    expect(SCREEN_IDS.filter((id) => !railed.has(id)).sort()).toEqual(["heal", "run"]);
  });
});

/*
 * `CX-03`, E4.2 — the strip is held to the app's rule.
 *
 * `AX-04` made the app's rail say which destinations need a project *before*
 * they are pressed, because seven of nine led to the same wall and the only way
 * to find out was to press one. The cockpit has the same nine destinations and
 * had no such mark: `g f` from a projectless session went to the same wall.
 *
 * A bracket rather than a colour, because a monochrome terminal has to carry it
 * too — the same reason focus is never colour alone.
 */
describe("a destination that needs a project says so on the strip (CX-03)", () => {
  it("marks the project's screens shut when none is open", () => {
    const shut = railRow("session", 200, false).entries.filter((one) => one.shut);
    /* The rail's five, which is `needsProject` minus `run` and `heal` — those
       are reached *from* a run rather than from the strip. */
    expect(shut.map((one) => one.screen).sort()).toEqual([
      "api",
      "bindings",
      "data",
      "flows",
      "import",
      "runs",
    ]);
  });

  it("marks nothing shut when a project is open", () => {
    expect(railRow("session", 200, true).entries.some((one) => one.shut)).toBe(false);
  });

  it("says nothing is shut when it has not been told, rather than guessing", () => {
    /*
     * The default is "a project is open". A strip that marked everything shut
     * on a screen with a project open would be a worse lie than the one this
     * fixes, and the places that draw a strip without knowing are the places
     * that would produce it.
     */
    expect(railRow("session", 200).entries.some((one) => one.shut)).toBe(false);
  });

  it("keeps Session and Settings open, because neither is a project's", () => {
    const entries = railRow("session", 200, false).entries;
    for (const id of ["session", "settings", "agents"]) {
      expect(entries.find((one) => one.screen === id)?.shut, `${id} is marked shut`).toBe(false);
    }
  });
});
