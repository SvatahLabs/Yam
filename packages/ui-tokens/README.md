# `@svatah/yam-ui-tokens`

The Yam design tokens: two themes, one type ramp, one status set
(REQ-ADE-12, LLD §13.7).

The values are `docs/spec/design/base.css`'s, transcribed once into
`src/index.ts` — because three things need them and only one is a stylesheet:

- `tokens.css`, generated from `src/index.ts` at build time and committed;
- `@svatah/yam-ui`, whose components ask for a token and never for a hex;
- `@svatah/yam-tui`, which renders the same status set as ANSI colours in a terminal
  that has no CSS variables.

```ts
import { DARK, LIGHT, STATUS, METRICS } from "@svatah/yam-ui-tokens";
```

```css
@import "@svatah/yam-ui-tokens/tokens.css";
```

`:root` is the dark theme; `[data-theme="light"]` overrides every token and
nothing else.

## The fonts

`fonts/` carries IBM Plex Sans (variable, 100–700) and IBM Plex Mono (400, 500),
Latin subsets, as `woff2`. They are **packaged, never fetched**:
`docs/spec/design/base.css` opens with a Google Fonts `@import`, and shipping
that would make the first paint of a local-only application a network call — one
that fails on an air-gapped machine.

IBM Plex is © 2017 IBM Corp. under the **SIL Open Font License 1.1**, with the
reserved font name "Plex". The licence text is `fonts/OFL.txt`. The OFL is a
free, permissive font licence: it allows use, study, modification and
redistribution, including in a commercial product, and requires only that the
font files are not sold on their own, that the licence travels with them, and
that a modified font is renamed. Nothing in this repository modifies them.

REQ-PKG-3 names MIT, Apache-2.0 and BSD for *dependencies*; the fonts are not a
dependency — no package manifest mentions them, and `pnpm licenses` never sees
them — they are data files carried with their licence, exactly as the phase's
environment note requires ("ship them as packaged font files under the OFL").

## The one deviation from the artboard

The light theme's `--dim` is `#868f9e`, not the artboard's `#8b96a5`. The
artboard's value is 2.998:1 against white — three thousandths below WCAG AA's
3:1 — and `scripts/audit-sheet.mjs` measures it and fails.
`docs/spec/progress/phase-9.md` records it.
