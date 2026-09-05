/**
 * T2.6 — the request field matrix (REQ-ADP-2, LLD §7.2).
 *
 * Validate: "Field matrix against a local server; cookie-sharing test."
 *
 * Against a real server rather than a mocked `fetch`, so what is asserted is the
 * request that actually went out. A mock can only tell you what the adapter
 * *called it with*, which is the same thing right up until it is not.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApiRequest } from "@svatah/schema";
import { ApiRequestError, executeRequest, HttpSurface } from "../src/index.js";
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
    const dir = mkdtempSync(join(tmpdir(), "svatah-http-"));
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
});
