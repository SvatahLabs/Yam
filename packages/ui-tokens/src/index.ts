/**
 * `@svatah/yam-ui-tokens` — the design tokens (T9.2, REQ-ADE-12, LLD §13.7).
 *
 * > Dark-first with a light theme, IBM Plex Sans and IBM Plex Mono (OFL), one
 * > accent for chrome and focus, five status colours (pass, fail, skip,
 * > healed, abort/warn/unverified, plus running/info) that never appear without
 * > a word or glyph beside them, 13 px text, 28 px controls, 4 px radii, 7 px
 * > row padding. Tokens are the seed in `docs/spec/design/base.css`.
 *
 * ## The values are the product's own site (`EX-01`)
 *
 * They used to be lavender on blue-grey — `#b8a1ff` on `#0f1216` — while
 * <https://yam.svatah.com> was green on warm paper. That is two opinions about
 * what colour the product is, and a product's own site is its brand, so the
 * site's values win. `packages/ui-tokens/test/brand.test.ts` reads the site's
 * stylesheet and fails when the two drift.
 *
 * What is *not* the site's is derived and says so at the line: the site is a
 * document and has three neutrals, an application is dense and needs six.
 *
 * They are TypeScript rather than CSS because three things need them and only
 * one of them is a stylesheet:
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
  /**
   * The brand (`EX-01`).
   *
   * `accent` and `yam` are two roles, not two opinions: the site draws focus
   * rings, marks and rules in `--accent` and the product's own mark, its active
   * destination and its primary action in `--yam`. Splitting them here is what
   * lets a renderer say which it means instead of picking a hex.
   */
  "yam",
  "yam-ink",
  "yam-soft",
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
  bg0: "#111613",
  bg1: "#191f1b",
  bg2: "#1e2821",
  /* A step the site has no name for: between its `--subtle` and its `--line`. */
  bg3: "#263029",
  line: "#2d3830",
  line2: "#3b483f",
  fg: "#e3e9e2",
  /* Between the site's `--ink` and its `--muted`: secondary text, not a third opinion. */
  fg2: "#c2cdc4",
  muted: "#a2aea4",
  /* 5.04:1 on `bg0` — the site has no fourth neutral and a 10.5 px label needs one. */
  dim: "#7b8a80",
  accent: "#a3b1f0",
  "accent-ink": "#131a2c",
  "accent-soft": "rgba(163,177,240,0.16)",
  yam: "#7cc9ae",
  "yam-ink": "#0c211a",
  "yam-soft": "rgba(124,201,174,0.14)",
  pass: "#4fc48a",
  fail: "#ee6a5f",
  /* `skip` is the neutral, so it follows `muted` rather than keeping a cool grey. */
  skip: "#a2aea4",
  healed: "#56c5d0",
  abort: "#e5b04c",
  info: "#6ea8fe",
  "pass-soft": "rgba(79,196,138,0.14)",
  "fail-soft": "rgba(238,106,95,0.14)",
  "skip-soft": "rgba(162,174,164,0.14)",
  "healed-soft": "rgba(86,197,208,0.14)",
  "abort-soft": "rgba(229,176,76,0.14)",
  "info-soft": "rgba(110,168,254,0.14)",
  scrim: "rgba(9,13,11,0.62)",
  /* A state change a person caused: fast enough to feel like the click. */
  "motion-quick": "120ms",
  /* One they did not: long enough to be seen arriving. */
  "motion-settle": "220ms",
  "motion-ease": "cubic-bezier(0.2, 0, 0, 1)",
};

/**
 * The light theme (the site's `:root`).
 *
 * Every brand and status colour darkens: a value that reads on `#111613` does
 * not read on `#fafbf9`, and "one accent" is a statement about the *role*
 * rather than about the hex. The site holds the same position — its `--yam` is
 * `#7cc9ae` in the dark and `#357862` in the light.
 */
export const LIGHT: Readonly<Record<TokenName, string>> = {
  /*
   * `bg0` is the page and `bg1` is what is raised above it, in both themes. On
   * the site that is warm paper with white cards, which is why the light ramp
   * goes up at `bg1` and back down at `bg2` — the ramp is distance from the
   * page, not a monotonic lightness.
   */
  bg0: "#fafbf9",
  bg1: "#ffffff",
  bg2: "#f0f3ef",
  bg3: "#e7ebe5",
  line: "#e0e5df",
  line2: "#ccd4cb",
  fg: "#253029",
  fg2: "#41504a",
  muted: "#626a65",
  /*
   * `#828b85` — 3.38:1 on `bg0` and 3.51:1 on `bg1`.
   *
   * The same reasoning as the palette it replaces: a 10.5 px section label at
   * 3:1 exactly is one rounding away from failing, and `scripts/audit-sheet.mjs`
   * measures it. The site has no fourth neutral to copy, so this is derived.
   */
  dim: "#828b85",
  accent: "#586ec2",
  "accent-ink": "#ffffff",
  "accent-soft": "rgba(88,110,194,0.12)",
  yam: "#357862",
  "yam-ink": "#ffffff",
  "yam-soft": "rgba(53,120,98,0.10)",
  pass: "#1f7a45",
  fail: "#b3261e",
  skip: "#626a65",
  healed: "#0f7f8a",
  abort: "#8a5f10",
  info: "#2f5bd7",
  "pass-soft": "rgba(31,122,69,0.12)",
  "fail-soft": "rgba(179,38,30,0.12)",
  "skip-soft": "rgba(98,106,101,0.12)",
  "healed-soft": "rgba(15,127,138,0.12)",
  "abort-soft": "rgba(138,95,16,0.12)",
  "info-soft": "rgba(47,91,215,0.12)",
  scrim: "rgba(17,22,19,0.38)",
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

/** `--bg0: #111613; …` for one theme, in `TOKEN_NAMES` order. */
export function declarations(theme: Theme): string {
  const table = THEMES[theme];
  return TOKEN_NAMES.map((name) => `  --${name}: ${table[name]};`).join("\n");
}

/**
 * The whole stylesheet: the faces, the two themes, and how a machine chooses
 * between them (`EX-02`).
 *
 * Four blocks, in this order, and the order is the requirement:
 *
 * 1. `:root` — the dark theme, and the metrics. The floor: a browser with no
 *    media support and a document with no attribute still gets a whole palette.
 * 2. `@media (prefers-color-scheme: light)` — the machine's preference. This is
 *    what was missing: the sheet had the light theme only behind an attribute,
 *    so somebody on a light Mac who had never opened the settings got the dark
 *    application and no way to know there was another.
 * 3. `[data-theme="dark"]` and `[data-theme="light"]` — a person's choice,
 *    written after the media query so it wins it.
 *
 * "System" is therefore not a third palette: it is the *absence* of the
 * attribute, which is why `theme.ts` in the renderer removes it rather than
 * setting it to `system`.
 *
 * `color-scheme` rides along so that the scrollbars, the caret and any native
 * control the application borrows follow the same decision. Without it a dark
 * application scrolls with a white scrollbar.
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
    " * Dark-first: `:root` is the dark theme. `prefers-color-scheme: light` is what a",
    " * machine that has chosen gets, and `[data-theme]` is what a person who has chosen",
    " * gets — written last, so it wins the media query (EX-02). A component that branched",
    " * on the theme would break the promise that the two differ only in tokens;",
    " * `packages/ui/test/theme.test.ts` is what holds it.",
    " */",
    faces,
    "",
    ":root {",
    "  color-scheme: dark light;",
    declarations("dark"),
    metrics,
    "}",
    "",
    "/* The machine's preference, for anybody who has not stated one of their own. */",
    "@media (prefers-color-scheme: light) {",
    "  :root {",
    `${declarations("light")
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n")}`,
    "  }",
    "}",
    "",
    "/* A stated choice, after the media query so that it overrides it. */",
    '[data-theme="dark"] {',
    "  color-scheme: dark;",
    declarations("dark"),
    "}",
    "",
    '[data-theme="light"] {',
    "  color-scheme: light;",
    declarations("light"),
    "}",
    "",
  ].join("\n");
}

export {
  appearanceOf,
  capabilitiesOf,
  depthFor,
  foreground,
  tone,
  hexOf,
  tokenHex,
  ansi256Of,
  rgbOf,
  RESET,
} from "./terminal.js";
export type { Capabilities, ColourDepth } from "./terminal.js";
