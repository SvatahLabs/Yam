/**
 * What a screen may ask the world (T9.1, LLD §13.7, §13.5).
 *
 * > The app and the terminal cockpit `yam ui` are two renderers of one
 * > headless **screen model**, and both are views over the local service
 * > (§13.5) and nothing else.
 *
 * ## Why this is an interface here and not an import
 *
 * `@svatah/yam-sdk` is generated *from* the service's OpenAPI description and takes
 * its `actions` list from this package (§13.8) — so a screen that imported the
 * SDK would make the workspace graph cyclic, which is the same mistake the
 * service made in Phase 2 and fixed by injecting `ServiceApi` (§13.5). The
 * dependency points one way, `sdk ─► screens`, and a screen receives its client
 * rather than reaching for one.
 *
 * It also makes the model testable without a server: `fakeService()` in
 * `fake.ts` is this interface over a bag of recorded responses.
 *
 * ## The methods are the generated client's, by name
 *
 * `getProject`, `postRun`, `getRunsByIdResults` — the names
 * `scripts/generate-service-client.mjs` derives from the paths. A screen can
 * therefore only ask for a route the service publishes, and the app's client,
 * the SDK and the fake all satisfy this structurally with nothing to adapt.
 */

/** A screen asks for what it renders and gets `unknown`; it parses with `@svatah/yam-schema`. */
export interface ScreenService {
  /** `GET /project` */
  getProject(): Promise<unknown>;
  /** `GET /flows/{file}` — the flow's text. */
  getFlowsByFile(file: string): Promise<unknown>;
  /** `PUT /flows/{file}` */
  putFlowsByFile(file: string, body?: unknown): Promise<unknown>;
  /** `POST /compile` — the lint a screen shows beside the editor. */
  postCompile(body?: unknown): Promise<unknown>;
  /** `GET /plan` — the compiled plan, exactly as `yam compile` writes it. */
  getPlan(): Promise<unknown>;
  /** `POST /run` */
  postRun(body?: unknown): Promise<unknown>;
  /** `GET /runs` */
  getRuns(): Promise<unknown>;
  /** `GET /runs/{id}` */
  getRunsById(id: string): Promise<unknown>;
  /** `GET /runs/{id}/results` */
  getRunsByIdResults(id: string): Promise<unknown>;
  /** `GET /runs/{id}/audit` */
  getRunsByIdAudit(id: string): Promise<unknown>;
  /**
   * `POST /runs/{id}/stop` — cancel a run between steps (T10.4, §13.5).
   *
   * Phase 9 had no Stop action because the service published no such route: a
   * screen may only ask for one that exists, and stopping a run needed the
   * executor to be cancellable, which is a runtime change and not a screen's.
   * T10.4 made it, so the Run screen has a Stop button.
   */
  postRunsByIdStop(id: string, body?: unknown): Promise<unknown>;
  /** `GET /bindings` — the list of `{ id, file }` rows. */
  getBindings(): Promise<unknown>;
  /** `GET /bindings/{id}` — one binding file, as the YAML on disk. */
  getBindingsById(id: string): Promise<unknown>;
  /** `POST /bindings/verify` */
  postBindingsVerify(body?: unknown): Promise<unknown>;
  /** `POST /record` */
  postRecord(body?: unknown): Promise<unknown>;
  /** `POST /capture` — record a flow from what a person does (Draft 2.23). */
  postCapture(body?: unknown): Promise<unknown>;
  /** `POST /capture/{id}/stop` — end a capture, writing the flow. */
  postCaptureByIdStop(id: string, body?: unknown): Promise<unknown>;
  /** `POST /record/{id}/decision` */
  postRecordByIdDecision(id: string, body?: unknown): Promise<unknown>;
  /** `POST /record/{id}/stop` */
  postRecordByIdStop(id: string, body?: unknown): Promise<unknown>;
  /** `POST /heal` */
  postHeal(body?: unknown): Promise<unknown>;
  /** `GET /api` */
  getApi(): Promise<unknown>;
  /** `POST /api/request` */
  postApiRequest(body?: unknown): Promise<unknown>;
  /** `PUT /api/{name}` — save a named request back to `api/<name>.yaml` (K7). */
  putApiByName(name: string, body?: unknown): Promise<unknown>;
  /** `GET /data` */
  getData(): Promise<unknown>;
  /** `PUT /data` */
  putData(body?: unknown): Promise<unknown>;
  /** `GET /tools` */
  getTools(): Promise<unknown>;
  /** `POST /migrate` */
  postMigrate(body?: unknown): Promise<unknown>;
  /** `POST /trajectory/compile` */
  postTrajectoryCompile(body?: unknown): Promise<unknown>;
  /**
   * `POST /surface/{session}/snapshot` — the driven session's tree, so a
   * reviewer can re-pick by clicking (REQ-ADE-4).
   *
   * The record review's, not the Explorer's: T15 replaced the Explorer with the
   * Surfaces action inspector, which reads the broker's own snapshot route.
   */
  postSurfaceBySessionSnapshot(session: string, body?: unknown): Promise<unknown>;

  /* ── SF-03/T14: the surface operation catalogue, over the broker ─────────── */

  /**
   * The catalogue's operations, as the service publishes them (SF-03, T14).
   *
   * These are the routes wave 2 (T12) generated from
   * `@svatah/yam-surface-control`'s one catalogue and served over the broker —
   * the same sessions the CLI and a generic MCP client address. The desktop is
   * a client of that broker, not a second session store, so a Surfaces screen
   * reaches them through these methods and holds no operation list of its own.
   *
   * They take and return the catalogue's `ResultEnvelope`; a screen parses it
   * with `@svatah/yam-schema` rather than trusting a shape.
   */
  /** `GET /targets` — discover targets and adapter readiness (SF-04). */
  getTargets(): Promise<unknown>;
  /** `POST /sessions` — connect to a target and open a session (SF-04). */
  postSessions(body?: unknown): Promise<unknown>;
  /** `GET /sessions` — list active surface sessions (SF-05). */
  getSessions(): Promise<unknown>;
  /** `DELETE /sessions/{session}` — close a surface session (SF-05). */
  deleteSessionsBySession(session: string): Promise<unknown>;
  /** `GET /sessions/{session}/capabilities` — the adapter's capabilities (SF-09). */
  getSessionsBySessionCapabilities(session: string): Promise<unknown>;
  /** `POST /sessions/{session}/snapshot` — a semantic snapshot (SF-10). */
  postSessionsBySessionSnapshot(session: string, body?: unknown): Promise<unknown>;
  /** `POST /sessions/{session}/act` — a validated action (SF-11). */
  postSessionsBySessionAct(session: string, body?: unknown): Promise<unknown>;
  /** `POST /sessions/{session}/read` — read a value (SF-11). */
  postSessionsBySessionRead(session: string, body?: unknown): Promise<unknown>;
  /** `POST /sessions/{session}/check` — check a predicate (SF-11). */
  postSessionsBySessionCheck(session: string, body?: unknown): Promise<unknown>;
  /** `POST /sessions/{session}/describe` — describe an element (SF-10). */
  postSessionsBySessionDescribe(session: string, body?: unknown): Promise<unknown>;
  /** `POST /sessions/{session}/screenshot` — an artifact reference (SF-11). */
  postSessionsBySessionScreenshot(session: string, body?: unknown): Promise<unknown>;
  /**
   * `GET /sessions/{session}/events` — what this session did, and the steps a
   * proposal compiles from (T17, SF-19).
   */
  getSessionsBySessionEvents(session: string): Promise<unknown>;
  /**
   * `POST /sessions/{session}/control` — take, release or report who holds a
   * target (T16, SF-13).
   */
  postSessionsBySessionControl(session: string, body?: unknown): Promise<unknown>;
  /**
   * `POST /sessions/{session}/request` — send an HTTP request (T15, SF-04).
   *
   * An HTTP surface has no elements: its tree is empty and `act` refuses, so
   * this is the only way to drive one.
   */
  postSessionsBySessionRequest(session: string, body?: unknown): Promise<unknown>;

  /** The event stream, as `GET /events/sse` carries it. Returns an unsubscribe. */
  subscribe(listener: (event: ServiceEventLike) => void): () => void;
  /** Who is connected over MCP (TV-M05, SF-13). Optional: an older service has none. */
  getAgentsClients?(): Promise<unknown>;
}

/**
 * One line of the event stream, as far as a screen cares.
 *
 * The full union is `@svatah/yam-service`'s `ServiceEvent`, which this package must
 * not import (the service is a runtime package and §13.7 keeps the model over
 * the wire). `kind` is what a screen switches on and the rest is carried
 * through, so a new event kind reaches a renderer without a change here.
 */
export interface ServiceEventLike {
  readonly kind: string;
  readonly [key: string]: unknown;
}

/**
 * Where the connection is, for the renderers' chrome and for `--json`.
 *
 * Not used to make a call — the client already knows — but shown in the top bar
 * and the TUI's header, which the mockups both put the service's address in.
 */
export interface ServiceConnectionInfo {
  readonly url: string;
  /** The project directory the service was opened on. */
  readonly project?: string;
}
