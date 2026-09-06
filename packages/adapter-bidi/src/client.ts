/**
 * A thin WebDriver BiDi client (LLD §7.3, REQ-ADP-4).
 *
 * BiDi is a bidirectional JSON protocol over one WebSocket: commands carry an
 * `id` and come back as `{ type: "success" | "error", id, … }`, and events
 * arrive unsolicited as `{ type: "event", method, params }`. That is the whole
 * of the transport, which is why this file is small and why the adapter above it
 * needs no driver, no SDK and no browser-specific code.
 *
 * Thin is the point. REQ-ADP-4 asks the BiDi adapter to *prove the surface
 * boundary*: if the only thing between `AgentSurface` and a stock browser is a
 * WebSocket and a command table, then the boundary is real and the Playwright
 * adapter is one implementation of it rather than the shape of it.
 *
 * `WebSocket` is Node's own global (stable since 22.4), so the adapter's whole
 * transport dependency is the runtime it already requires.
 *
 * The client knows nothing about pages, elements or actions. It sends a method
 * and a parameter object and gives back a result, and it turns a protocol-level
 * error into the surface's typed errors so nothing above has to read a BiDi
 * error code.
 */
import {
  DialogError,
  LocateError,
  NavigationError,
  ScriptError,
  SessionError,
  TimeoutError,
} from "@svatah/yam-surface";

/** One unsolicited message: `{ method, params }` with no `id`. */
export interface BidiEvent {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

export type BidiEventHandler = (event: BidiEvent) => void;

export interface BidiClientOptions {
  /** How long one command may take before it is a `TimeoutError`. */
  readonly commandTimeoutMs?: number;
  /** Every message sent and received, for `YAM_BIDI_TRACE=1`. */
  readonly onTraffic?: (direction: "→" | "←", message: unknown) => void;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

/**
 * BiDi's error codes, mapped onto the surface's typed errors (LLD §2.3, §8.4).
 *
 * The executor classifies a failure from the error's *type*, never from its
 * message, so this table is what lets a BiDi failure and a Playwright failure of
 * the same kind produce the same `FailureClass`. A code with no row becomes a
 * `ScriptError`, which is the honest answer for "the protocol refused and we do
 * not have a category for why".
 */
const ERROR_BY_CODE: Record<string, new (message: string, options?: { adapter?: string }) => Error> = {
  "no such element": LocateError,
  "no such node": LocateError,
  "no such frame": LocateError,
  "no such handle": LocateError,
  "invalid selector": LocateError,
  "element not interactable": LocateError,
  "no such alert": DialogError,
  "unexpected alert open": DialogError,
  "no such frame or window": NavigationError,
  "no such history entry": NavigationError,
  "invalid argument": ScriptError,
  "javascript error": ScriptError,
  "unsupported operation": ScriptError,
  "unknown command": ScriptError,
  "no such user context": SessionError,
  "session not created": SessionError,
  "invalid session id": SessionError,
  timeout: TimeoutError,
  "script timeout": TimeoutError,
};

/** A protocol-level refusal, before it becomes one of the surface's errors. */
export class BidiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly stacktrace?: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "BidiError";
  }

  /** The surface error this refusal means (LLD §2.3). */
  asSurfaceError(): Error {
    const Kind = ERROR_BY_CODE[this.code] ?? ScriptError;
    return new Kind(this.message, { adapter: "bidi" });
  }
}

interface Pending {
  readonly resolve: (value: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly method: string;
}

export class BidiClient {
  private socket: WebSocket | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Set<BidiEventHandler>();
  private closed = false;
  /** Set when the socket dies under us, so every later command says why. */
  private fatal: Error | undefined;

  private constructor(private readonly options: BidiClientOptions) {}

  /** Open a connection to a BiDi endpoint and wait for it to be usable. */
  static async connect(url: string, options: BidiClientOptions = {}): Promise<BidiClient> {
    const client = new BidiClient(options);
    const socket = new WebSocket(url);
    client.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        cleanup();
        resolve();
      };
      const onError = (): void => {
        cleanup();
        reject(
          new SessionError(
            `Could not open a WebDriver BiDi session at ${url}. Is the browser running with a ` +
              "remote agent, and is the URL its BiDi endpoint rather than its DevTools one?",
            { adapter: "bidi" },
          ),
        );
      };
      const cleanup = (): void => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });

    socket.addEventListener("message", (event) => client.receive(String(event.data)));
    socket.addEventListener("close", () => client.die("The BiDi connection closed."));
    socket.addEventListener("error", () => client.die("The BiDi connection failed."));
    return client;
  }

  /** Register an event handler. Returns a function that removes it. */
  on(handler: BidiEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Send one command and wait for its answer.
   *
   * Every command is timed out. A BiDi command that never answers — a navigation
   * to a host that neither connects nor refuses, a script that never settles —
   * would otherwise hang the step past its own timeout with nothing to report.
   */
  async send(
    method: string,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    if (this.fatal !== undefined) throw this.fatal;
    if (this.socket === undefined || this.closed) {
      throw new SessionError("The BiDi session is not open.", { adapter: "bidi" });
    }

    const id = this.nextId++;
    const message = { id, method, params };
    this.options.onTraffic?.("→", message);

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new TimeoutError(`The BiDi command ${method} did not answer in time.`, {
            adapter: "bidi",
          }),
        );
      }, options.timeoutMs ?? this.options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
      // `unref` where it exists, so a pending command cannot hold the process
      // open after the session is closed.
      (timer as { unref?: () => void }).unref?.();

      this.pending.set(id, { resolve, reject, timer, method });
      this.socket!.send(JSON.stringify(message));
    });
  }

  /** `send`, with a BiDi refusal already turned into a surface error. */
  async call(
    method: string,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    try {
      return await this.send(method, params, options);
    } catch (error) {
      throw error instanceof BidiError ? error.asSurfaceError() : error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(new SessionError("The BiDi session was closed.", { adapter: "bidi" }));
    }
    try {
      this.socket?.close();
    } catch {
      // Closing a socket that is already gone is not a failure worth raising:
      // the caller asked for it to be shut, and it is.
    }
  }

  private receive(raw: string): void {
    let message: {
      type?: string;
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: Record<string, unknown>;
      error?: string;
      message?: string;
      stacktrace?: string;
    };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      // A frame that is not JSON is not a BiDi message. Nothing above can act on
      // it, and dropping it is better than tearing the session down.
      return;
    }
    this.options.onTraffic?.("←", message);

    if (message.type === "event" && message.method !== undefined) {
      const event: BidiEvent = { method: message.method, params: message.params ?? {} };
      for (const handler of this.handlers) handler(event);
      return;
    }

    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (pending === undefined) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);

    if (message.type === "error") {
      pending.reject(
        new BidiError(
          message.error ?? "unknown error",
          message.message ?? `${pending.method} failed.`,
          message.stacktrace,
        ),
      );
      return;
    }
    pending.resolve(message.result ?? {});
  }

  /** The socket died. Everything waiting, and everything later, says so. */
  private die(why: string): void {
    if (this.closed && this.pending.size === 0) return;
    this.fatal ??= new SessionError(why, { adapter: "bidi" });
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(this.fatal);
    }
  }
}
