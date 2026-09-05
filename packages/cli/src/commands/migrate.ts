/**
 * `svatah migrate <src> <dest>` (REQ-LANG-11, LLD §15).
 *
 * Exit 0, or 8 when a step could not be converted — which is a real outcome, not
 * a failure: the step is left in the flow as a `// TODO(migrate):` comment and
 * the exit code says the output is not finished. A missing step is much harder
 * to notice than an obviously unfinished one.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrate, renderReviewReport } from "@svatah/migrate";
import { boolOption, stringOption, type ParsedArgs } from "../args.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import type { CommandIo } from "./surface.js";

export const REVIEW_FILE = "migration-review.md";

export async function migrateCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const source = args.command[1];
  const destination = args.command[2];

  if (source === undefined || destination === undefined) {
    io.err("Usage: svatah migrate <src> <dest> [--keep-original] [--json]");
    return EXIT.usage;
  }

  const result = migrate({
    source,
    destination,
    keepOriginal: boolOption(args, "keep-original"),
    ...(stringOption(args, "at") === undefined ? {} : { at: stringOption(args, "at")! }),
  });

  const review = renderReviewReport({
    source,
    destination,
    files: result.files,
    notes: result.notes,
    unmapped: result.unmapped,
    stories: result.stories,
  });
  writeFileSync(join(destination, REVIEW_FILE), review, "utf8");

  if (boolOption(args, "json")) {
    io.out(JSON.stringify({ ...result, review: join(destination, REVIEW_FILE) }, null, 2));
  } else {
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
