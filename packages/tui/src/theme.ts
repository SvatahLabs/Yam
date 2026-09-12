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
  capabilitiesOf,
  depthFor,
  foreground,
  hexOf,
  tone,
  ansi256Of,
  rgbOf,
  RESET,
  type ColourDepth,
  type StatusTone,
} from "@svatah/yam-ui-tokens";

/*
 * The colour itself moved to `@svatah/yam-ui-tokens` (TV-C03), because every
 * ordinary command needs it too and pulling React into `yam run` to print a
 * green "passed" would be absurd. What stays here is the half that is about
 * Ink.
 */
export { capabilitiesOf, depthFor, foreground, hexOf, tone, ansi256Of, rgbOf, RESET };
export type { ColourDepth };

/**
 * What Ink is told, which is a hexadecimal or a name.
 *
 * Ink accepts `#rrggbb` and downgrades it itself, and it accepts the eight
 * names. At `none` the answer is `undefined`, because "no colour" is the absence
 * of the prop rather than a colour called none.
 */
export function inkColour(what: StatusTone, depth: ColourDepth): string | undefined {
  if (depth === "none") return undefined;
  if (depth === "truecolor") return STATUS[what].hex;
  return STATUS[what].ansi;
}
