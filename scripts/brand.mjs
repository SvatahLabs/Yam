#!/usr/bin/env node
/**
 * Vendor the Yam mark from the brand repository, and build the app's icons.
 *
 *   node scripts/brand.mjs --from ../Portal/brand/yam
 *
 * `packages/ui/brand/` is a copy of the brand repository's Yam kit, so a build
 * of this repository never needs a checkout of that one (TV-A08). This is that
 * copy, made the same way every time, plus the icons the packager needs and the
 * kit does not ship in their platform formats.
 *
 * `packagerConfig.icon` in `apps/desktop/forge.config.ts` is `brand/app-icon`
 * with no extension, and the packager appends each platform's. With only a
 * `.png` here, the macOS and Windows builds silently shipped Electron's icon:
 * the packaged `electron.icns` was byte-for-byte Electron's own.
 *
 * - `app-icon.icns`, macOS. Rendered here on Apple's icon grid: the kit's app
 *   icon — the mark at five-sixths on an `#eef3ea` tile — as an 824-pixel
 *   rounded square on a 1024 canvas, the shape macOS draws every app icon in.
 *   The small drawing at 32 pixels and below and the full one above, as the
 *   kit's own favicon does. Needs macOS, for `iconutil`.
 * - `app-icon.ico`, Windows: the kit's `favicon.ico`, the mark at 16 to 256.
 * - `app-icon.png`, Linux: the kit's 512-pixel mark.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = join(ROOT, "packages", "ui", "brand");

const at = process.argv.indexOf("--from");
if (at < 0 || process.argv[at + 1] === undefined) {
  process.stderr.write("Usage: node scripts/brand.mjs --from <brand repository>/brand/yam\n");
  process.exit(2);
}
const FROM = resolve(process.argv[at + 1]);

const COPIES = [
  ...["color-light", "color-dark", "white", "black"].flatMap((variant) => [
    [`svg/yam-${variant}.svg`, `yam-${variant}.svg`],
    [`svg/yam-${variant}-small.svg`, `yam-${variant}-small.svg`],
  ]),
  ["lockups/yam-color-light-horizontal.svg", "yam-color-light-horizontal.svg"],
  ["lockups/yam-color-dark-horizontal.svg", "yam-color-dark-horizontal.svg"],
  ["icons/favicon.ico", "app-icon.ico"],
  ["png/yam-color-light-512.png", "app-icon.png"],
];

for (const [from] of COPIES) {
  if (!existsSync(join(FROM, from))) {
    process.stderr.write(`${join(FROM, from)} is not there; is --from the kit's yam directory?\n`);
    process.exit(1);
  }
}
for (const [from, to] of COPIES) cpSync(join(FROM, from), join(BRAND, to));
// The tile the old icon set was cut from; the three files above replace it.
rmSync(join(BRAND, "app-icon-512.png"), { force: true });
process.stdout.write(`copied ${COPIES.length} files from ${FROM}\n`);

if (process.platform !== "darwin") {
  process.stdout.write("app-icon.icns left as it is: iconutil is macOS's.\n");
  process.exit(0);
}

/** The drawing inside a kit SVG, without its `<svg>` element or title. */
const drawing = (file) =>
  readFileSync(join(BRAND, file), "utf8")
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "");
const full = drawing("yam-color-light.svg");
const small = drawing("yam-color-light-small.svg");

const icon = (pixels) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 1024 1024">` +
  `<rect x="100" y="100" width="824" height="824" rx="185" fill="#eef3ea"/>` +
  `<g transform="translate(100 100) scale(${824 / 48})"><g transform="translate(4 4) scale(.8333)">` +
  `${pixels <= 32 ? small : full}</g></g></svg>`;

const RENDITIONS = [
  [16, "16x16"], [32, "16x16@2x"], [32, "32x32"], [64, "32x32@2x"], [128, "128x128"],
  [256, "128x128@2x"], [256, "256x256"], [512, "256x256@2x"], [512, "512x512"], [1024, "512x512@2x"],
];

const iconset = join(mkdtempSync(join(tmpdir(), "yam-icon-")), "app-icon.iconset");
mkdirSync(iconset);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [pixels, name] of RENDITIONS) {
    await page.setViewportSize({ width: pixels, height: pixels });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${icon(pixels)}`,
    );
    await page.locator("svg").screenshot({ path: join(iconset, `icon_${name}.png`), omitBackground: true });
  }
} finally {
  await browser.close();
}

const made = spawnSync("iconutil", ["-c", "icns", iconset, "-o", join(BRAND, "app-icon.icns")], {
  stdio: "inherit",
});
if (made.status !== 0) process.exit(made.status ?? 1);
rmSync(dirname(iconset), { recursive: true, force: true });
process.stdout.write(`wrote app-icon.icns (${RENDITIONS.length} renditions)\n`);
