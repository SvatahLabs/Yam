/**
 * `@svatah/yam-sdk` — the typed client for the local service (T9.3, REQ-SDK-1,
 * LLD §13.8).
 *
 * > `@svatah/yam-sdk` (TypeScript): a typed client generated from the service's
 * > OpenAPI description at build time, plus `subscribe()` over the SSE and
 * > WebSocket streams with typed events, plus `actions` (the screen model's
 * > action list, runnable out of process). Nothing in it is hand-written that
 * > the description already states; a drift between the two fails the build.
 *
 * Four things, and only the first is generated:
 *
 * 1. **`GeneratedClient`** — one method per route, from `generated.ts`.
 *    `scripts/generate-clients.mjs` writes it and
 *    `tools/repo-checks/test/client-drift.test.ts` regenerates and diffs.
 * 2. **`subscribe()`** — the event stream, which an OpenAPI description cannot
 *    express as anything but "a string".
 * 3. **`actions`** — `@svatah/yam-screens`'s registry, so an agent out of process
 *    runs the same action a person clicks, by the same id.
 * 4. **`connect()`** — where the service is: `YAM_SERVICE_URL` and
 *    `YAM_SERVICE_TOKEN`, or the lock file the ADE writes. Never a model
 *    credential (§13.8).
 *
 * ## Node, not a browser
 *
 * `connect()` reads the environment and a lock file, so this package targets
 * Node — a CI job, an agent, `yam ui`. The ADE's *renderer* is a browser and
 * has neither: it is handed a `{ url, token }` by its preload bridge and
 * constructs `YamClient` directly, which needs nothing from `node:fs`.
 */
import { existsSync, readFileSync } from "node:fs";
import { ACTIONS, actionById } from "@svatah/yam-screens";
import type { Action, ActionArgs, ActionOutcome, ScreenService } from "@svatah/yam-screens";
import { GeneratedClient, ServiceError, EVENT_KINDS, ENDPOINTS } from "./generated.js";
import type { EventKind, ServiceConnection, ServiceEndpoint } from "./generated.js";

export { ServiceError, EVENT_KINDS, ENDPOINTS };
export type { EventKind, ServiceConnection, ServiceEndpoint };

/**
 * One message off the stream.
 *
 * `kind` is the union the description lists; the rest is carried through
 * untyped, because the *shapes* are `@svatah/yam-schema`'s and re-deriving them here
 * would make a second set of the same types (REQ-STD-1). A caller that wants a
 * `StepResult` parses `event.result` with `stepResultSchema`.
 */
export interface ServiceEvent {
  readonly kind: EventKind | string;
  readonly [key: string]: unknown;
}

/** Which transport `subscribe()` should use. SSE by default: it survives proxies. */
export type StreamTransport = "sse" | "websocket";

export interface SubscribeOptions {
  readonly transport?: StreamTransport;
  /** Only these kinds reach the listener. Everything, by default. */
  readonly kinds?: readonly string[];
  readonly onError?: (error: Error) => void;
  /** For tests: an `AbortSignal` that closes the stream. */
  readonly signal?: AbortSignal;
}

/**
 * The client.
 *
 * `ScreenService`-shaped by construction: it has a method per route with the
 * generated names, and `subscribe`. So `@svatah/yam-screens`'s screens load against
 * it with nothing to adapt, which is what "the same screens through the service"
 * means (REQ-ADE-13).
 */
export class YamClient extends GeneratedClient implements ScreenService {
  /**
   * Every action the screen model has, runnable out of process (§13.8).
   *
   * The same list, by the same ids, that the ADE's palette and `yam ui`'s
   * palette show — `tools/repo-checks/test/action-parity.test.ts` is what holds
   * the three together.
   */
  readonly actions: readonly Action[] = ACTIONS;

  /** Run one action by id. Throws when the id is not in the registry. */
  async run(actionId: string, args: ActionArgs = {}): Promise<ActionOutcome> {
    const action = actionById(actionId);
    if (action === undefined) {
      throw new Error(
        `No action "${actionId}". The registry has ${ACTIONS.length}: ` +
          `${ACTIONS.map((one) => one.id).join(", ")}.`,
      );
    }
    return await action.run(this, args);
  }

  /**
   * The event stream (LLD §13.5).
   *
   * Returns a function that closes it. The listener is called with a decoded
   * object per message, whichever transport carried it — a caller that had to
   * know which would be a caller with a reason to care about the difference,
   * and there is not one.
   */
  subscribe(
    listener: (event: ServiceEvent) => void,
    options: SubscribeOptions = {},
  ): () => void {
    const controller = new AbortController();
    const wanted = options.kinds === undefined ? undefined : new Set(options.kinds);
    const deliver = (event: ServiceEvent): void => {
      if (wanted === undefined || wanted.has(event.kind)) listener(event);
    };

    options.signal?.addEventListener("abort", () => controller.abort(), { once: true });

    if ((options.transport ?? "sse") === "websocket") {
      void this.websocket(deliver, controller, options.onError);
    } else {
      void this.sse(deliver, controller, options.onError);
    }

    return () => controller.abort();
  }

  /**
   * `GET /events/sse`, read as a stream of `data:` lines.
   *
   * `fetch` rather than `EventSource`: `EventSource` cannot send an
   * `Authorization` header, and the token is not a query parameter — a URL is
   * logged by every proxy and shell history there is.
   */
  private async sse(
    deliver: (event: ServiceEvent) => void,
    controller: AbortController,
    onError?: (error: Error) => void,
  ): Promise<void> {
    try {
      const response = await fetch(`${this.connection.url}/events/sse`, {
        headers: { authorization: `Bearer ${this.connection.token}` },
        signal: controller.signal,
      });
      if (!response.ok || response.body === null) {
        throw new ServiceError(response.status, "/events/sse", await response.text());
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        /*
         * A message ends at a blank line, not at a newline: SSE allows several
         * `data:` lines per event, and splitting on `\n` would deliver half of
         * a long one.
         */
        let at = buffer.indexOf("\n\n");
        while (at >= 0) {
          const message = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          const payload = message
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("");
          if (payload !== "") {
            try {
              deliver(JSON.parse(payload) as ServiceEvent);
            } catch {
              // A line that is not JSON is the service's problem to report; a
              // client that threw here would lose every event after it.
            }
          }
          at = buffer.indexOf("\n\n");
        }
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      onError?.(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  /** `GET /events` over a WebSocket, when a caller asks for one. */
  private async websocket(
    deliver: (event: ServiceEvent) => void,
    controller: AbortController,
    onError?: (error: Error) => void,
  ): Promise<void> {
    try {
      const url = new URL(`${this.connection.url}/events`);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      /*
       * The token as a subprotocol, which is the one place a WebSocket
       * handshake takes an application header. Node 22 has a global `WebSocket`;
       * a browser has one too, and neither lets a header be set on the upgrade.
       */
      const socket = new WebSocket(url, [`bearer.${this.connection.token}`]);
      controller.signal.addEventListener("abort", () => socket.close(), { once: true });
      socket.addEventListener("message", (message: MessageEvent) => {
        try {
          deliver(JSON.parse(String(message.data)) as ServiceEvent);
        } catch {
          // As above: a malformed frame must not end the subscription.
        }
      });
      socket.addEventListener("error", () => {
        if (!controller.signal.aborted) onError?.(new Error("The event socket failed."));
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      onError?.(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }
}

/**
 * Where the service is (LLD §13.8).
 *
 * > Auth is the bearer token the service prints; the SDK reads
 * > `YAM_SERVICE_URL` and `YAM_SERVICE_TOKEN` or a lock file, and never a
 * > model credential.
 *
 * In that order, and the order matters: an environment variable is what a CI job
 * and an agent set, and the lock file is what the ADE wrote for a service it is
 * already running. A caller that passes a connection outright skips both.
 */
export function connect(connection?: Partial<ServiceConnection>): YamClient {
  const url = connection?.url ?? process.env["YAM_SERVICE_URL"];
  const token = connection?.token ?? process.env["YAM_SERVICE_TOKEN"];

  if (url !== undefined && token !== undefined) return new YamClient({ url, token });

  const lock = readLock();
  if (lock !== undefined) return new YamClient(lock);

  throw new Error(
    "No Yam service to connect to. Start one with `yam serve --project <dir>` and set " +
      "YAM_SERVICE_URL and YAM_SERVICE_TOKEN to the url and token it prints, or open the " +
      "project in the ADE, which writes a lock file this reads. The SDK never reads a model " +
      "credential (LLD §13.8).",
  );
}

/**
 * The lock file the ADE writes for a service it started (LLD §13.6).
 *
 * `YAM_SERVICE_LOCK` names one directly; otherwise the ADE's user-data
 * directory is searched for the newest. Read lazily and defensively: a stale
 * lock from a service that died is a file that parses and a port that refuses,
 * and the connection error a caller then gets says which.
 */
function readLock(): ServiceConnection | undefined {
  const named = process.env["YAM_SERVICE_LOCK"];
  if (named === undefined) return undefined;
  try {
    if (!existsSync(named)) return undefined;
    const lock = JSON.parse(readFileSync(named, "utf8")) as Partial<ServiceConnection>;
    if (typeof lock.url !== "string" || typeof lock.token !== "string") return undefined;
    return { url: lock.url, token: lock.token };
  } catch {
    return undefined;
  }
}

export { ACTIONS, actionById } from "@svatah/yam-screens";
export type { Action, ActionArgs, ActionOutcome, ScreenService } from "@svatah/yam-screens";
