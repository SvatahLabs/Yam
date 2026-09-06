/**
 * A small argument reader for the CLI (LLD §15).
 *
 * Deliberately not a framework: the CLI's shape is a table in LLD §15 and the
 * exit codes are part of the contract, so the parsing that stands between a
 * command line and those is a few lines that can be read in one sitting.
 */
export interface ParsedArgs {
  /** Positional words before the first option, e.g. `["surface", "conform"]`. */
  readonly command: readonly string[];
  /**
   * `--name value` and `--name=value`; a bare `--flag` is `true`.
   *
   * An option given more than once collects into an array, because `--input`
   * (LLD §15) is meant to be repeated and silently keeping only the last one
   * would drop inputs a run was told to use.
   */
  readonly options: Readonly<Record<string, string | true | string[]>>;
  /** Positionals that appeared after an option. */
  readonly rest: readonly string[];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const command: string[] = [];
  const options: Record<string, string | true | string[]> = {};
  const rest: string[] = [];
  let seenOption = false;

  /** Second and later values of one option collect into an array. */
  const set = (name: string, value: string | true): void => {
    const existing = options[name];
    if (existing === undefined) {
      options[name] = value;
      return;
    }
    if (value === true) return;
    options[name] = Array.isArray(existing)
      ? [...existing, value]
      : [...(typeof existing === "string" ? [existing] : []), value];
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      seenOption = true;
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        set(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        set(body, next);
        i += 1;
      } else {
        set(body, true);
      }
      continue;
    }
    if (seenOption) rest.push(arg);
    else command.push(arg);
  }

  return { command, options, rest };
}

/**
 * A string option, or `undefined` when absent. A bare flag is not a string.
 *
 * A repeated option gives its last value here: a command that takes one of
 * something and was given two meant the second.
 */
export function stringOption(args: ParsedArgs, name: string): string | undefined {
  const value = args.options[name];
  if (Array.isArray(value)) return value[value.length - 1];
  return typeof value === "string" ? value : undefined;
}

/** Every value of a repeated option, in order. */
export function stringOptions(args: ParsedArgs, name: string): string[] {
  const value = args.options[name];
  if (Array.isArray(value)) return [...value];
  return typeof value === "string" ? [value] : [];
}

/** A boolean option: present as a bare flag, or `--name true|false`. */
export function boolOption(args: ParsedArgs, name: string, fallback = false): boolean {
  const value = args.options[name];
  if (value === undefined) return fallback;
  if (value === true) return true;
  return value !== "false" && value !== "0";
}

/**
 * A numeric option, or `undefined` when absent or unparseable.
 *
 * Unparseable is `undefined` rather than `NaN`: `--workers eight` should fall
 * back to the configured value, not set the pool size to nothing.
 */
export function numberOption(args: ParsedArgs, name: string): number | undefined {
  const value = stringOption(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * `--input k=v`, repeated, beneath `YAM_INPUT_<NAME>` (LLD §10, §15).
 *
 * Two sources because a story's inputs are two different things at once. At a
 * terminal they are arguments and belong on the command line; in CI one of them
 * is a password, and a password on a command line is a password in the process
 * list. The flag wins, so an exported default can still be overridden for one
 * invocation.
 *
 * `YAM_INPUT_PASSWORD` names the input `password`: the environment is upper
 * case by convention and the mapping is a lower-casing, so an input whose name
 * is not a plain lower-case word has to use the flag.
 *
 * Shared by `run`, `workflow run` and `heal --run` rather than written three
 * times: LLD §10 says heal takes them "exactly as `run` does", and the only way
 * to keep that true is for it to be the same function.
 */
export function inputOptions(
  args: ParsedArgs,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(environment)) {
    if (!key.startsWith("YAM_INPUT_") || value === undefined) continue;
    const name = key.slice("YAM_INPUT_".length).toLowerCase();
    if (name !== "") out[name] = value;
  }

  for (const one of stringOptions(args, "input")) {
    const at = one.indexOf("=");
    if (at <= 0) continue;
    out[one.slice(0, at).trim()] = one.slice(at + 1);
  }

  return out;
}
