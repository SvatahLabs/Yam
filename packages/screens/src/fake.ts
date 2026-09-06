/**
 * The fake-service harness (T9.1: "a fake-service harness for tests").
 *
 * `ScreenService` over a bag of recorded responses. Nothing is invented: the
 * bag `test/fixtures/` carries is what a real service answered for
 * `evals/fixtures` and for the `comp` run of `guards-and-compensation.flow`,
 * recorded by `scripts/record-screen-fixtures.mjs` and re-recordable with
 * `--check` so it cannot drift from the service.
 *
 * That is what makes T9.1's Validate a real claim: "every screen loads against
 * the fake service in tests with the state the mockup shows for the fixtures
 * project". A hand-written stub would let a screen pass a test against numbers
 * a service never produced.
 */
import type { ScreenService, ServiceEventLike } from "./service.js";

/** Every response the fake can give, keyed the way the fixtures file is. */
export interface FakeResponses {
  project?: unknown;
  plan?: unknown;
  compile?: unknown;
  runs?: unknown;
  bindings?: unknown;
  /** By element id: the binding file's YAML, as `GET /bindings/:id` answers it. */
  bindingById?: Record<string, string>;
  data?: unknown;
  api?: unknown;
  tools?: unknown;
  /** `flows/simple.flow` → its text, by basename as `GET /flows/*` takes it. */
  flows?: Record<string, string>;
  /** By run id: `summary`, `results`, `audit`. */
  runById?: Record<string, { summary?: unknown; results?: unknown; audit?: unknown }>;
}

/** What the fake was asked, in order. A test asserts on the screen rule with it. */
export interface FakeCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface FakeService extends ScreenService {
  /** Every call a screen made, in order. */
  readonly calls: readonly FakeCall[];
  /** Push an event to whoever subscribed, so a live screen can be driven. */
  emit(event: ServiceEventLike): void;
}

/** A route the fixtures have no answer for. Screens treat it as an empty screen. */
export class FakeNotFound extends Error {
  constructor(what: string) {
    super(`${what} is not in the recorded fixtures.`);
    this.name = "FakeNotFound";
  }
}

export function fakeService(responses: FakeResponses = {}): FakeService {
  const calls: FakeCall[] = [];
  const listeners = new Set<(event: ServiceEventLike) => void>();

  const record = (method: string, ...args: unknown[]): void => {
    calls.push({ method, args });
  };

  /** Answer with what was recorded, or refuse — never with an invented shape. */
  const answer = async (method: string, value: unknown, what: string): Promise<unknown> => {
    record(method);
    if (value === undefined) throw new FakeNotFound(what);
    return value;
  };

  const run = (id: string): { summary?: unknown; results?: unknown; audit?: unknown } =>
    responses.runById?.[id] ?? {};

  /** A write the fixtures cannot represent: recorded, and answered `{ ok: true }`. */
  const wrote = async (method: string, ...args: unknown[]): Promise<unknown> => {
    record(method, ...args);
    return { ok: true };
  };

  return {
    calls,
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      record("subscribe");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getProject: () => answer("getProject", responses.project, "GET /project"),
    getPlan: () => answer("getPlan", responses.plan, "GET /plan"),
    postCompile: () => answer("postCompile", responses.compile, "POST /compile"),
    getRuns: () => answer("getRuns", responses.runs ?? [], "GET /runs"),
    getBindings: () => answer("getBindings", responses.bindings ?? [], "GET /bindings"),
    async getBindingsById(id) {
      record("getBindingsById", id);
      const text = responses.bindingById?.[id];
      if (text === undefined) throw new FakeNotFound(`GET /bindings/${id}`);
      return text;
    },
    getData: () => answer("getData", responses.data, "GET /data"),
    getApi: () => answer("getApi", responses.api ?? [], "GET /api"),
    getTools: () => answer("getTools", responses.tools ?? {}, "GET /tools"),

    async getFlowsByFile(file) {
      record("getFlowsByFile", file);
      const text = responses.flows?.[file] ?? responses.flows?.[file.split("/").pop() ?? file];
      if (text === undefined) throw new FakeNotFound(`GET /flows/${file}`);
      return text;
    },
    async getRunsById(id) {
      record("getRunsById", id);
      const found = run(id).summary;
      if (found === undefined) throw new FakeNotFound(`GET /runs/${id}`);
      return found;
    },
    async getRunsByIdResults(id) {
      record("getRunsByIdResults", id);
      const found = run(id).results;
      if (found === undefined) throw new FakeNotFound(`GET /runs/${id}/results`);
      return found;
    },
    async getRunsByIdAudit(id) {
      record("getRunsByIdAudit", id);
      const found = run(id).audit;
      if (found === undefined) throw new FakeNotFound(`GET /runs/${id}/audit`);
      return found;
    },

    /*
     * The writes. A fake that pretended to run a flow would be a second
     * executor; what a screen's test can honestly check is that the action
     * called the right route with the right body, which `calls` records.
     */
    putFlowsByFile: (file, body) => wrote("putFlowsByFile", file, body),
    async postRun(body) {
      record("postRun", body);
      return { runId: "comp" };
    },
    postBindingsVerify: (body) => wrote("postBindingsVerify", body),
    async postRecord(body) {
      record("postRecord", body);
      return { sessionId: "rec-1" };
    },
    async postCapture(body) {
      record("postCapture", body);
      return { sessionId: "cap-1" };
    },
    postCaptureByIdStop: (id, body) => wrote("postCaptureByIdStop", id, body),
    postRecordByIdDecision: (id, body) => wrote("postRecordByIdDecision", id, body),
    postRecordByIdStop: (id, body) => wrote("postRecordByIdStop", id, body),
    postRunsByIdStop: (id, body) => wrote("postRunsByIdStop", id, body),
    async postHeal(body) {
      record("postHeal", body);
      return { healId: "heal-3" };
    },
    postApiRequest: (body) => wrote("postApiRequest", body),
    putApiByName: (name, body) => wrote("putApiByName", name, body),
    putData: (body) => wrote("putData", body),
    postMigrate: (body) => wrote("postMigrate", body),
    postTrajectoryCompile: (body) => wrote("postTrajectoryCompile", body),
    postSurfaceBySessionOpen: (session, body) => wrote("postSurfaceBySessionOpen", session, body),
    postSurfaceBySessionSnapshot: (session, body) =>
      wrote("postSurfaceBySessionSnapshot", session, body),
    postSurfaceBySessionAct: (session, body) => wrote("postSurfaceBySessionAct", session, body),
    postSurfaceBySessionClose: (session, body) => wrote("postSurfaceBySessionClose", session, body),
  };
}
