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
import { numberOption, stringOption, type ParsedArgs } from "../args.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import type { CommandIo } from "./surface.js";

export async function serveCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const project = args.command[1] ?? ".";

  /*
   * Imported dynamically, and this is the one place it happens for a reason
   * other than start-up cost: `@svatah/service` depends on `@svatah/cli`, so a
   * static import here would be a cycle. The CLI mounts the service; the service
   * calls the CLI's functions.
   */
  const { createService } = await import("@svatah/service");

  const service = await createService({
    project,
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
