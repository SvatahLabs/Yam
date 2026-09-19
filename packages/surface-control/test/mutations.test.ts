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
import { PermissionError, TimeoutError, UnsupportedError } from "@svatah/yam-surface";
import {
  DEFAULT_HOLDER,
  createAdapterFactory,
  createCoordinationStore,
  createEventStore,
  createPromotionStore,
  createRedactionPolicy,
  createSessionStore,
  dispatchAct,
  dispatchConnect,
  dispatchControl,
  dispatchEvents,
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

describe("what a session is promoted from keeps no secret (SF-15)", () => {
  const passwordField = {
    ref: "r1",
    role: "textbox",
    name: "Password",
    tag: "input",
    attrs: { type: "password" },
    text: "",
    neighbours: { before: [], after: [] },
    rolePath: [],
    box: [0, 0, 1, 1],
    index: 0,
    states: [],
  };

  async function promoting(surface: AgentSurface) {
    const { ctx, session } = await open(surface);
    ctx.promotion = createPromotionStore();
    ctx.redaction = createRedactionPolicy();
    return { ctx, session };
  }

  const typed = (ctx: DispatchContext, session: string): unknown =>
    (ctx.promotion!.list(session)[0]!.args as { args?: { value?: unknown } }).args?.value;

  it("withholds a value typed into a password field, though nobody declared it", async () => {
    const { ctx, session } = await promoting(
      surfaceWith({ describe: vi.fn().mockResolvedValue(passwordField) }),
    );
    await dispatchAct(ctx, { session, action: "type", ref: "r1", args: { value: "hunter2" } });
    expect(typed(ctx, session)).toBe("[REDACTED]");
    expect(JSON.stringify(await dispatchEvents(ctx, { session }))).not.toContain("hunter2");
  });

  it("withholds a declared secret, and keeps an ordinary value", async () => {
    const { ctx, session } = await promoting(surfaceWith());
    await dispatchAct(ctx, { session, action: "type", ref: "r1", args: { value: "code-4711" }, secrets: ["code-4711"] });
    await dispatchAct(ctx, { session, action: "type", ref: "r1", args: { value: "ada@example.test" } });
    const values = ctx.promotion!.list(session).map(
      (one) => (one.args as { args?: { value?: unknown } }).args?.value,
    );
    expect(values).toEqual(["[REDACTED]", "ada@example.test"]);
    expect(typed(ctx, session)).toBe("[REDACTED]");
  });
});

describe("what cannot be done is refused as unsupported, not told as a timeout (SF-11, SF-14)", () => {
  it("refuses an action whose capability the adapter lacks, before dispatch", async () => {
    const act = vi.fn().mockResolvedValue({ ok: true });
    const { ctx, session } = await open(
      surfaceWith({ act, kind: "desktop", capabilities: () => ({ drag: false }) as never } as never),
    );
    const refused = await dispatchAct(ctx, { session, action: "dragTo", ref: "r1", ref2: "r2" });
    expect(refused["status"]).toBe("refused");
    expect(code(refused)).toBe("UNSUPPORTED_OPERATION");
    expect(act).not.toHaveBeenCalled();
  });

  it("leaves an action to the adapter on a kind of surface its form was not written for", async () => {
    // Appium: `frames` is false, and `switchFrame` is how it enters a web view.
    const act = vi.fn().mockResolvedValue({ ok: true });
    const { ctx, session } = await open(
      surfaceWith({ act, kind: "mobile", capabilities: () => ({ frames: false }) as never } as never),
    );
    const switched = await dispatchAct(ctx, { session, action: "switchFrame", args: { frame: "WEBVIEW_1" } });
    expect(switched["status"]).toBe("succeeded");
    expect(act).toHaveBeenCalled();
  });

  it("answers an adapter's own refusal as UNSUPPORTED_OPERATION, refused", async () => {
    const { ctx, session } = await open(
      surfaceWith({ act: vi.fn().mockRejectedValue(new UnsupportedError("A browser has no application to quit.")) }),
    );
    const refused = await dispatchAct(ctx, { session, action: "quit" });
    expect(refused["status"]).toBe("refused");
    expect(code(refused)).toBe("UNSUPPORTED_OPERATION");
  });

  it("still answers a real timeout as TIMEOUT", async () => {
    const { ctx, session } = await open(surfaceWith({ act: vi.fn().mockRejectedValue(new TimeoutError("slow")) }));
    const failed = await dispatchAct(ctx, { session, action: "click", ref: "r1" });
    expect(failed["status"]).toBe("failed");
    expect(code(failed)).toBe("TIMEOUT");
  });

  it("answers a permission nobody granted as PERMISSION_REQUIRED, even while connecting", async () => {
    const surface = surfaceWith({
      open: vi.fn().mockRejectedValue(new PermissionError("The macOS Accessibility permission is not granted.")),
    });
    const connected = await dispatchConnect(
      { sessions: createSessionStore() },
      {
        app: "Yam",
        adapter: "http",
        adapterFactory: createAdapterFactory(async () => surface, () => ["http"]),
      },
    );
    expect(connected["status"]).toBe("refused");
    expect(code(connected)).toBe("PERMISSION_REQUIRED");
  });
});
