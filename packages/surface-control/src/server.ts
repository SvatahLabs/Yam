/**
 * The broker's server (SF-05, T05): the process that owns the sessions.
 *
 * A session is a browser that is open. A CLI invocation is a process that ends.
 * Wave 1's first cut kept the session store in the invocation, so
 * `yam surface connect` printed an id and then took the browser down with it,
 * and the next command answered `SESSION_NOT_FOUND` — the journey the wave
 * exists to deliver could not be run.
 *
 * So the store lives here, in a process that outlives the commands. It is one
 * route, `POST /op`, carrying the operation name and its arguments and
 * answering with the same envelope the dispatcher builds, because the CLI is
 * then a thin client rather than a second implementation.
 *
 * `node:http` rather than the service's Fastify: this package may not import
 * `service` (LLD §1), and a broker that pulled in a web framework to serve one
 * route would be paying for a dependency to avoid twenty lines.
 *
 * Loopback and a bearer token, always. The descriptor that carries the token is
 * written owner-only into the user's state directory, never into the project.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  dispatchAct,
  dispatchCapabilities,
  dispatchCheck,
  dispatchClose,
  dispatchConnect,
  dispatchDescribe,
  dispatchControl,
  dispatchEvents,
  dispatchRequest,
  dispatchRead,
  dispatchScreenshot,
  dispatchSessions,
  dispatchSnapshot,
  dispatchTargets,
  type DispatchContext,
} from "./dispatcher.js";
import type { AdapterFactoryFn } from "./adapter-factory.js";
import { createSessionStore } from "./sessions.js";
import { createReferenceStore } from "./references.js";
import { createCoordinationStore } from "./coordination.js";
import { createEventStore } from "./events.js";
import { createPromotionStore } from "./promotion.js";
import { createRedactionPolicy, type RedactionPolicy } from "./redaction.js";
import { failedEnvelope, makeRequestId } from "./envelope.js";
import { catalogueFingerprint } from "./catalogue.js";

/** One operation, by the name the catalogue gives it. */
export type BrokerOperation =
  | "targets"
  | "connect"
  | "snapshot"
  | "act"
  | "read"
  | "check"
  | "close"
  | "sessions"
  | "capabilities"
  | "describe"
  | "control"
  | "events"
  | "request"
  | "screenshot";

export interface BrokerOptions {
  readonly token: string;
  readonly factory: AdapterFactoryFn;
  readonly registeredAdapters: string[];
  /** Exit when nothing has been asked for this long. Zero keeps it running. */
  readonly idleMs?: number;
  /** Called when the idle timer fires, so the caller can clean its descriptor up. */
  readonly onIdle?: () => void;
}

export interface RunningBroker {
  readonly url: string;
  readonly server: Server;
  /** Sessions still open here; what `close` leaves behind. */
  readonly sessions: DispatchContext["sessions"];
  close(): Promise<void>;
}

/** Every operation, by name, so adding one to the catalogue is one line here. */
type DispatchFn = (context: DispatchContext, args: Record<string, unknown>) => Promise<unknown>;
const DISPATCH: Record<BrokerOperation, DispatchFn> = {
  targets: (context, args) => dispatchTargets(context, args as never),
  connect: (context, args) => dispatchConnect(context, args as never),
  snapshot: (context, args) => dispatchSnapshot(context, args as never),
  act: (context, args) => dispatchAct(context, args as never),
  read: (context, args) => dispatchRead(context, args as never),
  check: (context, args) => dispatchCheck(context, args as never),
  close: (context, args) => dispatchClose(context, args as never),
  sessions: (context) => dispatchSessions(context),
  capabilities: (context, args) => dispatchCapabilities(context, args as never),
  describe: (context, args) => dispatchDescribe(context, args as never),
  control: (context, args) => dispatchControl(context, args as never),
  events: (context, args) => dispatchEvents(context, args as never),
  request: (context, args) => dispatchRequest(context, args as never),
  screenshot: (context, args) => dispatchScreenshot(context, args as never),
};

/** Read a whole request body, refusing one that is implausibly large. */
async function readBody(request: NodeJS.ReadableStream, limit = 4_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > limit) throw new Error("The request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Start the broker on loopback, on a port the OS picks.
 *
 * The port is never fixed: two brokers on one machine, or a port somebody else
 * holds, must not be a startup failure a person has to diagnose.
 */
export async function startBroker(options: BrokerOptions): Promise<RunningBroker> {
  const sessions = createSessionStore();
  const references = createReferenceStore();
  const coordination = createCoordinationStore();
  const events = createEventStore();
  const promotion = createPromotionStore();
  const redaction: RedactionPolicy = createRedactionPolicy();
  const context: DispatchContext = { sessions, references, coordination, events, redaction, promotion };
  const withAdapterInfo = (args: Record<string, unknown>): Record<string, unknown> => ({
    ...args,
    adapterFactory: options.factory,
    registeredAdapters: options.registeredAdapters,
  });

  let idle: ReturnType<typeof setTimeout> | undefined;
  const touch = (): void => {
    if (options.idleMs === undefined || options.idleMs <= 0) return;
    if (idle !== undefined) clearTimeout(idle);
    idle = setTimeout(() => options.onIdle?.(), options.idleMs);
    idle.unref();
  };

  const server = createServer((request, response) => {
    void (async () => {
      const send = (code: number, body: unknown): void => {
        const text = JSON.stringify(body);
        response.writeHead(code, {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(text),
        });
        response.end(text);
      };
      touch();

      if (request.headers.authorization !== `Bearer ${options.token}`) {
        // No detail: an unauthenticated caller learns nothing about what is here.
        send(401, { error: "unauthorized" });
        return;
      }
      if (request.method === "GET" && request.url === "/health") {
        /*
         * What this broker *speaks*, not just that it is alive (T18, SF-03).
         * A client compares it with its own and refuses a broker it does not
         * recognise, because a dropped argument that answers `succeeded` is
         * worse than no broker at all. See `catalogueFingerprint`.
         */
        send(200, { ok: true, sessions: sessions.list().length, contract: catalogueFingerprint() });
        return;
      }
      if (request.method !== "POST" || request.url !== "/op") {
        send(404, { error: "not-found" });
        return;
      }

      try {
        const body = JSON.parse(await readBody(request)) as {
          operation?: string;
          args?: Record<string, unknown>;
        };
        const operation = body.operation as BrokerOperation | undefined;
        const run = operation === undefined ? undefined : DISPATCH[operation];
        if (run === undefined) {
          send(
            400,
            failedEnvelope(makeRequestId(), undefined, "INVALID_ARGUMENT", `No operation "${String(operation)}".`),
          );
          return;
        }
        const args = body.args ?? {};
        const needsAdapterInfo = operation === "connect" || operation === "targets";
        send(200, await run(context, needsAdapterInfo ? withAdapterInfo(args) : args));
      } catch (error) {
        /*
         * The envelope even here, and an honest code. A body that would not
         * parse dispatched nothing, so it is the caller's argument; anything
         * else got far enough that nobody can say whether it took effect,
         * which is exactly what OUTCOME_UNKNOWN is for.
         */
        const unparsed = error instanceof SyntaxError;
        send(
          unparsed ? 400 : 500,
          failedEnvelope(
            makeRequestId(),
            undefined,
            unparsed ? "INVALID_ARGUMENT" : "OUTCOME_UNKNOWN",
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    })();
  });

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => done());
  });
  touch();

  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    sessions,
    async close() {
      if (idle !== undefined) clearTimeout(idle);
      await sessions.closeAll();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

/** Ask a running broker to perform one operation. */
export async function callBroker(
  descriptor: { url: string; token: string },
  operation: BrokerOperation,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${descriptor.url}/op`, {
    method: "POST",
    headers: { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" },
    body: JSON.stringify({ operation, args }),
  });
  return (await response.json()) as unknown;
}

/**
 * What a broker at this descriptor is: alive, and what contract it speaks.
 *
 * `contract` is `undefined` for a broker old enough not to publish one, which
 * is itself a mismatch — that build predates the fingerprint and so predates
 * whatever made it necessary.
 */
export async function brokerHealth(
  descriptor: { url: string; token: string },
): Promise<{ alive: boolean; contract?: string }> {
  try {
    const response = await fetch(`${descriptor.url}/health`, {
      headers: { authorization: `Bearer ${descriptor.token}` },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return { alive: false };
    const body = (await response.json()) as { contract?: unknown };
    return {
      alive: true,
      ...(typeof body.contract === "string" ? { contract: body.contract } : {}),
    };
  } catch {
    return { alive: false };
  }
}

/** Whether a broker is answering at this descriptor *and* speaks this contract. */
export async function brokerAlive(descriptor: { url: string; token: string }): Promise<boolean> {
  const health = await brokerHealth(descriptor);
  return health.alive && health.contract === catalogueFingerprint();
}
