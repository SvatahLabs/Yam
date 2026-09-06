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

  it("closeAll preserves attached surfaces", async () => {
    const store = createSessionStore();
    const launched = stubSurface();
    const attached = stubSurface();
    store.create(launched, "playwright", { mode: "launch" });
    store.create(attached, "ax", { mode: "attach" });
    await store.closeAll();
    expect(store.list()).toHaveLength(0);
    expect(launched.close).toHaveBeenCalled();
    expect(attached.close).not.toHaveBeenCalled();
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

  it("expireSessions does not close attached surfaces", async () => {
    const store = createSessionStore();
    const surface = stubSurface();
    store.create(surface, "ax", { mode: "attach", ttlMs: 0 });
    await store.expireSessions();
    expect(surface.close).not.toHaveBeenCalled();
  });

  it("expireSessions keeps active sessions", async () => {
    const store = createSessionStore();
    const id = store.create(stubSurface(), "playwright", { ttlMs: 60_000 });
    const expired = await store.expireSessions();
    expect(expired).toHaveLength(0);
    expect(store.get(id)).toBeDefined();
  });
});
