/**
 * Writes the published JSON Schemas to `packages/schema/json/` (T0.3, REQ-STD-1).
 *
 * Runs after tsup as part of `pnpm --filter @svatah/schema build`, so it consumes
 * the package's own built entry point and needs no TypeScript loader.
 * `test/schema-drift.test.ts` fails if the committed files differ from what this
 * script would write.
 */
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateJsonSchemas } from "../dist/index.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "json");
mkdirSync(outDir, { recursive: true });

const files = generateJsonSchemas();

// Remove schemas that are no longer published, so the directory cannot go stale.
for (const existing of readdirSync(outDir)) {
  if (existing.endsWith(".schema.json") && !(existing in files)) {
    rmSync(join(outDir, existing));
    console.log(`removed stale ${existing}`);
  }
}

for (const [name, text] of Object.entries(files)) {
  writeFileSync(join(outDir, name), text);
}
console.log(`wrote ${Object.keys(files).length} JSON Schemas to packages/schema/json/`);
