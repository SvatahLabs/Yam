#!/usr/bin/env node
/**
 * Screenshot the component sheet in both themes (T9.2, T9.5).
 *
 *   pnpm sheet:shoot   # writes reports/sheet-dark.png and reports/sheet-light.png
 *
 * T9.2's Validate asks for "a screenshot of it in both themes"; T9.5 asks for
 * the screenshots to be in the progress record. Chromium through Playwright,
 * which the repository already installs (`pnpm browsers`) — no new dependency,
 * and the same engine the packaged ADE renders in.
 *
 * The page is loaded from the filesystem, so it needs no server; the fonts are
 * beside it, so the screenshot shows IBM Plex rather than a fallback.
 *
 * Both shots are of the *whole* sheet, not a viewport: the point is to be able
 * to compare every component against the `Tokens` artboard, and a scrolled
 * screenshot of a design system is a screenshot of the top of one.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? fallback : argv[at + 1];
};

const sheet = resolve(option("sheet", join(ROOT, "packages", "ui", "sheet", "index.html")));
const outDir = resolve(option("out", join(ROOT, "reports")));

if (!existsSync(sheet)) {
  process.stderr.write(`${sheet} does not exist. Run \`pnpm sheet\` first.\n`);
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await page.goto(`file://${sheet}`);

  for (const theme of ["dark", "light"]) {
    /*
     * The theme is set on `<html>`, which is what a renderer does. The sheet
     * itself draws *both* halves whatever this is — each half carries its own
     * `data-theme` — so this changes the page's chrome around them, and the
     * screenshot is of the page as someone with that preference sees it.
     */
    await page.evaluate((one) => document.documentElement.setAttribute("data-theme", one), theme);
    // The web fonts are local files; one frame is enough for them to paint.
    await page.evaluate(() => document.fonts.ready);
    const file = join(outDir, `sheet-${theme}.png`);
    await page.screenshot({ path: file, fullPage: true });
    process.stdout.write(`wrote ${file}\n`);
  }
} finally {
  await browser.close();
}
