/**
 * Reading a whole project: every flow file, the data, the named API requests
 * (REQ-LANG-1, 8, 9, 10, LLD §4.1, §3.5).
 *
 * The rules that only exist across files live here: story names are unique *per
 * project* (REQ-LANG-1), and a `compose:` or run block may name a story defined
 * in another file. Reading one file cannot know either, which is why the reader
 * does not try.
 *
 * IO is separated from parsing. `readProjectFrom` walks a directory;
 * `readProject` takes the contents. The service (T2.11) and the editor already
 * hold unsaved text, and a compiler that could only read the disk would make
 * live linting impossible.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import { isStoryBlock, isRunBlock, type FlowFile, type StoryBlock } from "./ast.js";
import { diagnostic, type Diagnostic } from "./diagnostics.js";
import { buildApiCatalogue, EMPTY_APIS, type ApiCatalogue } from "./api.js";
import { EMPTY_DATA, readData, type ProjectData } from "./data.js";
import { readFlow } from "./reader.js";

export interface Project {
  readonly flows: readonly FlowFile[];
  /** Story name → the story, across every file. Unique by REQ-LANG-1. */
  readonly stories: ReadonlyMap<string, { story: StoryBlock; file: string }>;
  /** Composition name → the story names it expands to, across every file. */
  readonly compositions: ReadonlyMap<string, { names: readonly string[]; file: string }>;
  /** Flow file → the names its run block executes, in order. */
  readonly runs: ReadonlyMap<string, readonly string[]>;
  readonly data: ProjectData;
  readonly apis: ApiCatalogue;
}

export interface ProjectSource {
  /** Flow files: path relative to the project root, and content. */
  readonly flows: ReadonlyArray<{ file: string; text: string }>;
  readonly data?: { file: string; text: string };
  readonly apis?: ReadonlyArray<{ file: string; text: string }>;
  readonly env?: NodeJS.ProcessEnv;
}

export function readProject(source: ProjectSource): {
  project: Project;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const flows: FlowFile[] = [];
  const stories = new Map<string, { story: StoryBlock; file: string }>();
  const compositions = new Map<string, { names: readonly string[]; file: string }>();
  const runs = new Map<string, readonly string[]>();

  for (const { file, text } of source.flows) {
    const { flow, diagnostics: read } = readFlow(text, file);
    diagnostics.push(...read);
    flows.push(flow);

    /** Names a run block already listed in this file, so `test:` order is one list. */
    const running: string[] = [];
    let sawRunBlock = false;

    for (const block of flow.blocks) {
      if (isStoryBlock(block)) {
        const existing = stories.get(block.name);
        if (existing !== undefined) {
          diagnostics.push(
            diagnostic(
              "E_DUP_STORY",
              `Two stories are named "${block.name}": ${existing.file}:${existing.story.line} and here. ` +
                "Story names are unique across the project, because a compose block, a run block and " +
                "`Run the \"…\" story` all name one by name alone (REQ-LANG-1).",
              { file, line: block.line },
            ),
          );
          continue;
        }
        stories.set(block.name, { story: block, file });
        continue;
      }

      if (block.kind === "compose") {
        const existing = compositions.get(block.name);
        if (existing !== undefined) {
          diagnostics.push(
            diagnostic(
              "E_DUP_STORY",
              `Two compositions are named "${block.name}": ${existing.file} and here.`,
              { file, line: block.line },
            ),
          );
          continue;
        }
        compositions.set(block.name, { names: block.names.map((n) => n.name), file });
        continue;
      }

      if (isRunBlock(block)) {
        // `test:` and `run:` are synonyms, and a file may hold more than one;
        // they concatenate in the order they appear (REQ-LANG-10).
        sawRunBlock = true;
        running.push(...block.names.map((n) => n.name));
      }
    }

    /*
     * A flow with no run block runs its scenarios, in file order.
     *
     * This is the legacy distinction between the two header words, and
     * `execution.flow` depends on it: seven `scenario:` blocks and no `test:`
     * block at all, which has to run or the compatibility milestone (T2.10,
     * REQ-NFR-8) has nothing to run. A `story:` is a library unit — something a
     * composition or a run block names — and a `scenario:` is a unit that runs
     * where it is written. Recorded as a deviation: REQ-LANG-10 says the run
     * block defines the order and does not say what happens without one.
     */
    if (!sawRunBlock) {
      running.push(
        ...flow.blocks.filter(isStoryBlock).filter((b) => b.kind === "scenario").map((b) => b.name),
      );
    }

    runs.set(file, running);
  }

  /*
   * Names are resolved after every file is read, because a run block in one file
   * may name a story in another. Resolving as we went would report a
   * forward reference as an unknown story.
   */
  const known = (name: string): boolean => stories.has(name) || compositions.has(name);

  for (const flow of flows) {
    for (const block of flow.blocks) {
      if (isStoryBlock(block)) continue;

      /*
       * A run block whose only name is its own header, naming nothing that
       * exists, runs nothing at all. "This block runs nothing" is what the
       * author needs to read; "unknown story" would send them looking for a
       * typo in a name they never wrote.
       */
      if (isRunBlock(block) && block.fromHeader === true && !known(block.name)) {
        diagnostics.push(
          diagnostic(
            "E_TEST_EMPTY",
            `"${block.kind}: ${block.name}" runs nothing. A run block with no names below it runs the story ` +
              `or composition of its own name, and there is none called "${block.name}". List the names to ` +
              "run under the header, or name an existing story or composition.",
            { file: flow.file, line: block.line },
          ),
        );
        continue;
      }

      for (const { name, line } of block.names) {
        if (known(name)) continue;
        diagnostics.push(
          diagnostic(
            "E_UNKNOWN_STORY",
            `"${name}" is not a story or a composition in this project.`,
            { file: flow.file, line },
          ),
        );
      }
    }
  }

  /* A composition that names itself, directly or through another, never ends. */
  for (const [name, composition] of compositions) {
    const cycle = findCycle(name, compositions);
    if (cycle !== undefined) {
      diagnostics.push(
        diagnostic(
          "E_UNKNOWN_STORY",
          `Composition "${name}" expands into itself: ${cycle.join(" → ")}.`,
          { file: composition.file, line: 0 },
        ),
      );
    }
  }

  let data: ProjectData = EMPTY_DATA;
  if (source.data !== undefined) {
    const read = readData(source.data.text, source.data.file, source.env ?? process.env);
    data = read.data;
    diagnostics.push(...read.diagnostics);
  }

  let apis: ApiCatalogue = EMPTY_APIS;
  if (source.apis !== undefined && source.apis.length > 0) {
    const read = buildApiCatalogue(
      source.apis.map((one) => ({
        file: one.file,
        text: one.text,
        fallbackName: basename(one.file, extname(one.file)),
      })),
    );
    apis = read.apis;
    diagnostics.push(...read.diagnostics);
  }

  return { project: { flows, stories, compositions, runs, data, apis }, diagnostics };
}

/** The path back to `start`, if expanding it reaches itself. */
function findCycle(
  start: string,
  compositions: ReadonlyMap<string, { names: readonly string[] }>,
): string[] | undefined {
  const seen = new Set<string>();
  const walk = (name: string, path: string[]): string[] | undefined => {
    const composition = compositions.get(name);
    if (composition === undefined) return undefined;
    for (const next of composition.names) {
      if (next === start) return [...path, next];
      if (seen.has(next)) continue;
      seen.add(next);
      const found = walk(next, [...path, next]);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(start, [start]);
}

/* ── reading from a directory ─────────────────────────────────────────────── */

export interface ProjectPaths {
  root: string;
  /** `config.flows.dir`. Default `flows`. */
  flowsDir?: string;
  /** `config.data.file`. Default `data.yaml`. */
  dataFile?: string;
  /** `config.api.dir`. Default `api`. */
  apiDir?: string;
  env?: NodeJS.ProcessEnv;
}

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path, extensions));
    else if (extensions.includes(extname(entry.name))) out.push(path);
  }
  return out;
}

/** Read a project from disk. Paths in diagnostics are relative to `root`. */
export function readProjectFrom(paths: ProjectPaths): {
  project: Project;
  diagnostics: Diagnostic[];
} {
  const root = paths.root;
  // Posix separators in diagnostics, so a report reads the same on Windows.
  const rel = (path: string): string => relative(root, path).split(sep).join("/");

  const flowFiles = filesUnder(join(root, paths.flowsDir ?? "flows"), [".flow"]);
  const apiFiles = filesUnder(join(root, paths.apiDir ?? "api"), [".yaml", ".yml"]);

  const dataPath = join(root, paths.dataFile ?? "data.yaml");
  let data: { file: string; text: string } | undefined;
  try {
    if (statSync(dataPath).isFile()) {
      data = { file: rel(dataPath), text: readFileSync(dataPath, "utf8") };
    }
  } catch {
    // No data file is normal: a project may have no run-level data at all.
  }

  return readProject({
    flows: flowFiles.map((file) => ({ file: rel(file), text: readFileSync(file, "utf8") })),
    ...(data === undefined ? {} : { data }),
    apis: apiFiles.map((file) => ({ file: rel(file), text: readFileSync(file, "utf8") })),
    ...(paths.env === undefined ? {} : { env: paths.env }),
  });
}
