/**
 * Copying `evals/self` into a scratch directory (P11-F1, LLD §13.9).
 *
 * Two scripts work on a *copy* of the self project rather than on the committed
 * one — `self-parity-bite.mjs` breaks an expectation on purpose, `self-record.mjs`
 * records bindings over the seeded ones — and both wrote the same loop:
 *
 *     for (const name of ["flows", "steps", "api", "bindings"]) cpSync(…)
 *
 * From a clean checkout that loop crashed with `ENOENT … evals/self/steps`, and
 * then with `ENOENT … evals/self/api`, because git carries no empty directory
 * and both are empty (the Phase 11 verification, F1). The directories are
 * tracked with a README now; this is the other half of the fix, so that a
 * project which legitimately has no `steps/` — most projects — is copied rather
 * than crashed on.
 *
 * The distinction is deliberate: a *required* part missing is a broken project
 * and says so, an *optional* one missing is a project that does not use that
 * feature. `flows` is required. `steps`, `api` and `bindings` are not.
 */
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

/** The parts of a Yam project, and whether a copy may do without one. */
export const SELF_PROJECT_PARTS = Object.freeze({
  required: Object.freeze(["flows"]),
  optional: Object.freeze(["steps", "api", "bindings"]),
});

/**
 * Copy the named parts of a project directory, skipping optional absences.
 *
 * Returns the names that were skipped, so a caller can say so rather than leave
 * a reader wondering whether a suite ran with less than it looks like it did.
 */
export function copyProjectParts(from, to, names) {
  const skipped = [];
  for (const name of names) {
    const source = join(from, name);
    if (!existsSync(source)) {
      if (SELF_PROJECT_PARTS.required.includes(name)) {
        throw new Error(
          `${source} does not exist, and a project without its flows is not a project. ` +
            `Optional parts (${SELF_PROJECT_PARTS.optional.join(", ")}) may be absent; this one may not.`,
        );
      }
      skipped.push(name);
      continue;
    }
    cpSync(source, join(to, name), { recursive: true });
  }
  return skipped;
}
