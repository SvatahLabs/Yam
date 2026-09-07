/**
 * Every mutation takes the target the same way (SF-13, SF-14) — verification
 * of wave 3.
 *
 * Two defects in the dispatcher, both found by driving rather than by reading:
 *
 * 1. Control was taken under one default name and acted on under another, so
 *    `control --take` with no holder followed by `act` with no holder was
 *    refused by its own hold.
 * 2. `request` checked control and nothing else: it took no lease, so it ran
 *    beside an `act` in flight, and it was on no operation record, so a caller
 *    that lost its connection mid-send had nothing to ask about.
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentSurface } from "@svatah/yam-surface";
import {
  DEFAULT_HOLDER,
  createAdapterFactory,
  createCoordinationStore,
  createEventStore,
  createSessionStore,
  dispatchAct,
  dispatchConnect,
  dispatchControl,
  dispatchRequest,
  type DispatchContext,
} from "../src/index.js";

function surfaceWith(overrides: Partial<AgentSurface> = {}): AgentSurface {
  return {
    kind: "http",
    capabilities: () => ({}),
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue({ tree: "", hash: "h", nodes: 0 }),
    act: vi.fn().mockResolvedValue({ ok: true }),
    read: vi.fn().mockResolvedValue("http://example.test/"),
    check: vi.fn().mockResolvedValue({ ok: true }),
    describe: vi.fn().mockResolvedValue({ role: "button", name: "Go" }),
    screenshot: vi.fn().mockResolvedValue(undefined),
    request: vi.fn().mockResolvedValue({ status: 200, json: { ok: true } }),
    ...overrides,
  } as unknown as AgentSurface;
}

async function open(surface: AgentSurface): Promise<{ ctx: DispatchContext; session: string }> {
  const ctx: DispatchContext = {
    sessions: createSessionStore(),
    coordination: createCoordinationStore(),
    events: createEventStore(),
  };
  const connected = (await dispatchConnect(ctx, {
    url: "http://example.test/",
    adapter: "http",
    adapterFactory: createAdapterFactory(async () => surface, () => ["http"]),
  })) as { result: { sessionId: string } };
  return { ctx, session: connected.result.sessionId };
}

const code = (envelope: unknown): string | undefined =>
  (envelope as { error?: { code?: string } }).error?.code;

describe("one default name for taking control and for acting on it", () => {
  it("a caller that took control without naming itself is not refused by its own hold", async () => {
    const { ctx, session } = await open(surfaceWith());
    const taken = (await dispatchControl(ctx, { session, action: "take" })) as {
      result: { holder: string; heldByYou: boolean };
    };
    expect(taken.result.holder).toBe(DEFAULT_HOLDER);

    const request = await dispatchRequest(ctx, {
      session,
      request: { name: "r", method: "GET", url: "/things" },
    });
    expect(code(request)).toBeUndefined();
    expect((request as { status: string }).status).toBe("succeeded");

    const act = await dispatchAct(ctx, { session, action: "click", ref: "r1" });
    expect(code(act)).not.toBe("CONTROL_BUSY");
  });

  it("a named holder still blocks the unnamed one, and is told who has it", async () => {
    const { ctx, session } = await open(surfaceWith());
    await dispatchControl(ctx, { session, action: "take", holder: "agent-1" });
    const refused = await dispatchRequest(ctx, {
      session,
      request: { name: "r", method: "GET", url: "/things" },
    });
    expect(code(refused)).toBe("CONTROL_BUSY");
    expect((refused as { error: { message: string } }).error.message).toContain("agent-1");
  });
});

describe("a request is a mutation like any other", () => {
  it("does not run beside an act in flight on the same target", async () => {
    let finish: (() => void) | undefined;
    const slow = surfaceWith({
      kind: "web",
      // Connecting a web surface navigates through `act`; only the click stalls.
      act: vi.fn().mockImplementation((action: string) =>
        action === "navigate"
          ? Promise.resolve({ ok: true })
          : new Promise<{ ok: true }>((done) => (finish = () => done({ ok: true }))),
      ),
    } as Partial<AgentSurface>);
    const { ctx, session } = await open(slow);
    const acting = dispatchAct(ctx, { session, action: "click", ref: "r1" });
    await new Promise((tick) => setTimeout(tick, 10));

    const meanwhile = await dispatchRequest(ctx, {
      session,
      request: { name: "r", method: "GET", url: "/things" },
    });
    expect(code(meanwhile)).toBe("CONTROL_BUSY");
    expect((slow as { request: ReturnType<typeof vi.fn> }).request).not.toHaveBeenCalled();

    finish!();
    expect((await acting as { status: string }).status).toBe("succeeded");

    const afterwards = await dispatchRequest(ctx, {
      session,
      request: { name: "r", method: "GET", url: "/things" },
    });
    expect((afterwards as { status: string }).status).toBe("succeeded");
  });

  it("is on the record from dispatch to outcome, so a lost caller can ask what became of it", async () => {
    const { ctx, session } = await open(surfaceWith());
    await dispatchRequest(ctx, { session, request: { name: "r", method: "GET", url: "/things" } });
    const kinds = ctx.events!.list(session).filter((one) => one.operationName === "request").map((one) => one.kind);
    expect(kinds).toContain("lease.acquired");
    expect(kinds).toContain("operation.succeeded");

    const failing = surfaceWith({
      request: vi.fn().mockRejectedValue(new Error("connection reset")),
    } as Partial<AgentSurface>);
    const second = await open(failing);
    const failed = await dispatchRequest(second.ctx, {
      session: second.session,
      request: { name: "r", method: "GET", url: "/things" },
    });
    expect((failed as { status: string }).status).toBe("failed");
    const after = second.ctx.events!.list(second.session).filter((one) => one.operationName === "request").map((one) => one.kind);
    expect(after).toContain("operation.failed");
    // And the target is free again: a failed mutation does not hold its lease.
    const again = await dispatchRequest(second.ctx, {
      session: second.session,
      request: { name: "r", method: "GET", url: "/things" },
    });
    expect(code(again)).not.toBe("CONTROL_BUSY");
  });
});
