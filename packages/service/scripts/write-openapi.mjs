/**
 * Writes `packages/service/openapi.json` (REQ-ADE-1, LLD §13.5).
 *
 * Committed, so the ADE's typed client can be generated from a file in the
 * repository rather than from a running service, and so a change to the contract
 * is a diff in a pull request. `test/openapi.test.ts` fails when the committed
 * document differs from what the service serves.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openApiDocument } from "../dist/index.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "openapi.json");
const text = `${JSON.stringify(openApiDocument("0.1.0"), null, 2)}\n`;
writeFileSync(out, text);
console.log(`wrote packages/service/openapi.json (${Object.keys(openApiDocument("0.1.0").paths).length} paths)`);
