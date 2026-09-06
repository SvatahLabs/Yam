/**
 * The HTTP adapter as an `AgentSurface` (REQ-ADP-2, REQ-SURF-1, LLD §7.2).
 *
 * An HTTP endpoint has no elements, so most of the surface does not apply — and
 * saying so honestly is the whole design here. `capabilities()` reports nothing
 * but `restore`, `snapshot()` returns an empty tree, and `act`, `locate` and
 * `describe` throw a typed error naming what this adapter is for. The executor
 * refuses a plan needing a missing capability *at start* rather than mid-run
 * (LLD §2.4), so a flow that expects to click something never reaches the point
 * of finding out there is nothing to click.
 *
 * What it does implement is `request()` and the `read` kinds that follow from
 * it, which is what an `api` step needs (LLD §8.2).
 */
import type {
  ActArgs,
  ActResult,
  ApiRequest,
  ApiResponse,
  Candidate,
  Capabilities,
  CheckResult,
  Config,
  ElementDescription,
  Predicate,
  ReadKind,
  Ref,
  SessionInit,
  SessionState,
  Snapshot,
  SurfaceAction,
  SurfaceKind,
} from "@svatah/yam-schema";
import type { AgentSurface } from "@svatah/yam-surface";
import { buildSnapshot, DataError, NO_CAPABILITIES, structuralHash } from "@svatah/yam-surface";
import { executeRequest, type RequestOptions } from "./request.js";
import { readJsonPath } from "./jsonpath.js";
import type { TemplateScope } from "./template.js";

export interface HttpAdapterOptions {
  /** `config.app.baseUrl`, for requests written with a relative URL. */
  readonly baseUrl?: string;
  /** Files in a multipart request are read relative to this. */
  readonly cwd?: string;
  readonly timeoutMs?: number;
  /** What `{…}` in a request reads. The executor supplies the run's scope. */
  readonly scope?: TemplateScope;
}

/**
 * What the HTTP adapter cannot do, said once.
 *
 * A message that names the adapter and the reason, rather than "not
 * implemented": someone seeing this has configured `adapter: http` for a flow
 * that clicks things, and what they need to know is which of the two is wrong.
 */
function notAnElementSurface(method: string): never {
  throw new DataError(
    `The HTTP adapter has no elements, so ${method}() has nothing to answer. ` +
      "It implements request(), read() and check() over the last response. " +
      "A flow that addresses elements needs a web, mobile or desktop adapter (REQ-ADP-2).",
  );
}

export class HttpSurface implements AgentSurface {
  readonly kind: SurfaceKind = "http";

  /** The last response, which `read` and `check` answer from. */
  private last: ApiResponse | undefined;
  private cookies: Record<string, string> = {};
  private options: HttpAdapterOptions;

  constructor(options: HttpAdapterOptions = {}) {
    this.options = options;
  }

  capabilities(): Capabilities {
    // `restore` is true because session state here is the cookie jar, and
    // restoring it is exactly as meaningful as it is for a browser.
    return { ...NO_CAPABILITIES, restore: true };
  }

  async open(session: SessionInit): Promise<void> {
    if (session.baseUrl !== undefined) {
      this.options = { ...this.options, baseUrl: session.baseUrl };
    }
    this.cookies = {};
    this.last = undefined;
  }

  async close(): Promise<void> {
    this.cookies = {};
    this.last = undefined;
  }

  /**
   * An empty tree.
   *
   * Not an error: a caller may reasonably snapshot any surface, and a surface
   * with no elements has an empty tree. The hash is the hash of nothing, which
   * is stable, so a context hash taken here is meaningful even though it is the
   * same every time.
   */
  async snapshot(): Promise<Snapshot> {
    return buildSnapshot("r0", [], structuralHash([]));
  }

  async act(_action: SurfaceAction, _ref?: Ref, _args?: ActArgs): Promise<ActResult> {
    return notAnElementSurface("act");
  }

  async locate(_candidate: Candidate): Promise<Ref[]> {
    return notAnElementSurface("locate");
  }

  async describe(_ref: Ref): Promise<ElementDescription> {
    return notAnElementSurface("describe");
  }

  async screenshot(): Promise<void> {
    throw new DataError("The HTTP adapter has nothing to photograph.");
  }

  /**
   * Read from the last response.
   *
   * `result` reads the whole response object, which is what a capture with a
   * `jsonPath` then indexes into (LLD §8.2).
   */
  async read(kind: ReadKind, _ref?: Ref, name?: string): Promise<unknown> {
    if (this.last === undefined) {
      throw new DataError("Nothing has been requested yet, so there is no response to read.");
    }
    switch (kind) {
      case "result":
        return this.last;
      case "text":
        return this.last.body;
      case "value":
        return this.last.json ?? this.last.body;
      case "attribute":
        // Headers are the nearest thing an HTTP response has to an attribute.
        return name === undefined ? undefined : this.last.headers[name.toLowerCase()];
      case "url":
      case "title":
        return undefined;
      default:
        return undefined;
    }
  }

  /**
   * Check a predicate against the last response.
   *
   * Only the value predicates make sense; a state predicate is about an element.
   * An unsupported predicate returns `ok: false` with a reason rather than
   * throwing, because a failed expectation is a normal outcome and the executor
   * classifies it as `assertion` (LLD §8.4).
   */
  async check(predicate: Predicate, _subject: "ref" | "page" | "dialog"): Promise<CheckResult> {
    if (this.last === undefined) {
      return { ok: false, actual: undefined, message: "No request has been made yet." };
    }
    const kind = predicate.kind;
    if (kind === "text" || kind === "textContains") {
      const expected = String(literal(predicate));
      const actual = this.last.body;
      const ok = kind === "text" ? actual === expected : actual.includes(expected);
      return { ok: negate(predicate) ? !ok : ok, actual };
    }
    return {
      ok: false,
      actual: undefined,
      message: `The HTTP adapter cannot check "${kind}": it has no elements and no page.`,
    };
  }

  async state(): Promise<SessionState> {
    return {
      kind: "http",
      ...(Object.keys(this.cookies).length === 0
        ? {}
        : { storageState: JSON.stringify({ cookies: this.cookies }) }),
    };
  }

  /** Restore the cookie jar, which is the whole of this adapter's session. */
  async restore(state: SessionState): Promise<void> {
    if (state.storageState === undefined) {
      this.cookies = {};
      return;
    }
    try {
      const parsed = JSON.parse(state.storageState) as { cookies?: Record<string, string> };
      this.cookies = parsed.cookies ?? {};
    } catch {
      this.cookies = {};
    }
  }

  /**
   * Execute a named request (REQ-ADP-2, REQ-ADP-3).
   *
   * `withSessionCookies` decides whether the caller's cookies go with it. The
   * adapter's *own* jar always does: two requests in a row are one conversation,
   * and a login followed by a call that forgot the cookie it was just given
   * would be a surprising thing for a request file to do.
   */
  async request(
    req: ApiRequest,
    opts: { withSessionCookies: boolean } & Partial<RequestOptions>,
  ): Promise<ApiResponse> {
    const sessionCookies = opts.withSessionCookies
      ? { ...this.cookies, ...(opts.sessionCookies ?? {}) }
      : this.cookies;

    const response = await executeRequest(req, {
      ...(this.options.scope === undefined ? {} : { scope: this.options.scope }),
      ...(this.options.baseUrl === undefined ? {} : { baseUrl: this.options.baseUrl }),
      ...(this.options.cwd === undefined ? {} : { cwd: this.options.cwd }),
      ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
      ...opts,
      sessionCookies,
    });

    this.last = response;
    if (response.cookies !== undefined) this.cookies = { ...this.cookies, ...response.cookies };
    return response;
  }

  /** The cookies this adapter has collected, for a paired web session. */
  sessionCookies(): Readonly<Record<string, string>> {
    return { ...this.cookies };
  }

  /** Read a JSON path out of the last response (`Step.capture.jsonPath`). */
  captureFromLast(jsonPath?: string): unknown {
    if (this.last === undefined) return undefined;
    if (jsonPath === undefined) return this.last.json ?? this.last.body;
    return readJsonPath(this.last.json ?? {}, jsonPath);
  }
}

function literal(predicate: Predicate): unknown {
  const value = (predicate as { value?: { kind?: string; value?: unknown } }).value;
  return value?.kind === "literal" ? value.value : undefined;
}

function negate(predicate: Predicate): boolean {
  return (predicate as { negate?: boolean }).negate === true;
}

/** Build an HTTP surface from a project config (LLD §2.4). */
export function createHttpSurface(config: Config, overrides: HttpAdapterOptions = {}): HttpSurface {
  return new HttpSurface({
    ...(config.app.baseUrl === undefined ? {} : { baseUrl: config.app.baseUrl }),
    timeoutMs: config.run.stepTimeoutMs,
    ...overrides,
  });
}
