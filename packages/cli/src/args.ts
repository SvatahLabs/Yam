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
  /** `--name value` and `--name=value`; a bare `--flag` is `true`. */
  readonly options: Readonly<Record<string, string | true>>;
  /** Positionals that appeared after an option. */
  readonly rest: readonly string[];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const command: string[] = [];
  const options: Record<string, string | true> = {};
  const rest: string[] = [];
  let seenOption = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      seenOption = true;
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        options[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        options[body] = next;
        i += 1;
      } else {
        options[body] = true;
      }
      continue;
    }
    if (seenOption) rest.push(arg);
    else command.push(arg);
  }

  return { command, options, rest };
}

/** A string option, or `undefined` when absent. A bare flag is not a string. */
export function stringOption(args: ParsedArgs, name: string): string | undefined {
  const value = args.options[name];
  return typeof value === "string" ? value : undefined;
}

/** A boolean option: present as a bare flag, or `--name true|false`. */
export function boolOption(args: ParsedArgs, name: string, fallback = false): boolean {
  const value = args.options[name];
  if (value === undefined) return fallback;
  if (value === true) return true;
  return value !== "false" && value !== "0";
}
