/**
 * P1-F3 — a committed bindings store must be shareable.
 *
 * A store is checked into the repository and read by whoever clones it. Two
 * things make that fail quietly, and both were true of the Phase 1 example store:
 *
 * 1. **A port in the context pattern.** `http://127.0.0.1:65431/login` names a
 *    port that existed for one process. It cannot match on the next run, let
 *    alone on anyone else's machine, so the entry silently stops being the
 *    entry for that URL and the resolver falls back to whatever is first.
 * 2. **An origin at all.** Bindings recorded against `localhost` do not apply on
 *    staging, and a store that only works where it was recorded is not a store.
 *
 * Draft 2.3 makes `context.pattern` path-only unless `bindings.matchHost` is set
 * (LLD §3.5). This is the check that keeps it that way: it reads what is
 * committed rather than what the code intends, so a regression in the recorder
 * shows up the moment someone commits its output.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { fromRoot } from "../src/repo.js";

/** Every `.yaml` under a directory, recursively. */
function yamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...yamlFiles(path));
    else if (entry.name.endsWith(".yaml")) out.push(path);
  }
  return out;
}

/** Every committed bindings store in the repository. */
const STORES = [fromRoot("examples", "plain-playwright", "bindings")].filter((dir) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
});

interface BindingFile {
  id: string;
  entries: Array<{ context: { pattern: string } }>;
}

const files = STORES.flatMap((dir) => yamlFiles(dir));

describe("committed bindings stores (LLD §3.5, Draft 2.3)", () => {
  it("finds the example store, so this suite is not vacuously green", () => {
    expect(files.length, "no committed binding files were found").toBeGreaterThan(0);
  });

  it.each(files)("%s carries no port in its context pattern", (file) => {
    const binding = parse(readFileSync(file, "utf8")) as BindingFile;
    for (const entry of binding.entries) {
      expect(
        entry.context.pattern,
        `${binding.id} is bound to a port, which existed for one process`,
      ).not.toMatch(/:\d+/);
    }
  });

  it.each(files)("%s carries no origin either — a store is not tied to a host", (file) => {
    const binding = parse(readFileSync(file, "utf8")) as BindingFile;
    for (const entry of binding.entries) {
      expect(entry.context.pattern, `${binding.id} names a host`).not.toMatch(/^[a-z][a-z0-9+.-]*:\/\//i);
      expect(entry.context.pattern, `${binding.id}'s pattern is not a path`).toMatch(/^\//);
    }
  });
});
