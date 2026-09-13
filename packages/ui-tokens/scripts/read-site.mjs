#!/usr/bin/env node
/**
 * Refresh `brand/site-palette.json` from the running site (E0.2).
 *
 *   YAM_SITE_URL=http://localhost:3102 node scripts/read-site.mjs
 *
 * Committing the result is the point: `test/brand.test.ts` reads it on a machine
 * that has no site, and compares it against the site on a machine that does.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSitePalette, SITE_URL } from "./site-palette.mjs";

const palette = await fetchSitePalette();
if (palette === null) {
  process.stderr.write(`no site at ${SITE_URL} — nothing written\n`);
  process.exit(1);
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "brand", "site-palette.json");
writeFileSync(
  out,
  `${JSON.stringify({ readAt: new Date().toISOString().slice(0, 10), ...palette }, null, 2)}\n`,
  "utf8",
);
process.stderr.write(`wrote ${out}\n`);
