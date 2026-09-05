#!/usr/bin/env node
/**
 * Regenerates `evals/migrate/expected/` from the frozen legacy project.
 *
 *   node scripts/migrate-legacy.mjs [--check]
 *
 * The output is committed so that a change to the migrator shows up as a diff a
 * reviewer reads — which is what T2.9's "golden output compared byte-for-byte"
 * is for. See `evals/migrate/README.md` for why the comparison is against this
 * rather than against the hand-migrated fixtures.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, renderReviewReport } from "@svatah/migrate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = "legacy/src/test/resources";
export const EXPECTED = "evals/migrate/expected";

/** A fixed timestamp: the output is compared byte for byte. */
const AT = "2026-09-02T00:00:00.000Z";

/** Migrate into `destination` and write the review report beside the output. */
export function migrateLegacy(destination) {
  const result = migrate({ source: join(ROOT, SOURCE), destination, at: AT });
  writeFileSync(
    join(destination, "migration-review.md"),
    renderReviewReport({
      source: SOURCE,
      destination: EXPECTED,
      files: result.files,
      notes: result.notes,
      unmapped: result.unmapped,
      stories: result.stories,
    }),
    "utf8",
  );
  return result;
}

/** Every file under a directory, as `path → contents`, for comparison. */
export function snapshot(dir) {
  const out = new Map();
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.set(relative(dir, path).split(sep).join("/"), readFileSync(path, "utf8"));
    }
  };
  try {
    if (statSync(dir).isDirectory()) walk(dir);
  } catch {
    // An absent directory is an empty snapshot, which the comparison reports.
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const target = join(ROOT, EXPECTED);

  if (check) {
    const temporary = join(ROOT, "evals", "migrate", ".check");
    rmSync(temporary, { recursive: true, force: true });
    mkdirSync(temporary, { recursive: true });
    migrateLegacy(temporary);

    const fresh = snapshot(temporary);
    const committed = snapshot(target);
    rmSync(temporary, { recursive: true, force: true });

    let drifted = 0;
    for (const [path, text] of fresh) {
      if (committed.get(path) !== text) {
        console.error(`${EXPECTED}/${path} differs`);
        drifted += 1;
      }
    }
    for (const path of committed.keys()) {
      if (!fresh.has(path)) {
        console.error(`${EXPECTED}/${path} is no longer produced`);
        drifted += 1;
      }
    }
    if (drifted > 0) console.error("Run `node scripts/migrate-legacy.mjs`.");
    process.exit(drifted === 0 ? 0 : 1);
  }

  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const result = migrateLegacy(target);
  console.log(
    `wrote ${result.files.length + 1} files to ${EXPECTED} ` +
      `(${result.stories.length} stories, ${result.unmapped} unmapped, ${result.notes.length} review notes)`,
  );
}
