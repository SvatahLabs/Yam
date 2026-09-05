/**
 * Copy the runtime conformance fixture into the published package (T7.6,
 * REQ-STD-2, REQ-STD-3, LLD §14).
 *
 * > `@svatah/schema` with the JSON Schema files and the conformance fixtures
 * > included.
 *
 * A third party writing a runtime downloads this package for two things: the
 * schemas their artifacts must satisfy, and the fixture their results are
 * compared against. Shipping the first without the second would leave them able
 * to validate and unable to check, which is half of REQ-STD-2.
 *
 * The fixture lives at `evals/conformance/runtime/` because that is where the
 * repository generates and diffs it; it is *copied* here at build time rather
 * than moved, so there is exactly one source and no chance of the published
 * copy drifting from the one CI regenerates. The copy is git-ignored for the
 * same reason.
 *
 * Its README says, in its own words, that the fixture is a **projection** of a
 * run and not itself valid against `stepResultSchema` — which is the distinction
 * that cost Phase 6 a false conformance result (F2), and the reason it travels
 * with the schemas rather than apart from them.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "..", "evals", "conformance", "runtime");
const target = join(here, "..", "conformance", "runtime");

if (!existsSync(source)) {
  process.stderr.write(
    `The runtime conformance fixture is not at ${source}.\n` +
      "Regenerate it with `node scripts/compatibility.mjs`.\n",
  );
  process.exit(1);
}

rmSync(join(here, "..", "conformance"), { recursive: true, force: true });
mkdirSync(dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`copied the runtime conformance fixture into ${target}`);
