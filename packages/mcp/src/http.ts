/**
 * `yam mcp --http` — Streamable HTTP MCP (T21, SF-08).
 *
 * > Offer Streamable HTTP MCP for clients that cannot spawn processes, backed
 * > by the same session service. Pin and negotiate supported protocol versions,
 * > test Origin/authentication/session isolation and disconnect semantics
 * > against that version. Do not label the existing REST API an MCP transport.
 *
 * ## What this is not
 *
 * It is not `/v1`. The service's REST routes are generated from the same
 * catalogue and answer the same operations, and that makes them a *sibling* of
 * this transport, not an instance of it: an MCP client cannot initialize
 * against them, cannot list tools, and cannot be cancelled by a JSON-RPC
 * notification. SF-08 says so in as many words, and the distinction is worth
 * keeping because the two are otherwise easy to conflate.
 *
 * ## The same server, a second transport
 *
 * `buildMcpServer` is the whole of the tool surface, generated from the
 * catalogue, and it is what `yam mcp` connects to a `StdioServerTransport`.
 * Here it is connected to a `StreamableHTTPServerTransport` instead. Nothing
 * about a tool, a schema or an annotation is decided here — a transport that
 * could add one would be a second contract, which is the thing the catalogue
 * exists to prevent.
 *
 * ## One server per MCP session, which is what isolation means
 *
 * Each initialization builds its *own* `McpServer` and its own transport. Two
 * clients therefore cannot see each other's MCP session id, cannot resume each
 * other's stream, and cannot be mistaken for each other by the broker: the
 * holder name a surface operation is attributed to is the name that client gave
 * at initialization (`server.getClientVersion()`), so a lease taken by one is a
 * lease the other is refused.
 *
 * What they *do* share, deliberately, is the broker — one session holder per
 * machine is how a person and an agent come to be looking at the same target
 * (SF-13). Sharing the broker is not sharing a session: a `surface_connect`
 * returns an opaque id, and a client that has not been told one cannot address
 * it. That is the property `mcp-http.test.ts` drives rather than assumes.
 *
 * ## Bound to loopback, behind a token, and not talked to by a web page
 *
 * The same three rules the service keeps (SF-15). Loopback only; a bearer token
 * generated per process and printed once on stdout, never written to a file;
 * and DNS-rebinding protection, so a page a person happens to have open cannot
 * reach a transport that drives their applications.
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { removeClient, writeClient } from "@svatah/yam-surface-control";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { EventStore } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { boolOption, numberOption, stringOption, EXIT } from "@svatah/yam-bindings-cli";
import type { CommandIo, ExitCode, ParsedArgs } from "@svatah/yam-bindings-cli";
import { buildMcpServer, policyFrom, type McpServerOptions } from "./server.js";

/**
 * The protocol revision this transport was written and tested against.
 *
 * SF-08 asks for it to be *pinned*, and pinning it in a constant that a test
 * compares with the SDK's own `LATEST_PROTOCOL_VERSION` is what makes an SDK
 * upgrade a red build rather than a silent change of behaviour. The cancellation
 * and resumption semantics below are this revision's; a newer one is a decision
 * somebody has to make, not one a `pnpm update` should make for them.
 */
export const PINNED_PROTOCOL_VERSION = "2025-11-25";

/** What the SDK in this workspace speaks, so a test can compare the two. */
export const SDK_LATEST_PROTOCOL_VERSION: string = LATEST_PROTOCOL_VERSION;

/**
 * The events of one stream, kept so a client that lost its connection can ask
 * for what it missed (T21, SF-08).
 *
 * The 2025-11-25 transport resumes with `Last-Event-ID`: a client reconnects,
 * names the last event it saw, and the server replays what came after it on a
 * new stream. Without a store the SDK simply does not offer resumption, and
 * "reconnect semantics of the version pinned" would be a claim with nothing
 * behind it.
 *
 * In memory and bounded. A transport that remembered every event of every
 * session for ever would be a memory leak with a protocol in front of it; the
 * bound is per stream, and a client that has been away longer than that is told
 * to start again rather than given a partial history it cannot tell from a
 * complete one.
 */
export function createEventStore(limitPerStream = 512): EventStore {
  const streams = new Map<string, Array<{ id: string; message: JSONRPCMessage }>>();
  const streamOf = new Map<string, string>();
  let counter = 0;

  return {
    async storeEvent(streamId, message) {
      counter += 1;
      const id = `${streamId}:${counter}`;
      const events = streams.get(streamId) ?? [];
      events.push({ id, message });
      while (events.length > limitPerStream) {
        const dropped = events.shift();
        if (dropped !== undefined) streamOf.delete(dropped.id);
      }
      streams.set(streamId, events);
      streamOf.set(id, streamId);
      return id;
    },

    async getStreamIdForEventId(eventId) {
      return streamOf.get(eventId);
    },

    async replayEventsAfter(lastEventId, { send }) {
      const streamId = streamOf.get(lastEventId);
      if (streamId === undefined) return "";
      const events = streams.get(streamId) ?? [];
      const at = events.findIndex((one) => one.id === lastEventId);
      if (at < 0) return streamId;
      for (const event of events.slice(at + 1)) await send(event.id, event.message);
      return streamId;
    },
  };
}

export interface HttpMcpOptions extends McpServerOptions {
  /** The port to listen on. `0` asks the system for one. */
  readonly port?: number;
  /** What to call a client that connects, for the list a person reads (TV-M05). */
  readonly clientName?: string;
  /** The tool profile these clients are given: what they may call. */
  readonly profile?: string;
  /** The bearer token. Generated per process when not given. */
  readonly token?: string;
  /**
   * Origins a browser page may use this from. Empty by default, which refuses
   * every cross-origin request — the safe answer for a transport that drives
   * the machine it runs on.
   */
  readonly allowedOrigins?: readonly string[];
}

export interface RunningHttpMcp {
  readonly url: string;
  readonly token: string;
  readonly server: Server;
  /** How many MCP sessions are open. */
  sessionCount(): number;
  close(): Promise<void>;
}

/** One MCP session: its own server, its own transport, its own event store. */
interface Held {
  readonly transport: StreamableHTTPServerTransport;
  readonly close: () => Promise<void>;
}

const MCP_PATH = "/mcp";

/**
 * Start the transport. Exported so a test can drive it in-process with a
 * generic client rather than by spawning a command and parsing its output.
 */
export async function startHttpMcp(options: HttpMcpOptions): Promise<RunningHttpMcp> {
  const token = options.token ?? randomBytes(24).toString("base64url");
  const sessions = new Map<string, Held>();
  const allowedOrigins = [...(options.allowedOrigins ?? [])];

  const send = (response: ServerResponse, code: number, body: unknown): void => {
    const text = JSON.stringify(body);
    response.writeHead(code, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(text),
    });
    response.end(text);
  };

  /**
   * A JSON-RPC error, because a client that spoke JSON-RPC deserves one back.
   *
   * An HTTP status alone leaves an MCP client with a transport error and no
   * message; the SDK's own clients surface `error.message`, which is where a
   * person reads why they were refused.
   */
  const refuse = (response: ServerResponse, code: number, message: string): void => {
    send(response, code, {
      jsonrpc: "2.0",
      error: { code: -32_000, message },
      id: null,
    });
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = (request.url ?? "").split("?")[0] ?? "";

      if (url === "/health" && request.method === "GET") {
        /*
         * Unauthenticated, and it says nothing about what is here beyond the
         * protocol it speaks — which is what a client needs to know before it
         * has a token, and all it needs.
         */
        send(response, 200, { ok: true, protocolVersion: PINNED_PROTOCOL_VERSION });
        return;
      }

      if (url !== MCP_PATH) {
        refuse(response, 404, `This is an MCP endpoint. It answers ${MCP_PATH}.`);
        return;
      }

      /* ── the token, on every MCP request (SF-15) ─────────────────────────── */
      const header = request.headers.authorization ?? "";
      const given = header.startsWith("Bearer ") ? header.slice(7) : undefined;
      if (given !== token) {
        /*
         * 401 with `WWW-Authenticate`, which is what the specification's
         * authorization section asks an HTTP transport to answer, and what
         * tells a client the credential is the thing that is missing rather
         * than the endpoint.
         */
        response.setHeader("WWW-Authenticate", 'Bearer realm="yam"');
        refuse(
          response,
          401,
          "This transport needs the bearer token it printed when it started. It is generated " +
            "per process and is not stored anywhere.",
        );
        return;
      }

      /* ── and no page that was not invited (SF-15) ────────────────────────── */
      const origin = request.headers.origin;
      if (origin !== undefined && !allowedOrigins.includes(origin)) {
        refuse(
          response,
          403,
          `This transport does not accept requests from ${origin}. It drives the applications ` +
            "on this machine, so a page is not allowed to reach it unless it was named at start-up.",
        );
        return;
      }

      const sessionId = request.headers["mcp-session-id"];
      const known = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;

      if (known !== undefined) {
        await known.transport.handleRequest(request, response);
        return;
      }

      if (typeof sessionId === "string") {
        /*
         * A session id this transport does not have. 404 is what the
         * specification asks for, and it is also what a client that was talking
         * to a transport that has since restarted needs to see so it
         * initializes again instead of retrying for ever.
         */
        refuse(response, 404, `No MCP session ${sessionId} here. Initialize again.`);
        return;
      }

      if (request.method !== "POST") {
        refuse(response, 400, "An MCP session begins with a POST that initializes it.");
        return;
      }

      /*
       * A new session: its own server, so two clients are two of everything
       * except the broker they share.
       */
      const built = await buildMcpServer(options);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore: createEventStore(),
        /*
         * DNS-rebinding protection, on. `allowedHosts` is loopback because that
         * is where this binds; `allowedOrigins` is whatever the caller named,
         * which is nothing by default.
         */
        enableDnsRebindingProtection: true,
        allowedHosts: ["127.0.0.1", "localhost", `127.0.0.1:${addressPort(server)}`],
        allowedOrigins,
        onsessioninitialized: (id: string) => {
          /* A connection the service can read, because it is another process. */
          writeClient({
            id: `http-${id}`,
            name: options.clientName ?? "an MCP client",
            transport: "http",
            profile: options.profile ?? "surface",
            since: new Date().toISOString(),
          });
          sessions.set(id, {
            transport,
            close: async () => {
              await transport.close().catch(() => undefined);
              await built.server.close().catch(() => undefined);
              await built.close().catch(() => undefined);
            },
          });
        },
        onsessionclosed: (id: string) => {
          removeClient(`http-${id}`);
          const held = sessions.get(id);
          sessions.delete(id);
          void held?.close();
        },
      });
      /*
       * A transport that closes for any other reason — the client's socket
       * went away, the process is stopping — takes its session with it.
       * Sessions the broker holds are *not* closed: an agent that disconnects
       * leaves what it opened for the person to see and close (SF-05), which is
       * the same rule stdio keeps.
       */
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id !== undefined) sessions.delete(id);
      };
      await built.server.connect(transport);
      await transport.handleRequest(request, response);
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      refuse(response, 500, error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(options.port ?? 0, "127.0.0.1", () => done());
  });

  return {
    url: `http://127.0.0.1:${addressPort(server)}${MCP_PATH}`,
    token,
    server,
    sessionCount: () => sessions.size,
    async close() {
      for (const held of [...sessions.values()]) await held.close();
      sessions.clear();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

function addressPort(server: Server): number {
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

/**
 * `yam mcp --http` — serve over Streamable HTTP.
 *
 * The handshake line is `yam serve`'s, for the same reason: a caller that
 * spawned this needs the URL and the token, once, on stdout, in a line it can
 * parse — and a token in a file is a token that outlives the process that
 * needed it.
 */
export async function httpMcpCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  /*
   * The first positional is the project, not the second (PK-05).
   *
   * This read `args.command[1]`, which was right while the command was
   * `yam mcp <project-dir>`: `command[0]` was the word "mcp". As its own
   * executable there is no such word, so `yam-mcp <project-dir>` put the
   * directory in `command[0]` and this read past it — the server started with
   * no project and said so, and the only way to get one was to pass a bogus
   * first argument.
   *
   * Nothing caught it because nothing drove this path: the in-process tests
   * call `buildMcpServer` directly and the stdio corpus spawns the binary with
   * no project at all.
   */
  const root = args.command[0];
  const origins = stringOption(args, "allow-origin");
  const running = await startHttpMcp({
    ...(root === undefined ? {} : { root }),
    io,
    ...policyFrom(args),
    ...(numberOption(args, "port") === undefined ? {} : { port: numberOption(args, "port")! }),
    ...(stringOption(args, "token") === undefined ? {} : { token: stringOption(args, "token")! }),
    ...(origins === undefined
      ? {}
      : { allowedOrigins: origins.split(",").map((one) => one.trim()).filter((one) => one !== "") }),
  });

  /*
   * The handshake names this package, not the subcommand it replaced (PK-05).
   *
   * Parsed by one thing — `test/http.test.ts` — and changed with it. A line a
   * person reads in a log that names a command answering "it has moved" is the
   * same defect as a screen name that no longer exists, one layer down.
   */
  io.out(`@svatah/yam-mcp listening url=${running.url} token=${running.token}`);
  io.err(
    `Streamable HTTP MCP on ${running.url}, protocol ${PINNED_PROTOCOL_VERSION}.\n` +
      "  Bound to 127.0.0.1 and behind the bearer token above.\n" +
      "  Ctrl-C to stop.",
  );
  if (boolOption(args, "json")) io.err("(--json has no meaning for a protocol server)");

  await new Promise<void>((done) => {
    const stop = (): void => {
      void running.close().then(done);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return EXIT.ok;
}
