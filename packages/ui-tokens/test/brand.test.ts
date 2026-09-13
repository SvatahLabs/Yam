/**
 * The tokens are the site's (`EX-01`, E0.2).
 *
 * The requirement is that the app, the cockpit and the website are drawn from
 * one set of values, and the way that stops being true is not a decision — it is
 * somebody changing one of the two and not the other. So this is two checks:
 *
 *   * the token tables carry the *recorded* site palette, which runs anywhere;
 *   * the recorded palette is what the site is serving, which runs where the
 *     site is up and says so when it is not.
 *
 * `brand/site-palette.json` is the record and `scripts/read-site.mjs` refreshes
 * it. A copy nothing re-reads goes stale; a fetch nothing records only runs on
 * one machine.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- a plain script, deliberately outside the TypeScript build.
import { fetchSitePalette, normalise, parseSitePalette, SITE_URL } from "../scripts/site-palette.mjs";
import { DARK, LIGHT, THEMES, TOKEN_NAMES, type Theme, type TokenName } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORD = JSON.parse(
  readFileSync(join(HERE, "..", "brand", "site-palette.json"), "utf8"),
) as { source: string; light: Record<string, string>; dark: Record<string, string> };

/**
 * Which of our tokens *is* one of the site's, by name.
 *
 * `bg1` is the site's `--paper` in both themes, which is why the light ramp goes
 * up at `bg1` and back down at `bg2`: the ramp is distance from the page.
 */
const BOUND: Readonly<Record<string, string>> = {
  bg0: "bg",
  bg1: "paper",
  bg2: "subtle",
  line: "line",
  fg: "ink",
  muted: "muted",
  accent: "accent",
  yam: "yam",
};

/**
 * The tokens the site has no value for, each with the reason.
 *
 * Listing them is the point. The site is a document with three neutrals and the
 * app is dense and needs six; without this table a new token could be invented
 * in any colour and no check would notice that it came from nowhere.
 */
const DERIVED: Readonly<Record<string, string>> = {
  bg3: "a step between the site's --subtle and its --line",
  line2: "a second rule, for a control's edge against a panel's",
  fg2: "between the site's --ink and its --muted",
  dim: "a fourth neutral, held to 3:1 against the page",
  "accent-ink": "what reads on top of --accent",
  "accent-soft": "--accent at a wash",
  "yam-ink": "what reads on top of --yam",
  "yam-soft": "--yam at a wash",
  pass: "a status, not the brand",
  fail: "a status, not the brand",
  skip: "a status, not the brand",
  healed: "a status, not the brand",
  abort: "a status, not the brand",
  info: "a status, not the brand",
  "pass-soft": "a status at a wash",
  "fail-soft": "a status at a wash",
  "skip-soft": "a status at a wash",
  "healed-soft": "a status at a wash",
  "abort-soft": "a status at a wash",
  "info-soft": "a status at a wash",
  scrim: "an overlay, and the one colour that is not the same in both themes",
  "motion-quick": "a duration",
  "motion-settle": "a duration",
  "motion-ease": "a curve",
};

describe("the palette is the product's own site (EX-01)", () => {
  for (const theme of ["dark", "light"] as const) {
    it(`draws the ${theme} theme's bound tokens from the site`, () => {
      const table = THEMES[theme];
      for (const [token, site] of Object.entries(BOUND)) {
        expect(
          normalise(table[token as TokenName]),
          `--${token} is not the site's --${site} in the ${theme} theme`,
        ).toBe(RECORD[theme][site]);
      }
    });
  }

  it("accounts for every token: bound to the site, or derived with a reason", () => {
    for (const name of TOKEN_NAMES) {
      const accounted = name in BOUND || name in DERIVED;
      expect(accounted, `--${name} is neither bound to the site nor recorded as derived`).toBe(true);
    }
    // And nothing lingers in the tables for a token that no longer exists.
    for (const name of [...Object.keys(BOUND), ...Object.keys(DERIVED)]) {
      expect(TOKEN_NAMES.includes(name as TokenName), `--${name} is claimed but not a token`).toBe(
        true,
      );
    }
  });

  it("keeps the brand and the focus accent apart, as the site does", () => {
    // Two roles, two values, in both themes — a single hex would be the site's
    // own distinction collapsed on the way in.
    expect(DARK.yam).not.toBe(DARK.accent);
    expect(LIGHT.yam).not.toBe(LIGHT.accent);
  });

  it("is not the palette it replaced", () => {
    // `EX-N3`: a check that passes on the design it replaces measures nothing.
    // The lavender is gone from both themes, and this is what would notice it
    // coming back.
    const all = Object.values({ ...DARK, ...LIGHT }).map((one) => one.toLowerCase());
    for (const gone of ["#b8a1ff", "#6b4fd8", "#0f1216", "#e3e8ee"]) {
      expect(all, `${gone} is the palette EX-01 replaced`).not.toContain(gone);
    }
  });
});

describe("the record and the site cannot drift (E0.2)", () => {
  it("matches what the site is serving, when the site is up", async () => {
    const live = (await fetchSitePalette()) as {
      light: Record<string, string>;
      dark: Record<string, string>;
    } | null;
    if (live === null) {
      // Not a failure and not a silent pass: the half that needs the site says
      // it did not run, and the half above ran anyway.
      console.warn(`no site at ${String(SITE_URL)}; the drift half did not run`);
      expect(RECORD.source).toContain("/styles.css");
      return;
    }
    for (const theme of ["dark", "light"] as Theme[]) {
      expect(live[theme], `the site's ${theme} palette has moved; run read-site.mjs`).toEqual(
        RECORD[theme],
      );
    }
  });

  it("would notice a stylesheet that had moved", () => {
    // Shown to bite. The site's own `:root` with one value changed: if the
    // parser were reading the wrong block, or normalising too eagerly, this
    // would come back equal.
    const sheet = `
      :root { --ifm-color-primary: #405642; }
      :root { --ink: #253029; --muted: #626a65; --line: #e0e5df; --paper: #FFF;
              --subtle: #f0f3ef; --accent: #586ec2; --yam: #112233;
              --ifm-background-color: #fafbf9; }
      html[data-theme="dark"] { --ink: #e3e9e2; --muted: #a2aea4; --line: #2d3830;
              --paper: #191f1b; --subtle: #1e2821; --accent: #a3b1f0; --yam: #7cc9ae;
              --ifm-background-color: #111613; }
    `;
    const parsed = parseSitePalette(sheet) as { light: Record<string, string> };
    expect(parsed.light["yam"]).toBe("#112233");
    expect(parsed.light["yam"]).not.toBe(RECORD.light["yam"]);
    // And `#FFF` is `#ffffff`: the two spellings of white must compare equal, or
    // the drift check fails on a formatting change.
    expect(parsed.light["paper"]).toBe("#ffffff");
  });
});
