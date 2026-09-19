/**
 * Loading a project for the module (b) commands (LLD §3.5, §15).
 *
 * `compile`, `lint` and `run` all need the same five things — the config, the
 * flows, the data, the named API requests and the Tier 0 steps — and getting
 * them in the same order matters, because a `--stable` compile has to be a
 * function of the files and nothing else.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readBindingIndex, type BindingIndexEntry } from "@svatah/yam-bindings";
import {
  compile,
  compileWithModelTiers,
  type CompileOptions,
  type CompileResult,
} from "@svatah/yam-compiler";
import { diagnostic, readProjectFrom, type Diagnostic, type Project } from "@svatah/yam-spec";
import { customDiagnostic, loadSteps, StepRegistry } from "@svatah/yam-steps";
import { projectTrust, type ProjectTrust } from "./trust.js";
import type { Config } from "@svatah/yam-schema";
import { loadConfig as readConfig } from "@svatah/yam-bindings-cli";
import { ConfigError } from "./config-error.js";

/*
 * Config loading lives in `@svatah/yam-bindings-cli` since Draft 2.5, so that both
 * command lines read one file with one set of defaults (LLD §15). Re-exported
 * here because this is where module (b) has always reached for it.
 */
export { CONFIG_FILES, loadConfig } from "@svatah/yam-bindings-cli";

export interface LoadedProject {
  readonly root: string;
  readonly config: Config;
  /** Whether the project's own code may run here, and why (SF-15). */
  readonly trust: ProjectTrust;
  readonly project: Project;
  readonly steps: StepRegistry;
  /** Everything reading the project said, including the step loader's. */
  readonly diagnostics: readonly Diagnostic[];
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

/** What a project's config launches: `app.launch`'s bundle and path (SF-15). */
export function launchesOf(config: { app: { launch?: { bundle?: string; path?: string } } }): string[] {
  const launch = config.app.launch;
  return [launch?.bundle, launch?.path].filter((one): one is string => one !== undefined);
}

/**
 * Why this project may not run here, or `undefined` when it may (SF-15).
 *
 * The steps are withheld at load; what a run would *start* is refused before
 * it starts: a program the config launches, and the Playwright config the
 * Playwright host runs.
 */
export function untrustedRun(loaded: LoadedProject, host?: string): string | undefined {
  if (loaded.trust.runsCode) return undefined;
  const launched = launchesOf(loaded.config);
  const playwright = host === "playwright" ? loaded.trust.code.filter((one) => one.startsWith("playwright.config.")) : [];
  const starts = [...launched, ...playwright];
  if (starts.length === 0) return undefined;
  return (
    `This project would start code this machine has not been told to run (${starts.join(", ")}). ` +
    `If you trust it, run \`yam trust ${loaded.root}\`.`
  );
}

export async function loadProject(root: string, options: { honourCi?: boolean } = {}): Promise<LoadedProject> {
  const absolute = resolve(root);
  const { config } = readConfig(absolute);

  const bindings = bindingsOf(absolute, config.bindings.dir);

  const read = readProjectFrom({
    root: absolute,
    flowsDir: config.flows.dir,
    // `config.flows.include` / `exclude` (T11.2): in the schema since Draft 1
    // and read by nothing, so a project that narrowed its flows was quietly
    // running all of them.
    ...(config.flows.include === undefined ? {} : { flowsInclude: config.flows.include }),
    ...(config.flows.exclude === undefined ? {} : { flowsExclude: config.flows.exclude }),
    dataFile: config.data.file,
    apiDir: config.api.dir,
    bindings: bindings.entries,
  });

  /*
   * A project's code runs only where the person has said it may (SF-15). An
   * untrusted project still loads — its flows, its bindings, its runs — and
   * says why its custom steps are missing, with the command that trusts it.
   */
  const trust = projectTrust(absolute, {
    stepsDir: config.steps.dir,
    launches: launchesOf(config),
    ...(options.honourCi === undefined ? {} : { honourCi: options.honourCi }),
  });
  const stepFiles = trust.code.filter((one) => one.startsWith(`${config.steps.dir}/`));
  /*
   * A warning, not an error: a project whose flows use no custom step still
   * compiles and runs, and one that does fails on the step it cannot find —
   * with this beside it saying why.
   */
  const steps =
    trust.runsCode || stepFiles.length === 0
      ? trust.runsCode
        ? await loadSteps(absolute, config.steps.dir)
        : { registry: new StepRegistry(), diagnostics: [] }
      : {
          registry: new StepRegistry(),
          diagnostics: [
            {
              ...customDiagnostic(
                "W_STEP_UNTRUSTED",
                `${config.steps.dir}/ holds code (${stepFiles.slice(0, 3).join(", ")}` +
                  `${stepFiles.length > 3 ? ", …" : ""}) that this machine has not been told to run, so ` +
                  `none of its custom steps were loaded. If you trust this project, run \`yam trust ${absolute}\`.`,
                stepFiles[0]!,
              ),
              severity: "warning" as const,
            },
          ],
        };

  return {
    root: absolute,
    config,
    trust,
    project: read.project,
    steps: steps.registry,
    diagnostics: [
      ...bindings.diagnostics,
      ...read.diagnostics,
      // `@svatah/yam-steps` keeps its own diagnostic shape (LLD §1); it is
      // structurally the same, and the compiler passes it through unchanged.
      ...steps.diagnostics.map((d) => ({ ...d, severity: d.severity })),
    ] as readonly Diagnostic[],
  };
}

/** What `compile()` is called with for a loaded project. */
function compileOptions(loaded: LoadedProject, options: { stable?: boolean }): CompileOptions {
  return {
    project: loaded.project,
    steps: loaded.steps,
    projectName: loaded.config.project,
    stepTimeoutMs: loaded.config.run.stepTimeoutMs,
    ...(options.stable === undefined ? {} : { stable: options.stable }),
  };
}

/** Compile a loaded project with the grammar alone. Offline, always. */
export function compileProject(
  loaded: LoadedProject,
  options: { stable?: boolean } = {},
): CompileResult {
  return compile(compileOptions(loaded, options));
}

/**
 * Compile, asking the registered model tiers about what the grammar refused
 * (T4.3, T4.4).
 *
 * Identical to `compileProject` when no tier was asked for, which is why `run`,
 * the service and the host can go on calling the synchronous one: a plan is a
 * plan whichever produced it, and `--tier2` is a decision made at `compile`
 * time and recorded in the plan's `origin.tier` (REQ-COMP-1).
 */
export async function compileProjectWithTiers(
  loaded: LoadedProject,
  options: { stable?: boolean; tier2?: boolean; tier3?: boolean; onProgress?: (line: string) => void } = {},
): Promise<CompileResult> {
  return await compileWithModelTiers(compileOptions(loaded, options), {
    ...(options.tier2 === undefined ? {} : { tier2: options.tier2 }),
    ...(options.tier3 === undefined ? {} : { tier3: options.tier3 }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  });
}
