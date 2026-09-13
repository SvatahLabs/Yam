/**
 * The tokens, rendered for a terminal (TV-T04, TV-05).
 *
 * What is asserted is that the cockpit sends the *token* where it can, an
 * approximation it computed where it cannot, and nothing at all where a person
 * asked for nothing — and that no path loses the word beside the colour.
 */
import { describe, expect, it } from "vitest";
import { STATUS, type StatusTone } from "@svatah/yam-ui-tokens";
import {
  ansi256Of,
  appearanceOf,
  chrome,
  depthFor,
  foreground,
  hexOf,
  inkColour,
  rgbOf,
  tone,
} from "../src/theme.js";
import { DARK, LIGHT } from "@svatah/yam-ui-tokens";
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

  /*
   * This read `toBe("green")`, and that was the 256 path saying a *name*.
   *
   * `STATUS[what].ansi` is the floor for a terminal that has only eight
   * colours; it was being sent to terminals that have 256, which made the whole
   * middle depth a second palette nobody maintained — `healed` was "cyan"
   * whatever the token said, and moving a token moved nothing. Ink parses the
   * `ansi256(n)` form, so the approximation is arithmetic on the token now.
   */
  it("hands Ink the token at 24-bit and a computed cube entry at 256", () => {
    expect(inkColour("pass", "truecolor")).toBe(STATUS.pass.hex);
    expect(inkColour("pass", "ansi256")).toBe(`ansi256(${ansi256Of(STATUS.pass.hex)})`);
    expect(inkColour("pass", "none")).toBeUndefined();
  });
});

/*
 * `CX-02`, `EX-01`, E0.4.
 *
 * The chrome had no test at all, which is how `"magenta"` and `"gray"` sat in
 * `widgets.tsx` through two phases: the one surface the token pipeline exists
 * for was the one bypassing it, and nothing asked.
 */
describe("the chrome is the brand, at every depth (CX-02)", () => {
  it("sends the token itself at 24-bit", () => {
    const drawn = chrome("truecolor", "dark");
    expect(drawn.accent).toBe(DARK.accent);
    expect(drawn.brand).toBe(DARK.yam);
    expect(drawn.accentInk).toBe(DARK["accent-ink"]);
    expect(drawn.line).toBe(DARK.line2);
  });

  it("computes the cube at 256 rather than naming one of eight colours", () => {
    const drawn = chrome("ansi256", "dark");
    expect(drawn.accent).toBe(`ansi256(${ansi256Of(DARK.accent)})`);
    expect(drawn.brand).toBe(`ansi256(${ansi256Of(DARK.yam)})`);
    /* Ink's own form, or it draws nothing and says nothing. */
    for (const one of Object.values(drawn)) expect(one).toMatch(/^ansi256\(\d{1,3}\)$/);
  });

  it("sends nothing at all in monochrome, so style has to carry focus", () => {
    const drawn = chrome("none", "dark");
    for (const one of Object.values(drawn)) expect(one).toBeUndefined();
  });

  it("draws the light theme on a light terminal (EX-02)", () => {
    expect(chrome("truecolor", "light").brand).toBe(LIGHT.yam);
    expect(chrome("truecolor", "light").brand).not.toBe(chrome("truecolor", "dark").brand);
  });

  it("keeps the brand and the focus accent apart, as the app does", () => {
    expect(chrome("truecolor", "dark").brand).not.toBe(chrome("truecolor", "dark").accent);
  });

  it("is not the palette it replaced", () => {
    /* `EX-N3`: the lavender, which is what a terminal drew before. */
    expect(chrome("truecolor", "dark").accent).not.toBe("#b8a1ff");
    expect(Object.values(chrome("ansi256", "dark"))).not.toContain("magenta");
    expect(Object.values(chrome("ansi256", "dark"))).not.toContain("gray");
  });
});

describe("which theme a terminal is on (EX-02)", () => {
  it("takes a stated choice over everything", () => {
    expect(appearanceOf({ YAM_THEME: "light", COLORFGBG: "15;0" })).toBe("light");
    expect(appearanceOf({ YAM_THEME: "dark" })).toBe("dark");
  });

  it("reads what the terminal says its background is", () => {
    /* xterm's form and Konsole's, both `fg;…;bg`. */
    expect(appearanceOf({ COLORFGBG: "15;0" })).toBe("dark");
    expect(appearanceOf({ COLORFGBG: "0;15" })).toBe("light");
    expect(appearanceOf({ COLORFGBG: "15;default;0" })).toBe("dark");
    expect(appearanceOf({ COLORFGBG: "0;default;7" })).toBe("light");
  });

  it("is dark when nothing says otherwise, because the tokens are dark-first", () => {
    expect(appearanceOf({})).toBe("dark");
    expect(appearanceOf({ COLORFGBG: "nonsense" })).toBe("dark");
  });
});
