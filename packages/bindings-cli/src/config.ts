/**
 * Reading `svatah.config.yaml` (LLD §3.5, §15).
 *
 * This lives in module (a) rather than in `@svatah/cli` because both command
 * lines need it. LLD §15 (Draft 2.5) requires one base-URL and storage-state
 * precedence "applied identically by every command that opens a session", and
 * three of those commands — `bindings verify`, `surface conform`, `eval` — are
 * module (a)'s. A second config reader beside this one is exactly how the two
 * halves would come to disagree about what `config.app` says.
 *
 * It reaches for nothing above `@svatah/schema`: the config schema, the YAML
 * parser, and the defaults.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { DEFAULT_CONFIG, configSchema, type Config } from "@svatah/schema";

/**
 * A project config that will not load (LLD §3.5, §15).
 *
 * A distinct class so `cli.ts` can catch it by type and turn it into exit 64
 * with a message, rather than letting a `ZodError` print a page of JSON for a
 * misspelled key.
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    /** The config file this came from, relative to the project root. */
    readonly file: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

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

/**
 * The paths in `app.launch` are the *project's*, so they are resolved from it
 * (T11.2, LLD §13.9).
 *
 * `flows.dir` and the rest are read relative to the project root by whoever
 * reads them; `app.launch.bundle` is handed to `open` and to `pgrep`, which are
 * run from wherever the person is standing. A relative bundle path is the
 * natural thing for a self-suite to write — the application it drives is the
 * one this checkout builds — and it has to mean the same thing whatever
 * directory `svatah run` was typed in.
 *
 * `resolve` leaves an absolute path alone, so a configuration that names one is
 * untouched.
 */
function rooted(config: Config, root: string): Config {
  const launch = config.app.launch;
  if (launch === undefined) return config;
  const at = (path: string | undefined): string | undefined =>
    path === undefined ? undefined : resolve(root, path);
  return {
    ...config,
    app: {
      ...config.app,
      launch: {
        ...launch,
        ...(launch.bundle === undefined ? {} : { bundle: at(launch.bundle)! }),
        ...(launch.path === undefined ? {} : { path: at(launch.path)! }),
      },
    },
  };
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
    return { config: rooted(result.data, root), file: name };
  }
  return {
    config: configSchema.parse({
      ...DEFAULT_CONFIG,
      project: root.split(/[\\/]/).pop() ?? "project",
    }),
  };
}

/**
 * `config.app` from a directory, or nothing.
 *
 * The forgiving form, for the module (a) commands: `svatah-bindings surface
 * conform` is run from all sorts of directories, and one that has no config, or
 * a config with a typo in an unrelated section, is not a reason to refuse to
 * conform against an explicitly given `--base-url`.
 */
export function appConfig(root: string): Config["app"] {
  try {
    return loadConfig(root).config.app;
  } catch {
    return {};
  }
}
