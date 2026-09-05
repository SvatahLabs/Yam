/**
 * Writes `packages/spec/actions.yaml` from the vocabulary (T2.2).
 *
 * Runs after tsup as part of `pnpm --filter @svatah/spec build`, so it consumes
 * the package's own built entry point and needs no TypeScript loader.
 * `test/vocabulary.test.ts` fails if the committed file differs from what this
 * script would write.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateActionsYaml } from "../dist/index.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "actions.yaml");
const text = generateActionsYaml();
writeFileSync(out, text);
console.log(`wrote packages/spec/actions.yaml (${text.split("\n").length} lines)`);
