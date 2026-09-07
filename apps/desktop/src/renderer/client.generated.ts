/*
 * GENERATED FILE — do not edit.
 *
 * `node scripts/generate-app-client.mjs` writes this from the service's own
 * OpenAPI description (`GET /openapi.json`, LLD §13.5). It is committed so the
 * renderer builds without a running service, and a test regenerates it and diffs,
 * so drift between the app and the service is a red build rather than a discovery.
 *
 * Bodies are `unknown` on purpose: their types are `@svatah/yam-schema`'s, and
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
  { id: "deleteSessionsBySession", verb: "delete", path: "/sessions/{session}", summary: "Close a surface session (SF-05)" },
  { id: "getApi", verb: "get", path: "/api", summary: "Named API requests" },
  { id: "getBindings", verb: "get", path: "/bindings", summary: "The bindings store" },
  { id: "getBindingsById", verb: "get", path: "/bindings/{id}", summary: "One binding" },
  { id: "getData", verb: "get", path: "/data", summary: "Run data, with secrets redacted" },
  { id: "getEvents", verb: "get", path: "/events", summary: "The event stream (WebSocket)" },
  { id: "getEventsSse", verb: "get", path: "/events/sse", summary: "The event stream (server-sent events)" },
  { id: "getFlowsByFile", verb: "get", path: "/flows/{file}", summary: "Read a flow file" },
  { id: "getHealth", verb: "get", path: "/health", summary: "Liveness, for the app's spawn handshake" },
  { id: "getOpenapijson", verb: "get", path: "/openapi.json", summary: "This document" },
  { id: "getPlan", verb: "get", path: "/plan", summary: "The compiled plan, story by story" },
  { id: "getProject", verb: "get", path: "/project", summary: "Config, flows, stories, compositions, run blocks and API names" },
  { id: "getRuns", verb: "get", path: "/runs", summary: "Every run's summary" },
  { id: "getRunsById", verb: "get", path: "/runs/{id}", summary: "One run's summary" },
  { id: "getRunsByIdAudit", verb: "get", path: "/runs/{id}/audit", summary: "One run's audit log" },
  { id: "getRunsByIdResults", verb: "get", path: "/runs/{id}/results", summary: "One run's step results" },
  { id: "getRunsByIdScreenshotsByName", verb: "get", path: "/runs/{id}/screenshots/{name}", summary: "A screenshot a run wrote" },
  { id: "getSessions", verb: "get", path: "/sessions", summary: "List active surface sessions (SF-05)" },
  { id: "getSessionsBySessionCapabilities", verb: "get", path: "/sessions/{session}/capabilities", summary: "A session's adapter capabilities (SF-09)" },
  { id: "getSessionsBySessionEvents", verb: "get", path: "/sessions/{session}/events", summary: "What this session did, and the steps a proposal compiles from (T17, SF-19)" },
  { id: "getTargets", verb: "get", path: "/targets", summary: "Discover available targets and adapter readiness (SF-04)" },
  { id: "getTools", verb: "get", path: "/tools", summary: "The tools this project exposes, and every invocation served" },
  { id: "postApiRequest", verb: "post", path: "/api/request", summary: "Execute one API request ad hoc" },
  { id: "postBindingsVerify", verb: "post", path: "/bindings/verify", summary: "Dry-resolve the store, or one binding" },
  { id: "postCapture", verb: "post", path: "/capture", summary: "Record a flow from what a person does; sentences arrive on the stream" },
  { id: "postCaptureByIdStop", verb: "post", path: "/capture/{id}/stop", summary: "End a capture, writing the flow and its bindings" },
  { id: "postCompile", verb: "post", path: "/compile", summary: "Compile and lint" },
  { id: "postHeal", verb: "post", path: "/heal", summary: "Heal a run; proposals arrive on the stream" },
  { id: "postMigrate", verb: "post", path: "/migrate", summary: "Import a Yam prototype's electron-db directory into this project" },
  { id: "postRecord", verb: "post", path: "/record", summary: "Start a recording session; decisions arrive on the stream" },
  { id: "postRecordByIdDecision", verb: "post", path: "/record/{id}/decision", summary: "Accept, re-pick or reject the grounding a session is waiting on" },
  { id: "postRecordByIdStop", verb: "post", path: "/record/{id}/stop", summary: "Stop a recording session" },
  { id: "postRun", verb: "post", path: "/run", summary: "Start a run; step events arrive on the stream" },
  { id: "postRunsByIdStop", verb: "post", path: "/runs/{id}/stop", summary: "Stop a run that is going" },
  { id: "postSessions", verb: "post", path: "/sessions", summary: "Connect to a target and open a surface session (SF-04)" },
  { id: "postSessionsBySessionAct", verb: "post", path: "/sessions/{session}/act", summary: "Perform a validated action on the surface (SF-11)" },
  { id: "postSessionsBySessionCheck", verb: "post", path: "/sessions/{session}/check", summary: "Check a predicate against the surface (SF-11)" },
  { id: "postSessionsBySessionControl", verb: "post", path: "/sessions/{session}/control", summary: "Take, release or report who holds a target (T16, SF-13)" },
  { id: "postSessionsBySessionDescribe", verb: "post", path: "/sessions/{session}/describe", summary: "Describe a specific element on the surface (SF-10)" },
  { id: "postSessionsBySessionRead", verb: "post", path: "/sessions/{session}/read", summary: "Read a value from the surface (SF-11)" },
  { id: "postSessionsBySessionRequest", verb: "post", path: "/sessions/{session}/request", summary: "Send an HTTP request on an HTTP surface (T15, SF-04)" },
  { id: "postSessionsBySessionScreenshot", verb: "post", path: "/sessions/{session}/screenshot", summary: "Take a screenshot of the current surface (SF-11)" },
  { id: "postSessionsBySessionSnapshot", verb: "post", path: "/sessions/{session}/snapshot", summary: "A semantic snapshot of the surface (SF-10)" },
  { id: "postSurfaceBySessionSnapshot", verb: "post", path: "/surface/{session}/snapshot", summary: "The driven session's snapshot, for the picker and the explorer" },
  { id: "postTrajectoryCompile", verb: "post", path: "/trajectory/compile", summary: "Compile a captured trajectory into proposals/<date>/" },
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

  /** `DELETE /sessions/{session}` — Close a surface session (SF-05) */
  async deleteSessionsBySession(session: string): Promise<unknown> {
    return await this.call("delete", `/sessions/${encodeURIComponent(session)}`, { });
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
    return await this.call("get", `/bindings/${encodeURIComponent(id)}`, { text: true, });
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
    return await this.call("get", `/events/sse`, { text: true, });
  }

  /** `GET /flows/{file}` — Read a flow file */
  async getFlowsByFile(file: string): Promise<unknown> {
    return await this.call("get", `/flows/${encodeURIComponent(file)}`, { text: true, });
  }

  /** `GET /health` — Liveness, for the app's spawn handshake */
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

  /** `GET /sessions` — List active surface sessions (SF-05) */
  async getSessions(): Promise<unknown> {
    return await this.call("get", `/sessions`, { });
  }

  /** `GET /sessions/{session}/capabilities` — A session's adapter capabilities (SF-09) */
  async getSessionsBySessionCapabilities(session: string): Promise<unknown> {
    return await this.call("get", `/sessions/${encodeURIComponent(session)}/capabilities`, { });
  }

  /** `GET /sessions/{session}/events` — What this session did, and the steps a proposal compiles from (T17, SF-19) */
  async getSessionsBySessionEvents(session: string): Promise<unknown> {
    return await this.call("get", `/sessions/${encodeURIComponent(session)}/events`, { });
  }

  /** `GET /targets` — Discover available targets and adapter readiness (SF-04) */
  async getTargets(): Promise<unknown> {
    return await this.call("get", `/targets`, { });
  }

  /** `GET /tools` — The tools this project exposes, and every invocation served */
  async getTools(): Promise<unknown> {
    return await this.call("get", `/tools`, { });
  }

  /** `POST /api/request` — Execute one API request ad hoc */
  async postApiRequest(body?: unknown): Promise<unknown> {
    return await this.call("post", `/api/request`, { body, });
  }

  /** `POST /bindings/verify` — Dry-resolve the store, or one binding */
  async postBindingsVerify(body?: unknown): Promise<unknown> {
    return await this.call("post", `/bindings/verify`, { body, });
  }

  /** `POST /capture` — Record a flow from what a person does; sentences arrive on the stream */
  async postCapture(body?: unknown): Promise<unknown> {
    return await this.call("post", `/capture`, { body, });
  }

  /** `POST /capture/{id}/stop` — End a capture, writing the flow and its bindings */
  async postCaptureByIdStop(id: string): Promise<unknown> {
    return await this.call("post", `/capture/${encodeURIComponent(id)}/stop`, { });
  }

  /** `POST /compile` — Compile and lint */
  async postCompile(): Promise<unknown> {
    return await this.call("post", `/compile`, { });
  }

  /** `POST /heal` — Heal a run; proposals arrive on the stream */
  async postHeal(body?: unknown): Promise<unknown> {
    return await this.call("post", `/heal`, { body, });
  }

  /** `POST /migrate` — Import a Yam prototype's electron-db directory into this project */
  async postMigrate(body?: unknown): Promise<unknown> {
    return await this.call("post", `/migrate`, { body, });
  }

  /** `POST /record` — Start a recording session; decisions arrive on the stream */
  async postRecord(body?: unknown): Promise<unknown> {
    return await this.call("post", `/record`, { body, });
  }

  /** `POST /record/{id}/decision` — Accept, re-pick or reject the grounding a session is waiting on */
  async postRecordByIdDecision(id: string, body?: unknown): Promise<unknown> {
    return await this.call("post", `/record/${encodeURIComponent(id)}/decision`, { body, });
  }

  /** `POST /record/{id}/stop` — Stop a recording session */
  async postRecordByIdStop(id: string): Promise<unknown> {
    return await this.call("post", `/record/${encodeURIComponent(id)}/stop`, { });
  }

  /** `POST /run` — Start a run; step events arrive on the stream */
  async postRun(body?: unknown): Promise<unknown> {
    return await this.call("post", `/run`, { body, });
  }

  /** `POST /runs/{id}/stop` — Stop a run that is going */
  async postRunsByIdStop(id: string): Promise<unknown> {
    return await this.call("post", `/runs/${encodeURIComponent(id)}/stop`, { });
  }

  /** `POST /sessions` — Connect to a target and open a surface session (SF-04) */
  async postSessions(body?: unknown): Promise<unknown> {
    return await this.call("post", `/sessions`, { body, });
  }

  /** `POST /sessions/{session}/act` — Perform a validated action on the surface (SF-11) */
  async postSessionsBySessionAct(session: string, body?: unknown): Promise<unknown> {
    return await this.call("post", `/sessions/${encodeURIComponent(session)}/act`, { body, });
  }

  /** `POST /sessions/{session}/check` — Check a predicate against the surface (SF-11) */
  async postSessionsBySessionCheck(session: string, body?: unknown): Promise<unknown> {
    return await this.call("post", `/sessions/${encodeURIComponent(session)}/check`, { body, });
  }

  /** `POST /sessions/{session}/control` — Take, release or report who holds a target (T16, SF-13) */
  async postSessionsBySessionControl(session: string, body?: unknown): Promise<unknown> {
    return await this.call("post", `/sessions/${encodeURIComponent(session)}/control`, { body, });
  }

  /** `POST /sessions/{session}/describe` — Describe a specific element on the surface (SF-10) */
  async postSessionsBySessionDescribe(session: string, body?: unknown): Promise<unknown> {
    return await this.call("post", `/sessions/${encodeURIComponent(session)}/describe`, { body, });
  }

  /** `POST /sessions/{session}/read` — Read a value from the surface (SF-11) */
  async postSessionsBySessionRead(session: string, body?: unknown): Promise<unknown> {
    return await this.call("post", `/sessions/${encodeURIComponent(session)}/read`, { body, });
  }

  /** `POST /sessions/{session}/request` — Send an HTTP request on an HTTP surface (T15, SF-04) */
  async postSessionsBySessionRequest(session: string, body?: unknown): Promise<unknown> {
    return await this.call("post", `/sessions/${encodeURIComponent(session)}/request`, { body, });
  }

  /** `POST /sessions/{session}/screenshot` — Take a screenshot of the current surface (SF-11) */
  async postSessionsBySessionScreenshot(session: string, body?: unknown): Promise<unknown> {
    return await this.call("post", `/sessions/${encodeURIComponent(session)}/screenshot`, { body, });
  }

  /** `POST /sessions/{session}/snapshot` — A semantic snapshot of the surface (SF-10) */
  async postSessionsBySessionSnapshot(session: string, body?: unknown): Promise<unknown> {
    return await this.call("post", `/sessions/${encodeURIComponent(session)}/snapshot`, { body, });
  }

  /** `POST /surface/{session}/snapshot` — The driven session's snapshot, for the picker and the explorer */
  async postSurfaceBySessionSnapshot(session: string, body?: unknown): Promise<unknown> {
    return await this.call("post", `/surface/${encodeURIComponent(session)}/snapshot`, { body, });
  }

  /** `POST /trajectory/compile` — Compile a captured trajectory into proposals/<date>/ */
  async postTrajectoryCompile(body?: unknown): Promise<unknown> {
    return await this.call("post", `/trajectory/compile`, { body, });
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
