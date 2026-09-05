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
import { HttpSurface } from "@svatah/adapter-http";
import { apiRequestSchema } from "@svatah/schema";
import { numberOption, stringOption, type ParsedArgs } from "@svatah/bindings-cli";
import { compileProject, loadProject } from "../project.js";
import {
  serviceCompileTrajectory,
  serviceHeal,
  serviceOpenSurfaceSession,
  serviceRecord,
  serviceToolsFor,
  serviceVerifyBindings,
} from "../service-api.js";
import { runProject } from "./run.js";
import { newRunId } from "@svatah/runtime";
import { EXIT, type ExitCode } from "@svatah/bindings-cli";
import type { CommandIo } from "@svatah/bindings-cli";

/**
 * The ADE's API client, through the adapter a run uses (LLD §13.5).
 *
 * The service cannot import `adapter-http` — it imports only `@svatah/schema` —
 * so this arrives the same way its other functions do. Sharing the adapter is
 * the point: an ADE with its own HTTP client would have its own idea of a
 * header, a redirect and a cookie, and "the API client agrees with the run"
 * would be a coincidence rather than a fact.
 *
 * The request is parsed against the published schema before anything is sent, so
 * a renderer cannot talk the service into an arbitrary fetch.
 */
async function apiRequest(
  loaded: Awaited<ReturnType<typeof loadProject>>,
  request: unknown,
  options: { withSessionCookies?: boolean } = {},
): Promise<unknown> {
  const parsed = apiRequestSchema.parse(request);
  const http = new HttpSurface({
    ...(loaded.config.app.baseUrl === undefined ? {} : { baseUrl: loaded.config.app.baseUrl }),
    cwd: loaded.root,
  });
  return await http.request(parsed, {
    withSessionCookies: options.withSessionCookies === true,
    scope: { read: () => undefined },
  });
}

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
    /*
     * Nine functions since T5.7 and T5.8, and every one of them the CLI's own.
     *
     * The ADE's record review, bindings browser, heal review, surface explorer
     * and tool panel need capabilities a command line already has; injecting
     * them here rather than letting the service reach for them is what keeps
     * "an agent and a person get the same artifact" true (LLD §13.5).
     */
    api: {
      loadProject,
      compileProject,
      runProject,
      newRunId,
      apiRequest,
      record: serviceRecord,
      verifyBindings: serviceVerifyBindings,
      heal: serviceHeal,
      openSurfaceSession: serviceOpenSurfaceSession,
      compileTrajectory: serviceCompileTrajectory,
      toolsFor: serviceToolsFor,
    } as never,
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
