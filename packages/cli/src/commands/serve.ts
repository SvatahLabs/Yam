/**
 * `svatah serve` (REQ-ADE-1, LLD §13.5, §15).
 *
 * ```
 * svatah serve [dir] [--port 0] [--token <t>]
 * ```
 *
 * Prints the port and the token on stdout, once, in a line the ADE parses when
 * it spawns this as a child process. The token is generated per process and is
 * not written anywhere: a token in a file is a token that outlives the process
 * that needed it.
 */
import { createService } from "@svatah/service";
import { numberOption, stringOption, type ParsedArgs } from "@svatah/bindings-cli";
import { compileProject, loadProject } from "../project.js";
import { runProject } from "./run.js";
import { newRunId } from "@svatah/runtime";
import { EXIT, type ExitCode } from "@svatah/bindings-cli";
import type { CommandIo } from "@svatah/bindings-cli";

export async function serveCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const project = args.command[1] ?? ".";

  /*
   * The service is *given* the CLI's functions rather than importing them
   * (LLD §13.5: "every handler calls the same functions the CLI calls"). That is
   * what makes the dependency point one way — `cli ─► service` — and it makes
   * the rule stronger than a lint could: a handler has no way to reach the
   * compiler or the executor, only these four.
   *
   * The first draft had the service import `@svatah/cli`, which made the
   * workspace graph cyclic and gave pnpm an arbitrary build order; a clean clone
   * failed with the service's type build running before the CLI had types.
   */
  const service = await createService({
    project,
    api: { loadProject, compileProject, runProject, newRunId } as never,
    ...(numberOption(args, "port") === undefined ? {} : { port: numberOption(args, "port")! }),
    ...(stringOption(args, "token") === undefined ? {} : { token: stringOption(args, "token")! }),
  });

  // One line, parsed by the ADE's spawn handshake (LLD §13.6).
  io.out(`svatah serve listening url=${service.url} token=${service.token}`);
  io.err(
    `Serving ${project} on ${service.url}\n` +
      "  Bound to 127.0.0.1. Every route but /health and /openapi.json needs the token above.\n" +
      "  Ctrl-C to stop.",
  );

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      void service.close().then(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  return EXIT.ok;
}
