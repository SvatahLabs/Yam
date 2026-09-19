/**
 * T2.6 — the request field matrix (REQ-ADP-2, LLD §7.2).
 *
 * Validate: "Field matrix against a local server; cookie-sharing test."
 *
 * Against a real server rather than a mocked `fetch`, so what is asserted is the
 * request that actually went out. A mock can only tell you what the adapter
 * *called it with*, which is the same thing right up until it is not.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { isIP, type LookupFunction } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApiRequest } from "@svatah/yam-schema";
import {
  ALLOW_LINK_LOCAL_ENV,
  ApiRequestError,
  executeRequest,
  HttpSurface,
  parseSetCookie,
  refusedDestination,
  type RequestOptions,
} from "../src/index.js";
import { startEchoServer, type EchoServer } from "./server.js";

let app: EchoServer;
beforeAll(async () => {
  app = await startEchoServer();
});
afterAll(async () => {
  await app.close();
});

const request = (parts: Partial<ApiRequest> & { name?: string }): ApiRequest =>
  ({ name: "test", method: "GET", url: "/echo", ...parts }) as ApiRequest;

interface Echo {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
}

const echo = async (parts: Partial<ApiRequest>, options = {}): Promise<Echo> => {
  const response = await executeRequest(request(parts), { baseUrl: app.origin, ...options });
  return response.json as Echo;
};

describe("the field matrix (REQ-ADP-2)", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const)(
    "sends %s",
    async (method) => {
      const response = await executeRequest(request({ method }), { baseUrl: app.origin });
      expect(response.status).toBe(200);
      // HEAD has no body to echo, so the method is checked by the status alone.
      if (method !== "HEAD") expect((response.json as Echo).method).toBe(method);
    },
  );

  it("resolves a relative URL against the base URL", async () => {
    expect((await echo({ url: "/echo" })).path).toBe("/echo");
  });

  it("takes an absolute URL as it stands", async () => {
    expect((await echo({ url: `${app.origin}/echo` })).path).toBe("/echo");
  });

  it("says so when a relative URL has no base to resolve against", async () => {
    // The message has to name both halves: someone reading it does not know
    // whether the request or the config is the thing to fix.
    await expect(executeRequest(request({ url: "/echo" }))).rejects.toThrow(/base URL is configured/);
  });

  it("sends headers", async () => {
    const result = await echo({ headers: { "x-run": "42", accept: "application/json" } });
    expect(result.headers["x-run"]).toBe("42");
  });

  it("sends query parameters", async () => {
    expect((await echo({ query: { page: "2", q: "a b" } })).query).toEqual({ page: "2", q: "a b" });
  });

  it("fills path parameters, in both spellings", async () => {
    expect((await echo({ url: "/orders/:id", pathParams: { id: "42" } })).path).toBe("/orders/42");
    expect((await echo({ url: "/orders/{id}", pathParams: { id: "42" } })).path).toBe("/orders/42");
  });

  it("percent-encodes a path parameter, so a value cannot change the route", async () => {
    expect((await echo({ url: "/orders/:id", pathParams: { id: "a/b" } })).path).toBe("/orders/a%2Fb");
  });

  it("sends a form body with the form content type", async () => {
    const result = await echo({ method: "POST", form: { user: "atul", pw: "x y" } });
    expect(result.headers["content-type"]).toContain("application/x-www-form-urlencoded");
    expect(result.body).toBe("user=atul&pw=x+y");
  });

  it("sends a JSON body with the JSON content type", async () => {
    const result = await echo({ method: "POST", json: { a: 1, b: ["x"] } });
    expect(result.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(result.body)).toEqual({ a: 1, b: ["x"] });
  });

  it("leaves a content type the request set alone", async () => {
    // `application/vnd.api+json` is a deliberate choice, not an oversight.
    const result = await echo({
      method: "POST",
      json: { a: 1 },
      headers: { "content-type": "application/vnd.api+json" },
    });
    expect(result.headers["content-type"]).toBe("application/vnd.api+json");
  });

  it("sends a raw body", async () => {
    const result = await echo({ method: "POST", body: "plain words" });
    expect(result.body).toBe("plain words");
    expect(result.headers["content-type"]).toContain("text/plain");
  });

  it("sends basic auth", async () => {
    const result = await echo({ auth: { kind: "basic", username: "atul", password: "hunter2" } });
    expect(result.headers["authorization"]).toBe(
      `Basic ${Buffer.from("atul:hunter2").toString("base64")}`,
    );
  });

  it("sends cookies the request declares", async () => {
    expect((await echo({ cookies: { a: "1", b: "2" } })).headers["cookie"]).toBe("a=1; b=2");
  });

  it("uploads a file as multipart, with the field name and the file name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-http-"));
    writeFileSync(join(dir, "summary.pdf"), "%PDF-1.4 pretend");

    const result = await echo(
      { method: "POST", files: { report: "summary.pdf" }, form: { note: "monthly" } },
      { cwd: dir },
    );
    expect(result.headers["content-type"]).toContain("multipart/form-data");
    expect(result.headers["content-type"]).toContain("boundary=");
    expect(result.body).toContain('name="report"');
    expect(result.body).toContain('filename="summary.pdf"');
    expect(result.body).toContain("%PDF-1.4 pretend");
    expect(result.body).toContain('name="note"');
  });

  it("follows a redirect by default and returns the 3xx when told not to", async () => {
    const followed = await executeRequest(request({ url: "/redirect" }), { baseUrl: app.origin });
    expect(followed.status).toBe(200);

    const stopped = await executeRequest(request({ url: "/redirect", followRedirects: false }), {
      baseUrl: app.origin,
    });
    expect(stopped.status).toBe(302);
    expect(stopped.headers["location"]).toBe("/echo");
  });

  it("times out rather than hanging", async () => {
    await expect(
      executeRequest(request({ url: "/slow", timeoutMs: 50 }), { baseUrl: app.origin }),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("lets the caller override the request's own timeout", async () => {
    await expect(
      executeRequest(request({ url: "/slow", timeoutMs: 60_000 }), {
        baseUrl: app.origin,
        timeoutMs: 50,
      }),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("wraps a transport failure with the method and the URL", async () => {
    // "fetch failed" alone tells you nothing about which of forty requests it was.
    await expect(
      executeRequest(request({ url: "http://127.0.0.1:1/nothing" })),
    ).rejects.toThrow(/GET http:\/\/127\.0\.0\.1:1\/nothing failed/);
  });
});

describe("the response (REQ-ADP-2)", () => {
  it("carries status, headers, body, parsed JSON and a duration", async () => {
    const response = await executeRequest(request({ url: "/items" }), { baseUrl: app.origin });
    expect(response.status).toBe(200);
    expect(response.statusText).toBe("OK");
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toContain("activeCount");
    expect((response.json as { activeCount: number }).activeCount).toBe(3);
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("leaves `json` off a response that is not JSON", async () => {
    const response = await executeRequest(request({ url: "/text" }), { baseUrl: app.origin });
    expect(response.json).toBeUndefined();
    expect(response.body).toBe("just text");
  });

  it("does not throw on a 4xx: the status is the answer", async () => {
    // An endpoint that refuses is a thing a test asserts, not a transport error.
    const response = await executeRequest(request({ url: "/status/418" }), { baseUrl: app.origin });
    expect(response.status).toBe(418);
    expect((response.json as { error: string }).error).toBe("teapot");
  });

  it("reads the cookies the response set", async () => {
    const response = await executeRequest(request({ url: "/login" }), { baseUrl: app.origin });
    expect(response.cookies).toEqual({ session: "abc123", theme: "dark" });
  });
});

describe("templating (LLD §7.2)", () => {
  const scope = {
    read: (reference: string) =>
      ({ "data.baseUrl": "/echo", "data.user.email": "a@b.c", token: "t-1" })[reference],
  };

  it("expands references in the URL, headers, query, form and JSON body", async () => {
    const result = await echo(
      {
        method: "POST",
        url: "{data.baseUrl}",
        headers: { "x-token": "{token}" },
        query: { who: "{data.user.email}" },
        json: { email: "{data.user.email}", nested: { t: "{token}" } },
      },
      { scope },
    );
    expect(result.path).toBe("/echo");
    expect(result.headers["x-token"]).toBe("t-1");
    expect(result.query["who"]).toBe("a@b.c");
    expect(JSON.parse(result.body)).toEqual({ email: "a@b.c", nested: { t: "t-1" } });
  });

  it("leaves a reference nothing defines as it was written", async () => {
    // Substituting an empty string would send a request that looks fine and is
    // wrong; leaving the braces makes the mistake visible in the echo.
    const result = await echo({ headers: { "x-a": "{nope}" } }, { scope });
    expect(result.headers["x-a"]).toBe("{nope}");
  });
});

describe("cookie sharing (REQ-ADP-3)", () => {
  it("carries the paired session's cookies when the step asked for them", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin });
    const response = await surface.request(request({ url: "/echo" }), {
      withSessionCookies: true,
      sessionCookies: { session: "from-browser" },
    });
    expect((response.json as Echo).headers["cookie"]).toContain("session=from-browser");
  });

  it("does not, when it did not", async () => {
    // This is how a flow tests that an endpoint refuses an unauthenticated call
    // — the case that is impossible if sharing is a global setting.
    const surface = new HttpSurface({ baseUrl: app.origin });
    const response = await surface.request(request({ url: "/echo" }), {
      withSessionCookies: false,
      sessionCookies: { session: "from-browser" },
    });
    expect((response.json as Echo).headers["cookie"]).toBeUndefined();
  });

  it("keeps its own jar across requests, so a login is not forgotten", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin });
    await surface.request(request({ url: "/login" }), { withSessionCookies: false });
    expect(surface.sessionCookies()).toEqual({ session: "abc123", theme: "dark" });

    const next = await surface.request(request({ url: "/echo" }), { withSessionCookies: false });
    expect((next.json as Echo).headers["cookie"]).toContain("session=abc123");
  });

  it("lets the request's own cookie win over the session's", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin });
    const response = await surface.request(request({ url: "/echo", cookies: { session: "mine" } }), {
      withSessionCookies: true,
      sessionCookies: { session: "theirs" },
    });
    expect((response.json as Echo).headers["cookie"]).toBe("session=mine");
  });

  it("restores a saved jar, which is the whole of this adapter's session state", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin });
    await surface.request(request({ url: "/login" }), { withSessionCookies: false });
    const saved = await surface.state();

    const fresh = new HttpSurface({ baseUrl: app.origin });
    await fresh.restore(saved);
    expect(fresh.sessionCookies()).toEqual({ session: "abc123", theme: "dark" });
  });

  /*
   * The jar was one flat record sent with every request to any host, so the
   * session cookie application A set went to whatever absolute URL was named
   * next. `other.test` is the same echo server under another name, which is
   * the case that matters: the only thing different is the host.
   */
  it("sends a response's cookies back only to the host that set them", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin, lookup: resolving({ "other.test": "127.0.0.1" }) });
    await surface.request(request({ url: "/login" }), { withSessionCookies: false });

    const same = await surface.request(request({ url: "/echo" }), { withSessionCookies: false });
    expect((same.json as Echo).headers["cookie"]).toContain("session=abc123");

    const other = await surface.request(request({ url: `http://other.test:${app.port}/echo` }), {
      withSessionCookies: false,
    });
    expect((other.json as Echo).path).toBe("/echo");
    expect((other.json as Echo).headers["cookie"]).toBeUndefined();
    expect(surface.sessionCookies(`http://other.test:${app.port}/`)).toEqual({});
    expect(await surface.cookies(`${app.origin}/anything`)).toEqual({ session: "abc123", theme: "dark" });
  });

  it("keeps cookies under the host that answered, after a redirect to another", async () => {
    const surface = new HttpSurface({ lookup: resolving({ "first.test": "127.0.0.1" }) });
    const to = encodeURIComponent(`${app.origin}/login`);
    await surface.request(request({ url: `http://first.test:${app.port}/redirect-to?to=${to}` }), {
      withSessionCookies: false,
    });
    expect(surface.sessionCookies(`${app.origin}/`)).toEqual({ session: "abc123", theme: "dark" });
    expect(surface.sessionCookies(`http://first.test:${app.port}/`)).toEqual({});
  });

  /*
   * `withSessionCookies` did nothing: the adapter's own jar went either way
   * and nothing else was ever supplied. The browser answers per URL, so it is
   * asked with the request's absolute URL — and not asked at all when the
   * step said to leave the session's cookies out.
   */
  it("asks for the session's cookies for this request's own URL, and only when told to", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin });
    const asked: string[] = [];
    const sessionCookiesFor = async (url: string): Promise<Record<string, string>> => {
      asked.push(url);
      return { browser_session: "signed-in" };
    };

    const withThem = await surface.request(request({ url: "/echo", query: { page: "2" } }), {
      withSessionCookies: true,
      sessionCookiesFor,
    });
    expect((withThem.json as Echo).headers["cookie"]).toBe("browser_session=signed-in");
    expect(asked).toEqual([`${app.origin}/echo?page=2`]);

    const without = await surface.request(request({ url: "/echo" }), {
      withSessionCookies: false,
      sessionCookiesFor,
    });
    expect((without.json as Echo).headers["cookie"]).toBeUndefined();
    expect(asked).toHaveLength(1);
  });

  it("restores the jar a state saved before it was scoped by host, as the base URL's", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin, lookup: resolving({ "other.test": "127.0.0.1" }) });
    await surface.restore({ kind: "http", storageState: JSON.stringify({ cookies: { session: "old" } }) });
    expect(surface.sessionCookies()).toEqual({ session: "old" });

    const home = await surface.request(request({ url: "/echo" }), { withSessionCookies: false });
    expect((home.json as Echo).headers["cookie"]).toBe("session=old");
    const other = await surface.request(request({ url: `http://other.test:${app.port}/echo` }), {
      withSessionCookies: false,
    });
    expect((other.json as Echo).headers["cookie"]).toBeUndefined();

    // And what it saves now comes back by host.
    const fresh = new HttpSurface();
    await fresh.restore(await surface.state());
    expect(await fresh.cookies(`${app.origin}/`)).toEqual({ session: "old" });
  });
});

/*
 * The jar as a browser keeps it (REQ-ADP-3).
 *
 * A jar per hostname stopped cookies leaking to other hosts and ignored
 * `Domain`, so a sign-in at `auth.example.test` setting a cookie for
 * `example.test` was never sent to `api.example.test` — which the flat jar
 * before it did, and a browser does. Every name here is the echo server under
 * another name, so the only thing that differs is the host.
 */
describe("the jar keeps a cookie's attributes (REQ-ADP-3)", () => {
  const names = resolving({
    "auth.example.test": "127.0.0.1",
    "api.example.test": "127.0.0.1",
    "example.test": "127.0.0.1",
    "elsewhere.test": "127.0.0.1",
    localhost: "127.0.0.1",
  });
  const at = (host: string, path: string): ApiRequest => request({ url: `http://${host}:${app.port}${path}` });
  /** A path on the echo server that sets each of `lines` as a cookie. */
  const setsCookies = (path: string, ...lines: string[]): string =>
    `${path}?${lines.map((line) => `c=${encodeURIComponent(line)}`).join("&")}`;
  const setting = (host: string, path: string, ...lines: string[]): ApiRequest =>
    request({ url: `http://${host}:${app.port}${setsCookies(path, ...lines)}` });
  const cookieHeader = async (surface: HttpSurface, req: ApiRequest): Promise<string | undefined> =>
    ((await surface.request(req, { withSessionCookies: false })).json as Echo).headers["cookie"];

  it("sends a Domain cookie to a sibling subdomain, and a host-only one to its host alone", async () => {
    const surface = new HttpSurface({ lookup: names });
    await surface.request(
      setting("auth.example.test", "/set-cookie", "sid=s1; Domain=example.test; Path=/", "local=l1; Path=/"),
      { withSessionCookies: false },
    );

    expect(await cookieHeader(surface, at("api.example.test", "/echo"))).toBe("sid=s1");
    expect(await cookieHeader(surface, at("example.test", "/echo"))).toBe("sid=s1");
    expect(await cookieHeader(surface, at("auth.example.test", "/echo"))).toBe("sid=s1; local=l1");
    expect(await cookieHeader(surface, at("elsewhere.test", "/echo"))).toBeUndefined();
  });

  it("ignores a cookie whose Domain the answering host is not in, as a browser does", async () => {
    const surface = new HttpSurface({ lookup: names });
    await surface.request(
      setting("auth.example.test", "/set-cookie", "stolen=x; Domain=elsewhere.test", "tld=y; Domain=test"),
      { withSessionCookies: false },
    );
    expect(await cookieHeader(surface, at("elsewhere.test", "/echo"))).toBeUndefined();
    expect(await cookieHeader(surface, at("auth.example.test", "/echo"))).toBeUndefined();
    expect(await surface.state()).toEqual({ kind: "http" });
  });

  it("matches a path at a slash, defaults it to the URL's directory, and keeps Secure to https", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin });
    await surface.request(
      request({ url: setsCookies("/api/set-cookie", "admin=a; Path=/admin", "api=b", "safe=c; Path=/; Secure") }),
      { withSessionCookies: false },
    );

    expect(await cookieHeader(surface, request({ url: "/admin/users" }))).toBe("admin=a");
    expect(await cookieHeader(surface, request({ url: "/administrator" }))).toBeUndefined();
    expect(await cookieHeader(surface, request({ url: "/api/items" }))).toBe("api=b");
    expect(await cookieHeader(surface, request({ url: "/apiary" }))).toBeUndefined();
    // Not over plain http; it is in the jar for an https URL on the same host.
    expect(await surface.cookies(`https://127.0.0.1:${app.port}/`)).toEqual({ safe: "c" });
  });

  it("deletes a cookie a response expires, and replaces one set again", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin });
    await surface.request(request({ url: setsCookies("/set-cookie", "a=1; Path=/", "b=1; Path=/") }), {
      withSessionCookies: false,
    });
    await surface.request(request({ url: setsCookies("/set-cookie", "a=; Path=/; Max-Age=0", "b=2; Path=/") }), {
      withSessionCookies: false,
    });
    expect(surface.sessionCookies()).toEqual({ b: "2" });
  });

  /*
   * `app.baseUrl: http://localhost:3000` and a request file naming
   * `http://127.0.0.1:3000/…` are the same server, and a browser's split
   * between the two names lost the sign-in between them.
   */
  it("treats localhost, 127.0.0.1 and ::1 as one host, and nothing else as it", async () => {
    const surface = new HttpSurface({ baseUrl: `http://localhost:${app.port}`, lookup: names });
    await surface.request(request({ url: "/login" }), { withSessionCookies: false });

    expect(await cookieHeader(surface, at("127.0.0.1", "/echo"))).toBe("session=abc123; theme=dark");
    expect(await surface.cookies(`http://[::1]:${app.port}/`)).toEqual({ session: "abc123", theme: "dark" });
    expect(await surface.cookies(`http://app.localhost:${app.port}/`)).toEqual({});
    expect(await surface.cookies(`http://127.0.0.2:${app.port}/`)).toEqual({});
  });

  it("saves the jar with its attributes, and the flat record an older Yam reads", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin, lookup: names });
    await surface.request(request({ url: "/login" }), { withSessionCookies: false });
    await surface.request(setting("auth.example.test", "/set-cookie", "sid=s1; Domain=example.test"), {
      withSessionCookies: false,
    });
    const saved = await surface.state();
    const parsed = JSON.parse(saved.storageState!) as { jar: unknown[]; cookies: Record<string, string> };
    expect(parsed.jar).toContainEqual({ name: "sid", value: "s1", domain: ".example.test", path: "/" });
    // Only the base URL's host's cookies, since an older reader sends them everywhere.
    expect(parsed.cookies).toEqual({ session: "abc123", theme: "dark" });

    const fresh = new HttpSurface({ lookup: names });
    await fresh.restore(saved);
    expect(await fresh.cookies(`http://api.example.test:${app.port}/`)).toEqual({ sid: "s1" });
    expect(await fresh.cookies(`${app.origin}/`)).toEqual({ session: "abc123", theme: "dark" });
  });

  it("holds the flat cookies of an old state when there is no base URL, rather than dropping them", async () => {
    const surface = new HttpSurface();
    await surface.restore({ kind: "http", storageState: JSON.stringify({ cookies: { session: "old" } }) });
    // No host to send them to, so none is sent them...
    expect(await surface.cookies(`${app.origin}/`)).toEqual({});
    // ...and saving again keeps them, for an adapter that has a base URL.
    const saved = await surface.state();
    const later = new HttpSurface({ baseUrl: app.origin });
    await later.restore(saved);
    expect(later.sessionCookies()).toEqual({ session: "old" });
    expect(JSON.parse(saved.storageState!)).toEqual({
      jar: [],
      cookies: { session: "old" },
      unscoped: { session: "old" },
    });
  });

  /*
   * `Call the "x" API without cookies` left out only the browser's cookies;
   * the jar still went, so a call meant to show an endpoint refuses an
   * anonymous caller was signed in by an earlier call in the same run.
   */
  it("sends no session or jar cookies, and keeps none, when the step said without cookies", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin });
    await surface.request(request({ url: "/login" }), { withSessionCookies: false });

    const anonymous = await surface.request(request({ url: setsCookies("/set-cookie", "session=anonymous; Path=/") }), {
      withSessionCookies: true,
      withoutCookies: true,
      sessionCookies: { browser: "yes" },
    });
    expect((anonymous.json as Echo).headers["cookie"]).toBeUndefined();
    expect(surface.sessionCookies()).toEqual({ session: "abc123", theme: "dark" });

    // A cookie the request file itself declares is part of the request, not a session.
    const declared = await surface.request(request({ url: "/echo", cookies: { consent: "yes" } }), {
      withSessionCookies: false,
      withoutCookies: true,
    });
    expect((declared.json as Echo).headers["cookie"]).toBe("consent=yes");

    // `withSessionCookies: false` alone is still the jar without the browser's.
    const plain = await surface.request(request({ url: "/echo" }), { withSessionCookies: false });
    expect((plain.json as Echo).headers["cookie"]).toBe("session=abc123; theme=dark");
  });

  it("parses a Set-Cookie line as the URL that answered would store it", () => {
    const url = "https://auth.example.test/account/login";
    expect(parseSetCookie("sid=a=b; Domain=.Example.test; Secure; HttpOnly", url)).toEqual({
      name: "sid",
      value: "a=b",
      domain: ".example.test",
      path: "/account",
      secure: true,
      expired: false,
    });
    expect(parseSetCookie("x=1; Path=relative", url)?.path).toBe("/account");
    expect(parseSetCookie("x=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT", url)?.expired).toBe(true);
    expect(parseSetCookie("x=1; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT", url)?.expired).toBe(false);
    expect(parseSetCookie("x=1; Domain=auth.example.test", url)?.domain).toBe(".auth.example.test");
    expect(parseSetCookie("x=1; Domain=127.0.0.1", "http://127.0.0.1/")?.domain).toBe("127.0.0.1");
    expect(parseSetCookie("x=1; Domain=0.0.1", "http://127.0.0.1/")).toBeUndefined();
    expect(parseSetCookie("x=1; Domain=localhost", "http://localhost/")?.domain).toBe("localhost");
    expect(parseSetCookie("x=1; Domain=ample.test", url)).toBeUndefined();
    expect(parseSetCookie("novalue", url)).toBeUndefined();
    expect(parseSetCookie("=nameless", url)).toBeUndefined();
  });
});

/** A resolver that answers from a table, so no test needs a real name. */
function resolving(table: Readonly<Record<string, string>>): LookupFunction {
  return (hostname, options, callback) => {
    const address = table[hostname];
    if (address === undefined) {
      callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), "");
      return;
    }
    if (options.all === true) callback(null, [{ address, family: isIP(address) }]);
    else callback(null, address, isIP(address));
  };
}

/*
 * Link-local and cloud metadata destinations (REQ-ADP-2).
 *
 * `169.254.169.254` is where a cloud instance's credentials are handed to
 * whoever asks from inside it, and a request's URL is something a flow, a
 * request file or an agent writes. None of these tests reaches a network: an
 * address is refused before `fetch` is called, a name is refused in the
 * lookup before a socket connects, and what is allowed goes to a fake `fetch`
 * or to the loopback echo server.
 */
describe("destinations it refuses (REQ-ADP-2)", () => {
  const saved = process.env[ALLOW_LINK_LOCAL_ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[ALLOW_LINK_LOCAL_ENV];
    else process.env[ALLOW_LINK_LOCAL_ENV] = saved;
  });

  const fakeFetch = () =>
    vi.fn(async () => new Response("ok", { status: 200 })) as unknown as NonNullable<RequestOptions["fetch"]> &
      ReturnType<typeof vi.fn>;

  it.each([
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://169.254.0.1/",
    "http://0xA9FEA9FE/",
    "http://[fe80::1]/",
    "http://[fd00:ec2::254]/latest/meta-data/",
    "http://[fd00:ec2::23]/v1/credentials",
    "http://[::ffff:169.254.169.254]/",
    "http://100.100.100.200/latest/meta-data/",
    "http://168.63.129.16/machine?comp=goalstate",
    "http://[64:ff9b::a9fe:a9fe]/latest/meta-data/",
    "http://[64:ff9b::169.254.169.254]/latest/meta-data/",
    "http://[64:ff9b::6464:64c8]/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://METADATA.google.internal./computeMetadata/v1/",
  ])("refuses %s before anything is sent, and says how to allow it", async (url) => {
    delete process.env[ALLOW_LINK_LOCAL_ENV];
    const fetch = fakeFetch();
    const error = await executeRequest(request({ url }), { fetch }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as Error).message).toMatch(/refused: .*(link-local|metadata)/);
    expect((error as Error).message).toContain(`${ALLOW_LINK_LOCAL_ENV}=1`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1:3000/",
    "http://127.8.8.8/",
    "http://[::1]:3000/",
    "http://localhost:3000/",
    "http://10.0.4.12/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.10/",
    "http://100.100.100.201/",
    "http://[64:ff9b::a00:40c]/",
    "http://[fd00:ec3::254]/",
    "https://api.example.com/",
  ])("sends to %s, since local applications are what Yam tests", async (url) => {
    delete process.env[ALLOW_LINK_LOCAL_ENV];
    const fetch = fakeFetch();
    expect((await executeRequest(request({ url }), { fetch })).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("answers the same question for any address", () => {
    expect(refusedDestination("169.254.169.254")).toContain("link-local");
    expect(refusedDestination("febf:ffff::1")).toContain("link-local");
    expect(refusedDestination("fec0::1")).toBeUndefined();
    expect(refusedDestination("fe80::1%en0")).toContain("link-local");
    expect(refusedDestination("172.32.0.1")).toBeUndefined();
    expect(refusedDestination("app.example.com")).toBeUndefined();
    expect(refusedDestination("fd00:ec2::ffff")).toContain("metadata");
    expect(refusedDestination("fd00:ec2:0:1::254")).toBeUndefined();
    expect(refusedDestination("64:ff9b::a9fe:a9fe")).toBe(
      "64:ff9b::a9fe:a9fe is NAT64 for 169.254.169.254, and 169.254.169.254 is a link-local address, " +
        "where cloud metadata services live",
    );
    expect(refusedDestination("64:ff9b::a83f:8110")).toContain("platform");
    expect(refusedDestination("64:ff9b:1::a9fe:a9fe")).toBeUndefined();
  });

  it("refuses a name that resolves to a NAT64 metadata address, at the lookup", async () => {
    delete process.env[ALLOW_LINK_LOCAL_ENV];
    const error = await executeRequest(request({ url: "http://innocent.test/" }), {
      lookup: resolving({ "innocent.test": "64:ff9b::6464:64c8" }),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as Error).message).toContain("innocent.test resolves to 64:ff9b::6464:64c8");
    expect((error as Error).message).toContain("100.100.100.200");
  });

  it("refuses a name that resolves to a link-local address, at the lookup", async () => {
    delete process.env[ALLOW_LINK_LOCAL_ENV];
    const lookup = resolving({ "innocent.test": "169.254.169.254" });
    const error = await executeRequest(request({ url: "http://innocent.test/latest/meta-data/" }), {
      lookup,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as Error).message).toContain("innocent.test resolves to 169.254.169.254");
    expect((error as Error).message).toContain(`${ALLOW_LINK_LOCAL_ENV}=1`);
  });

  it("keeps the guard on a request that skips TLS verification", async () => {
    delete process.env[ALLOW_LINK_LOCAL_ENV];
    const error = await executeRequest(
      request({ url: "https://innocent.test/", tls: { insecure: true } }),
      { lookup: resolving({ "innocent.test": "fe80::1" }) },
    ).catch((caught: unknown) => caught);
    expect((error as Error).message).toContain("innocent.test resolves to fe80::1");
  });

  it("refuses a redirect to a link-local address, which no check of the first URL sees", async () => {
    delete process.env[ALLOW_LINK_LOCAL_ENV];
    const to = encodeURIComponent("http://169.254.169.254/latest/meta-data/");
    const error = await executeRequest(request({ url: `/redirect-to?to=${to}` }), {
      baseUrl: app.origin,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as Error).message).toContain("169.254.169.254 is a link-local address");
  });

  it("connects to a name that resolves to loopback", async () => {
    delete process.env[ALLOW_LINK_LOCAL_ENV];
    const response = await executeRequest(request({ url: `http://app.test:${app.port}/echo` }), {
      lookup: resolving({ "app.test": "127.0.0.1" }),
    });
    expect((response.json as Echo).path).toBe("/echo");
  });

  it(`sends to a link-local address when ${ALLOW_LINK_LOCAL_ENV}=1 says to`, async () => {
    process.env[ALLOW_LINK_LOCAL_ENV] = "1";
    const fetch = fakeFetch();
    expect((await executeRequest(request({ url: "http://169.254.169.254/" }), { fetch })).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
