/**
 * The design tokens, rendered for a terminal (TV-T04, TV-05).
 *
 * The app and the cockpit share `@svatah/yam-ui-tokens`, and until now the
 * terminal was handed a flattened copy of it: seven tone names mapped to the
 * eight colours a 1980s terminal had. Every terminal a person actually uses
 * does 24-bit colour, and the token table has had the hexadecimal all along —
 * so the cockpit sends the token, and falls back only where it must.
 *
 * Three paths, chosen by what the terminal admits to and never guessed:
 *
 *   * **24-bit** — the token's own colour;
 *   * **256** — the nearest colour in the xterm cube, computed rather than
 *     hand-picked, so a token that changes brings its approximation with it;
 *   * **none** — no escape at all. Not a degraded colour: nothing. Every tone
 *     carries a word or a glyph beside it (`REQ-ADE-12`), which is what makes
 *     monochrome a rendering rather than a loss.
 */
import {
  STATUS,
  appearanceOf,
  capabilitiesOf,
  depthFor,
  foreground,
  hexOf,
  tone,
  ansi256Of,
  rgbOf,
  RESET,
  tokenHex,
  type THEMES,
  type ColourDepth,
  type StatusTone,
  type Theme,
} from "@svatah/yam-ui-tokens";

/*
 * The colour itself moved to `@svatah/yam-ui-tokens` (TV-C03), because every
 * ordinary command needs it too and pulling React into `yam run` to print a
 * green "passed" would be absurd. What stays here is the half that is about
 * Ink.
 */
export {
  appearanceOf,
  capabilitiesOf,
  depthFor,
  foreground,
  hexOf,
  tokenHex,
  tone,
  ansi256Of,
  rgbOf,
  RESET,
  STATUS,
};
export type { ColourDepth, Theme };

/**
 * The theme this terminal is on, resolved once (`EX-02`).
 *
 * The same decision the app makes on `<html>`, made from what a terminal is
 * willing to say about itself: `YAM_THEME` is the stated choice, `COLORFGBG` is
 * the machine's, and dark is the floor.
 */
export const APPEARANCE: Theme = appearanceOf(process.env);

/**
 * What Ink is told, which is a hexadecimal or a name.
 *
 * Ink accepts `#rrggbb` and downgrades it itself, and it accepts the eight
 * names. At `none` the answer is `undefined`, because "no colour" is the absence
 * of the prop rather than a colour called none.
 */
export function inkColour(
  what: StatusTone,
  depth: ColourDepth,
  appearance: Theme = APPEARANCE,
): string | undefined {
  if (depth === "none") return undefined;
  const hex = hexOf(what, appearance);
  if (depth === "truecolor") return hex;
  /*
   * `ansi256(n)`, computed — not `STATUS[what].ansi`, which is a name.
   *
   * The eight names are the floor this table has always carried for a terminal
   * that has only eight, and they were being sent to terminals that have 256.
   * That made the 256 path a second palette nobody maintained: `healed` was
   * "cyan" whatever the token said. Ink parses the `ansi256(n)` form, so the
   * approximation can be arithmetic on the token instead.
   */
  return `ansi256(${ansi256Of(hex)})`;
}

/**
 * The chrome, from the tokens rather than from Ink's eight names (TV-05,
 * `EX-01`, `CX-02`).
 *
 * The borders and the status bar were `"magenta"` and `"gray"` written as
 * literals — so the one thing the token pipeline was built for was the one thing
 * bypassing it, and the focused border came out as the terminal's magenta.
 *
 * Three depths, and 256 is the one that changed. It used to answer with Ink's
 * colour *names*, which is a second, hand-picked palette: `accent` became
 * whatever the terminal calls magenta, and a token that moved left it behind.
 * Now it is `ansi256(n)` computed from the token, the same arithmetic
 * `foreground()` does — so the cockpit approximates the brand rather than
 * naming a different colour. At `none` there is no escape at all, and the bold
 * border style is what carries focus instead: focus is never colour alone.
 *
 * `brand` and `accent` are two roles, as they are on the site and in the app.
 * The mark, the current rail entry and a primary key are the brand; a focused
 * border and a selected row are the accent.
 */
export interface Chrome {
  /** Focus, selection — the site's `--accent`. */
  readonly accent: string | undefined;
  /** What reads on top of `accent`. */
  readonly accentInk: string | undefined;
  /** The product's own colour — the site's `--yam`. */
  readonly brand: string | undefined;
  /** What reads on top of `brand`. */
  readonly brandInk: string | undefined;
  /** An unfocused border. */
  readonly line: string | undefined;
  readonly barBg: string | undefined;
  readonly barFg: string | undefined;
  /** Body text, where a terminal's own foreground is not what is wanted. */
  readonly fg: string | undefined;
  /** A label beside something louder: a key's name, a hint. */
  readonly fg2: string | undefined;
  /** Secondary text: a key nobody has pressed, a row that is not current. */
  readonly dim: string | undefined;
}

/**
 * Ink props for a colour that may not exist.
 *
 * At `none` every entry of `Chrome` is `undefined`, and Ink's contract is that
 * no colour means *no prop* — passing `color={undefined}` is fine but writing
 * the ternary at forty call sites is how `color="gray"` survived at thirteen of
 * them. One helper, so the monochrome path is impossible to forget.
 */
export const ink = (colour: string | undefined): { color?: string } =>
  colour === undefined ? {} : { color: colour };

export const inkBg = (colour: string | undefined): { backgroundColor?: string } =>
  colour === undefined ? {} : { backgroundColor: colour };

export function chrome(depth: ColourDepth, appearance: Theme = APPEARANCE): Chrome {
  const of = (token: keyof (typeof THEMES)["dark"]): string | undefined => {
    if (depth === "none") return undefined;
    const hex = tokenHex(token, appearance);
    return depth === "truecolor" ? hex : `ansi256(${ansi256Of(hex)})`;
  };
  return {
    accent: of("accent"),
    accentInk: of("accent-ink"),
    brand: of("yam"),
    brandInk: of("yam-ink"),
    line: of("line2"),
    barBg: of("bg2"),
    barFg: of("muted"),
    fg: of("fg"),
    fg2: of("fg2"),
    dim: of("dim"),
  };
}

/**
 * The chrome, resolved once for this terminal (TV-05).
 *
 * Depth from what the terminal admits to, theme from what it says it is on.
 */
export const CHROME = chrome(depthFor(capabilitiesOf(process.stdout, process.env)), APPEARANCE);
