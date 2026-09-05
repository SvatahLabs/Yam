/**
 * The `svatah` command line (LLD §15).
 *
 * Phase 1 built the commands module (a) needs — `surface conform`, `bindings`,
 * `heal`, `eval healing`. Phase 2 adds module (b)'s: `compile`, `lint`, `run`
 * under both hosts, `migrate`, `init` and `doctor`. What is still missing says
 * which task builds it rather than printing a bare "unknown command", because
 * "not yet" and "never" are different answers.
 *
 * Commands are imported lazily. `svatah bindings list` should not pay for
 * loading the compiler, and `svatah --help` should not load anything at all.
 */
import { parseArgs, type ParsedArgs } from "./args.js";
import { EXIT, type ExitCode } from "./exit-codes.js";
import { surfaceCommand, type CommandIo } from "./commands/surface.js";

/** Commands LLD §15 lists that are not built yet, and what builds them. */
const LATER: Record<string, string> = {
  record: "T3.3",
  repl: "T4.5",
  workflow: "T5.4",
  tool: "T5.5",
  mcp: "T4.6",
  serve: "T2.11",
};

const USAGE = `svatah — a deterministic automation runtime with a standard agent surface

Flows (module b):

  svatah init [dir] [--force]
  svatah lint [dir] [--json]
  svatah compile [dir] [--stable] [--out .svatah/plan.json] [--json]
  svatah run [dir] [--host playwright|none] [--flow <file>] [--story <name>]
             [--workers <n>] [--headed] [--out runs] [--run-id <id>] [--json]
  svatah host generate [dir] [--out .svatah/specs]
  svatah migrate <src> <dest> [--keep-original] [--json]
  svatah doctor [dir] [--json]

Bindings and healing (module a):

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
    case "compile":
      return await (await import("./commands/compile.js")).compileCommand(args, io);
    case "lint":
      return await (await import("./commands/compile.js")).lintCommand(args, io);
    case "run":
      return await (await import("./commands/run.js")).runCommand(args, io);
    case "migrate":
      return await (await import("./commands/migrate.js")).migrateCommand(args, io);
    case "init":
      return await (await import("./commands/init.js")).initCommand(args, io);
    case "doctor":
      return await (await import("./commands/doctor.js")).doctorCommand(args, io);
    case "host":
      return await (await import("./commands/host.js")).hostCommand(args, io);
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
