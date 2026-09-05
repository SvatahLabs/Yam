/**
 * The migration review report (REQ-LANG-11: verified by `T, R`).
 *
 * Migration produces a *draft*. The report is what makes reviewing it a job of
 * minutes: everything the migrator had to guess at, in one place, with the
 * original line beside it.
 *
 * It is Markdown because it is read by a person, in a pull request, next to the
 * diff of the flows it describes.
 */

export interface ReviewNote {
  readonly file: string;
  /** 0 when the note is about the file rather than a line. */
  readonly line: number;
  readonly kind: "step" | "secret" | "unmapped-locator" | "duplicate-locator";
  readonly message: string;
  /** The original line, when there is one. */
  readonly source?: string;
}

const HEADINGS: Record<ReviewNote["kind"], string> = {
  step: "Steps that need a look",
  secret: "Values that became secrets",
  "unmapped-locator": "Locator forms that were dropped",
  "duplicate-locator": "Elements defined more than once",
};

const EXPLANATIONS: Record<ReviewNote["kind"], string> = {
  step:
    "A legacy locator says where an element was, never what it is. Where the original " +
    "prose said nothing, the phrase below was derived from the locator — rename it to what " +
    "the element actually is, and the bindings will be recorded against a name a person " +
    "recognises.",
  secret:
    "These read an environment variable rather than the value the old file held. The old " +
    "file had the value in plain text; carrying it across would have made the new one " +
    "exactly as unsafe (REQ-NFR-6).",
  "unmapped-locator":
    "These alternatives were in the old file and are not locator forms v3 has. The other " +
    "alternatives for the same element were kept.",
  "duplicate-locator":
    "Two files defined the same element. The first definition was kept; check that it is " +
    "the one you want.",
};

export interface ReportInput {
  readonly source: string;
  readonly destination: string;
  readonly files: readonly string[];
  readonly notes: readonly ReviewNote[];
  readonly unmapped: number;
  readonly stories: ReadonlyArray<{ file: string; name: string; steps: number }>;
}

export function renderReviewReport(input: ReportInput): string {
  const lines: string[] = [
    "# Migration review",
    "",
    `\`svatah migrate ${input.source} ${input.destination}\``,
    "",
    "Story names and step order are preserved exactly, so the old file and the new one",
    "read side by side. What follows is everything the migration had to guess at.",
    "",
    "## What was written",
    "",
    "| File | Stories | Steps |",
    "|---|---|---|",
  ];

  const byFile = new Map<string, { stories: number; steps: number }>();
  for (const story of input.stories) {
    const entry = byFile.get(story.file) ?? { stories: 0, steps: 0 };
    entry.stories += 1;
    entry.steps += story.steps;
    byFile.set(story.file, entry);
  }
  for (const [file, counts] of [...byFile.entries()].sort()) {
    lines.push(`| \`${file}\` | ${counts.stories} | ${counts.steps} |`);
  }

  const others = input.files.filter((file) => !byFile.has(file)).sort();
  if (others.length > 0) {
    lines.push("");
    lines.push("Also written:");
    lines.push("");
    for (const file of others) lines.push(`- \`${file}\``);
  }

  lines.push("");
  lines.push(
    input.unmapped === 0
      ? "Every step was converted."
      : `**${input.unmapped} step(s) could not be converted** and are left in the flow as ` +
        "`// TODO(migrate):` comments — a missing step is much harder to notice than an " +
        "obviously unfinished one. The exit code is 8 until they are written.",
  );
  lines.push("");

  for (const kind of Object.keys(HEADINGS) as Array<ReviewNote["kind"]>) {
    const mine = input.notes.filter((note) => note.kind === kind);
    if (mine.length === 0) continue;

    lines.push(`## ${HEADINGS[kind]} (${mine.length})`);
    lines.push("");
    lines.push(EXPLANATIONS[kind]);
    lines.push("");
    for (const note of mine) {
      const at = note.line === 0 ? note.file : `${note.file}:${note.line}`;
      lines.push(`- **${at}** — ${note.message}`);
      if (note.source !== undefined) lines.push(`  > \`${note.source.trim()}\``);
    }
    lines.push("");
  }

  if (input.notes.length === 0) {
    lines.push("Nothing needed a decision.");
    lines.push("");
  }

  return lines.join("\n");
}
