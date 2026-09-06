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
  /** `POST /surface/{session}/open` */
  postSurfaceBySessionOpen(session: string, body?: unknown): Promise<unknown>;
  /** `POST /surface/{session}/snapshot` */
  postSurfaceBySessionSnapshot(session: string, body?: unknown): Promise<unknown>;
  /** `POST /surface/{session}/act` */
  postSurfaceBySessionAct(session: string, body?: unknown): Promise<unknown>;
  /** `POST /surface/{session}/close` */
  postSurfaceBySessionClose(session: string, body?: unknown): Promise<unknown>;
  /** The event stream, as `GET /events/sse` carries it. Returns an unsubscribe. */
  subscribe(listener: (event: ServiceEventLike) => void): () => void;
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
