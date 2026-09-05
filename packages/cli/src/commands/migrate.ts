/**
 * `svatah migrate <src> <dest>` (REQ-LANG-11, LLD §15).
 *
 * Exit 0, or 8 when a step could not be converted — which is a real outcome, not
 * a failure: the step is left in the flow as a `// TODO(migrate):` comment and
 * the exit code says the output is not finished. A missing step is much harder
 * to notice than an obviously unfinished one.
 *
 * ## `--from-ade` (T6.6, REQ-ADE-9)
 *
 * ```
 * svatah migrate <dest> --from-ade <electron-db dir> [--project <name>]
 * ```
 *
 * The prototype ADE kept a project's flows, locators and data in an electron-db
 * directory. `--from-ade` extracts them back into the files this command already
 * reads and then converts them in the same run, so the output is the same
 * project directory a person with those files on disk would get.
 */
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractAdeProject, migrate, renderReviewReport } from "@svatah/migrate";
import { boolOption, stringOption, type ParsedArgs } from "@svatah/bindings-cli";
import { EXIT, type ExitCode } from "@svatah/bindings-cli";
import type { CommandIo } from "@svatah/bindings-cli";

export const REVIEW_FILE = "migration-review.md";

export async function migrateCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const fromAde = stringOption(args, "from-ade");
  const source = fromAde ?? args.command[1];
  const destination = fromAde === undefined ? args.command[2] : args.command[1];

  if (source === undefined || destination === undefined) {
    io.err(
      "Usage: svatah migrate <src> <dest> [--keep-original] [--json]\n" +
        "       svatah migrate <dest> --from-ade <electron-db dir> [--project <name>]",
    );
    return EXIT.usage;
  }

  /*
   * The prototype import is two steps, and this is the first (T6.6,
   * REQ-ADE-9, LLD §13.5).
   *
   * The prototype kept v2 flows, a `.locator` file and a `.data` file *in a
   * database* rather than on disk. It is not a second dialect: extracting them
   * turns the database back into the files `migrate` already converts, and the
   * conversion below is the same one a person with those files on disk gets.
   * Doing the flow rewriting here as well would be a second implementation of
   * it, and the two would drift.
   */
  const extracted =
    fromAde === undefined
      ? undefined
      : extractAdeProject({
          source,
          destination,
          ...(stringOption(args, "project") === undefined
            ? {}
            : { project: stringOption(args, "project")! }),
        });

  const result = migrate({
    // After an extraction, the *destination* is what `migrate` reads: the flows,
    // the `.locator` and the `.data` file it just wrote there.
    source: extracted === undefined ? source : destination,
    destination,
    keepOriginal: boolOption(args, "keep-original"),
    ...(stringOption(args, "at") === undefined ? {} : { at: stringOption(args, "at")! }),
  });

  /*
   * The intermediates go once `migrate` has read them (T6.6).
   *
   * `.imported.locator` and `.imported.data` are the prototype's own files,
   * reconstructed so the v2 converter has something to read. Leaving them in the
   * project would put the old tool's locator file beside the new bindings store
   * — the second source of truth ADR-17 rejected — and the next `svatah migrate`
   * of the same directory would convert them again.
   */
  const written = [...result.files];
  for (const one of extracted?.intermediates ?? []) {
    rmSync(join(destination, one), { force: true });
  }

  const review = renderReviewReport({
    source,
    destination,
    files: [...new Set([...(extracted?.files ?? []), ...written])]
      .filter((one) => !(extracted?.intermediates ?? []).includes(one))
      .sort(),
    // The extraction's notes first: "this table was not imported" is context for
    // everything the conversion then says about what *was*.
    notes: [...(extracted?.notes ?? []), ...result.notes],
    unmapped: result.unmapped,
    stories: result.stories,
  });
  writeFileSync(join(destination, REVIEW_FILE), review, "utf8");

  if (boolOption(args, "json")) {
    io.out(JSON.stringify({ ...result, review: join(destination, REVIEW_FILE) }, null, 2));
  } else {
    if (extracted !== undefined) {
      io.err(
        `imported the prototype project "${extracted.project}" from ${source}\n` +
          `  ${extracted.flowFiles.length} flow file(s); results and screenshots were not ` +
          "imported (REQ-ADE-9)",
      );
    }
    io.err(
      `migrated ${result.stories.length} stories into ${destination}\n` +
        `  ${result.files.length} file(s), ${result.notes.length} review note(s)\n` +
        `  read ${join(destination, REVIEW_FILE)} before trusting the output`,
    );
    if (result.unmapped > 0) {
      io.err(
        `\n${result.unmapped} step(s) could not be converted and are left as ` +
          "`// TODO(migrate):` comments.",
      );
    }
  }

  return result.unmapped > 0 ? EXIT.unmapped : EXIT.ok;
}
