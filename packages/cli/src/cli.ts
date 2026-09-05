/**
 * The `svatah` command line (LLD §15).
 *
 * Phase 1 implements the commands module (a) needs: `surface conform`,
 * `bindings`, `heal` and `eval healing`. The rest of the table in LLD §15 arrives
 * with the components behind it, and an unimplemented command says which task
 * builds it rather than printing a bare "unknown command".
 */
import { parseArgs, type ParsedArgs } from "./args.js";
import { EXIT, type ExitCode } from "./exit-codes.js";
import { surfaceCommand, type CommandIo } from "./commands/surface.js";

/** Commands LLD §15 lists that Phase 1 does not build, and what does. */
const LATER: Record<string, string> = {
  compile: "T2.5",
  lint: "T2.5",
  record: "T3.3",
  run: "T2.7",
  migrate: "T2.9",
  repl: "T4.5",
  workflow: "T5.4",
  tool: "T5.5",
  host: "T2.8",
  init: "T2.10",
  doctor: "T4.1",
  mcp: "T4.6",
  serve: "T2.11",
};

const USAGE = `svatah — a deterministic automation runtime with a standard agent surface

Phase 1 (module a — bindings and model-free healing for Playwright users):

  svatah surface conform --adapter <name> [--base-url <url>] [--headed] [--only <ids>]
                         [--report <path.md>] [--json]
  svatah bindings list [--dir <bindings>] [--json]
  svatah bindings show <id> [--dir <bindings>] [--json]
  svatah bindings verify [--adapter <name>] [--base-url <url>] [--id <id>] [--json]
  svatah bindings prune [--used-in <dirs>] [--apply] [--json]
  svatah heal --from-bind-failures | --run <id>
              [--dir <bindings>] [--out <.svatah>] [--base-url <url>]
              [--apply] [--no-model] [--headed] [--json]
  svatah eval healing [--no-model] [--base-url <url>] [--report <path.md>] [--json]

Exit codes are the table in LLD §15.
`;

export async function main(argv: readonly string[], io: CommandIo): Promise<ExitCode> {
  const args: ParsedArgs = parseArgs(argv);
  const command = args.command[0];

  if (command === undefined || command === "help" || args.options["help"] !== undefined) {
    io.out(USAGE);
    return command === undefined ? EXIT.usage : EXIT.ok;
  }

  switch (command) {
    case "surface":
      return await surfaceCommand(args, io);
    case "bindings":
      return await (await import("./commands/bindings.js")).bindingsCommand(args, io);
    case "heal":
      return await (await import("./commands/heal.js")).healCommand(args, io);
    case "eval":
      return await (await import("./commands/eval.js")).evalCommand(args, io);
    default: {
      const task = LATER[command];
      io.err(
        task === undefined
          ? `Unknown command "${command}".\n\n${USAGE}`
          : `\`svatah ${command}\` is not built yet; it arrives with ${task} (see docs/spec/tasks.md).`,
      );
      return EXIT.usage;
    }
  }
}
