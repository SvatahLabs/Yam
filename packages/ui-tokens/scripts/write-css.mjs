#!/usr/bin/env node
/**
 * Write `tokens.css` from `src/index.ts` (T9.2, REQ-ADE-12).
 *
 * The tokens live in TypeScript because three things need them and only one is
 * a stylesheet (see `src/index.ts`). This is the stylesheet, generated at build
 * time and committed so a renderer can import a file and a test can read one.
 * `test/tokens.test.ts` regenerates and diffs, so the two cannot drift.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stylesheet } from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const out = join(HERE, "..", "tokens.css");
writeFileSync(out, stylesheet(), "utf8");
process.stderr.write(`wrote ${out}\n`);
