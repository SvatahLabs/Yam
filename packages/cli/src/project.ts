/**
 * Loading a project for the module (b) commands (LLD §3.5, §15).
 *
 * `compile`, `lint` and `run` all need the same five things — the config, the
 * flows, the data, the named API requests and the Tier 0 steps — and getting
 * them in the same order matters, because a `--stable` compile has to be a
 * function of the files and nothing else.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { compile, type CompileResult } from "@svatah/compiler";
import { readProjectFrom, type Diagnostic, type Project } from "@svatah/spec";
import { loadSteps, type StepRegistry } from "@svatah/steps";
import { DEFAULT_CONFIG, configSchema, type Config } from "@svatah/schema";

export const CONFIG_FILES = ["svatah.config.yaml", "svatah.config.yml", "svatah.config.json"];

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
    const merged = { ...DEFAULT_CONFIG, project: root.split(/[\\/]/).pop() ?? "project", ...(parsed ?? {}) };
    return { config: configSchema.parse(merged), file: name };
  }
  return {
    config: configSchema.parse({
      ...DEFAULT_CONFIG,
      project: root.split(/[\\/]/).pop() ?? "project",
    }),
  };
}

/** The bindings store's ids and phrases, without loading the store itself. */
function bindingsOf(root: string, dir: string): Array<{ id: string; phrases: string[] }> {
  const out: Array<{ id: string; phrases: string[] }> = [];
  const walk = (current: string, prefix: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path, prefix === "" ? entry.name : `${prefix}.${entry.name}`);
        continue;
      }
      if (!entry.name.endsWith(".yaml")) continue;
      const text = readFileSync(path, "utf8");
      const stem = entry.name.replace(/\.yaml$/, "");
      const id = /^id: "(.+)"$/m.exec(text)?.[1] ?? (prefix === "" ? stem : `${prefix}.${stem}`);
      const phrases = [...text.matchAll(/^ {2}- "(.+)"$/gm)].map((m) => m[1]!);
      out.push({ id, phrases });
    }
  };
  walk(join(root, dir), "");
  return out;
}

export async function loadProject(root: string): Promise<LoadedProject> {
  const absolute = resolve(root);
  const { config } = loadConfig(absolute);

  const read = readProjectFrom({
    root: absolute,
    flowsDir: config.flows.dir,
    dataFile: config.data.file,
    apiDir: config.api.dir,
    bindings: bindingsOf(absolute, config.bindings.dir),
  });

  const steps = await loadSteps(absolute, config.steps.dir);

  return {
    root: absolute,
    config,
    project: read.project,
    steps: steps.registry,
    diagnostics: [
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
