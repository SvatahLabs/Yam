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
import type * as ServiceExports from "@svatah/service";
import { numberOption, stringOption, type ParsedArgs } from "@svatah/bindings-cli";

type ServiceModule = typeof ServiceExports;
type RunningService = ServiceExports.RunningService;
import { EXIT, type ExitCode } from "@svatah/bindings-cli";
import type { CommandIo } from "@svatah/bindings-cli";

export async function serveCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const project = args.command[1] ?? ".";

  /*
   * Imported dynamically, and this is the one place it happens for a reason
   * other than start-up cost.
   *
   * `@svatah/service` depends on `@svatah/cli` — LLD §13.5 says every handler
   * calls the CLI's functions — so the dependency only points one way, and this
   * package must not declare the service even as a dev dependency: that would
   * make the workspace graph cyclic and the build order arbitrary. It is an
   * *optional peer*, resolved at run time, so `svatah serve` works when the
   * service is installed and says what to install when it is not.
   */
  let service: RunningService;
  try {
    const { createService } = (await import("@svatah/service")) as ServiceModule;
    service = await createService({
      project,
      ...(numberOption(args, "port") === undefined ? {} : { port: numberOption(args, "port")! }),
      ...(stringOption(args, "token") === undefined ? {} : { token: stringOption(args, "token")! }),
    });
  } catch (error) {
    if (!(error instanceof Error) || !/Cannot find (package|module)/.test(error.message)) throw error;
    io.err(
      "`svatah serve` needs @svatah/service, which is an optional peer of this package.\n" +
        "  npm install @svatah/service",
    );
    return EXIT.usage;
  }

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
