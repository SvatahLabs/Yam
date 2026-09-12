/**
 * `@svatah/yam-ui-tokens` — the design tokens (T9.2, REQ-ADE-12, LLD §13.7).
 *
 * > Dark-first with a light theme, IBM Plex Sans and IBM Plex Mono (OFL), one
 * > lavender accent for chrome and focus, five status colours (pass, fail, skip,
 * > healed, abort/warn/unverified, plus running/info) that never appear without
 * > a word or glyph beside them, 13 px text, 28 px controls, 4 px radii, 7 px
 * > row padding. Tokens are the seed in `docs/spec/design/base.css`.
 *
 * The values below are that file's, transcribed once. They are TypeScript
 * rather than CSS because three things need them and only one of them is a
 * stylesheet:
 *
 *   * `tokens.css` — generated from here by `scripts/write-css.mjs`, so the two
 *     cannot drift and a test can assert that the themes differ only in tokens;
 *   * `@svatah/yam-ui` — a component that needs a status colour asks for the token,
 *     never for `#4fc48a`;
 *   * `@svatah/yam-tui` — a terminal has no CSS variables, and renders the same
 *     status set as ANSI colours from the same names.
 *
 * ## Why the light theme is a second table and not a filter
 *
 * "The two themes differ only in tokens" (T9.2's Validate) is a claim about the
 * *component* layer: no component may branch on the theme. It is not a claim
 * that the light theme is the dark one inverted — it is not, and the artboard's
 * light palette was chosen by eye against WCAG contrast, not computed. So both
 * tables are written out and the check is that every token in one exists in the
 * other.
 */

/** Every token name, in the order `docs/spec/design/base.css` declares them. */
export const TOKEN_NAMES = [
  "bg0",
  "bg1",
  "bg2",
  "bg3",
  "line",
  "line2",
  "fg",
  "fg2",
  "muted",
  "dim",
  "accent",
  "accent-ink",
  "accent-soft",
  "pass",
  "fail",
  "skip",
  "healed",
  "abort",
  "info",
  "pass-soft",
  "fail-soft",
  "skip-soft",
  "healed-soft",
  "abort-soft",
  "info-soft",
  /**
   * The scrim behind a modal (the `Palette` artboard's `rgba(10,12,16,0.62)`).
   *
   * A token rather than a literal in `ui.css`, because it is the one colour that
   * is *not* the same in both themes: a 62 % black over a dark application is a
   * dimming, and over a light one it is a blackout.
   */
  "scrim",
  /*
   * Motion (TV-18… TV-A04).
   *
   * There were no transitions and no keyframes in either stylesheet — nought and
   * nought — so in an app that receives events while a person watches, arriving
   * rows and changing statuses were silent instant jumps. Durations are tokens
   * because a duration is a design decision: "quick" has to mean the same in two
   * places or the app feels assembled rather than made.
   */
  "motion-quick",
  "motion-settle",
  "motion-ease",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type Theme = "dark" | "light";

/**
 * The dark theme (`docs/spec/design/base.css`, the `Tokens` artboard).
 *
 * Dark-first: this is `:root`, and the light theme is what
 * `[data-theme="light"]` overrides.
 */
export const DARK: Readonly<Record<TokenName, string>> = {
  bg0: "#0f1216",
  bg1: "#151a20",
  bg2: "#1b2128",
  bg3: "#222a33",
  line: "#262e37",
  line2: "#313a45",
  fg: "#e3e8ee",
  fg2: "#b4bdc8",
  muted: "#8b96a5",
  dim: "#5f6a78",
  accent: "#b8a1ff",
  "accent-ink": "#1c1533",
  "accent-soft": "rgba(184,161,255,0.16)",
  pass: "#4fc48a",
  fail: "#ee6a5f",
  skip: "#8b96a5",
  healed: "#56c5d0",
  abort: "#e5b04c",
  info: "#6ea8fe",
  "pass-soft": "rgba(79,196,138,0.14)",
  "fail-soft": "rgba(238,106,95,0.14)",
  "skip-soft": "rgba(139,150,165,0.14)",
  "healed-soft": "rgba(86,197,208,0.14)",
  "abort-soft": "rgba(229,176,76,0.14)",
  "info-soft": "rgba(110,168,254,0.14)",
  scrim: "rgba(10,12,16,0.62)",
  /* A state change a person caused: fast enough to feel like the click. */
  "motion-quick": "120ms",
  /* One they did not: long enough to be seen arriving. */
  "motion-settle": "220ms",
  "motion-ease": "cubic-bezier(0.2, 0, 0, 1)",
};

/**
 * The light theme (the `Tokens` artboard's "Light" block).
 *
 * The accent darkens to `#6b4fd8` and every status colour with it: a lavender
 * that reads on `#0f1216` does not read on `#ffffff`, and "one accent" is a
 * statement about the *role* rather than about the hex.
 */
export const LIGHT: Readonly<Record<TokenName, string>> = {
  bg0: "#ffffff",
  bg1: "#f7f8fa",
  bg2: "#eef1f5",
  bg3: "#e4e8ee",
  line: "#d8dde5",
  line2: "#c5ccd6",
  fg: "#171b21",
  fg2: "#3c4553",
  muted: "#5b6472",
  /*
   * `#868f9e`, not the artboard's `#8b96a5` (a deviation, recorded in
   * `docs/spec/progress/phase-9.md`).
   *
   * The mockup's light `dim` is 2.998:1 against `#ffffff` — three thousandths
   * under WCAG AA's 3:1 for a large or bold glyph, and well under the 4.5:1 a
   * 10.5 px section label would want. `scripts/audit-sheet.mjs` measures it and
   * fails, which is what the audit is for. Darkened by five units of lightness
   * to 3.26:1; on the dark theme `dim` is unchanged.
   */
  dim: "#868f9e",
  accent: "#6b4fd8",
  "accent-ink": "#ffffff",
  "accent-soft": "rgba(107,79,216,0.12)",
  pass: "#1f7a45",
  fail: "#b3261e",
  skip: "#5b6472",
  healed: "#0f7f8a",
  abort: "#8a5f10",
  info: "#2f5bd7",
  "pass-soft": "rgba(31,122,69,0.12)",
  "fail-soft": "rgba(179,38,30,0.12)",
  "skip-soft": "rgba(91,100,114,0.12)",
  "healed-soft": "rgba(15,127,138,0.12)",
  "abort-soft": "rgba(138,95,16,0.12)",
  "info-soft": "rgba(47,91,215,0.12)",
  scrim: "rgba(23,27,33,0.38)",
  /* A state change a person caused: fast enough to feel like the click. */
  "motion-quick": "120ms",
  /* One they did not: long enough to be seen arriving. */
  "motion-settle": "220ms",
  "motion-ease": "cubic-bezier(0.2, 0, 0, 1)",
};

export const THEMES: Readonly<Record<Theme, Readonly<Record<TokenName, string>>>> = {
  dark: DARK,
  light: LIGHT,
};

/**
 * The five status colours, and the word each must appear with (LLD §13.7).
 *
 * > five status colours […] that never appear without a word or glyph beside
 * > them.
 *
 * The rule is enforced in `@svatah/yam-ui`: `Pill` takes a label and refuses an
 * empty one. This table is what a renderer maps a status onto, so a terminal
 * and a browser call the same outcome the same thing.
 */
export const STATUS_TONES = ["pass", "fail", "skip", "healed", "abort", "info", "neutral"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

export interface StatusStyle {
  /** The token to colour the text with. */
  readonly token: TokenName | "fg2";
  /** The token behind it, for a pill. */
  readonly soft: TokenName | "bg3";
  /** The glyph the terminal and the editor gutter use, beside the word. */
  readonly glyph: string;
  /**
   * The ANSI colour name, for a terminal that has only eight (TV-05).
   *
   * The floor, not the intent. `hex` is what a terminal that admits to 24-bit
   * colour is sent, and `@svatah/yam-tui`'s `theme.ts` chooses between them by
   * capability — so the cockpit and the app draw a tone from the same table
   * rather than from a flattened copy of it.
   */
  readonly ansi: "green" | "red" | "gray" | "cyan" | "yellow" | "blue" | "white";
  /** The token's own colour, for a terminal that can be sent one. */
  readonly hex: string;
}

export const STATUS: Readonly<Record<StatusTone, StatusStyle>> = {
  pass: { token: "pass", soft: "pass-soft", hex: DARK["pass"], glyph: "✓", ansi: "green" },
  fail: { token: "fail", soft: "fail-soft", hex: DARK["fail"], glyph: "✗", ansi: "red" },
  skip: { token: "skip", soft: "skip-soft", hex: DARK["skip"], glyph: "–", ansi: "gray" },
  healed: { token: "healed", soft: "healed-soft", hex: DARK["healed"], glyph: "~", ansi: "cyan" },
  abort: { token: "abort", soft: "abort-soft", hex: DARK["abort"], glyph: "!", ansi: "yellow" },
  info: { token: "info", soft: "info-soft", hex: DARK["info"], glyph: "•", ansi: "blue" },
  neutral: { token: "fg2", soft: "bg3", hex: DARK.fg2, glyph: "·", ansi: "white" },
};

/**
 * The type ramp (the `Tokens` artboard's "Type" block).
 *
 * Seven sizes and no more. "Density is the default": 13 px body, and the
 * inspector is the only place that breathes.
 */
export const TYPE = {
  screenTitle: { size: 20, weight: 600 },
  subject: { size: 18, weight: 600 },
  toolbarTitle: { size: 14, weight: 600 },
  body: { size: 13, weight: 400 },
  mono: { size: 12.5, weight: 400 },
  meta: { size: 12, weight: 400 },
  sectionLabel: { size: 10.5, weight: 600 },
} as const;

/** The measurements every control shares (LLD §13.7: 28 px controls, 4 px radii). */
export const METRICS = {
  controlHeight: 28,
  radius: 4,
  radiusLarge: 6,
  rowPadding: 7,
  railWidth: 220,
  inspectorWidth: 360,
  topBarHeight: 44,
  statusBarHeight: 28,
} as const;

/**
 * The font stacks. Monospace is for what the runtime wrote; sans for what we
 * wrote (LLD §13.7).
 */
export const FONTS = {
  sans: '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif',
  mono: '"IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace',
} as const;

/**
 * The packaged font files (REQ-PKG-3, and the phase's environment note: "ship
 * them as packaged font files under the OFL, never a runtime fetch").
 *
 * `docs/spec/design/base.css` opens with an `@import` from Google Fonts, which
 * is a network call at paint time in an application whose whole promise is that
 * it runs against a local service. The same faces are in `fonts/` with the OFL
 * text beside them, and `tokens.css` declares them with `@font-face`.
 *
 * The Sans file is a variable font covering the three weights the mockups use;
 * the Mono weights are two static faces. Latin subsets only: the interface is
 * English and the fallback stack covers the rest.
 */
export const FONT_FILES = [
  { family: "IBM Plex Sans", file: "IBMPlexSans-latin.woff2", weight: "100 700" },
  { family: "IBM Plex Mono", file: "IBMPlexMono-400-latin.woff2", weight: "400" },
  { family: "IBM Plex Mono", file: "IBMPlexMono-500-latin.woff2", weight: "500" },
] as const;

/** `--bg0: #0f1216; …` for one theme, in `TOKEN_NAMES` order. */
export function declarations(theme: Theme): string {
  const table = THEMES[theme];
  return TOKEN_NAMES.map((name) => `  --${name}: ${table[name]};`).join("\n");
}

/**
 * The whole stylesheet: the faces, `:root` (dark), and the light override.
 *
 * Generated into `tokens.css` at build time and committed, so a renderer can
 * import a file and a test can read one.
 */
export function stylesheet(): string {
  const faces = FONT_FILES.map(
    (one) =>
      `@font-face {\n` +
      `  font-family: "${one.family}";\n` +
      `  font-style: normal;\n` +
      `  font-weight: ${one.weight};\n` +
      `  font-display: swap;\n` +
      `  src: url("./fonts/${one.file}") format("woff2");\n` +
      `}`,
  ).join("\n");

  const metrics = [
    `  --r: ${METRICS.radius}px;`,
    `  --r2: ${METRICS.radiusLarge}px;`,
    `  --control-h: ${METRICS.controlHeight}px;`,
    `  --row-pad: ${METRICS.rowPadding}px;`,
    /*
     * A share of the window, with stated bounds (TV-19, TV-A07).
     *
     * These were fixed pixels, so above the app's single breakpoint the rail and
     * the inspector were 580 px of any window — forty-five per cent of a 1280
     * one. The preferred size is a share; the minimum keeps a row readable and
     * the maximum stops a wide monitor giving the chrome half of itself.
     */
    `  --rail-w: 15vw;`,
    `  --rail-min: 150px;`,
    `  --rail-max: ${METRICS.railWidth}px;`,
    `  --inspector-w: 24vw;`,
    `  --inspector-min: 250px;`,
    `  --inspector-max: ${METRICS.inspectorWidth}px;`,
    `  --topbar-h: ${METRICS.topBarHeight}px;`,
    `  --statusbar-h: ${METRICS.statusBarHeight}px;`,
    `  --sans: ${FONTS.sans};`,
    `  --mono: ${FONTS.mono};`,
  ].join("\n");

  return [
    "/*",
    " * GENERATED FILE — do not edit. `pnpm --filter @svatah/yam-ui-tokens build` writes it",
    " * from `src/index.ts`, which is the one place the values live (T9.2, REQ-ADE-12).",
    " *",
    " * Dark-first: `:root` is the dark theme and `[data-theme=\"light\"]` overrides every",
    " * token and nothing else. A component that branched on the theme would break that",
    " * promise; `packages/ui/test/theme.test.ts` is what holds it.",
    " */",
    faces,
    "",
    ":root {",
    declarations("dark"),
    metrics,
    "}",
    "",
    '[data-theme="light"] {',
    declarations("light"),
    "}",
    "",
  ].join("\n");
}

export {
  capabilitiesOf,
  depthFor,
  foreground,
  tone,
  hexOf,
  ansi256Of,
  rgbOf,
  RESET,
} from "./terminal.js";
export type { Capabilities, ColourDepth } from "./terminal.js";
