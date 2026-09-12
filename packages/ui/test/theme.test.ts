/**
 * T9.2 Validate — "the two themes differ only in tokens".
 *
 * The claim has two halves and they are checked separately, because only one of
 * them is about the stylesheet:
 *
 * 1. **The stylesheet has one theme in it.** `ui.css` reads tokens and never a
 *    colour, and there is no `[data-theme="light"]` rule in it: the only place
 *    the light theme exists is `@svatah/yam-ui-tokens`'s second table. A rule that
 *    said `.sv-btn-primary { background: #b8a1ff }` would work in the dark and
 *    be invisible in the light, and nobody would notice until a screenshot.
 * 2. **The two token tables have the same keys.** A token defined in one theme
 *    and not the other is a variable that resolves to nothing on half the
 *    application.
 *
 * The third half — that the colours are legible — is `scripts/audit-sheet.mjs`'s
 * contrast check, which is run against the rendered sheet in both themes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DARK, LIGHT, TOKEN_NAMES, declarations, stylesheet } from "@svatah/yam-ui-tokens";

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_CSS = readFileSync(join(HERE, "..", "ui.css"), "utf8");
const TOKENS_CSS = readFileSync(
  join(HERE, "..", "..", "ui-tokens", "tokens.css"),
  "utf8",
);

describe("the component stylesheet is theme-free (T9.2)", () => {
  it("has no theme selector: the tokens are the only place a theme exists", () => {
    expect(UI_CSS).not.toContain('[data-theme="light"]');
    expect(UI_CSS).not.toContain('[data-theme="dark"]');
  });

  it("names no colour of its own outside the shadow and the overlay", () => {
    /*
     * Two `rgba(0,0,0,…)` values survive: the palette's drop shadow and its
     * overlay scrim. Both are black at low alpha over whatever is behind them,
     * which is the same thing in either theme, and a token for "shadow" would
     * be a token with one value.
     */
    const colours = [...UI_CSS.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map(
      (match) => match[0],
    );
    expect(colours.filter((one) => !/^rgba\(0, 0, 0/.test(one))).toEqual([]);
  });

  it("reads its colours from tokens, and only from tokens that exist", () => {
    const used = new Set(
      [...UI_CSS.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((match) => match[1]!),
    );
    const defined = new Set<string>([
      ...TOKEN_NAMES,
      // The metrics and the font stacks, which `tokens.css` declares beside the
      // colours.
      "r",
      "r2",
      "control-h",
      "row-pad",
      "rail-w",
      "inspector-w",
      "topbar-h",
      "statusbar-h",
      "sans",
      "mono",
    ]);
    for (const one of used) {
      expect(defined.has(one), `ui.css uses --${one}, which no theme defines`).toBe(true);
    }
    // And it actually uses them: a stylesheet with no `var()` would pass the
    // two checks above by saying nothing.
    expect(used.size).toBeGreaterThan(15);
  });
});

describe("state changes are seen rather than jumped (TV-A04, TV-16)", () => {
  it("has motion at all, which it did not", () => {
    /*
     * `grep -c transition` over this stylesheet and the app's returned nought
     * and nought. In an app that receives events while a person watches, an
     * arriving row and a changing status were silent instant jumps —
     * indistinguishable from something that had always been there.
     */
    expect(UI_CSS).toMatch(/transition:/);
    expect(UI_CSS).toMatch(/@keyframes/);
  });

  it("takes its durations from tokens, so quick means one thing", () => {
    expect(UI_CSS).toMatch(/var\(--motion-quick\)/);
    expect(UI_CSS).toMatch(/var\(--motion-settle\)/);
  });

  it("replaces motion rather than removing it, for whoever asked for none", () => {
    /*
     * The information was never the movement: it was that something happened. So
     * with reduced motion an arrival is announced instead of animated.
     */
    const reduced = UI_CSS.slice(UI_CSS.indexOf("prefers-reduced-motion"));
    expect(reduced).toMatch(/animation: none/);
    expect(reduced).toMatch(/outline:/);
  });
});

describe("the two themes define the same tokens (T9.2)", () => {
  it("has every token in both", () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
    expect(Object.keys(DARK).sort()).toEqual([...TOKEN_NAMES].sort());
  });

  it("gives every token a different value in the two themes, or says why not", () => {
    /*
     * `skip` is deliberately the same grey in both (`#8b96a5` in the dark table
     * is `dim` in the light one, and the skip colour is `#5b6472`) — so this is
     * not "every value differs", which would be a rule about a palette rather
     * than about a design. What it checks is that nothing was *forgotten*: a
     * token copied from the dark table into the light one unchanged is almost
     * always a token nobody looked at.
     */
    /*
     * Motion is the same in both, deliberately (TV-A04). A duration is not a
     * colour: how long a row takes to arrive is a property of the interaction,
     * and a light theme in which things moved faster would be a different
     * product wearing the same components. Named, so that a *colour* which
     * turned up here still fails.
     */
    const shared = new Set(["motion-quick", "motion-settle", "motion-ease"]);
    const identical = TOKEN_NAMES.filter((name) => DARK[name] === LIGHT[name] && !shared.has(name));
    expect(identical).toEqual([]);
  });

  it("writes both tables into tokens.css, dark at :root", () => {
    expect(TOKENS_CSS).toContain(":root {");
    expect(TOKENS_CSS).toContain('[data-theme="light"] {');
    expect(TOKENS_CSS).toContain(declarations("dark"));
    expect(TOKENS_CSS).toContain(declarations("light"));
  });

  it("is generated, so the stylesheet and the table cannot drift", () => {
    expect(TOKENS_CSS).toBe(stylesheet());
  });

  it("packages the fonts rather than fetching them (REQ-NFR-1, the phase's rule)", () => {
    expect(TOKENS_CSS).toContain("@font-face");
    expect(TOKENS_CSS).toContain('url("./fonts/IBMPlexSans-latin.woff2")');
    // `docs/spec/design/base.css` opens with a Google Fonts `@import`. Shipping
    // that would make the first paint of a local-only application a network
    // call — and one that fails on an air-gapped machine.
    expect(TOKENS_CSS).not.toContain("fonts.googleapis.com");
    expect(TOKENS_CSS).not.toContain("@import");
  });
});
