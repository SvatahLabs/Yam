/**
 * The service's surface routes, taken from the catalogue (T12, SF-03).
 *
 * The service may not import `surface-control` (LLD §1), so the CLI builds the
 * descriptors and hands them over. One list, one source: an operation added to
 * the catalogue is served, offered as a CLI subcommand and published as an MCP
 * tool without any of the three being edited.
 *
 * Every operation runs against the same broker the command line uses, so an
 * HTTP client and a person at a terminal address the same sessions rather than
 * two parallel worlds.
 */
import { OPERATIONS, callBroker, type BrokerOperation } from "@svatah/yam-surface-control";

/** One route the service can register, per catalogue operation. */
export interface SurfaceRoute {
  readonly name: string;
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  run(args: Record<string, unknown>): Promise<unknown>;
}

/**
 * The routes, bound to whichever broker is running.
 *
 * `start` is injected so the service does not decide how a broker comes to
 * exist; in practice it is the same lazy start the CLI does.
 */
export function surfaceRoutes(start: () => Promise<{ url: string; token: string }>): SurfaceRoute[] {
  return OPERATIONS.map((operation) => ({
    name: operation.name,
    method: operation.service.method,
    path: operation.service.path,
    async run(args: Record<string, unknown>): Promise<unknown> {
      /*
       * One place decides how a broker comes to exist (T00).
       *
       * This route used to make the decision a second time — discover, ask
       * whether it is alive, and start one if the answer was no — with a
       * two-second deadline standing in for "is it there". A broker launching
       * a browser for somebody else answers no, and the service then started a
       * *second* broker on the machine while the first still held every open
       * session. That is the desktop half of the race that made the outer
       * session disappear mid-run: the application's own service asking for a
       * broker at the same moment as the command line driving it.
       *
       * `start` is `connectToBroker`, which discovers, distinguishes busy from
       * gone, and takes an exclusive lock before starting anything.
       */
      return await callBroker(await start(), operation.name as BrokerOperation, args);
    },
  }));
}
