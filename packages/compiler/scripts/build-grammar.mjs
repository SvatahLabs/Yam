/**
 * Generates the Tier 1 parser from `grammar/step.peggy` (T2.4, LLD §4.2).
 *
 * The generated module is committed, for the same reason the JSON Schemas and
 * `actions.yaml` are: the package must build and publish without the generator,
 * and a reviewer must be able to see what changed. `test/grammar.test.ts` fails
 * when the committed file differs from what this script would write.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import peggyDefault from "peggy";

// peggy 5 ships CommonJS; under ESM the whole module object is the default.
const peggy = peggyDefault;

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

export function generateParser() {
  const grammar = readFileSync(join(root, "grammar", "step.peggy"), "utf8");
  const source = peggy.generate(grammar, {
    allowedStartRules: ["Step", "GuardOnly"],
    format: "es",
    output: "source",
    // A parse failure is expected — an unrecognised sentence is `E_NO_MATCH`,
    // not a crash — so the error has to carry a location the compiler can use.
    error: undefined,
  });
  return `/* eslint-disable */\n// @ts-nocheck\n// GENERATED from grammar/step.peggy by scripts/build-grammar.mjs — do not edit.\n${source}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = join(root, "src", "generated");
  mkdirSync(out, { recursive: true });
  const text = generateParser();
  writeFileSync(join(out, "step-parser.js"), text);
  console.log(`wrote src/generated/step-parser.js (${text.length} bytes)`);
}
