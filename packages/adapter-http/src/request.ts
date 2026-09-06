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
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
// undici rather than the global `fetch`: constructing a dispatcher is the only
// way to honour `tls.insecure` per request, and mixing undici's Agent with the
// global fetch's types is a type conflict with no runtime meaning. undici is the
// implementation Node's own fetch uses, so nothing behaves differently.
import {
  Agent,
  fetch as undiciFetch,
  FormData as UndiciFormData,
  type RequestInit as UndiciRequestInit,
} from "undici";
import type { ApiRequest, ApiResponse } from "@svatah/yam-schema";
import { expand, expandRecord, fillPathParams, type TemplateScope } from "./template.js";

export interface RequestOptions {
  /** What `{…}` in the request reads. */
  readonly scope?: TemplateScope;
  /**
   * Cookies from the paired web session, when the step asked for them
   * (REQ-ADP-3). Supplied by the executor; the adapter never reaches for them.
   */
  readonly sessionCookies?: Readonly<Record<string, string>>;
  /** Resolve a relative URL. `config.app.baseUrl`. */
  readonly baseUrl?: string;
  /** Overrides the request's own `timeoutMs`. */
  readonly timeoutMs?: number;
  /** Files are read relative to this. The project root. */
  readonly cwd?: string;
  /** Injected in tests. */
  readonly fetch?: typeof undiciFetch;
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
  const scope = options.scope ?? NO_SCOPE;
  const started = performance.now();

  const url = buildUrl(request, scope, options);
  const headers = new Headers();
  for (const [name, value] of Object.entries(expandRecord(request.headers, scope) ?? {})) {
    headers.set(name, value);
  }

  if (request.auth !== undefined) {
    const user = expand(request.auth.username, scope);
    const password = expand(request.auth.password, scope);
    headers.set("authorization", `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`);
  }

  const cookies = { ...(options.sessionCookies ?? {}), ...(expandRecord(request.cookies, scope) ?? {}) };
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

  const init: UndiciRequestInit = {
    method: request.method,
    headers: Object.fromEntries(headers.entries()),
    // `manual` returns the 3xx rather than following it, which is what a test
    // asserting a redirect needs to see.
    redirect: request.followRedirects === false ? "manual" : "follow",
    signal: AbortSignal.timeout(options.timeoutMs ?? request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    ...(body === undefined ? {} : { body }),
    ...(dispatcherFor(request) === undefined ? {} : { dispatcher: dispatcherFor(request) }),
  };

  const doFetch = options.fetch ?? undiciFetch;

  let response;
  try {
    response = await doFetch(url, init);
  } catch (error) {
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

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: text,
    ...(parseJson(text, responseHeaders["content-type"]) as { json?: unknown }),
    ...(setCookies(response.headers) as { cookies?: Record<string, string> }),
    durationMs: Math.round(performance.now() - started),
  };
}

function buildUrl(request: ApiRequest, scope: TemplateScope, options: RequestOptions): string {
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

/**
 * TLS options, as an undici dispatcher.
 *
 * `insecure` is here because internal environments have self-signed
 * certificates and a test suite that cannot reach staging is not a test suite.
 * It is per-request rather than global so that turning it on for one internal
 * endpoint does not turn it on for everything.
 */
function dispatcherFor(request: ApiRequest): Agent | undefined {
  const tls = request.tls;
  if (tls === undefined) return undefined;
  const connect: Record<string, unknown> = {};
  if (tls.insecure === true) connect["rejectUnauthorized"] = false;
  if (Object.keys(connect).length === 0) return undefined;
  return new Agent({ connect });
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
