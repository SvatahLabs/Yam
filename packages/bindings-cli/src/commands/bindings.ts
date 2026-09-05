/**
 * `svatah bindings list|show <id>|verify|prune` (LLD §15, T1.6).
 *
 * The store is files in a repository, so most of what a person needs is `git`
 * and an editor. These four are what `git` cannot do: say what the store holds
 * without opening twenty files, dry-resolve every binding against a live
 * application, and remove the ones nothing uses any more.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  BindingsStore,
  Dictionary,
  tryResolve,
  type LocatorError,
} from "@svatah/bindings";
import { createSurface, listAdapters } from "@svatah/surface";
import { DEFAULT_CONFIG, type Config } from "@svatah/schema";
import { registerAllAdapters } from "../adapters.js";
import { boolOption, stringOption, type ParsedArgs } from "../args.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { sessionTarget } from "../session.js";
import type { CommandIo } from "./surface.js";

export async function bindingsCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const sub = args.command[1] ?? "list";
  const dir = stringOption(args, "dir") ?? process.env["SVATAH_BINDINGS"] ?? "bindings";
  const json = boolOption(args, "json");

  let store: BindingsStore;
  try {
    store = BindingsStore.load(dir);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return EXIT.failed;
  }

  switch (sub) {
    case "list":
      return list(store, dir, io, json);
    case "show":
      return show(store, args, io, json);
    case "verify":
      return await verify(store, args, io, json);
    case "prune":
      return prune(store, args, io, json);
    default:
      io.err(`Unknown "bindings" subcommand "${sub}". Try list, show, verify or prune.`);
      return EXIT.usage;
  }
}

/* ── list ─────────────────────────────────────────────────────────────────── */

function list(store: BindingsStore, dir: string, io: CommandIo, json: boolean): ExitCode {
  const ids = store.ids();
  const rows = ids.map((id) => {
    const file = store.get(id)!;
    return {
      id,
      entries: file.entries.length,
      phrases: file.phrases,
      candidates: file.entries[0]?.candidates.length ?? 0,
      verified: file.entries.every((e) => e.verified),
      provenance: [...new Set(file.entries.map((e) => e.provenance.model))],
    };
  });

  if (json) {
    io.out(JSON.stringify({ dir, hash: store.hash(), bindings: rows }, null, 2));
    return EXIT.ok;
  }

  if (rows.length === 0) {
    io.out(`No bindings in ${dir}. Record some with SVATAH_MODE=record.`);
    return EXIT.ok;
  }

  const width = Math.max(...rows.map((r) => r.id.length));
  io.out(`${rows.length} binding${rows.length === 1 ? "" : "s"} in ${dir} (hash ${store.hash().slice(0, 12)})\n`);
  for (const row of rows) {
    io.out(
      `  ${row.id.padEnd(width)}  ${row.entries} context${row.entries === 1 ? " " : "s"}` +
        `  ${String(row.candidates).padStart(2)} candidates` +
        `  ${row.verified ? "verified  " : "unverified"}` +
        `  ${row.provenance.join(", ")}` +
        `${row.phrases.length > 0 ? `  — ${row.phrases.join("; ")}` : ""}`,
    );
  }

  const ambiguous = Dictionary.fromStore(store).ambiguous();
  if (ambiguous.length > 0) {
    io.out("\n  Phrases that mean more than one element (W_AMBIGUOUS_TARGET):");
    for (const one of ambiguous) io.out(`    "${one.phrase}" → ${one.ids.join(", ")}`);
  }
  return EXIT.ok;
}

/* ── show ─────────────────────────────────────────────────────────────────── */

function show(store: BindingsStore, args: ParsedArgs, io: CommandIo, json: boolean): ExitCode {
  const id = args.command[2] ?? args.rest[0];
  if (id === undefined) {
    io.err("`bindings show` needs an element id, for example `login.username-field`.");
    return EXIT.usage;
  }
  if (!store.has(id)) {
    const near = store.ids().filter((known) => known.includes(id) || id.includes(known));
    io.err(
      `No bindings for "${id}".${near.length > 0 ? ` Did you mean ${near.join(", ")}?` : ""}`,
    );
    return EXIT.failed;
  }

  if (json) {
    io.out(JSON.stringify(store.get(id), null, 2));
    return EXIT.ok;
  }
  // The canonical YAML is what is on disk, and it is meant to be read.
  io.out(store.render(id));
  return EXIT.ok;
}

/* ── verify ───────────────────────────────────────────────────────────────── */

/**
 * Dry-resolve every binding against a live application.
 *
 * This is the check a pull request wants: not "does the file parse" but "does
 * every binding still find its element". It acts on nothing — resolution is a
 * query — so it is safe against an environment a test run would not be.
 */
async function verify(
  store: BindingsStore,
  args: ParsedArgs,
  io: CommandIo,
  json: boolean,
): Promise<ExitCode> {
  const adapter = stringOption(args, "adapter") ?? "playwright";
  const only = stringOption(args, "id");

  // Flag, then environment, then `config.app`, then the sample app's port
  // (LLD §15, Draft 2.5). `verify` is a session-opening command like any other.
  const target = sessionTarget(args, {
    root: stringOption(args, "project") ?? ".",
    fallbackBaseUrl: "http://127.0.0.1:4173",
  });
  const baseUrl = target.baseUrl!;

  registerAllAdapters();
  if (!listAdapters().includes(adapter)) {
    io.err(`No adapter registered under "${adapter}". Registered: ${listAdapters().join(", ")}.`);
    return EXIT.usage;
  }

  const ids = only === undefined ? store.ids() : [only];
  if (ids.length === 0) {
    io.out("Nothing to verify.");
    return EXIT.ok;
  }

  const config: Config = {
    ...DEFAULT_CONFIG,
    project: "bindings-verify",
    adapter: adapter as Config["adapter"],
    app: { ...target },
    run: { ...DEFAULT_CONFIG.run, headless: !boolOption(args, "headed") },
  };

  const results: Array<{ id: string; ok: boolean; by?: string; detail?: string }> = [];
  const surface = await createSurface(config);
  await surface.open({ ...target });

  try {
    for (const id of ids) {
      const entry = store.entryFor(id, {});
      if (entry === undefined) {
        results.push({ id, ok: false, detail: "no entry" });
        continue;
      }
      // Each binding is checked on the page it was recorded against; a binding
      // recorded on /checkout cannot be resolved from /login, and reporting that
      // as a failure would be noise rather than news.
      await surface.act("navigate", undefined, { url: entry.context.pattern }).catch(() => undefined);

      const attempt = await tryResolve(id, surface, store, { reportDrift: true });
      if (attempt.ok) {
        results.push({ id, ok: true, by: attempt.resolution.by });
      } else {
        const error = attempt.error as LocatorError;
        results.push({
          id,
          ok: false,
          detail: error.detail.contextDrift
            ? "the page's shape has drifted from the one it was recorded on"
            : `${error.detail.tried.length} candidates tried, none matched exactly one`,
        });
      }
    }
  } finally {
    await surface.close().catch(() => undefined);
  }

  const failed = results.filter((r) => !r.ok);

  if (json) {
    io.out(JSON.stringify({ baseUrl, adapter, results }, null, 2));
  } else {
    const width = Math.max(...results.map((r) => r.id.length));
    for (const result of results) {
      io.out(
        `  ${result.ok ? "ok  " : "FAIL"}  ${result.id.padEnd(width)}  ` +
          `${result.ok ? `resolved by ${result.by}` : result.detail}`,
      );
    }
    io.out(`\n  ${results.length - failed.length} of ${results.length} resolved.`);
  }

  return failed.length === 0 ? EXIT.ok : EXIT.failed;
}

/* ── prune ────────────────────────────────────────────────────────────────── */

/**
 * Remove bindings nothing refers to.
 *
 * "Nothing refers to" means no `bind("<id>")` call and no flow step naming the
 * element, across the paths given with `--used-in` (default: the working
 * directory). Dry by default: deleting a binding because a grep missed a
 * dynamically-built id would be a bad way to find out.
 */
function prune(store: BindingsStore, args: ParsedArgs, io: CommandIo, json: boolean): ExitCode {
  const apply = boolOption(args, "apply");
  const roots = (stringOption(args, "used-in") ?? "tests,src,flows,e2e").split(",").map((s) => s.trim());

  const haystack = collectSources(roots);
  const unused = store.ids().filter((id) => !haystack.includes(id));

  if (json) {
    io.out(JSON.stringify({ searched: roots, unused, applied: apply }, null, 2));
  } else if (unused.length === 0) {
    io.out(`Every binding is referenced from ${roots.join(", ")}.`);
  } else {
    io.out(`${unused.length} binding${unused.length === 1 ? "" : "s"} referenced from nowhere in ${roots.join(", ")}:\n`);
    for (const id of unused) io.out(`  ${id}`);
    io.out(
      apply
        ? "\n  Removed."
        : "\n  Nothing removed. Re-run with --apply to delete them, after checking that no id is built at run time.",
    );
  }

  if (apply && unused.length > 0) {
    for (const id of unused) store.remove(id);
    store.save();
  }
  return EXIT.ok;
}

/** Every source file under the given roots, concatenated. */
function collectSources(roots: readonly string[]): string {
  const parts: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 8 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (/\.(ts|tsx|js|mjs|cjs|jsx|flow)$/.test(entry.name)) {
        parts.push(readFileSync(path, "utf8"));
      }
    }
  };
  for (const root of roots) walk(root, 0);
  return parts.join("\n");
}
