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
import { numberOption, stringOption, type ParsedArgs } from "@svatah/bindings-cli";

/**
 * What `svatah serve` needs from `@svatah/service`, written out here.
 *
 * Not `import type … from "@svatah/service"`: a type import still has to
 * *resolve*, so the package would have to be declared, and declaring it anywhere
 * — dependency, dev dependency, optional peer — makes the workspace graph cyclic
 * (the service depends on this package, LLD §13.5). A structural type costs four
 * lines and says exactly what this command depends on.
 */
interface RunningService {
  readonly url: string;
  readonly token: string;
  close(): Promise<void>;
}

interface ServiceModule {
  createService(options: {
    project: string;
    port?: number;
    token?: string;
  }): Promise<RunningService>;
}
import { EXIT, type ExitCode } from "@svatah/bindings-cli";
import type { CommandIo } from "@svatah/bindings-cli";

export async function serveCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const project = args.command[1] ?? ".";

  /*
   * Imported dynamically, and this is the one place it happens for a reason
   * other than start-up cost.
   *
   * `@svatah/service` depends on `@svatah/cli` — LLD §13.5 says every handler
   * calls the CLI's functions — so the dependency points one way and this
   * package declares the service **nowhere**: not as a dependency, not as a dev
   * dependency, not even as an optional peer. Any of those makes the workspace
   * graph cyclic, and a cyclic graph gives pnpm an arbitrary build order — which
   * showed up as the service's type build running before the CLI had any types.
   *
   * So the import is resolved at run time and its absence is a message rather
   * than a stack trace. A project that wants `svatah serve` installs
   * `@svatah/service`; everything else in the CLI works without it.
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
