import { describe, it, expect, vi } from "vitest";
import { createSessionStore } from "../src/sessions.js";
import type { AgentSurface } from "@svatah/yam-surface";

function stubSurface(kind = "web"): AgentSurface {
  return {
    kind,
    capabilities: () => ({
      canSnapshot: true,
      canAct: true,
      canRead: true,
      canCheck: true,
      canDescribe: true,
      canScreenshot: true,
      canNavigate: true,
      canDialog: false,
      canDrag: false,
      canUpload: false,
      canSelectOption: false,
    }),
    open: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn(),
    act: vi.fn(),
    read: vi.fn(),
    check: vi.fn(),
    describe: vi.fn(),
    screenshot: vi.fn(),
  } as unknown as AgentSurface;
}

describe("SessionStore", () => {
  it("create returns an s_ prefixed id", () => {
    const store = createSessionStore();
    const id = store.create(stubSurface(), "playwright");
    expect(id).toMatch(/^s_[a-f0-9]{12}$/);
  });

  it("get returns the created session", () => {
    const store = createSessionStore();
    const surface = stubSurface();
    const id = store.create(surface, "playwright");
    const entry = store.get(id);
    expect(entry).toBeDefined();
    expect(entry!.surface).toBe(surface);
    expect(entry!.adapter).toBe("playwright");
    expect(entry!.status).toBe("ready");
    expect(entry!.mode).toBe("launch");
  });

  it("get returns undefined for unknown id", () => {
    const store = createSessionStore();
    expect(store.get("s_unknown")).toBeUndefined();
  });

  it("list returns all sessions", () => {
    const store = createSessionStore();
    store.create(stubSurface(), "playwright");
    store.create(stubSurface("desktop"), "uia");
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0].kind).toBe("web");
    expect(list[1].kind).toBe("desktop");
  });

  it("remove deletes a session", () => {
    const store = createSessionStore();
    const id = store.create(stubSurface(), "playwright");
    store.remove(id);
    expect(store.get(id)).toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });

  it("closeAll closes launched surfaces and clears the store", async () => {
    const store = createSessionStore();
    const s1 = stubSurface();
    const s2 = stubSurface();
    store.create(s1, "playwright");
    store.create(s2, "playwright");
    await store.closeAll();
    expect(store.list()).toHaveLength(0);
    expect(s1.close).toHaveBeenCalled();
    expect(s2.close).toHaveBeenCalled();
  });

  /*
   * Closing an attached session detaches; it does not close the user's
   * application (SF-05) — and the place that decides is the *adapter* (T00).
   *
   * This case used to assert that the store skipped `close()` on an attached
   * session altogether, which is a second and weaker copy of a decision every
   * adapter already makes correctly: `AxSurface` and `UiaSurface` quit only
   * `this.launched`, the Playwright and BiDi adapters disconnect from a browser
   * they attached to rather than ending it, and an HTTP surface has nothing to
   * quit. Skipping the call therefore quit nothing and *released* nothing —
   * a CDP connection outliving a session the TTL had already swept.
   *
   * So the store closes every session and the adapter decides what closing one
   * means. `mode` stays what SF-05 asks it to be: the record of who owns the
   * target, published to a caller who wants to know before it closes anything.
   */
  it("closeAll closes every session, and the adapter decides what that means", async () => {
    const store = createSessionStore();
    const launched = stubSurface();
    const attached = stubSurface();
    store.create(launched, "playwright", { mode: "launch" });
    store.create(attached, "ax", { mode: "attach" });
    await store.closeAll();
    expect(store.list()).toHaveLength(0);
    expect(launched.close).toHaveBeenCalled();
    expect(attached.close, "released, not quit: the adapter quits only what it launched")
      .toHaveBeenCalled();
  });

  it("keeps the ownership mode a caller can read before it closes anything", () => {
    const store = createSessionStore();
    store.create(stubSurface(), "playwright", { mode: "launch" });
    store.create(stubSurface(), "ax", { mode: "attach" });
    expect(store.list().map((one) => one.mode)).toEqual(["launch", "attach"]);
  });

  it("touch updates lastActivity", () => {
    const store = createSessionStore();
    const id = store.create(stubSurface(), "playwright");
    const before = store.get(id)!.lastActivity;
    // Small delay to ensure time difference
    store.touch(id);
    const after = store.get(id)!.lastActivity;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it("expireSessions removes expired sessions", async () => {
    const store = createSessionStore();
    const surface = stubSurface();
    const id = store.create(surface, "playwright", { ttlMs: 0 });
    // TTL of 0 means immediately expired
    const expired = await store.expireSessions();
    expect(expired).toContain(id);
    expect(store.get(id)).toBeUndefined();
    expect(surface.close).toHaveBeenCalled();
  });

  it("expireSessions releases an attached surface rather than leaking it", async () => {
    // The same rule as `closeAll` above: the adapter quits only what it
    // launched, so an expired attachment is let go of and the user's
    // application is left where it was.
    const store = createSessionStore();
    const surface = stubSurface();
    store.create(surface, "ax", { mode: "attach", ttlMs: 0 });
    await store.expireSessions();
    expect(surface.close).toHaveBeenCalled();
  });

  it("expireSessions keeps active sessions", async () => {
    const store = createSessionStore();
    const id = store.create(stubSurface(), "playwright", { ttlMs: 60_000 });
    const expired = await store.expireSessions();
    expect(expired).toHaveLength(0);
    expect(store.get(id)).toBeDefined();
  });
});
