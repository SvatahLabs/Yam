/**
 * Loading a project's `steps/` directory (REQ-LANG-15, LLD §5).
 *
 * Every `.ts`, `.js` or `.mjs` file under `config.steps.dir` is imported, and
 * every export that is a `defineStep` result is registered. The id is
 * `<file>#<export>` — `steps/transfer.ts#default` — which is what a plan records
 * in `custom.id` and what a diagnostic names.
 *
 * ## Why a file that fails to load is a diagnostic, not a throw
 *
 * `steps/` is user code. One file with a syntax error should report *that file*
 * and leave the other nine loaded, so a person sees one message about one file
 * instead of a stack trace and a compile that did nothing. A step that was
 * supposed to load and did not still fails the compile — through
 * `E_STEP_LOAD` — so nothing is quietly skipped.
 *
 * TypeScript files load only when the host can import them (a loader, or a build
 * step). That is the project's business, not this one's; an import that fails is
 * reported like any other load failure, with the error the runtime gave.
 */
import { readdirSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { customDiagnostic, type Diagnostic } from "./diagnostics.js";
import { isCustomStep } from "./types.js";
import { StepRegistry } from "./registry.js";
import type { DefinedStep } from "./define.js";

const LOADABLE = new Set([".ts", ".mts", ".js", ".mjs"]);

/** Every loadable file under `dir`, deepest-last, sorted for a stable order. */
function stepFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // No `steps/` directory at all is the normal case for most projects.
    return [];
  }
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...stepFiles(path));
    else if (LOADABLE.has(extname(entry.name)) && !entry.name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

export interface LoadResult {
  readonly registry: StepRegistry;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Load `steps/` into a registry.
 *
 * `root` is the project root; `dir` is `config.steps.dir`, resolved against it.
 * Ids are relative to the root and use posix separators, so a plan compiled on
 * Windows and one compiled on Linux carry the same `custom.id`.
 */
export async function loadSteps(root: string, dir = "steps"): Promise<LoadResult> {
  const registry = new StepRegistry();
  const diagnostics: Diagnostic[] = [];

  for (const path of stepFiles(join(root, dir))) {
    const id = relative(root, path).split(sep).join("/");

    let module: Record<string, unknown>;
    try {
      module = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
    } catch (error) {
      diagnostics.push(
        customDiagnostic(
          "E_STEP_LOAD",
          `${id} could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
          id,
        ),
      );
      continue;
    }

    let found = 0;
    for (const [name, value] of Object.entries(module)) {
      if (!isCustomStep(value)) continue;
      found += 1;
      const step = (value as DefinedStep).withId(`${id}#${name}`);
      const clash = registry.add(step);
      if (clash !== undefined) diagnostics.push(clash);
    }

    if (found === 0) {
      diagnostics.push(
        customDiagnostic(
          "E_STEP_LOAD",
          `${id} exports no custom step. A file under steps/ must export at least one defineStep() result.`,
          id,
        ),
      );
    }
  }

  return { registry, diagnostics };
}
