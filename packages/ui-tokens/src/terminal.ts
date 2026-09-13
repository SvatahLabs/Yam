/**
 * The tokens, rendered for a terminal (TV-C03, TV-05).
 *
 * Here rather than in `@svatah/yam-tui` because two things need it and only one
 * of them draws with Ink: the cockpit, and every ordinary command. `yam run`
 * printing a green "passed" and `yam ui` printing a different green would be two
 * products, and pulling React into a command that prints eight lines to say so
 * would be worse.
 *
 * No `process` and no `ink`: capability detection takes what it is given, so a
 * test can state a terminal rather than being run in one.
 */
import { STATUS, THEMES, type StatusTone, type Theme } from "./index.js";

/** What a terminal can do, as far as it will admit. */
export interface Capabilities {
  readonly truecolor: boolean;
  readonly ansi256: boolean;
  readonly colour: boolean;
  readonly mouse: boolean;
}

/**
 * What this terminal can do (TV-05).
 *
 * `COLORTERM` is the only reliable statement a terminal makes about 24-bit
 * colour, and `NO_COLOR` is the only reliable statement a *person* makes about
 * wanting none. Neither is guessed at, and `--color` overrides both.
 */
export function capabilitiesOf(
  stdout: { isTTY?: boolean } | undefined,
  env: Record<string, string | undefined>,
): Capabilities {
  const tty = stdout?.isTTY === true;
  const noColour = env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "";
  const term = env["TERM"] ?? "";
  const colorterm = env["COLORTERM"] ?? "";
  const truecolor = /truecolor|24bit/i.test(colorterm);
  const ansi256 = truecolor || /-256color|^xterm-kitty$|^alacritty/.test(term);
  return {
    truecolor: tty && !noColour && truecolor,
    ansi256: tty && !noColour && ansi256,
    colour: tty && !noColour && term !== "dumb",
    mouse: tty && term !== "dumb",
  };
}


/**
 * Which theme a terminal is on (`EX-02`).
 *
 * A terminal has no `prefers-color-scheme`, and for a long time that was taken
 * to mean it has no preference — so the cockpit drew the dark table on a light
 * terminal and the status words came out pale on white.
 *
 * It does state one, in two ways, and both are read here:
 *
 *   * `YAM_THEME` — a person saying it outright, which is the cockpit's
 *     equivalent of `[data-theme]` and beats everything;
 *   * `COLORFGBG` — the terminal saying what its background is. Set by xterm,
 *     rxvt, Konsole and iTerm2, as `fg;bg` or `fg;default;bg`. The convention is
 *     the one vim reads: a background of 0–6 or 8 is dark, anything else light.
 *
 * Dark when neither says anything, because the tokens are dark-first and a
 * guess that matches the default is the cheapest guess to be wrong about.
 */
export function appearanceOf(env: Record<string, string | undefined>): Theme {
  const asked = (env["YAM_THEME"] ?? "").toLowerCase();
  if (asked === "light" || asked === "dark") return asked;

  const fgbg = env["COLORFGBG"];
  if (fgbg !== undefined && fgbg !== "") {
    const background = Number.parseInt(fgbg.split(";").pop() ?? "", 10);
    if (Number.isFinite(background)) {
      return (background >= 0 && background <= 6) || background === 8 ? "dark" : "light";
    }
  }
  return "dark";
}

/** A token's value, for the theme the terminal is on. */
export const tokenHex = (name: keyof (typeof THEMES)["dark"], appearance: Theme = "dark"): string =>
  THEMES[appearance][name];

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
export function tone(
  what: StatusTone,
  text: string,
  depth: ColourDepth,
  appearance: Theme = "dark",
): string {
  if (depth === "none" || text === "") return text;
  return `${foreground(hexOf(what, appearance), depth)}${text}${RESET}`;
}

/**
 * The hexadecimal a tone is, for a renderer that colours its own way.
 *
 * `STATUS` records the dark table's value, because a constant can only hold one.
 * The theme is the argument, and it defaults to dark so that every caller
 * written before there was a choice still means what it meant.
 */
export const hexOf = (what: StatusTone, appearance: Theme = "dark"): string =>
  appearance === "dark" ? STATUS[what].hex : THEMES[appearance][STATUS[what].token];

