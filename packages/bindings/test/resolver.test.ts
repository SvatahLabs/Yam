/**
 * T1.3 Validate — "resolver matrix with a stub surface".
 *
 * The resolver's contract (LLD §6.3, REQ-RUN-5) is about cardinality and
 * ordering: candidates in order, a per-candidate timeout, exactly one match, `nth`
 * for a legitimate multi-match, a `webmcp` preference, and a `LocatorError` that
 * reports every candidate tried and whether the page's shape had drifted.
 *
 * Every row of that is a case here. The stub surface is what makes the
 * interesting rows arrangeable at all — and the fact that it can exist is the
 * resolver's independence: it knows `AgentSurface` and nothing else.
 */
import { describe, expect, it } from "vitest";
import { buildSnapshot, structuralHash } from "@svatah/yam-surface";
import { BindingsStore, LocatorError, resolve, tryResolve } from "../src/index.js";
import { StubSurface } from "./stub-surface.js";
import { candidate, entry } from "./fixtures.js";

const ID = "login.username-field";

function storeWith(...candidates: ReturnType<typeof candidate>[]): BindingsStore {
  const store = BindingsStore.empty("/nowhere");
  store.put(ID, entry({ candidates }), "the username field");
  return store;
}

describe("the resolver matrix (LLD §6.3)", () => {
  it("returns the first candidate that matches exactly one element", async () => {
    const surface = new StubSurface({
      answers: {
        "testid:username": { kind: "refs", refs: [] },
        "label:Username": { kind: "refs", refs: ["r7"] },
      },
    });
    const store = storeWith(
      candidate({ by: "testid", value: "username" }),
      candidate({ by: "label", value: "Username" }),
      candidate({ by: "css", value: "#username" }),
    );

    const resolution = await resolve(ID, surface, store);
    expect(resolution.ref).toBe("r7");
    expect(resolution.candidateIndex).toBe(1);
    expect(resolution.by).toBe("label");

    // The third candidate is never tried: order is the ranking.
    expect(surface.located.map((c) => c.by)).toEqual(["testid", "label"]);
  });

  it("tries candidates strictly in the order they are stored", async () => {
    const surface = new StubSurface({ fallback: { kind: "refs", refs: [] } });
    const store = storeWith(
      candidate({ by: "testid", value: "username" }),
      candidate({ by: "label", value: "Username" }),
      candidate({ by: "css", value: "#username" }),
      candidate({ by: "xpath", value: "//input" }),
    );
    await expect(resolve(ID, surface, store)).rejects.toBeInstanceOf(LocatorError);
    expect(surface.located.map((c) => c.by)).toEqual(["testid", "label", "css", "xpath"]);
  });

  it("refuses a candidate that matches more than one element and carries no nth", async () => {
    const surface = new StubSurface({
      answers: { "role:button/Book now": { kind: "refs", refs: ["r1", "r2"] } },
    });
    const store = storeWith(candidate({ by: "role", role: "button", name: "Book now" }));

    const result = await tryResolve(ID, surface, store);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail.tried[0]!.matched).toBe(2);
    expect(result.error.detail.tried[0]!.rejected).toContain("cannot say which was meant");
    expect(result.error.message).toContain("matched 2 elements");
  });

  it("uses nth to disambiguate a candidate that legitimately matches several", async () => {
    const surface = new StubSurface({
      answers: { "role:button/Book now": { kind: "refs", refs: ["r1", "r2", "r3"] } },
    });
    const store = storeWith(candidate({ by: "role", role: "button", name: "Book now", nth: 1 }));

    const resolution = await resolve(ID, surface, store);
    expect(resolution.ref).toBe("r2");
    expect(resolution.by).toBe("role");
  });

  it("reports an nth that is out of range rather than resolving nothing quietly", async () => {
    const surface = new StubSurface({
      answers: { "role:button/Book now": { kind: "refs", refs: ["r1", "r2"] } },
    });
    const store = storeWith(candidate({ by: "role", role: "button", name: "Book now", nth: 5 }));

    const result = await tryResolve(ID, surface, store);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail.tried[0]!.rejected).toContain("nth=5 is out of range");
  });

  it("gives each candidate its own timeout and moves on to the next", async () => {
    const surface = new StubSurface({
      answers: {
        "testid:username": { kind: "hang" },
        "label:Username": { kind: "refs", refs: ["r7"] },
      },
    });
    const store = storeWith(
      candidate({ by: "testid", value: "username" }),
      candidate({ by: "label", value: "Username" }),
    );

    const started = Date.now();
    const resolution = await resolve(ID, surface, store, { candidateTimeoutMs: 60 });
    expect(resolution.ref).toBe("r7");
    // The hanging candidate cost its timeout and no more.
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("records a timed-out candidate as an error, not as a miss", async () => {
    const surface = new StubSurface({ fallback: { kind: "hang" } });
    const store = storeWith(candidate({ by: "testid", value: "username" }));

    const result = await tryResolve(ID, surface, store, { candidateTimeoutMs: 40 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail.tried[0]!.error).toContain("timed out after 40 ms");
  });

  it("carries on when a candidate throws", async () => {
    const surface = new StubSurface({
      answers: {
        "xpath://bad[": { kind: "throw", message: "invalid xpath expression" },
        "testid:username": { kind: "refs", refs: ["r7"] },
      },
    });
    const store = storeWith(
      candidate({ by: "xpath", value: "//bad[" }),
      candidate({ by: "testid", value: "username" }),
    );

    const resolution = await resolve(ID, surface, store);
    expect(resolution.ref).toBe("r7");
  });

  it("fails when the element has no bindings at all", async () => {
    const surface = new StubSurface();
    const result = await tryResolve("login.never-recorded", surface, BindingsStore.empty("/nowhere"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail.tried).toEqual([]);
    // Draft 2.20 (REQ-CLI-5): a missing binding says so in words a newcomer can act on.
    expect(result.error.message).toContain("No binding for");
  });
});

describe("the webmcp preference (REQ-ADP-9, LLD §6.3)", () => {
  it("is inert when the adapter does not report the capability", async () => {
    const surface = new StubSurface({
      capabilities: { webmcp: false },
      answers: { "testid:username": { kind: "refs", refs: ["r7"] } },
    });
    const store = storeWith(
      candidate({ by: "webmcp", tool: "fill-username", score: 1 }),
      candidate({ by: "testid", value: "username" }),
    );

    const resolution = await resolve(ID, surface, store);
    expect(resolution.by).toBe("testid");
    // The webmcp candidate was not even offered to the adapter.
    expect(surface.located.map((c) => c.by)).toEqual(["testid"]);
  });

  it("is preferred over the locators when the tool is declared", async () => {
    const surface = new StubSurface({
      capabilities: { webmcp: true },
      answers: {
        "webmcp:fill-username": { kind: "refs", refs: ["tool-ref"] },
        "testid:username": { kind: "refs", refs: ["r7"] },
      },
    });
    const store = storeWith(
      candidate({ by: "testid", value: "username" }),
      candidate({ by: "webmcp", tool: "fill-username", paramMap: { value: "text" }, score: 1 }),
    );

    const resolution = await resolve(ID, surface, store);
    expect(resolution.by).toBe("webmcp");
    expect(resolution.ref).toBe("tool-ref");
    expect(resolution.webmcp).toEqual({ tool: "fill-username", paramMap: { value: "text" } });
    // Preferred means first, whatever its position among the candidates.
    expect(surface.located.map((c) => c.by)).toEqual(["webmcp"]);
  });

  it("falls through to the locators when the declaration has gone", async () => {
    const surface = new StubSurface({
      capabilities: { webmcp: true },
      answers: {
        "webmcp:fill-username": { kind: "refs", refs: [] },
        "testid:username": { kind: "refs", refs: ["r7"] },
      },
    });
    const store = storeWith(
      candidate({ by: "webmcp", tool: "fill-username", score: 1 }),
      candidate({ by: "testid", value: "username" }),
    );

    const resolution = await resolve(ID, surface, store);
    expect(resolution.by).toBe("testid");
    expect(resolution.ref).toBe("r7");
  });
});

describe("LocatorError (REQ-RUN-5, REQ-HEAL-1)", () => {
  it("reports every candidate tried, with what each one saw", async () => {
    const surface = new StubSurface({
      answers: {
        "testid:username": { kind: "refs", refs: [] },
        "label:Username": { kind: "refs", refs: ["r1", "r2"] },
        "css:#username": { kind: "throw", message: "bad selector" },
      },
    });
    const store = storeWith(
      candidate({ by: "testid", value: "username" }),
      candidate({ by: "label", value: "Username" }),
      candidate({ by: "css", value: "#username" }),
    );

    const result = await tryResolve(ID, surface, store);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.detail.tried).toHaveLength(3);
    expect(result.error.detail.tried.map((a) => a.candidate.by)).toEqual(["testid", "label", "css"]);
    expect(result.error.detail.id).toBe(ID);
    expect(result.error.detail.phrase).toBe("the username field");
    expect(result.error.detail.state?.url).toContain("/login");

    const message = result.error.message;
    expect(message).toContain('Could not resolve "login.username-field" (the username field)');
    expect(message).toContain('testid "username" — matched nothing');
    expect(message).toContain('label "Username" — matched 2');
    expect(message).toContain("css \"#username\" — error: bad selector");
    expect(message).toContain("session at http://127.0.0.1:4173/login");
  });

  it("is a LocateError, so the executor classifies it as `locator` (LLD §8.4)", async () => {
    const { failureClassOf } = await import("@svatah/yam-surface");
    const surface = new StubSurface({ fallback: { kind: "refs", refs: [] } });
    const result = await tryResolve(ID, surface, storeWith(candidate({ by: "id", value: "x" })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(failureClassOf(result.error)).toBe("locator");
  });

  it("flags context drift when asked, and says what the shape was and is", async () => {
    const nodes = [
      { ref: "r0", role: "main", states: [], depth: 0 },
      { ref: "r1", role: "form", states: [], depth: 1, parent: "r0", name: "Sign in" },
      { ref: "r2", role: "textbox", states: [], depth: 2, parent: "r1", name: "Username" },
    ];
    const live = buildSnapshot("r0", nodes, structuralHash(nodes));

    const surface = new StubSurface({ fallback: { kind: "refs", refs: [] }, snapshot: live });
    const store = storeWith(candidate({ by: "testid", value: "username" }));

    const result = await tryResolve(ID, surface, store, { reportDrift: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail.contextDrift).toBe(true);
    expect(result.error.detail.recordedHash).toBe("a".repeat(64));
    expect(result.error.detail.liveHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.error.message).toContain("the page's shape has drifted");
  });

  it("does not claim drift when the shape is the one the binding was recorded on", async () => {
    const nodes = [{ ref: "r0", role: "main", states: [], depth: 0 }];
    const live = buildSnapshot("r0", nodes, structuralHash(nodes));
    const recordedHash = structuralHash([{ ref: "r0", role: "main", states: [], depth: 0 }]);

    const store = BindingsStore.empty("/nowhere");
    store.put(
      ID,
      entry({
        context: { pattern: "http://127.0.0.1:4173/login", hash: recordedHash, platform: "web" },
        candidates: [candidate({ by: "testid", value: "username" })],
      }),
    );

    const surface = new StubSurface({ fallback: { kind: "refs", refs: [] }, snapshot: live });
    const result = await tryResolve(ID, surface, store, { reportDrift: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail.contextDrift).toBe(false);
    expect(result.error.message).not.toContain("drifted");
  });

  it("renders a bind-failure line the healer can consume (LLD §12)", async () => {
    const surface = new StubSurface({ fallback: { kind: "refs", refs: [] } });
    const store = storeWith(
      candidate({ by: "testid", value: "username" }),
      candidate({ by: "css", value: "#username" }),
    );

    const result = await tryResolve(ID, surface, store, { reportDrift: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const line = result.error.toFailureLine();
    expect(line["id"]).toBe(ID);
    expect(line["phrase"]).toBe("the username field");
    expect(line["recordedHash"]).toBe("a".repeat(64));
    expect(Array.isArray(line["tried"])).toBe(true);
    expect((line["tried"] as Array<{ by: string }>).map((t) => t.by)).toEqual(["testid", "css"]);
    // It has to survive JSON: `.yam/bind-failures.jsonl` is one line per failure.
    expect(() => JSON.parse(JSON.stringify(line))).not.toThrow();
  });
});
