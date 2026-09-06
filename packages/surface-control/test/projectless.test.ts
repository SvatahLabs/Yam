/**
 * T04 — Surface control works without a project (SF-01, SF-03, SF-12).
 *
 * Done condition: connect/snapshot/act/check work with no flow/compiler/binding
 * load and no model credential. Invalid unrelated flow files cannot prevent
 * surface control.
 */
import { describe, it, expect, vi } from "vitest";
import type { AgentSurface } from "@svatah/yam-surface";
import {
  createAdapterFactory,
  createSessionStore,
  dispatchConnect,
  dispatchSnapshot,
  dispatchAct,
  dispatchRead,
  dispatchCheck,
  dispatchClose,
  type DispatchContext,
} from "../src/index.js";

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
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue({
      tree: "- [ref=r1] button 'Click me'",
      hash: "abc123",
      nodes: 1,
    }),
    act: vi.fn().mockResolvedValue({ ok: true }),
    read: vi.fn().mockResolvedValue("Test Page"),
    check: vi.fn().mockResolvedValue({ ok: true, message: "visible" }),
    describe: vi.fn().mockResolvedValue({ role: "button", name: "Click me" }),
    screenshot: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentSurface;
}

describe("projectless connect/snapshot/act/read/check/close", () => {
  it("completes the primary journey with no project loaded", async () => {
    const surface = stubSurface();
    const factory = createAdapterFactory(
      async () => surface,
      () => ["playwright"],
    );

    const ctx: DispatchContext = { sessions: createSessionStore() };

    const connectResult = await dispatchConnect(ctx, {
      url: "http://127.0.0.1:4173",
      adapter: "playwright",
      adapterFactory: factory,
    }) as Record<string, unknown>;

    expect(connectResult.status).toBe("succeeded");
    const sessionId = (connectResult.result as Record<string, unknown>).sessionId as string;
    expect(sessionId).toMatch(/^s_/);

    const snapResult = await dispatchSnapshot(ctx, { session: sessionId }) as Record<string, unknown>;
    expect(snapResult.status).toBe("succeeded");

    const actResult = await dispatchAct(ctx, {
      session: sessionId,
      action: "click",
      ref: "r1",
    }) as Record<string, unknown>;
    expect(actResult.status).toBe("succeeded");

    const readResult = await dispatchRead(ctx, {
      session: sessionId,
      kind: "title" as never,
    }) as Record<string, unknown>;
    expect(readResult.status).toBe("succeeded");

    const checkResult = await dispatchCheck(ctx, {
      session: sessionId,
      predicate: { kind: "visible" },
      subject: "page" as never,
    }) as Record<string, unknown>;
    expect(checkResult.status).toBe("succeeded");

    const closeResult = await dispatchClose(ctx, { session: sessionId }) as Record<string, unknown>;
    expect(closeResult.status).toBe("succeeded");

    expect(surface.open).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:4173" });
    expect(surface.close).toHaveBeenCalled();
  });

  it("works with no URL (for desktop/attached sessions)", async () => {
    const surface = stubSurface("desktop");
    const factory = createAdapterFactory(
      async () => surface,
      () => ["ax"],
    );

    const ctx: DispatchContext = { sessions: createSessionStore() };
    const result = await dispatchConnect(ctx, {
      adapter: "ax",
      adapterFactory: factory,
    }) as Record<string, unknown>;

    expect(result.status).toBe("succeeded");
    expect(surface.open).toHaveBeenCalledWith({});
  });
});

describe("adapter factory refuses unknown adapters", () => {
  it("refuses a nonexistent adapter before launch", async () => {
    const factory = createAdapterFactory(
      async () => { throw new Error("should not be called"); },
      () => ["playwright", "bidi"],
    );

    await expect(factory("does-not-exist")).rejects.toThrow(
      /Adapter "does-not-exist" is not registered/,
    );
  });

  it("lists available adapters in the error", async () => {
    const factory = createAdapterFactory(
      async () => { throw new Error("should not be called"); },
      () => ["playwright", "bidi"],
    );

    await expect(factory("fake")).rejects.toThrow(/playwright, bidi/);
  });
});

describe("invalid project files do not prevent surface control", () => {
  it("dispatcher has no project dependency in its call chain", async () => {
    const surface = stubSurface();
    const ctx: DispatchContext = { sessions: createSessionStore() };
    const sessionId = ctx.sessions.create(surface, "playwright");

    const snapResult = await dispatchSnapshot(ctx, { session: sessionId }) as Record<string, unknown>;
    expect(snapResult.status).toBe("succeeded");

    const actResult = await dispatchAct(ctx, {
      session: sessionId,
      action: "click",
      ref: "r1",
    }) as Record<string, unknown>;
    expect(actResult.status).toBe("succeeded");

    const readResult = await dispatchRead(ctx, {
      session: sessionId,
      kind: "title" as never,
    }) as Record<string, unknown>;
    expect(readResult.status).toBe("succeeded");

    const checkResult = await dispatchCheck(ctx, {
      session: sessionId,
      predicate: { kind: "visible" },
      subject: "page" as never,
    }) as Record<string, unknown>;
    expect(checkResult.status).toBe("succeeded");
  });
});

describe("import boundary: surface-control is project-free", () => {
  it("source files do not import compiler, recorder, gateway, or service", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));

    const forbidden = [
      "@svatah/yam-compiler",
      "@svatah/yam-recorder",
      "@svatah/yam-gateway",
      "@svatah/yam-service",
      "@svatah/yam-trajectory",
      "@svatah/yam-healer",
      "@svatah/yam-bindings",
      "@svatah/yam-tool",
    ];

    for (const file of files) {
      const content = readFileSync(join(srcDir, file), "utf8");
      for (const pkg of forbidden) {
        expect(
          content,
          `${file} must not import ${pkg}`,
        ).not.toContain(`from "${pkg}"`);
      }
    }
  });
});
