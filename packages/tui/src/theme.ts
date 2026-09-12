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
import { STATUS, type StatusTone } from "@svatah/yam-ui-tokens";
import type { Capabilities } from "./terminal.js";

/** How much colour to send. */
export type ColourDepth = "truecolor" | "ansi256" | "none";

/** `--color`, and what the terminal says when nobody passed it. */
export function depthFor(capabilities: Capabilities, asked?: string): ColourDepth {
  if (asked === "none" || asked === "never") return "none";
  if (asked === "24bit" || asked === "truecolor") return "truecolor";
  if (asked === "256") return "ansi256";
  if (!capabilities.colour) return "none";
  return capabilities.truecolor ? "truecolor" : capabilities.ansi256 ? "ansi256" : "none";
}

const clamp = (one: number): number => Math.max(0, Math.min(255, one));

/** `#4fc48a` → `[79, 196, 138]`. */
export function rgbOf(hex: string): readonly [number, number, number] {
  const value = hex.replace("#", "");
  const wide = value.length === 3 ? value.split("").map((one) => one + one).join("") : value;
  return [
    clamp(Number.parseInt(wide.slice(0, 2), 16)),
    clamp(Number.parseInt(wide.slice(2, 4), 16)),
    clamp(Number.parseInt(wide.slice(4, 6), 16)),
  ];
}

/**
 * The nearest xterm-256 index, computed.
 *
 * The 6×6×6 cube for anything with colour in it and the 24-step grey ramp for
 * anything without: a hand-written table would be a second place for a token to
 * live, and this way a token that changes brings its approximation with it.
 */
export function ansi256Of(hex: string): number {
  const [r, g, b] = rgbOf(hex);
  const grey = Math.abs(r - g) < 8 && Math.abs(g - b) < 8;
  if (grey) {
    const level = Math.round(((r + g + b) / 3 - 8) / 10);
    return 232 + Math.max(0, Math.min(23, level));
  }
  const step = (one: number): number => (one < 48 ? 0 : one < 114 ? 1 : Math.round((one - 35) / 40));
  return 16 + 36 * step(r) + 6 * step(g) + step(b);
}

/** The escape that colours the foreground, for this depth. */
export function foreground(hex: string, depth: ColourDepth): string {
  if (depth === "none") return "";
  if (depth === "ansi256") return `\u001b[38;5;${ansi256Of(hex)}m`;
  const [r, g, b] = rgbOf(hex);
  return `\u001b[38;2;${r};${g};${b}m`;
}

/** And the one that stops. */
export const RESET = "\u001b[39m";

/**
 * A tone, drawn.
 *
 * `text` is never coloured *instead of* being said: the caller passes the word
 * or the glyph, and this wraps it. A tone with no word beside it is the thing
 * `REQ-ADE-12` forbids, and a function that took only a colour would make it
 * easy to write.
 */
export function tone(what: StatusTone, text: string, depth: ColourDepth): string {
  if (depth === "none" || text === "") return text;
  return `${foreground(STATUS[what].hex, depth)}${text}${RESET}`;
}

/** The hexadecimal a tone is, for a renderer that colours its own way. */
export const hexOf = (what: StatusTone): string => STATUS[what].hex;

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
