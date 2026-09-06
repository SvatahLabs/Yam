/**
 * The renderer's whole view of the outside world (T3.6, T3.7, LLD §13.6).
 *
 * `GeneratedServiceClient` is written from the service's own OpenAPI document, so
 * a screen can only call a route the service publishes. This adds the two things
 * a generator cannot: the event stream, which is not a request, and a screen
 * rule stated as a type.
 *
 * ## The screen rule, as a type
 *
 * "Every screen renders a service response or a project file and nothing the CLI
 * cannot produce" (T3.7). `ScreenData<T>` is that sentence: every value a screen
 * displays carries the endpoint it came from, so the static check in
 * `test/screen-rule.test.ts` can read the renderer's sources and find a screen
 * that invented something. A rule nobody can check is a rule that erodes.
 */
import {
  ENDPOINTS,
  GeneratedServiceClient,
  ServiceError,
  type ServiceConnection,
  type ServiceEndpoint,
} from "./client.generated.js";

export { ENDPOINTS, ServiceError, type ServiceConnection, type ServiceEndpoint };

/** An event the service streams (`ServiceEvent` in `@svatah/yam-schema`). */
export interface StreamedEvent {
  readonly kind: string;
  readonly runId?: string;
  readonly [key: string]: unknown;
}

export class ServiceClient extends GeneratedServiceClient {
  /**
   * Subscribe to the run and record stream (LLD §13.5's `GET /events/sse`).
   *
   * Server-sent events rather than the WebSocket, because a renderer with a
   * strict `connect-src` and no Node has `EventSource`'s job easier: one
   * `fetch`, a reader, and no upgrade. The token goes in the header, which is
   * why this is a `fetch` and not `new EventSource(url)` — that API cannot send
   * one, and a token in a query string is a token in a log.
   */
  subscribe(onEvent: (event: StreamedEvent) => void): () => void {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`${this.connection.url}/events/sse`, {
          headers: { authorization: `Bearer ${this.connection.token}` },
          signal: controller.signal,
        });
        const body = response.body;
        if (body === null) return;

        const reader = body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;

          // SSE frames are separated by a blank line; a frame's `data:` lines are
          // the payload. Anything else — the `event:` name, the opening comment —
          // is redundant here, since every payload names its own `kind`.
          let at = buffer.indexOf("\n\n");
          while (at !== -1) {
            const frame = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("");
            if (data !== "") {
              try {
                onEvent(JSON.parse(data) as StreamedEvent);
              } catch {
                // A frame that will not parse is one event lost, not a dead
                // stream. The run's files are the record; this is the live view.
              }
            }
            at = buffer.indexOf("\n\n");
          }
        }
      } catch {
        // An aborted or dropped stream is not an error a screen should show: the
        // run continues and `GET /runs/:id` has the answer either way.
      }
    })();

    return () => controller.abort();
  }

  /**
   * A screenshot a run wrote, as bytes.
   *
   * The generated client parses every answer as JSON or text, which is right for
   * every route but this one. Fetching it here — with the token in a header —
   * keeps a credential out of an `<img src>` and therefore out of every log a URL
   * touches.
   */
  async screenshot(runId: string, name: string): Promise<Blob> {
    const path = `/runs/${encodeURIComponent(runId)}/screenshots/${encodeURIComponent(name)}`;
    const response = await fetch(`${this.connection.url}${path}`, {
      headers: { authorization: `Bearer ${this.connection.token}` },
    });
    if (!response.ok) throw new ServiceError(response.status, path, await response.text());
    return await response.blob();
  }
}

/**
 * A value a screen displays, and where it came from.
 *
 * The `from` is not decoration. T3.7's screen rule — "every screen renders a
 * service response or a project file and nothing the CLI cannot produce" — is
 * checkable exactly because every rendered value names its endpoint, and the
 * check can then compare that name against the routes the service publishes.
 */
export interface ScreenData<T> {
  readonly value: T;
  /** The `ServiceEndpoint.id` this came from. */
  readonly from: string;
}

export function fromEndpoint<T>(from: string, value: T): ScreenData<T> {
  return { from, value };
}
