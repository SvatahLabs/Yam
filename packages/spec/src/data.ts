/**
 * Run-level data and secrets (REQ-LANG-9, REQ-NFR-6, `docs/flow-language.md` §3).
 *
 * ```yaml
 * user:
 *   email: "atul@example.com"
 *   password: "${YAM_SAMPLE_PASSWORD}"
 * secrets:
 *   - user.password
 * ```
 *
 * Two things matter here and nothing else does.
 *
 * **Secrets are indirections.** A value under `secrets:` names an environment
 * variable through `${NAME}`; the file holds the name, never the value, so
 * `data.yaml` is committable. The set of secret paths travels with the data,
 * because everything downstream — prompts, audit lines, results, traces,
 * screenshots — needs to know which values to redact, and asking "does it look
 * like a password" is not a way to know that.
 *
 * **A missing secret is not a compile error.** Compiling a plan does not need the
 * value; running does. So an unresolved `${NAME}` is `W_SECRET_UNSET` and the
 * path stays marked secret, which keeps the redaction correct even when the
 * value is absent.
 */
import { parse } from "yaml";
import { diagnostic, type Diagnostic } from "./diagnostics.js";

export interface ProjectData {
  /** The tree, with `${ENV}` indirections resolved where the variable was set. */
  readonly values: Readonly<Record<string, unknown>>;
  /** Dotted paths declared secret, so everything downstream can redact them. */
  readonly secrets: ReadonlySet<string>;
}

export const EMPTY_DATA: ProjectData = { values: {}, secrets: new Set() };

/** `${NAME}` — the whole value, not an interpolation inside a longer string. */
const INDIRECTION = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

/** Environment overrides: `YAM_DATA_USER__EMAIL` → `user.email`. */
const OVERRIDE_PREFIX = "YAM_DATA_";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every dotted path in a tree, so an override can be matched case-insensitively. */
function paths(tree: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    out.push(path);
    if (isRecord(value)) out.push(...paths(value, path));
  }
  return out;
}

function readAt(tree: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = tree;
  for (const segment of path.split(".")) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function writeAt(tree: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  const last = segments.pop()!;
  let cursor = tree;
  for (const segment of segments) {
    const next = cursor[segment];
    if (!isRecord(next)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[last] = value;
}

/**
 * Resolve `${NAME}` indirections in place, reporting the ones that are unset.
 *
 * Only whole-value indirections are resolved. `"${A}/${B}"` is left alone: a
 * value that is partly a secret is a value that cannot be redacted, and quietly
 * half-resolving it would produce exactly that.
 */
function resolveIndirections(
  tree: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  file: string,
  out: Diagnostic[],
  prefix = "",
): void {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isRecord(value)) {
      resolveIndirections(value, env, file, out, path);
      continue;
    }
    if (typeof value !== "string") continue;
    const match = INDIRECTION.exec(value);
    if (match === null) continue;
    const name = match[1]!;
    const resolved = env[name];
    if (resolved === undefined) {
      out.push(
        diagnostic(
          "W_SECRET_UNSET",
          `${path} reads \${${name}}, which is not set. Compiling does not need the value; running will.`,
          { file, line: 0 },
        ),
      );
      continue;
    }
    tree[key] = resolved;
  }
}

/** `YAM_DATA_*` overrides, applied after the file and after indirections. */
function applyOverrides(tree: Record<string, unknown>, env: NodeJS.ProcessEnv): void {
  const known = new Map(paths(tree).map((path) => [path.toLowerCase(), path]));

  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(OVERRIDE_PREFIX) || value === undefined) continue;
    const raw = name.slice(OVERRIDE_PREFIX.length);
    if (raw === "") continue;
    // `__` is the path separator, because a shell variable cannot contain a dot.
    // A literal dotted name is accepted too, for anyone setting it from a script.
    const requested = raw.includes(".") ? raw : raw.split("__").join(".");
    // Match an existing path whatever its casing; otherwise create the
    // lower-cased one, so a new key is at least predictable.
    writeAt(tree, known.get(requested.toLowerCase()) ?? requested.toLowerCase(), value);
  }
}

/**
 * Read `data.yaml` (or a JSON file with the same shape).
 *
 * `text` is the file's content; the caller does the IO, so this is testable
 * without a filesystem and reusable by the service, which has the content in
 * hand already.
 */
export function readData(
  text: string,
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): { data: ProjectData; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  let parsed: unknown;
  try {
    parsed = parse(text) as unknown;
  } catch (error) {
    diagnostics.push(
      diagnostic("E_DATA", `${file} is not valid YAML: ${(error as Error).message}`, {
        file,
        line: 0,
      }),
    );
    return { data: EMPTY_DATA, diagnostics };
  }

  if (parsed === null || parsed === undefined) return { data: EMPTY_DATA, diagnostics };
  if (!isRecord(parsed)) {
    diagnostics.push(
      diagnostic("E_DATA", `${file} must be a mapping of names to values.`, { file, line: 0 }),
    );
    return { data: EMPTY_DATA, diagnostics };
  }

  const tree = structuredClone(parsed);
  const declared = tree["secrets"];
  delete tree["secrets"];

  const secrets = new Set<string>();
  if (declared !== undefined) {
    if (!Array.isArray(declared)) {
      diagnostics.push(
        diagnostic("E_DATA", "`secrets:` must be a list of dotted paths.", { file, line: 0 }),
      );
    } else {
      for (const entry of declared) {
        if (typeof entry !== "string") {
          diagnostics.push(
            diagnostic("E_DATA", `\`secrets:\` holds ${JSON.stringify(entry)}, which is not a path.`, {
              file,
              line: 0,
            }),
          );
          continue;
        }
        if (readAt(tree, entry) === undefined) {
          diagnostics.push(
            diagnostic(
              "E_DATA",
              `\`secrets:\` names "${entry}", which is not in the data. A path that redacts nothing is a redaction someone is relying on.`,
              { file, line: 0 },
            ),
          );
          continue;
        }
        secrets.add(entry);
      }
    }
  }

  resolveIndirections(tree, env, file, diagnostics, "");
  applyOverrides(tree, env);

  return { data: { values: tree, secrets }, diagnostics };
}

/** Read one dotted path, for `{data.user.email}`. */
export function dataAt(data: ProjectData, path: string): unknown {
  return readAt(data.values as Record<string, unknown>, path);
}

/** Whether a dotted path was declared secret, or sits under one that was. */
export function isSecretPath(data: ProjectData, path: string): boolean {
  if (data.secrets.has(path)) return true;
  for (const secret of data.secrets) {
    if (path.startsWith(`${secret}.`)) return true;
  }
  return false;
}
