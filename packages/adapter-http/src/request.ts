/**
 * Executing an `ApiRequest` (REQ-ADP-2, REQ-ADP-3, LLD §7.2).
 *
 * The field set mirrors the legacy Java builder, which is what makes `migrate`
 * able to carry an existing project's requests across: method, URL, headers,
 * query and path params, form and JSON bodies, basic auth, cookies, redirects,
 * TLS options, and file upload.
 *
 * ## Cookies, and why they are a parameter rather than a setting
 *
 * REQ-ADP-3: "HTTP calls from a web flow can share the session's cookies or
 * not." Sharing is the useful default for a call that continues what the browser
 * was doing — check the booking the UI just made — and exactly wrong for a call
 * that is meant to be unauthenticated, which is how you test that an endpoint
 * refuses. Neither is right always, so it is per-call (`withSessionCookies`), and
 * the executor supplies the browser's cookies rather than this adapter reaching
 * for them: the HTTP adapter has no idea a browser exists.
 */
import { Buffer } from "node:buffer";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { readFile } from "node:fs/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { basename } from "node:path";
// undici rather than the global `fetch`: constructing a dispatcher is the only
// way to honour `tls.insecure` per request, and mixing undici's Agent with the
// global fetch's types is a type conflict with no runtime meaning. undici is the
// implementation Node's own fetch uses, so nothing behaves differently.
import {
  Agent,
  buildConnector,
  fetch as undiciFetch,
  FormData as UndiciFormData,
  type RequestInit as UndiciRequestInit,
} from "undici";
import type { ApiRequest, ApiResponse } from "@svatah/yam-schema";
import type { StoredCookie } from "@svatah/yam-surface";
import { expand, expandRecord, fillPathParams, type TemplateScope } from "./template.js";

export interface RequestOptions {
  /** What `{…}` in the request reads. */
  readonly scope?: TemplateScope;
  /**
   * Cookies from the paired web session, when the step asked for them
   * (REQ-ADP-3). Supplied by the executor; the adapter never reaches for them.
   */
  readonly sessionCookies?: Readonly<Record<string, string>>;
  /**
   * The cookies to send to this request's URL, asked for with the absolute
   * URL once it is known (REQ-ADP-3).
   *
   * A record of cookies has no host, so whoever supplied one had to guess
   * which request it was for. A browser answers per URL — `AgentSurface.
   * cookies(url)` — and this is how that answer reaches the one request it is
   * right for. Its cookies win over `sessionCookies`; the request's own
   * `cookies` win over both.
   */
  readonly sessionCookiesFor?: (url: string) => Promise<Readonly<Record<string, string>>>;
  /** Resolve a relative URL. `config.app.baseUrl`. */
  readonly baseUrl?: string;
  /** Overrides the request's own `timeoutMs`. */
  readonly timeoutMs?: number;
  /** Files are read relative to this. The project root. */
  readonly cwd?: string;
  /** Injected in tests. */
  readonly fetch?: typeof undiciFetch;
  /**
   * How a hostname becomes addresses; `dns.lookup` otherwise. Injected in
   * tests, so a name that resolves to a link-local address can be refused
   * without a resolver that answers one.
   */
  readonly lookup?: LookupFunction;
}

/** A request as it was sent: the response, the URL asked for, and where it ended. */
export interface SentRequest {
  readonly response: ApiResponse;
  /** The absolute URL the request was sent to. */
  readonly url: string;
  /** The URL that answered, after any redirects; `url` when there were none. */
  readonly finalUrl: string;
  /**
   * The cookies the response set, with their attributes, as `finalUrl` would
   * store them (`parseSetCookie`). `response.cookies` keeps only names and
   * values, which is not enough to know where a cookie may be sent.
   */
  readonly setCookies: readonly ResponseCookie[];
}

const NO_SCOPE: TemplateScope = { read: () => undefined };
const DEFAULT_TIMEOUT_MS = 30_000;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly request: ApiRequest,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Execute one request. */
export async function executeRequest(
  request: ApiRequest,
  options: RequestOptions = {},
): Promise<ApiResponse> {
  return (await sendRequest(request, options)).response;
}

/**
 * Execute one request, and say where it went.
 *
 * `executeRequest` with the URLs kept: a cookie jar scoped by host has to know
 * which host set a cookie, and after a redirect that is the host that
 * answered rather than the one that was asked.
 */
export async function sendRequest(request: ApiRequest, options: RequestOptions = {}): Promise<SentRequest> {
  const scope = options.scope ?? NO_SCOPE;
  const started = performance.now();

  const url = buildUrl(request, scope, options);
  const refused = linkLocalAllowed() ? undefined : refusedDestination(new URL(url).hostname);
  if (refused !== undefined) {
    throw new ApiRequestError(refusalMessage(request, url, refused), request);
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(expandRecord(request.headers, scope) ?? {})) {
    headers.set(name, value);
  }

  if (request.auth !== undefined) {
    const user = expand(request.auth.username, scope);
    const password = expand(request.auth.password, scope);
    headers.set("authorization", `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`);
  }

  let forUrl: Readonly<Record<string, string>> = {};
  if (options.sessionCookiesFor !== undefined) {
    try {
      forUrl = await options.sessionCookiesFor(url);
    } catch (error) {
      throw new ApiRequestError(
        `${request.method} ${url} was not sent: the session's cookies for it could not be read ` +
          `(${error instanceof Error ? error.message : String(error)}).`,
        request,
        error,
      );
    }
  }
  const cookies = {
    ...(options.sessionCookies ?? {}),
    ...forUrl,
    ...(expandRecord(request.cookies, scope) ?? {}),
  };
  if (Object.keys(cookies).length > 0) {
    // The request's own cookies win over the session's: a step that names a
    // cookie is being explicit, and the session is the background.
    headers.set(
      "cookie",
      Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    );
  }

  const body = await buildBody(request, scope, headers, options);
  const dispatcher = dispatcherFor(request, options);

  const init: UndiciRequestInit = {
    method: request.method,
    headers: Object.fromEntries(headers.entries()),
    // `manual` returns the 3xx rather than following it, which is what a test
    // asserting a redirect needs to see.
    redirect: request.followRedirects === false ? "manual" : "follow",
    signal: AbortSignal.timeout(options.timeoutMs ?? request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    ...(body === undefined ? {} : { body }),
    ...(dispatcher === undefined ? {} : { dispatcher }),
  };

  const doFetch = options.fetch ?? undiciFetch;

  let response;
  try {
    response = await doFetch(url, init);
  } catch (error) {
    // Refused at connection time — a name that resolved to a link-local
    // address, or a redirect to one — says why, not "fetch failed".
    const refusal = refusalIn(error);
    if (refusal !== undefined) {
      throw new ApiRequestError(refusalMessage(request, url, refusal.message), request, error);
    }
    throw new ApiRequestError(
      `${request.method} ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
      request,
      error,
    );
  }

  const text = await response.text();
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    responseHeaders[name.toLowerCase()] = value;
  });

  // A response built rather than fetched has no URL of its own.
  const finalUrl = typeof response.url === "string" && response.url !== "" ? response.url : url;
  return {
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: text,
      ...(parseJson(text, responseHeaders["content-type"]) as { json?: unknown }),
      ...(setCookies(response.headers) as { cookies?: Record<string, string> }),
      durationMs: Math.round(performance.now() - started),
    },
    url,
    finalUrl,
    setCookies: (response.headers.getSetCookie?.() ?? [])
      .map((line) => parseSetCookie(line, finalUrl))
      .filter((cookie) => cookie !== undefined),
  };
}

/** The absolute URL a request goes to: templated, path parameters filled, query added. */
export function buildUrl(
  request: ApiRequest,
  scope: TemplateScope,
  options: Pick<RequestOptions, "baseUrl">,
): string {
  const expanded = fillPathParams(expand(request.url, scope), expandRecord(request.pathParams, scope));
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(expanded);
  const base = options.baseUrl?.replace(/\/+$/, "") ?? "";

  if (!absolute && base === "") {
    throw new ApiRequestError(
      `"${request.name}" has a relative URL ("${expanded}") and no base URL is configured. ` +
        "Set `app.baseUrl` in the config, or write the request's URL in full.",
      request,
    );
  }

  const url = new URL(absolute ? expanded : `${base}${expanded.startsWith("/") ? "" : "/"}${expanded}`);
  for (const [name, value] of Object.entries(expandRecord(request.query, scope) ?? {})) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

/**
 * The body, and the `content-type` that goes with it.
 *
 * Four shapes, checked in the order that makes the most specific one win. The
 * content type is only set when the request did not set one itself, because a
 * request that says `content-type: application/vnd.api+json` means it.
 */
async function buildBody(
  request: ApiRequest,
  scope: TemplateScope,
  headers: Headers,
  options: RequestOptions,
): Promise<string | UndiciFormData | undefined> {
  const setTypeIfUnset = (value: string): void => {
    if (!headers.has("content-type")) headers.set("content-type", value);
  };

  if (request.files !== undefined && Object.keys(request.files).length > 0) {
    // Multipart: `fetch` sets the boundary itself, so any content-type the
    // caller set has to go — a boundary-less multipart header is unparseable.
    headers.delete("content-type");
    const form = new UndiciFormData();
    for (const [field, value] of Object.entries(expandRecord(request.form, scope) ?? {})) {
      form.set(field, value);
    }
    for (const [field, path] of Object.entries(request.files)) {
      const resolved = expand(path, scope);
      const contents = await readFile(
        options.cwd === undefined ? resolved : `${options.cwd}/${resolved}`,
      );
      // `File` is global from Node 20 and is what undici's FormData accepts; the
      // cast bridges @types/node's copy of the undici types and undici's own.
      form.set(field, new File([contents], basename(resolved)) as unknown as Blob, basename(resolved));
    }
    return form;
  }

  if (request.json !== undefined) {
    setTypeIfUnset("application/json");
    return JSON.stringify(expandJson(request.json, scope));
  }

  if (request.form !== undefined) {
    setTypeIfUnset("application/x-www-form-urlencoded");
    return new URLSearchParams(expandRecord(request.form, scope)).toString();
  }

  if (request.body !== undefined) {
    setTypeIfUnset("text/plain; charset=utf-8");
    return expand(request.body, scope);
  }

  return undefined;
}

/** Expand `{…}` in every string of a JSON body, at any depth. */
function expandJson(value: unknown, scope: TemplateScope): unknown {
  if (typeof value === "string") return expand(value, scope);
  if (Array.isArray(value)) return value.map((item) => expandJson(item, scope));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        expandJson(item, scope),
      ]),
    );
  }
  return value;
}

/* ── destinations this adapter does not send to ───────────────────────────── */

/** Set to `1` to let requests reach link-local and metadata addresses. */
export const ALLOW_LINK_LOCAL_ENV = "YAM_HTTP_ALLOW_LINK_LOCAL";

/**
 * Link-local addresses, and the cloud metadata services that live on them.
 *
 * A request file, a flow, and an agent driving `yam surface request` can all
 * name any URL, and `http://169.254.169.254/` is where AWS, Azure and GCP hand
 * an instance its credentials to whoever asks from inside it; `fd00:ec2::254`
 * is AWS's IPv6 address for the same service, and `metadata.google.internal`
 * is GCP's name for it. Yam running on a CI runner or a cloud workstation
 * would fetch those for anybody who could write a request. Nothing Yam tests
 * lives there.
 *
 * The list stopped at the link-local ranges and one AWS address, and cloud
 * platforms put the same kind of service elsewhere too:
 *
 * - `fd00:ec2::/64`, the whole AWS range rather than its one address: EKS Pod
 *   Identity answers credentials on `fd00:ec2::23`, next to IMDS on `::254`.
 * - `100.100.100.200`, Alibaba Cloud's metadata service, inside the carrier-
 *   grade NAT range, which is not refused as a whole: it is ordinary address
 *   space on some private networks.
 * - `168.63.129.16`, Azure's WireServer, which hands a VM its extension
 *   configuration and, with it, secrets.
 * - `64:ff9b::/96`, the NAT64 prefix, which is not refused but unwrapped: on
 *   an IPv6-only network `64:ff9b::a9fe:a9fe` is `169.254.169.254` through the
 *   translator, and it is judged as the address it carries.
 *
 * Loopback and the private ranges are deliberately *not* here: the application
 * on `localhost:3000` and the staging service on `10.0.4.12` are the main
 * thing Yam tests, and refusing them would refuse Yam's own job.
 */
const LINK_LOCAL = new BlockList();
LINK_LOCAL.addSubnet("169.254.0.0", 16, "ipv4");
LINK_LOCAL.addSubnet("fe80::", 10, "ipv6");
const METADATA_ADDRESSES = new BlockList();
METADATA_ADDRESSES.addSubnet("fd00:ec2::", 64, "ipv6");
METADATA_ADDRESSES.addAddress("100.100.100.200", "ipv4");
METADATA_ADDRESSES.addAddress("168.63.129.16", "ipv4");
const METADATA_HOSTNAMES = new Set(["metadata.google.internal"]);
const NAT64 = new BlockList();
NAT64.addSubnet("64:ff9b::", 96, "ipv6");

function linkLocalAllowed(): boolean {
  return process.env[ALLOW_LINK_LOCAL_ENV] === "1";
}

/**
 * Why a hostname or address is refused, or `undefined` when it is not.
 *
 * `BlockList` matches an IPv4-mapped IPv6 address against the IPv4 subnet, so
 * `[::ffff:169.254.169.254]` is refused with the address it spells; and the
 * URL parser has already turned `0xA9FEA9FE` and its friends into dotted form
 * before this sees them. A NAT64 address is judged by the IPv4 address in its
 * last 32 bits.
 */
export function refusedDestination(hostname: string): string | undefined {
  const bare = hostname
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (METADATA_HOSTNAMES.has(bare)) return `${bare} is a cloud metadata service`;
  const family = isIP(bare);
  if (family === 0) return undefined;
  const type = family === 4 ? "ipv4" : "ipv6";
  if (type === "ipv6" && NAT64.check(bare, "ipv6")) {
    const embedded = embeddedIpv4(bare);
    const refused = embedded === undefined ? undefined : refusedDestination(embedded);
    return refused === undefined ? undefined : `${bare} is NAT64 for ${embedded}, and ${refused}`;
  }
  if (LINK_LOCAL.check(bare, type)) return `${bare} is a link-local address, where cloud metadata services live`;
  if (METADATA_ADDRESSES.check(bare, type)) return `${bare} is a cloud metadata or platform service address`;
  return undefined;
}

/**
 * The IPv4 address in the last 32 bits of an IPv6 address, dotted.
 *
 * `address` has already passed `isIP` as IPv6, so it is well formed: at most
 * one `::`, and a dotted tail only in the last position.
 */
function embeddedIpv4(address: string): string | undefined {
  // A dotted tail (`64:ff9b::169.254.169.254`) is already the answer's spelling.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (dotted !== null) return dotted[1];
  const [before = "", after] = address.split("::");
  const head = before === "" ? [] : before.split(":");
  const tail = after === undefined || after === "" ? [] : after.split(":");
  const groups = [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail];
  const high = parseInt(groups[6] ?? "", 16);
  const low = parseInt(groups[7] ?? "", 16);
  if (groups.length !== 8 || Number.isNaN(high) || Number.isNaN(low)) return undefined;
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/** A refusal made while connecting, carried through undici's `fetch failed` as its cause. */
class DestinationRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DestinationRefused";
  }
}

function refusalIn(error: unknown): DestinationRefused | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (current instanceof DestinationRefused) return current;
    current = current.cause;
  }
  return undefined;
}

function refusalMessage(request: ApiRequest, url: string, why: string): string {
  return (
    `${request.method} ${url} was refused: ${why}. Yam does not send requests to link-local ` +
    `addresses or cloud metadata and platform services; set ${ALLOW_LINK_LOCAL_ENV}=1 to allow them.`
  );
}

/**
 * A lookup that refuses a name resolving to a refused address.
 *
 * Checking the URL's hostname is not enough on its own: any name can be made
 * to resolve to `169.254.169.254`. The check is made on the addresses the
 * connection will actually use, every one of them, since the socket may try
 * any. Node asks with `all: true` when it races address families, and with
 * `all` unset otherwise; both are answered.
 */
function guardedLookup(base: LookupFunction): LookupFunction {
  return (hostname, options, callback) => {
    base(hostname, { ...options, all: true }, (error, addresses, family) => {
      if (error !== null) {
        callback(error, "");
        return;
      }
      const list: LookupAddress[] = Array.isArray(addresses)
        ? addresses
        : [{ address: addresses, family: family ?? isIP(addresses) }];
      for (const one of list) {
        const refused = refusedDestination(one.address);
        if (refused !== undefined) {
          callback(new DestinationRefused(`${hostname} resolves to ${one.address}: ${refused}`), "");
          return;
        }
      }
      if (options.all === true) callback(null, list);
      else if (list[0] === undefined) callback(null, "");
      else callback(null, list[0].address, list[0].family);
    });
  };
}

/** The agents made so far, one per combination; see `dispatcherFor`. */
const agents = new Map<string, Agent>();
const agentsByLookup = new WeakMap<LookupFunction, Map<string, Agent>>();
const DEFAULT_LOOKUP = dnsLookup as unknown as LookupFunction;

/**
 * The dispatcher a request is sent through: the destination guard, with TLS
 * options merged into the same connector.
 *
 * `insecure` is here because internal environments have self-signed
 * certificates and a test suite that cannot reach staging is not a test suite.
 * It is per-request rather than global so that turning it on for one internal
 * endpoint does not turn it on for everything.
 *
 * The guard is in the connector rather than only before `fetch`, because a
 * connection is where a hostname becomes an address — and where a redirect's
 * `Location` is connected to, which no check of the first URL sees. Node does
 * not call `lookup` for an IP literal, so the connector checks the host it is
 * handed as well. Agents are kept, one per combination, rather than made per
 * request: each holds a connection pool, and a pool per request is a pool
 * nobody closes.
 */
function dispatcherFor(request: ApiRequest, options: RequestOptions): Agent | undefined {
  const insecure = request.tls?.insecure === true;
  const guarded = !linkLocalAllowed();
  // Opted out, secure, and no lookup of its own: undici's global dispatcher, as before.
  if (!guarded && !insecure && options.lookup === undefined) return undefined;

  const lookup = options.lookup ?? DEFAULT_LOOKUP;
  let cache = agents;
  if (options.lookup !== undefined) {
    cache = agentsByLookup.get(options.lookup) ?? new Map<string, Agent>();
    agentsByLookup.set(options.lookup, cache);
  }
  const key = `${insecure ? "insecure" : "verified"}:${guarded ? "guarded" : "open"}`;
  const existing = cache.get(key);
  if (existing !== undefined) return existing;

  const tls = insecure ? { rejectUnauthorized: false } : {};
  let agent: Agent;
  if (guarded) {
    const connector = buildConnector({ ...tls, lookup: guardedLookup(lookup) });
    agent = new Agent({
      connect: (target, callback) => {
        const refused = refusedDestination(target.hostname);
        if (refused !== undefined) {
          callback(new DestinationRefused(refused), null);
          return;
        }
        connector(target, callback);
      },
    });
  } else {
    agent = new Agent({ connect: { ...tls, lookup } });
  }
  cache.set(key, agent);
  return agent;
}

/** The parsed body, when it is JSON. A body that says it is JSON and is not is
 * not an error here: the status and the text are still the answer. */
function parseJson(text: string, contentType: string | undefined): { json?: unknown } {
  if (text === "") return {};
  const looksJson =
    contentType !== undefined && /\bjson\b/i.test(contentType)
      ? true
      : /^\s*[[{]/.test(text);
  if (!looksJson) return {};
  try {
    return { json: JSON.parse(text) as unknown };
  } catch {
    return {};
  }
}

/** Cookies the response set, so a following request can carry them. */
function setCookies(headers: Headers): { cookies?: Record<string, string> } {
  const raw = headers.getSetCookie?.() ?? [];
  if (raw.length === 0) return {};
  const cookies: Record<string, string> = {};
  for (const line of raw) {
    const pair = line.split(";")[0] ?? "";
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    cookies[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  return Object.keys(cookies).length === 0 ? {} : { cookies };
}

/** A cookie a response set: what a jar stores, and whether it was a deletion. */
export interface ResponseCookie extends StoredCookie {
  /** `Max-Age` of zero or less, or an `Expires` already past: remove, do not store. */
  readonly expired: boolean;
}

/**
 * One `Set-Cookie` line, as a browser would store it for the response from
 * `url` (RFC 6265 §5.2, §5.3; REQ-ADP-3) — or `undefined` for a cookie a
 * browser would ignore.
 *
 * The jar kept only a name and a value, so `Domain` was lost: a sign-in at
 * `auth.example.com` setting `sid; Domain=example.com` was never sent to
 * `api.example.com`, as a browser would send it. What a jar needs to decide
 * where a cookie goes is read here:
 *
 * - **Domain.** Absent, the cookie is host-only: its domain is the host, with
 *   no leading dot. Present, it is stored with a leading dot and goes to the
 *   domain and its subdomains — if the host is that domain or inside it. A
 *   `Domain` the host does not match is a response setting a cookie for
 *   somebody else, and the whole cookie is ignored, as a browser ignores it.
 *   A single-label domain (`com`, `localhost`) and an IP address stand in for
 *   the public suffix list this does not carry: a host-only cookie when they
 *   name the host, ignored when they do not. A multi-label public suffix
 *   (`co.uk`) is not recognised, so a host under one can set a cookie for its
 *   siblings; nothing Yam tests is expected to try.
 * - **Path.** Absent, or not starting with `/`, the directory of the URL's
 *   path (`/api/login` gives `/api`), which is where a browser would scope it.
 * - **Secure.** Kept, so the cookie goes only over `https:`.
 * - **Max-Age**, then **Expires.** Only whether the cookie is already expired,
 *   which is how a server deletes one. A jar lives for a run, so a future
 *   expiry is not kept.
 */
export function parseSetCookie(line: string, url: string): ResponseCookie | undefined {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return undefined;
  }
  const [pair = "", ...attributes] = line.split(";");
  const at = pair.indexOf("=");
  if (at <= 0) return undefined;
  const name = pair.slice(0, at).trim();
  const value = pair.slice(at + 1).trim();
  if (name === "") return undefined;

  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  let domainAttribute: string | undefined;
  let pathAttribute: string | undefined;
  let secure = false;
  let maxAge: number | undefined;
  let expires: number | undefined;
  for (const attribute of attributes) {
    const equals = attribute.indexOf("=");
    const key = (equals < 0 ? attribute : attribute.slice(0, equals)).trim().toLowerCase();
    const argument = equals < 0 ? "" : attribute.slice(equals + 1).trim();
    if (key === "domain" && argument !== "") {
      domainAttribute = argument.replace(/^\./, "").toLowerCase();
    } else if (key === "path") {
      pathAttribute = argument.startsWith("/") ? argument : undefined;
    } else if (key === "secure") {
      secure = true;
    } else if (key === "max-age" && /^-?\d+$/.test(argument)) {
      maxAge = Number(argument);
    } else if (key === "expires") {
      const parsed = Date.parse(argument);
      if (!Number.isNaN(parsed)) expires = parsed;
    }
  }

  let domain = host;
  if (domainAttribute !== undefined && domainAttribute !== host) {
    const insideIt = host.endsWith(`.${domainAttribute}`) && isIP(host) === 0;
    if (!insideIt || !domainAttribute.includes(".")) return undefined;
    domain = `.${domainAttribute}`;
  } else if (domainAttribute !== undefined && isIP(host) === 0 && domainAttribute.includes(".")) {
    domain = `.${domainAttribute}`;
  }

  const expired = maxAge !== undefined ? maxAge <= 0 : expires !== undefined && expires <= Date.now();
  return {
    name,
    value,
    domain,
    path: pathAttribute ?? defaultPath(target.pathname),
    ...(secure ? { secure: true } : {}),
    expired,
  };
}

/** RFC 6265 §5.1.4: the URL's path up to, not including, its last `/`; `/` at the top. */
function defaultPath(pathname: string): string {
  if (!pathname.startsWith("/")) return "/";
  const last = pathname.lastIndexOf("/");
  return last <= 0 ? "/" : pathname.slice(0, last);
}
