/**
 * The tokens, rendered for a terminal (TV-T04, TV-05).
 *
 * What is asserted is that the cockpit sends the *token* where it can, an
 * approximation it computed where it cannot, and nothing at all where a person
 * asked for nothing — and that no path loses the word beside the colour.
 */
import { describe, expect, it } from "vitest";
import { STATUS, type StatusTone } from "@svatah/yam-ui-tokens";
import { ansi256Of, depthFor, foreground, hexOf, inkColour, rgbOf, tone } from "../src/theme.js";
import type { Capabilities } from "../src/terminal.js";

const caps = (over: Partial<Capabilities> = {}): Capabilities => ({
  truecolor: true,
  ansi256: true,
  colour: true,
  mouse: true,
  ...over,
});

describe("how much colour to send (TV-05)", () => {
  it("takes the terminal's word when nobody overrode it", () => {
    expect(depthFor(caps())).toBe("truecolor");
    expect(depthFor(caps({ truecolor: false }))).toBe("ansi256");
    expect(depthFor(caps({ truecolor: false, ansi256: false }))).toBe("none");
    expect(depthFor(caps({ colour: false }))).toBe("none");
  });

  it("lets --color override a terminal that is wrong about itself", () => {
    expect(depthFor(caps({ colour: false }), "24bit")).toBe("truecolor");
    expect(depthFor(caps(), "none")).toBe("none");
    expect(depthFor(caps(), "256")).toBe("ansi256");
  });
});

describe("the token itself, where the terminal can take one", () => {
  it("sends the hexadecimal the app uses, as 24-bit", () => {
    expect(foreground("#4fc48a", "truecolor")).toBe("\u001b[38;2;79;196;138m");
    expect(rgbOf("#4fc48a")).toEqual([79, 196, 138]);
  });

  it("reads a three-digit hexadecimal as well as a six", () => {
    expect(rgbOf("#fff")).toEqual([255, 255, 255]);
  });

  it("computes the nearest 256 rather than keeping a second table", () => {
    /* The cube for colour, the grey ramp for grey. */
    expect(ansi256Of("#000000")).toBe(232);
    expect(ansi256Of("#ffffff")).toBeGreaterThanOrEqual(232);
    const green = ansi256Of("#4fc48a");
    expect(green).toBeGreaterThanOrEqual(16);
    expect(green).toBeLessThanOrEqual(231);
  });

  it("sends nothing at all when there is to be no colour", () => {
    expect(foreground("#4fc48a", "none")).toBe("");
    expect(tone("pass", "passed", "none")).toBe("passed");
  });
});

describe("a tone never arrives without its word (REQ-ADE-12)", () => {
  it("wraps the word rather than replacing it", () => {
    const drawn = tone("fail", "failed", "truecolor");
    expect(drawn).toContain("failed");
    expect(drawn.endsWith("\u001b[39m")).toBe(true);
  });

  it("gives every tone a hexadecimal and a glyph", () => {
    for (const one of Object.keys(STATUS) as StatusTone[]) {
      expect(hexOf(one), one).toMatch(/^#[0-9a-f]{6}$/i);
      expect(STATUS[one].glyph.length, one).toBeGreaterThan(0);
    }
  });

  it("hands Ink the token at 24-bit and the old name at 256", () => {
    expect(inkColour("pass", "truecolor")).toBe(STATUS.pass.hex);
    expect(inkColour("pass", "ansi256")).toBe("green");
    expect(inkColour("pass", "none")).toBeUndefined();
  });
});
