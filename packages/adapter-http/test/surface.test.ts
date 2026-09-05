/**
 * T2.6 — the HTTP adapter as an `AgentSurface` (REQ-SURF-1, LLD §7.2).
 *
 * The interesting half is what it refuses. An HTTP endpoint has no elements, and
 * an adapter that answered `locate` with an empty array would let a flow that
 * clicks things get halfway through a run before failing on something that could
 * never have worked. Saying so in `capabilities()` lets the executor refuse the
 * plan at start (LLD §2.4).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiRequest } from "@svatah/schema";
import { HttpSurface } from "../src/index.js";
import { startEchoServer, type EchoServer } from "./server.js";

let app: EchoServer;
beforeAll(async () => {
  app = await startEchoServer();
});
afterAll(async () => {
  await app.close();
});

const req = (url: string): ApiRequest => ({ name: "test", method: "GET", url }) as ApiRequest;

describe("what it says it can do (REQ-SURF-1)", () => {
  const surface = new HttpSurface();

  it("claims nothing it cannot do", () => {
    const capabilities = surface.capabilities();
    for (const flag of ["dialogs", "frames", "windows", "upload", "drag", "trace", "webmcp", "screenshot"] as const) {
      expect(capabilities[flag], flag).toBe(false);
    }
  });

  it("claims `restore`, because its session is a cookie jar", () => {
    expect(surface.capabilities().restore).toBe(true);
  });

  it("is an http surface", () => {
    expect(surface.kind).toBe("http");
  });

  it("snapshots an empty tree rather than refusing", () => {
    // A caller may reasonably snapshot any surface; a surface with no elements
    // has an empty tree, and that is a true answer rather than an error.
    return surface.snapshot().then((snapshot) => {
      expect(snapshot.nodes).toEqual([]);
      expect(snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it.each(["act", "locate", "describe", "screenshot"] as const)(
    "%s says what this adapter is for rather than 'not implemented'",
    async (method) => {
      // Someone seeing this configured `adapter: http` for a flow that clicks
      // things. What they need to know is which of the two is wrong.
      const call = (surface as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[
        method
      ]!;
      await expect(call.call(surface, "click", "r0")).rejects.toThrow(/HTTP adapter/);
    },
  );
});

describe("reading and checking the last response", () => {
  it("has nothing to read before a request has been made", async () => {
    await expect(new HttpSurface().read("text")).rejects.toThrow(/Nothing has been requested/);
  });

  it("reads the body, the parsed JSON, a header and the whole response", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin });
    await surface.request(req("/items"), { withSessionCookies: false });

    expect(await surface.read("text")).toContain("activeCount");
    expect((await surface.read("value")) as { activeCount: number }).toMatchObject({ activeCount: 3 });
    expect(await surface.read("attribute", undefined, "Content-Type")).toContain("application/json");
    expect((await surface.read("result")) as { status: number }).toMatchObject({ status: 200 });
  });

  it("captures a JSON path out of the last response", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin });
    await surface.request(req("/items"), { withSessionCookies: false });
    expect(surface.captureFromLast("$.items[0].id")).toBe("BK-1");
    expect(surface.captureFromLast()).toMatchObject({ activeCount: 3 });
  });

  it("checks text and textContains", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin });
    await surface.request(req("/text"), { withSessionCookies: false });

    expect(
      await surface.check({ kind: "textContains", value: { kind: "literal", value: "text" } }, "page"),
    ).toMatchObject({ ok: true });
    expect(
      await surface.check({ kind: "text", value: { kind: "literal", value: "nope" } }, "page"),
    ).toMatchObject({ ok: false });
  });

  it("returns a reason rather than throwing for a predicate about an element", async () => {
    // A failed expectation is a normal outcome the executor classifies as
    // `assertion`; throwing would make it infrastructure (LLD §8.4).
    const surface = new HttpSurface({ baseUrl: app.origin });
    await surface.request(req("/text"), { withSessionCookies: false });
    const result = await surface.check({ kind: "visible" }, "ref");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no elements");
  });
});

describe("session", () => {
  it("forgets its jar when reopened, because a new session is a new session", async () => {
    const surface = new HttpSurface({ baseUrl: app.origin });
    await surface.request(req("/login"), { withSessionCookies: false });
    expect(Object.keys(surface.sessionCookies())).toHaveLength(2);

    await surface.open({ baseUrl: app.origin });
    expect(surface.sessionCookies()).toEqual({});
  });

  it("takes the base URL from the session when one is given", async () => {
    const surface = new HttpSurface();
    await surface.open({ baseUrl: app.origin });
    const response = await surface.request(req("/text"), { withSessionCookies: false });
    expect(response.body).toBe("just text");
  });
});
