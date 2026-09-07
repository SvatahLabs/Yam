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
import {
  OPERATIONS,
  brokerAlive,
  callBroker,
  discoverBroker,
  type BrokerOperation,
} from "@svatah/yam-surface-control";

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
      const found = discoverBroker();
      const broker = found !== undefined && (await brokerAlive(found)) ? found : await start();
      return await callBroker(broker, operation.name as BrokerOperation, args);
    },
  }));
}
