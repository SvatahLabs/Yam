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
import type { AgentSurface, StoredCookie } from "@svatah/yam-surface";
import { buildSnapshot, cookiesFor, DataError, NO_CAPABILITIES, structuralHash } from "@svatah/yam-surface";
import { sendRequest, type RequestOptions, type ResponseCookie } from "./request.js";
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
  /** Injected in tests; see `RequestOptions.fetch`. */
  readonly fetch?: RequestOptions["fetch"];
  /** Injected in tests; see `RequestOptions.lookup`. */
  readonly lookup?: RequestOptions["lookup"];
}

/** What `request()` takes beyond the request itself (REQ-ADP-3). */
export type HttpRequestOptions = {
  /** Whether the paired session's cookies go with this request. */
  readonly withSessionCookies: boolean;
  /**
   * The step said `without cookies`: no session cookies and none from this
   * adapter's jar either, and the cookies the response sets are not kept.
   * Wins over `withSessionCookies`.
   */
  readonly withoutCookies?: boolean;
} & Partial<RequestOptions>;

/*
 * The names a loopback host goes by (REQ-ADP-3).
 *
 * A browser keeps `localhost` and `127.0.0.1` apart, and so a jar that did the
 * same lost its sign-in whenever `app.baseUrl` said one and a request file the
 * other — the same server on the same machine. Here the three names are one
 * host for cookies. It is safe for the same reason a cookie ignores the port:
 * every name reaches the same machine, and whoever listens on any port of it
 * is already sent the cookie. Only the exact names are aliased; `app.localhost`
 * and `127.0.0.2` are hosts of their own.
 */
const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const LOOPBACK = "localhost";

/** A host with the loopback names made one, for the jar. */
function jarHost(host: string): string {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, "");
  return LOOPBACK_NAMES.has(bare) ? LOOPBACK : bare;
}

/** A URL as the jar matches it, with a loopback host made one; `undefined` when it does not parse. */
function jarUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    if (jarHost(parsed.hostname) === LOOPBACK) parsed.hostname = LOOPBACK;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/** A cookie as the jar stores it: its domain with the loopback names made one. */
function stored(cookie: ResponseCookie): StoredCookie {
  const dot = cookie.domain.startsWith(".") ? "." : "";
  return {
    name: cookie.name,
    value: cookie.value,
    domain: `${dot}${jarHost(dot === "" ? cookie.domain : cookie.domain.slice(1))}`,
    ...(cookie.path === undefined ? {} : { path: cookie.path }),
    ...(cookie.secure === true ? { secure: true } : {}),
  };
}

/** The same cookie: a later one of the same name, domain and path replaces it. */
function sameCookie(a: StoredCookie, b: StoredCookie): boolean {
  return a.name === b.name && a.domain === b.domain && (a.path ?? "/") === (b.path ?? "/");
}

/** Whether a stored cookie is one of `host`'s — sent to it on some path, over some scheme. */
function belongsTo(cookie: StoredCookie, host: string): boolean {
  const bracketed = host.includes(":") ? `[${host}]` : host;
  return Object.keys(cookiesFor(`https://${bracketed}${cookie.path ?? "/"}`, [cookie])).length > 0;
}

function isStoredCookie(value: unknown): value is StoredCookie {
  const cookie = value as Partial<StoredCookie> | null;
  return (
    typeof cookie === "object" &&
    cookie !== null &&
    typeof cookie.name === "string" &&
    cookie.name !== "" &&
    typeof cookie.value === "string" &&
    typeof cookie.domain === "string" &&
    cookie.domain !== "" &&
    (cookie.path === undefined || typeof cookie.path === "string") &&
    (cookie.secure === undefined || typeof cookie.secure === "boolean")
  );
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
  /**
   * The cookies responses have set, as a browser stores them (REQ-ADP-3).
   *
   * It was one flat record sent with every request to any host, so a session
   * cookie application A set went to whatever absolute URL a request file or
   * an agent named next — B, an attacker's endpoint, anything. Then it was a
   * record per hostname, which stopped that and ignored `Domain`: a sign-in at
   * `auth.example.com` setting `sid; Domain=example.com` was no longer sent to
   * `api.example.com`, where the flat jar had sent it and a browser would.
   * Now each cookie keeps the attributes that decide where it goes (`Domain`,
   * `Path`, `Secure`, read by `parseSetCookie`), and a request is sent what
   * `cookiesFor` — the rule every adapter with a jar shares — says a browser
   * would send to its URL.
   */
  private jar: StoredCookie[] = [];
  /**
   * Cookies restored from a state saved before the jar knew hosts, when this
   * adapter had no base URL to give them a host. A base URL arrives only with
   * the constructor or `open()`, and `open()` starts a new session, so nothing
   * ever sends these; they are held and saved again by `state()` (under
   * `unscoped`, and as the legacy `cookies`), so a restore into an adapter
   * without a base URL and a save out of it loses nothing.
   */
  private unscoped: Record<string, string> = {};
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
    this.jar = [];
    this.unscoped = {};
    this.last = undefined;
  }

  async close(): Promise<void> {
    this.jar = [];
    this.unscoped = {};
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

  /**
   * The jar: `{"jar": [{"name", "value", "domain", "path", "secure"}], "cookies": {…}}`.
   *
   * `jar` is the whole of it. `cookies` is the shape a state had before the
   * jar knew hosts — one flat record — and holds the base URL's host's
   * cookies, so a Yam that reads only that shape still restores the session a
   * run signed in to. It is written for one release (0.2) and then dropped.
   * `unscoped` carries cookies a restore could not give a host (`restore`).
   */
  async state(): Promise<SessionState> {
    const base = this.baseHost();
    const unscoped = Object.keys(this.unscoped).length === 0 ? undefined : { ...this.unscoped };
    const legacy =
      base === undefined
        ? unscoped
        : Object.fromEntries(
            this.jar.filter((cookie) => belongsTo(cookie, base)).map((cookie) => [cookie.name, cookie.value]),
          );
    if (this.jar.length === 0 && unscoped === undefined) return { kind: "http" };
    return {
      kind: "http",
      storageState: JSON.stringify({
        jar: this.jar,
        ...(legacy === undefined || Object.keys(legacy).length === 0 ? {} : { cookies: legacy }),
        ...(unscoped === undefined ? {} : { unscoped }),
      }),
    };
  }

  /**
   * Restore the cookie jar, which is the whole of this adapter's session.
   *
   * A state with `jar` is restored as it was saved. The flat `cookies` of an
   * earlier state are restored as host-only cookies on `/` for the base URL's
   * host — what a flat record sent to that host amounted to, and the host
   * every request those states came from could have meant without naming one.
   * With no base URL there is no host to give them, and a cookie with no host
   * is the cookie this jar stopped sending everywhere: they are not sent, but
   * held and saved again rather than dropped without a word (`unscoped`).
   */
  async restore(state: SessionState): Promise<void> {
    this.jar = [];
    this.unscoped = {};
    if (state.storageState === undefined) return;
    let parsed: { jar?: unknown; cookies?: unknown; unscoped?: unknown };
    try {
      parsed = JSON.parse(state.storageState) as typeof parsed;
    } catch {
      return;
    }
    const flat = Array.isArray(parsed.jar) ? parsed.unscoped : parsed.cookies;
    if (Array.isArray(parsed.jar)) {
      this.jar = parsed.jar.filter(isStoredCookie).map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain.toLowerCase(),
        ...(cookie.path === undefined ? {} : { path: cookie.path }),
        ...(cookie.secure === true ? { secure: true } : {}),
      }));
    }
    if (typeof flat !== "object" || flat === null) return;
    const cookies = Object.entries(flat as Record<string, unknown>).filter(
      (entry): entry is [string, string] => entry[0] !== "" && typeof entry[1] === "string",
    );
    const base = this.baseHost();
    if (base === undefined) {
      this.unscoped = Object.fromEntries(cookies);
      return;
    }
    const adopted = cookies.map(([name, value]) => ({ name, value, domain: base, path: "/" }));
    this.jar = [...adopted.filter((cookie) => !this.jar.some((one) => sameCookie(one, cookie))), ...this.jar];
  }

  /**
   * Execute a named request (REQ-ADP-2, REQ-ADP-3).
   *
   * The adapter's *own* jar goes with every request, as a browser would send
   * it to the request's URL: two requests in a row are one conversation, and a
   * login followed by a call that forgot the cookie it was just given would be
   * a surprising thing for a request file to do.
   *
   * `withSessionCookies` decides whether the *caller's* cookies go too — the
   * browser's, for a flow that signed in through the UI and calls the API as
   * that person. The flag did nothing before: the jar was sent either way, and
   * the executor never supplied any other cookies, so `with the session
   * cookies` and `without cookies` sent the same request. The caller supplies
   * them as `sessionCookies`, a record, or `sessionCookiesFor`, asked with this
   * request's absolute URL so a browser can answer for the right host; with
   * the flag unset, neither is read.
   *
   * `withoutCookies` is the step that said so. Leaving the session's cookies
   * out was not enough: the jar still went, so a call meant to show that an
   * endpoint refuses an anonymous caller went signed in whenever an earlier
   * call in the run had signed in. It sends neither. The request's own
   * `cookies`, written in its request file, are part of the request rather
   * than of any session, and still go. `withSessionCookies: false` alone keeps
   * its meaning — the jar without the browser's — because it is also what
   * every caller passes for a step that said nothing about cookies.
   */
  async request(req: ApiRequest, opts: HttpRequestOptions): Promise<ApiResponse> {
    const {
      withSessionCookies: askedForSession,
      withoutCookies,
      sessionCookies: suppliedCookies,
      sessionCookiesFor: suppliedFor,
      ...rest
    } = opts;
    const withSessionCookies = askedForSession && withoutCookies !== true;

    const sent = await sendRequest(req, {
      ...(this.options.scope === undefined ? {} : { scope: this.options.scope }),
      ...(this.options.baseUrl === undefined ? {} : { baseUrl: this.options.baseUrl }),
      ...(this.options.cwd === undefined ? {} : { cwd: this.options.cwd }),
      ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
      ...(this.options.lookup === undefined ? {} : { lookup: this.options.lookup }),
      ...rest,
      // The jar under the caller's cookies: a browser's session is the one the
      // step asked to act as.
      sessionCookiesFor: async (url) =>
        withoutCookies === true
          ? {}
          : {
              ...this.cookiesAt(url),
              ...(withSessionCookies ? (suppliedCookies ?? {}) : {}),
              ...(withSessionCookies && suppliedFor !== undefined ? await suppliedFor(url) : {}),
            },
    });

    const response = sent.response;
    this.last = response;
    /*
     * Kept as the URL that answered sets them: after a redirect, that is the
     * host that set them. A call made without cookies keeps none either — an
     * unauthenticated call a server answers with a fresh anonymous session
     * would otherwise replace the signed-in one the next call needs.
     */
    if (withoutCookies !== true) this.keep(sent.setCookies);
    return response;
  }

  /**
   * The cookies this adapter would send to `url`: those a browser holding its
   * jar would send there (REQ-ADP-3).
   */
  async cookies(url: string): Promise<Record<string, string>> {
    return this.cookiesAt(this.resolve(url));
  }

  /**
   * The cookies this adapter would send to a URL — the base URL when none is
   * named — for a paired web session.
   */
  sessionCookies(url?: string): Readonly<Record<string, string>> {
    return this.cookiesAt(url === undefined ? this.options.baseUrl : this.resolve(url));
  }

  private cookiesAt(url: string | undefined): Record<string, string> {
    const matched = jarUrl(url);
    return matched === undefined ? {} : cookiesFor(matched, this.jar);
  }

  /** Store what a response set, replacing a cookie of the same name, domain and path. */
  private keep(cookies: readonly ResponseCookie[]): void {
    let jar = this.jar;
    for (const cookie of cookies) {
      const next = stored(cookie);
      jar = jar.filter((one) => !sameCookie(one, next));
      if (!cookie.expired) jar.push(next);
    }
    this.jar = jar;
  }

  /** The base URL's host, as the jar names it. */
  private baseHost(): string | undefined {
    const url = jarUrl(this.options.baseUrl);
    return url === undefined ? undefined : jarHost(new URL(url).hostname);
  }

  /** A URL made absolute against the base URL, or as it was. */
  private resolve(url: string): string {
    if (this.options.baseUrl === undefined) return url;
    try {
      return new URL(url, this.options.baseUrl).toString();
    } catch {
      return url;
    }
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
