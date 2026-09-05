/*
 * GENERATED FILE — do not edit.
 *
 * `node scripts/generate-ade-client.mjs` writes this from the service's own
 * OpenAPI description (`GET /openapi.json`, LLD §13.5). It is committed so the
 * renderer builds without a running service, and a test regenerates it and diffs,
 * so drift between the ADE and the service is a red build rather than a discovery.
 *
 * Bodies are `unknown` on purpose: their types are `@svatah/schema`'s, and
 * re-deriving them here would make a second, subtly different set of the same
 * types (REQ-STD-1).
 */

/** One route the service publishes. The static check reads this list. */
export interface ServiceEndpoint {
  readonly id: string;
  readonly verb: "get" | "post" | "put" | "delete" | "patch";
  readonly path: string;
  readonly summary: string;
}

export const ENDPOINTS: readonly ServiceEndpoint[] = [
  { id: "getApi", verb: "get", path: "/api", summary: "Named API requests" },
  { id: "getBindings", verb: "get", path: "/bindings", summary: "The bindings store" },
  { id: "getBindingsById", verb: "get", path: "/bindings/{id}", summary: "One binding" },
  { id: "getData", verb: "get", path: "/data", summary: "Run data, with secrets redacted" },
  { id: "getEvents", verb: "get", path: "/events", summary: "The event stream (WebSocket)" },
  { id: "getEventsSse", verb: "get", path: "/events/sse", summary: "The event stream (server-sent events)" },
  { id: "getFlowsByFile", verb: "get", path: "/flows/{file}", summary: "Read a flow file" },
  { id: "getHealth", verb: "get", path: "/health", summary: "Liveness, for the ADE's spawn handshake" },
  { id: "getOpenapijson", verb: "get", path: "/openapi.json", summary: "This document" },
  { id: "getPlan", verb: "get", path: "/plan", summary: "The compiled plan, story by story" },
  { id: "getProject", verb: "get", path: "/project", summary: "Config, flows, stories, compositions, run blocks and API names" },
  { id: "getRuns", verb: "get", path: "/runs", summary: "Every run's summary" },
  { id: "getRunsById", verb: "get", path: "/runs/{id}", summary: "One run's summary" },
  { id: "getRunsByIdAudit", verb: "get", path: "/runs/{id}/audit", summary: "One run's audit log" },
  { id: "getRunsByIdResults", verb: "get", path: "/runs/{id}/results", summary: "One run's step results" },
  { id: "getRunsByIdScreenshotsByName", verb: "get", path: "/runs/{id}/screenshots/{name}", summary: "A screenshot a run wrote" },
  { id: "postApiRequest", verb: "post", path: "/api/request", summary: "Execute one API request ad hoc" },
  { id: "postCompile", verb: "post", path: "/compile", summary: "Compile and lint" },
  { id: "postRun", verb: "post", path: "/run", summary: "Start a run; step events arrive on the stream" },
  { id: "putApiByName", verb: "put", path: "/api/{name}", summary: "Save a named request under api/<name>.yaml" },
  { id: "putData", verb: "put", path: "/data", summary: "Write data.yaml" },
  { id: "putFlowsByFile", verb: "put", path: "/flows/{file}", summary: "Write a flow file" },
];

export interface ServiceConnection {
  readonly url: string;
  readonly token: string;
}

/** Everything the renderer can ask the service. Nothing else exists. */
export class GeneratedServiceClient {
  constructor(protected readonly connection: ServiceConnection) {}

  protected async call(
    verb: string,
    path: string,
    options: { body?: unknown; text?: boolean } = {},
  ): Promise<unknown> {
    const response = await fetch(`${this.connection.url}${path}`, {
      method: verb.toUpperCase(),
      headers: {
        authorization: `Bearer ${this.connection.token}`,
        ...(options.body === undefined
          ? {}
          : { "content-type": options.text ? "text/plain" : "application/json" }),
      },
      ...(options.body === undefined
        ? {}
        : {
            body:
              typeof options.body === "string" ? options.body : JSON.stringify(options.body),
          }),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new ServiceError(response.status, path, raw);
    }
    if (options.text === true) return raw;
    return raw === "" ? undefined : (JSON.parse(raw) as unknown);
  }

  /** `GET /api` — Named API requests */
  async getApi(): Promise<unknown> {
    return await this.call("get", `/api`, { });
  }

  /** `GET /bindings` — The bindings store */
  async getBindings(): Promise<unknown> {
    return await this.call("get", `/bindings`, { });
  }

  /** `GET /bindings/{id}` — One binding */
  async getBindingsById(id: string): Promise<unknown> {
    return await this.call("get", `/bindings/${encodeURIComponent(id)}`, { });
  }

  /** `GET /data` — Run data, with secrets redacted */
  async getData(): Promise<unknown> {
    return await this.call("get", `/data`, { });
  }

  /** `GET /events` — The event stream (WebSocket) */
  async getEvents(): Promise<unknown> {
    return await this.call("get", `/events`, { });
  }

  /** `GET /events/sse` — The event stream (server-sent events) */
  async getEventsSse(): Promise<unknown> {
    return await this.call("get", `/events/sse`, { });
  }

  /** `GET /flows/{file}` — Read a flow file */
  async getFlowsByFile(file: string): Promise<unknown> {
    return await this.call("get", `/flows/${encodeURIComponent(file)}`, { text: true, });
  }

  /** `GET /health` — Liveness, for the ADE's spawn handshake */
  async getHealth(): Promise<unknown> {
    return await this.call("get", `/health`, { });
  }

  /** `GET /openapi.json` — This document */
  async getOpenapijson(): Promise<unknown> {
    return await this.call("get", `/openapi.json`, { });
  }

  /** `GET /plan` — The compiled plan, story by story */
  async getPlan(): Promise<unknown> {
    return await this.call("get", `/plan`, { });
  }

  /** `GET /project` — Config, flows, stories, compositions, run blocks and API names */
  async getProject(): Promise<unknown> {
    return await this.call("get", `/project`, { });
  }

  /** `GET /runs` — Every run's summary */
  async getRuns(): Promise<unknown> {
    return await this.call("get", `/runs`, { });
  }

  /** `GET /runs/{id}` — One run's summary */
  async getRunsById(id: string): Promise<unknown> {
    return await this.call("get", `/runs/${encodeURIComponent(id)}`, { });
  }

  /** `GET /runs/{id}/audit` — One run's audit log */
  async getRunsByIdAudit(id: string): Promise<unknown> {
    return await this.call("get", `/runs/${encodeURIComponent(id)}/audit`, { });
  }

  /** `GET /runs/{id}/results` — One run's step results */
  async getRunsByIdResults(id: string): Promise<unknown> {
    return await this.call("get", `/runs/${encodeURIComponent(id)}/results`, { });
  }

  /** `GET /runs/{id}/screenshots/{name}` — A screenshot a run wrote */
  async getRunsByIdScreenshotsByName(id: string, name: string): Promise<unknown> {
    return await this.call("get", `/runs/${encodeURIComponent(id)}/screenshots/${encodeURIComponent(name)}`, { });
  }

  /** `POST /api/request` — Execute one API request ad hoc */
  async postApiRequest(body?: unknown): Promise<unknown> {
    return await this.call("post", `/api/request`, { body, });
  }

  /** `POST /compile` — Compile and lint */
  async postCompile(): Promise<unknown> {
    return await this.call("post", `/compile`, { });
  }

  /** `POST /run` — Start a run; step events arrive on the stream */
  async postRun(body?: unknown): Promise<unknown> {
    return await this.call("post", `/run`, { body, });
  }

  /** `PUT /api/{name}` — Save a named request under api/<name>.yaml */
  async putApiByName(name: string, body?: unknown): Promise<unknown> {
    return await this.call("put", `/api/${encodeURIComponent(name)}`, { body, });
  }

  /** `PUT /data` — Write data.yaml */
  async putData(body?: unknown): Promise<unknown> {
    return await this.call("put", `/data`, { body, });
  }

  /** `PUT /flows/{file}` — Write a flow file */
  async putFlowsByFile(file: string, body?: unknown): Promise<unknown> {
    return await this.call("put", `/flows/${encodeURIComponent(file)}`, { body, text: true, });
  }

}

/** A non-2xx answer, with the body the service sent. */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`${path} answered ${status}: ${body.slice(0, 400)}`);
    this.name = "ServiceError";
  }
}
