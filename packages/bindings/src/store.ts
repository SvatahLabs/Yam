/**
 * The bindings store (LLD §6.1, REQ-REC-6, REQ-REC-9).
 *
 * "Recorder output is plain files inside the project directory, suitable for a
 * pull request." So the store is a directory of canonical YAML, one file per
 * element, and its only interesting property is that writing the same bindings
 * twice produces the same bytes: a re-record that changed nothing must produce an
 * empty diff, or nobody will review the ones that did change.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  bindingFileSchema,
  bindingsHash,
  canonicalYaml,
  SCHEMA_VERSION,
  type BindingEntry,
  type BindingFile,
} from "@svatah/schema";
import { DataError } from "@svatah/surface";
import { assertElementId, idToSegments, pathToId } from "./ids.js";
import { patternMatches } from "./context.js";

/** How an entry is selected for a context (LLD §6.3). */
export interface EntrySelector {
  /** The current URL or window title. */
  readonly url?: string;
  /** The live context hash, when one has been computed. */
  readonly hash?: string;
  readonly platform?: BindingEntry["context"]["platform"];
}

/**
 * The store, held in memory and written back as files.
 *
 * Loading is eager: the store is small (one file per element), the resolver reads
 * it on every step, and a lazy read would put file IO inside the timeout budget
 * of a candidate (LLD §6.3).
 */
export class BindingsStore {
  private readonly files = new Map<string, BindingFile>();

  private constructor(readonly dir: string) {}

  /** An empty store rooted at `dir`. Nothing is written until `save`. */
  static empty(dir: string): BindingsStore {
    return new BindingsStore(dir);
  }

  /** Read every `*.yaml` under `dir`. A missing directory is an empty store. */
  static load(dir: string): BindingsStore {
    const store = new BindingsStore(dir);
    if (!existsSync(dir)) return store;

    for (const path of walk(dir)) {
      const id = pathToId(relative(dir, path).split(sep).join("/"));
      let raw: unknown;
      try {
        raw = parseYaml(readFileSync(path, "utf8"));
      } catch (cause) {
        // The parser's own message says the line and column; without it the
        // diagnostic names a file and leaves the reader to find the typo.
        const why = cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
        throw new DataError(`${path} is not valid YAML: ${why}`, { cause });
      }
      const parsed = bindingFileSchema.safeParse(raw);
      if (!parsed.success) {
        /*
         * A person, not a JSON dump.
         *
         * A hand-edited binding file is a normal thing to get wrong, and the
         * whole `ZodError` printed raw is a page of nesting that buries which
         * field it was. One line per issue, deepest field first, is what someone
         * can act on.
         */
        const issues = parsed.error.issues
          .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("\n");
        throw new DataError(`${path} is not a valid bindings file:\n${issues}`);
      }
      if (parsed.data.id !== id) {
        throw new DataError(
          `${path} declares id "${parsed.data.id}" but its path says "${id}". ` +
            "An id and its path are the same thing written two ways (LLD §6.1).",
        );
      }
      store.files.set(id, parsed.data);
    }
    return store;
  }

  /** Every element id in the store, sorted. */
  ids(): string[] {
    return [...this.files.keys()].sort();
  }

  has(id: string): boolean {
    return this.files.has(id);
  }

  /** The file for an id, or `undefined`. */
  get(id: string): BindingFile | undefined {
    return this.files.get(id);
  }

  /** Every entry recorded for an id, in the order they were recorded. */
  entries(id: string): readonly BindingEntry[] {
    return this.files.get(id)?.entries ?? [];
  }

  /**
   * The entry that applies to a context (LLD §6.3).
   *
   * "entries matching (platform, pattern) first, else first". A hash match is
   * preferred over a pattern match, because a page whose shape is unchanged is a
   * stronger signal than a URL that looks similar.
   */
  entryFor(id: string, selector: EntrySelector = {}): BindingEntry | undefined {
    const entries = this.entries(id);
    if (entries.length === 0) return undefined;

    const candidates =
      selector.platform === undefined
        ? entries
        : entries.filter((e) => e.context.platform === selector.platform);
    const pool = candidates.length > 0 ? candidates : entries;

    if (selector.hash !== undefined) {
      const exact = pool.find((e) => e.context.hash === selector.hash);
      if (exact !== undefined) return exact;
    }
    if (selector.url !== undefined) {
      const byPattern = pool.find((e) => patternMatches(e.context.pattern, selector.url!));
      if (byPattern !== undefined) return byPattern;
    }
    return pool[0];
  }

  /** Every phrase recorded for an id. */
  phrases(id: string): readonly string[] {
    return this.files.get(id)?.phrases ?? [];
  }

  /**
   * Add or replace the entry for a context, and record the phrase.
   *
   * An entry replaces one with the same context hash and pattern rather than
   * accumulating: re-recording an element in the same place should produce a
   * diff of that entry, not a second copy of it.
   *
   * `replaces` names an entry this one supersedes even though its context has
   * moved. A repair is exactly that case — the page's shape changed, which is
   * why the binding broke — and without it a heal would leave the broken entry
   * in place *and* add the repaired one beside it, with the broken one first
   * (LLD §6.3 selects by hash, then pattern, then position). The next run would
   * resolve the broken entry and fail again.
   */
  put(
    id: string,
    entry: BindingEntry,
    phrase?: string,
    options: { replaces?: BindingEntry["context"] } = {},
  ): void {
    assertElementId(id);
    const existing = this.files.get(id);
    const phrases = new Set(existing?.phrases ?? []);
    if (phrase !== undefined && phrase.trim() !== "") phrases.add(phrase.trim());

    const supersedes = options.replaces;
    const entries = (existing?.entries ?? []).filter((e) => {
      if (e.context.hash === entry.context.hash && e.context.pattern === entry.context.pattern) {
        return false;
      }
      if (
        supersedes !== undefined &&
        e.context.hash === supersedes.hash &&
        e.context.pattern === supersedes.pattern
      ) {
        return false;
      }
      return true;
    });
    entries.push(entry);

    this.files.set(id, {
      schemaVersion: SCHEMA_VERSION,
      id,
      phrases: [...phrases].sort(),
      entries,
    });
  }

  /** Record a phrase against an id that already exists. */
  addPhrase(id: string, phrase: string): void {
    const file = this.files.get(id);
    if (file === undefined) return;
    const phrases = new Set(file.phrases);
    phrases.add(phrase.trim());
    this.files.set(id, { ...file, phrases: [...phrases].sort() });
  }

  /** Remove an element entirely. Returns whether it was there. */
  remove(id: string): boolean {
    return this.files.delete(id);
  }

  /** The canonical YAML for one id — the exact bytes `save` writes. */
  render(id: string): string {
    const file = this.files.get(id);
    if (file === undefined) throw new DataError(`No bindings for "${id}".`);
    return canonicalYaml(file);
  }

  /**
   * Hash of the whole store (`Summary.bindingsHash`, REQ-AUTO-3).
   *
   * Taken over the id → file map, so it is independent of file-system ordering
   * and of which machine wrote the files.
   */
  hash(): string {
    return bindingsHash(Object.fromEntries([...this.files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))));
  }

  /** The store as a plain object, for diffing and for tests. */
  toObject(): Record<string, BindingFile> {
    return Object.fromEntries([...this.files.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
  }

  /**
   * Write every file, and delete files for ids no longer in the store.
   *
   * Deleting is part of saving because `bindings prune` is otherwise a special
   * case that leaves the directory and the store disagreeing.
   */
  save(): { written: string[]; removed: string[] } {
    mkdirSync(this.dir, { recursive: true });
    const written: string[] = [];

    for (const [id, file] of this.files) {
      const path = join(this.dir, ...idToSegments(id));
      mkdirSync(dirname(path), { recursive: true });
      const body = canonicalYaml(file);
      // Only touch a file whose bytes changed, so `git status` and file mtimes
      // stay honest about what a record pass actually did.
      if (!existsSync(path) || readFileSync(path, "utf8") !== body) {
        writeFileSync(path, body, "utf8");
        written.push(path);
      }
    }

    const removed: string[] = [];
    if (existsSync(this.dir)) {
      for (const path of walk(this.dir)) {
        const id = pathToId(relative(this.dir, path).split(sep).join("/"));
        if (!this.files.has(id)) {
          rmSync(path);
          removed.push(path);
        }
      }
    }
    return { written, removed };
  }
}

/** Every `*.yaml` under a directory, in sorted order so a load is deterministic. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.name.endsWith(".yaml")) out.push(path);
  }
  return out;
}
