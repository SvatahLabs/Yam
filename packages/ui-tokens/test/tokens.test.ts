/**
 * The tokens themselves (T9.2, REQ-ADE-12, LLD §13.7).
 *
 * What only this package can assert: that the status set is complete in both
 * the browser's terms and the terminal's, that the measurements are §13.7's
 * numbers, and that the fonts are *files on disk* rather than a URL.
 *
 * The two-theme invariants — same keys, different values, generated stylesheet
 * — are in `packages/ui/test/theme.test.ts`, beside the components that would
 * break if they failed.
 */
import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DARK,
  FONTS,
  FONT_FILES,
  LIGHT,
  METRICS,
  STATUS,
  STATUS_TONES,
  TOKEN_NAMES,
  TYPE,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = join(HERE, "..", "fonts");

describe("the status set (LLD §13.7)", () => {
  it("has the five status colours plus running and neutral", () => {
    // "five status colours (pass, fail, skip, healed, abort/warn/unverified,
    // plus running/info)", and a neutral for "not run".
    expect([...STATUS_TONES]).toEqual([
      "pass",
      "fail",
      "skip",
      "healed",
      "abort",
      "info",
      "neutral",
    ]);
  });

  it("gives every tone a glyph and an ANSI colour, so a terminal can say it too", () => {
    for (const tone of STATUS_TONES) {
      const style = STATUS[tone];
      expect(style.glyph, `${tone} has no glyph`).not.toBe("");
      expect(style.ansi, `${tone} has no ANSI colour`).toBeTypeOf("string");
      // And a token that exists, so `var(--pass)` is never `var(--undefined)`.
      for (const name of [style.token, style.soft]) {
        expect(
          TOKEN_NAMES.includes(name as (typeof TOKEN_NAMES)[number]),
          `${tone} names --${name}, which no theme defines`,
        ).toBe(true);
      }
    }
  });

  it("uses a different glyph for every tone: colour is never the only signal", () => {
    const glyphs = STATUS_TONES.map((tone) => STATUS[tone].glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});

describe("the measurements (LLD §13.7)", () => {
  it("is the artboard's density: 13 px text, 28 px controls, 4 px radii, 7 px rows", () => {
    expect(TYPE.body.size).toBe(13);
    expect(METRICS.controlHeight).toBe(28);
    expect(METRICS.radius).toBe(4);
    expect(METRICS.rowPadding).toBe(7);
  });

  it("has the shell's own measurements, so a renderer never guesses one", () => {
    expect(METRICS.railWidth).toBe(220);
    expect(METRICS.inspectorWidth).toBe(360);
    expect(METRICS.topBarHeight).toBe(44);
    expect(METRICS.statusBarHeight).toBe(28);
  });

  it("has seven type sizes and no more", () => {
    expect(Object.keys(TYPE)).toHaveLength(7);
  });
});

describe("the fonts are packaged, not fetched (REQ-NFR-1, the phase's rule)", () => {
  it("names IBM Plex Sans and Mono, with a fallback for a host that has neither", () => {
    expect(FONTS.sans).toContain("IBM Plex Sans");
    expect(FONTS.mono).toContain("IBM Plex Mono");
    // A stack that ended at the web font would render nothing before it loads.
    expect(FONTS.sans).toContain("sans-serif");
    expect(FONTS.mono).toContain("monospace");
  });

  it("ships every face it declares, as a file with bytes in it", () => {
    for (const one of FONT_FILES) {
      const path = join(FONTS_DIR, one.file);
      expect(existsSync(path), `${one.file} is declared and not shipped`).toBe(true);
      expect(statSync(path).size, `${one.file} is empty`).toBeGreaterThan(1_000);
    }
  });

  it("carries the OFL text beside them", () => {
    // IBM Plex is © 2017 IBM Corp. under the SIL Open Font License 1.1, with the
    // reserved font name "Plex". The licence travels with the files.
    const licence = join(FONTS_DIR, "OFL.txt");
    expect(existsSync(licence)).toBe(true);
    expect(statSync(licence).size).toBeGreaterThan(1_000);
  });
});

describe("the two themes are complete (T9.2)", () => {
  it("defines every token in both", () => {
    for (const name of TOKEN_NAMES) {
      expect(DARK[name], `the dark theme has no --${name}`).toBeTypeOf("string");
      expect(LIGHT[name], `the light theme has no --${name}`).toBeTypeOf("string");
    }
  });

  it("has no token in a theme that `TOKEN_NAMES` does not list", () => {
    expect(Object.keys(DARK).sort()).toEqual([...TOKEN_NAMES].sort());
    expect(Object.keys(LIGHT).sort()).toEqual([...TOKEN_NAMES].sort());
  });
});
