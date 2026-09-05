/**
 * Loading a project for the module (b) commands (LLD §3.5, §15).
 *
 * `compile`, `lint` and `run` all need the same five things — the config, the
 * flows, the data, the named API requests and the Tier 0 steps — and getting
 * them in the same order matters, because a `--stable` compile has to be a
 * function of the files and nothing else.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { readBindingIndex, type BindingIndexEntry } from "@svatah/bindings";
import { compile, type CompileResult } from "@svatah/compiler";
import { diagnostic, readProjectFrom, type Diagnostic, type Project } from "@svatah/spec";
import { loadSteps, type StepRegistry } from "@svatah/steps";
import { DEFAULT_CONFIG, configSchema, type Config } from "@svatah/schema";
import { ConfigError } from "./config-error.js";

export const CONFIG_FILES = ["svatah.config.yaml", "svatah.config.yml", "svatah.config.json"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The defaults, with the file's sections merged over them one level deep.
 *
 * A shallow spread would be wrong: `bindings: { dir: fixtures }` in a config
 * would replace the whole `bindings` section and silently drop
 * `testIdAttributes` and `ignoreAttributes`, which is not what anyone writing
 * two lines of YAML means. Arrays are replaced whole — a project that lists its
 * test-id attributes is naming the set, not adding to ours.
 */
function withDefaults(parsed: Record<string, unknown>, project: string): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...DEFAULT_CONFIG, project, ...parsed };
  for (const [key, fallback] of Object.entries(DEFAULT_CONFIG)) {
    const given = parsed[key];
    if (isPlainObject(fallback) && isPlainObject(given)) merged[key] = { ...fallback, ...given };
  }
  return merged;
}

export interface LoadedProject {
  readonly root: string;
  readonly config: Config;
  readonly project: Project;
  readonly steps: StepRegistry;
  /** Everything reading the project said, including the step loader's. */
  readonly diagnostics: readonly Diagnostic[];
}

/** The config a project declares, or the defaults. */
export function loadConfig(root: string): { config: Config; file?: string } {
  for (const name of CONFIG_FILES) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const parsed = (name.endsWith(".json") ? JSON.parse(text) : parseYaml(text)) as
      | Record<string, unknown>
      | null;
    const merged = withDefaults(parsed ?? {}, root.split(/[\\/]/).pop() ?? "project");
    const result = configSchema.safeParse(merged);
    /*
     * A typo in a config file is the user's mistake, not a crash. Zod's issues
     * become one line each, pointing at the path, and the caller turns that into
     * exit 64 (LLD §15).
     */
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("\n");
      throw new ConfigError(`${name} is not a valid Svatah config:\n${issues}`, name);
    }
    return { config: result.data, file: name };
  }
  return {
    config: configSchema.parse({
      ...DEFAULT_CONFIG,
      project: root.split(/[\\/]/).pop() ?? "project",
    }),
  };
}

/**
 * The bindings store's ids and phrases, for the target dictionary (LLD §4.3).
 *
 * Draft 2.5. This used to scan the YAML text for lines of the form two spaces,
 * dash, double-quoted string, which reads one of the several ways YAML writes a
 * list of strings: a phrase written unquoted, single-quoted, in flow style, or
 * at a different indentation silently vanished from the dictionary while
 * `bindings show` still listed it, and every step naming it compiled `unbound`
 * (Phase 3 verification, F1). The entries now come from the same loader the
 * store uses, so a file the store accepts contributes exactly what it declares.
 *
 * A file that will not parse is a `ConfigError` rather than a stack trace, and
 * — the point of raising it at all — rather than a project that quietly loses
 * every phrase in the file.
 */
function bindingsOf(
  root: string,
  dir: string,
): { entries: BindingIndexEntry[]; diagnostics: Diagnostic[] } {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return { entries: [], diagnostics: [] };

  let entries: BindingIndexEntry[];
  try {
    entries = readBindingIndex(absolute);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const named = message.includes(absolute) ? message.split(absolute).join(dir) : `${dir}: ${message}`;
    throw new ConfigError(named, dir);
  }

  /*
   * `W_BINDING_NO_PHRASES` (LLD §4.3, Draft 2.5).
   *
   * A binding with no phrase is not broken — `bind("login.username-field")`
   * addresses it by id and never needs one — so this is a warning, not an error.
   * It is worth saying because in a flow project a phraseless binding is
   * unreachable: no sentence can name the element, and the step that meant to
   * will compile against a second, unbound id derived from its own wording.
   */
  const diagnostics = entries
    .filter((entry) => entry.phrases.length === 0)
    .map((entry) =>
      diagnostic(
        "W_BINDING_NO_PHRASES",
        `${entry.id} declares no phrases, so no sentence can name it. ` +
          "Add a `phrases:` list, or record the element from a flow step.",
        { file: `${dir}/${entry.file}`, line: 0 },
      ),
    );

  return { entries, diagnostics };
}

export async function loadProject(root: string): Promise<LoadedProject> {
  const absolute = resolve(root);
  const { config } = loadConfig(absolute);

  const bindings = bindingsOf(absolute, config.bindings.dir);

  const read = readProjectFrom({
    root: absolute,
    flowsDir: config.flows.dir,
    dataFile: config.data.file,
    apiDir: config.api.dir,
    bindings: bindings.entries,
  });

  const steps = await loadSteps(absolute, config.steps.dir);

  return {
    root: absolute,
    config,
    project: read.project,
    steps: steps.registry,
    diagnostics: [
      ...bindings.diagnostics,
      ...read.diagnostics,
      // `@svatah/steps` keeps its own diagnostic shape (LLD §1); it is
      // structurally the same, and the compiler passes it through unchanged.
      ...steps.diagnostics.map((d) => ({ ...d, severity: d.severity })),
    ] as readonly Diagnostic[],
  };
}

/** Compile a loaded project. */
export function compileProject(
  loaded: LoadedProject,
  options: { stable?: boolean } = {},
): CompileResult {
  return compile({
    project: loaded.project,
    steps: loaded.steps,
    projectName: loaded.config.project,
    stepTimeoutMs: loaded.config.run.stepTimeoutMs,
    ...(options.stable === undefined ? {} : { stable: options.stable }),
  });
}
