/**
 * Read the product's own site and pull its palette out of its stylesheet
 * (`EX-01`, E0.2).
 *
 * The site is the brand, so it is the source: `src/index.ts` transcribes it and
 * `test/brand.test.ts` fails when the transcription drifts. Reading it needs
 * the site to be up, which CI's checkout is not, so the values are also
 * *recorded* in `brand/site-palette.json` and the test has two halves:
 *
 *   * always — the recorded values are the ones in the token tables;
 *   * when the site answers — the site's values are the recorded ones.
 *
 * A copy that nothing re-reads is a copy that silently goes stale, and a fetch
 * that nothing records is a check that only runs on the machine with the site
 * running. Both halves, or neither is worth having.
 *
 * `node scripts/read-site.mjs` refreshes the record.
 */

/** Where the site is, unless told otherwise. */
export const SITE_URL = process.env["YAM_SITE_URL"] ?? "http://localhost:3102";

/**
 * The site's own custom properties — the ones that are the brand rather than
 * Docusaurus's defaults. `--ifm-background-color` is Infima's page colour and
 * is read as `bg`, because the site sets it deliberately in the same block.
 */
export const SITE_TOKENS = ["yam", "accent", "ink", "muted", "line", "paper", "subtle", "bg"];

/** `#fff` and `#FFFFFF` are the same colour and must compare equal. */
export function normalise(value) {
  const hex = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex);
  return short === null ? hex : `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
}

/**
 * Pull one theme's declarations out of a stylesheet.
 *
 * A regular expression over innermost `selector { … }` blocks, rather than a CSS
 * parser: a parser would be a dependency in a package that has none, and the two
 * blocks wanted are flat lists of declarations.
 *
 * The selector alone is not enough to find them. A Docusaurus bundle declares
 * `:root` several times — Infima's defaults, the syntax highlighter's, the
 * search widget's — and only one of them is the brand. The brand block is the
 * one that declares `--yam`, so that is what is matched on.
 */
function blockFor(css, selector) {
  for (const block of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const sel = block[1].trim();
    const body = block[2];
    const named = sel === selector || sel.endsWith(`,${selector}`) || sel.endsWith(`, ${selector}`);
    if (named && body.includes("--yam")) return body;
  }
  return null;
}

function readBlock(css, selector) {
  const body = blockFor(css, selector);
  if (body === null) throw new Error(`the site's stylesheet has no brand ${selector} block`);
  const out = {};
  for (const name of SITE_TOKENS) {
    const property = name === "bg" ? "--ifm-background-color" : `--${name}`;
    const found = new RegExp(`${property}\\s*:\\s*([^;]+)`).exec(body);
    if (found === null) throw new Error(`the site's ${selector} declares no ${property}`);
    out[name] = normalise(found[1]);
  }
  return out;
}

/** Both themes, from the text of the site's stylesheet. */
export function parseSitePalette(css) {
  return { light: readBlock(css, ":root"), dark: readBlock(css, 'html[data-theme="dark"]') };
}

/**
 * Fetch and parse, or hand back `null` when the site is not running.
 *
 * `null` rather than a throw: "the site is down" is not a failing check, it is
 * half the check not running, and the test says which it got.
 */
export async function fetchSitePalette(url = SITE_URL) {
  let css;
  try {
    const response = await fetch(new URL("/styles.css", url), {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    css = await response.text();
  } catch {
    return null;
  }
  return { source: new URL("/styles.css", url).href, ...parseSitePalette(css) };
}
