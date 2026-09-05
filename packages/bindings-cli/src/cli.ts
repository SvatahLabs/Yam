/**
 * The `svatah-bindings` command line (LLD §1, §15, HLD §12, Draft 2.3).
 *
 * Module (a) is what a plain Playwright user installs: the store, model-free
 * healing, the adapter and the `bind()` fixture, with no flow language, compiler
 * or executor anywhere in the tree (REQ-PKG-1). This gives that half a command
 * line of its own, so someone who added one dependency and one fixture can still
 * inspect, verify and repair their bindings from a terminal.
 *
 * `@svatah/cli` mounts these same functions under `svatah`, so there is one
 * implementation behind two executables rather than two that drift apart.
 */
import { parseArgs, type ParsedArgs } from "./args.js";
import { EXIT, type ExitCode } from "./exit-codes.js";
import { surfaceCommand, type CommandIo } from "./commands/surface.js";

const USAGE = `svatah-bindings — the bindings store and model-free healing (module a)

  svatah-bindings bindings list [--dir <bindings>] [--json]
  svatah-bindings bindings show <id> [--dir <bindings>] [--json]
  svatah-bindings bindings verify [--adapter <name>] [--base-url <url>] [--id <id>] [--json]
  svatah-bindings bindings prune [--used-in <dirs>] [--apply] [--json]
  svatah-bindings heal --from-bind-failures | --run <id>
                       [--dir <bindings>] [--out <.svatah>] [--runs <runs>]
                       [--base-url <url>] [--storage-state <path.json>]
                       [--apply] [--no-model] [--headed] [--json]
  svatah-bindings surface conform --adapter <name> [--base-url <url>] [--headed]
                                  [--only <ids>] [--report <path.md>] [--json]
  svatah-bindings eval healing [--no-model] [--base-url <url>] [--report <path.md>] [--json]

Every one of these is also a \`svatah\` subcommand, if the whole project is
installed. Exit codes are the table in LLD §15.
`;

/** The commands module (a) owns. Mounted by `@svatah/cli` under `svatah` too. */
export async function runBindingsCommand(
  command: string,
  args: ParsedArgs,
  io: CommandIo,
): Promise<ExitCode | undefined> {
  switch (command) {
    case "surface":
      return await surfaceCommand(args, io);
    case "bindings":
      return await (await import("./commands/bindings.js")).bindingsCommand(args, io);
    case "heal":
      return await (await import("./commands/heal.js")).healCommand(args, io);
    case "eval":
      return await (await import("./commands/eval.js")).evalCommand(args, io);
    default:
      // Not one of ours. `@svatah/cli` tries its own commands next.
      return undefined;
  }
}

export async function main(argv: readonly string[], io: CommandIo): Promise<ExitCode> {
  const args: ParsedArgs = parseArgs(argv);
  const command = args.command[0];

  if (command === undefined || command === "help" || args.options["help"] !== undefined) {
    io.out(USAGE);
    return command === undefined ? EXIT.usage : EXIT.ok;
  }

  const result = await runBindingsCommand(command, args, io);
  if (result !== undefined) return result;

  io.err(
    `Unknown command "${command}".\n\n${USAGE}\n` +
      "If you were looking for `compile`, `run` or `migrate`, those are the flow half of " +
      "Svatah and live in `@svatah/cli` — install it and use `svatah`.",
  );
  return EXIT.usage;
}
