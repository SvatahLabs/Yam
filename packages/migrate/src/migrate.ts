/**
 * `svatah migrate <src> <dest>` (REQ-LANG-11, LLD §15).
 *
 * "`migrate` converts v1/v2 flows, `.locator`, and `.data` files into v3 flows, a
 * seed bindings store, and `data.yaml`, preserving names and step order."
 *
 * Names and step order are preserved *exactly* — one v3 step per legacy step, in
 * the same order, under the same story name. That is the property T2.9 is
 * checked on, and it is the one that makes a migrated suite reviewable: a
 * reviewer can put the two files side by side and read down.
 *
 * ## Migration is a draft, and says so
 *
 * A legacy locator says where an element is, never what it is, so a target phrase
 * is sometimes derived rather than read. Every derived phrase, every dropped
 * second locator, every value turned into a secret indirection and every step
 * that could not be rewritten goes into the review report. The output is meant to
 * be read before it is trusted, and the report is what makes that possible in
 * minutes rather than by re-reading the original.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import { canonicalYaml } from "@svatah/schema";
import { parseLocatorFile, seedBinding, type MigratedLocator } from "./locators.js";
import { migrateData } from "./data.js";
import { readLegacyFlow, type LegacyFlow } from "./v2.js";
import { rewriteStep } from "./rewrite.js";
import type { ReviewNote } from "./report.js";

export interface MigrateOptions {
  readonly source: string;
  readonly destination: string;
  /** Keep the original file beside the converted one. */
  readonly keepOriginal?: boolean;
  /** Fixed timestamp, so two migrations of one input are the same bytes. */
  readonly at?: string;
}

export interface MigrateResult {
  /** Files written, relative to the destination. */
  readonly files: readonly string[];
  readonly notes: readonly ReviewNote[];
  /** Steps that could not be rewritten. Non-zero means exit code 8 (LLD §15). */
  readonly unmapped: number;
  readonly stories: ReadonlyArray<{ file: string; name: string; steps: number }>;
}

const FLOW_EXTENSIONS = [".flow"];
const LOCATOR_EXTENSIONS = [".locator", ".properties"];
const DATA_EXTENSIONS = [".data"];

/** Every file under a directory, sorted, so two runs walk in the same order. */
function walk(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

export function migrate(options: MigrateOptions): MigrateResult {
  const at = options.at ?? new Date().toISOString();
  const notes: ReviewNote[] = [];
  const files: string[] = [];
  const stories: Array<{ file: string; name: string; steps: number }> = [];
  let unmapped = 0;

  const source = statSync(options.source).isDirectory() ? options.source : undefined;
  const inputs = source === undefined ? [options.source] : walk(source);

  /** Locators from every `.locator` file, merged; ids are unique per project. */
  const locators = new Map<string, MigratedLocator>();

  for (const path of inputs) {
    const extension = extname(path).toLowerCase();
    if (!LOCATOR_EXTENSIONS.includes(extension)) continue;
    for (const locator of parseLocatorFile(readFileSync(path, "utf8"))) {
      const existing = locators.get(locator.id);
      if (existing !== undefined) {
        // Two files naming one element is normal in a legacy project: the
        // `.properties` file and the `.locator` file overlap. The first wins,
        // and the second is reported rather than silently merged.
        notes.push({
          file: relativeTo(source, path),
          line: 0,
          kind: "duplicate-locator",
          message:
            `"${locator.phrase}" is also defined elsewhere; the first definition was kept ` +
            `(${existing.candidates.length} candidates, versus ${locator.candidates.length} here).`,
        });
        continue;
      }
      locators.set(locator.id, locator);
      for (const alternative of locator.unmapped) {
        notes.push({
          file: relativeTo(source, path),
          line: 0,
          kind: "unmapped-locator",
          message: `"${alternative}" is not a locator form v3 has; it was dropped.`,
        });
      }
    }
  }

  for (const path of inputs) {
    const extension = extname(path).toLowerCase();
    const name = basename(path, extension);

    if (FLOW_EXTENSIONS.includes(extension)) {
      const legacy = readLegacyFlow(readFileSync(path, "utf8"), relativeTo(source, path));
      const converted = convertFlow(legacy, notes);
      unmapped += converted.unmapped;
      stories.push(...converted.stories.map((story) => ({ file: `flows/${name}.flow`, ...story })));

      write(options.destination, join("flows", `${name}.flow`), converted.text, files);
      if (options.keepOriginal === true) {
        write(options.destination, join("flows", `${name}.flow.v2`), readFileSync(path, "utf8"), files);
      }
      continue;
    }

    if (DATA_EXTENSIONS.includes(extension)) {
      const data = migrateData(readFileSync(path, "utf8"));
      if (Object.keys(data.values).length === 0) continue;

      for (const { key, variable } of data.redacted) {
        notes.push({
          file: relativeTo(source, path),
          line: 0,
          kind: "secret",
          message:
            `"${key}" looks like a secret, so it reads \${${variable}} instead of the value ` +
            "the old file held. Set that variable before running (REQ-NFR-6).",
        });
      }

      write(
        options.destination,
        "data.yaml",
        canonicalYaml({
          ...data.values,
          ...(data.secrets.length === 0 ? {} : { secrets: [...data.secrets].sort() }),
        }),
        files,
      );
    }
  }

  for (const locator of [...locators.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (locator.candidates.length === 0) continue;
    write(
      options.destination,
      join("bindings", "migrated", `${locator.id}.yaml`),
      canonicalYaml(seedBinding({ ...locator, id: `migrated.${locator.id}` }, at)),
      files,
    );
  }

  return { files, notes, unmapped, stories };
}

function write(destination: string, relativePath: string, text: string, files: string[]): void {
  const path = join(destination, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  files.push(relativePath.split(sep).join("/"));
}

function relativeTo(source: string | undefined, path: string): string {
  return source === undefined ? path : relative(source, path).split(sep).join("/");
}

/* ── one flow ─────────────────────────────────────────────────────────────── */

function convertFlow(
  legacy: LegacyFlow,
  notes: ReviewNote[],
): { text: string; unmapped: number; stories: Array<{ name: string; steps: number }> } {
  const lines: string[] = [
    `// Migrated from ${legacy.file} by \`svatah migrate\`.`,
    "//",
    "// Story names and step order are preserved exactly (REQ-LANG-11). Read the",
    "// review report beside this file before trusting it: a legacy locator says",
    "// where an element was, never what it is, so some target phrases were derived",
    "// and need a better name.",
    "",
  ];
  let unmapped = 0;
  const stories: Array<{ name: string; steps: number }> = [];

  /** Every name this file defines, so a run block can be checked against it. */
  const names = new Set(
    legacy.blocks.filter((b) => b.kind !== "test").map((b) => b.name),
  );
  const compositions = legacy.blocks.filter((b) => b.kind === "compose").map((b) => b.name);

  for (const block of legacy.blocks) {
    if (block.kind === "compose") {
      lines.push(`compose: ${block.name}`);
      for (const name of block.names) lines.push(`  ${name}`);
      lines.push("");
      continue;
    }
    if (block.kind === "test") {
      /*
       * A v2 run block names one thing, and sometimes names a *label* rather
       * than anything that exists — `test : Run all login stories` in the
       * original `natural_language_login.flow` names no story and no
       * composition, and the legacy runner would have failed on it.
       *
       * The label is kept as the block's name and what to run is listed
       * beneath it, which is the v3 form and is also the only reading under
       * which the file runs at all.
       */
      lines.push(`test: ${block.name}`);
      if (!names.has(block.name)) {
        const runnable = compositions.length > 0 ? compositions : [...names];
        for (const name of runnable) lines.push(`  ${name}`);
        notes.push({
          file: legacy.file,
          line: block.line,
          kind: "step",
          message:
            `"test : ${block.name}" names no story or composition in this file, so it ran ` +
            `nothing. The label is kept and ${runnable.map((n) => `"${n}"`).join(", ")} ` +
            "listed beneath it — check that is what was meant.",
        });
      }
      lines.push("");
      continue;
    }

    lines.push(`${block.kind}: ${block.name}`);
    let count = 0;

    for (const step of block.steps) {
      if (step.commented) {
        // A commented-out step stays commented, so the two files still read
        // line for line.
        lines.push(`  // ${step.raw.replace(/^(\/\/|#)\s*/, "")}`);
        continue;
      }

      const { sentence, notes: stepNotes } = rewriteStep(step);
      for (const message of stepNotes) {
        notes.push({ file: legacy.file, line: step.line, kind: "step", message, source: step.raw });
      }

      if (sentence === undefined) {
        unmapped += 1;
        // Left in place as a comment rather than dropped: a missing step is much
        // harder to notice than one that is obviously unfinished (exit code 8).
        lines.push(`  // TODO(migrate): ${step.raw.trim()}`);
        continue;
      }
      lines.push(`  ${sentence}`);
      count += 1;
    }

    stories.push({ name: block.name, steps: count });
    lines.push("");
  }

  return { text: `${lines.join("\n").replace(/\n+$/, "")}\n`, unmapped, stories };
}
