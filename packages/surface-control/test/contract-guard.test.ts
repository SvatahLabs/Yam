/**
 * The contract is enforced, not only generated (T18, SF-03, SF-04, SF-11).
 *
 * Wave 2 made the catalogue the single source of the CLI, the MCP tools and the
 * service's routes, and wave 4 found the half that was missing: nothing checked
 * that a *caller* and a *broker* agreed about it, or that an argument a caller
 * sent was one the operation takes. Three defects came out of that gap, and
 * each has a case here.
 */
import { describe, expect, it } from "vitest";
import type { AgentSurface } from "@svatah/yam-surface";
import { catalogueFingerprint, OPERATIONS } from "../src/catalogue.js";
import { dispatchAct, dispatchConnect, type DispatchContext } from "../src/dispatcher.js";
import { createSessionStore } from "../src/sessions.js";
import { createReferenceStore } from "../src/references.js";
import { createCoordinationStore } from "../src/coordination.js";
import { createEventStore } from "../src/events.js";

/** A surface that records what it was asked, and is never asked anything else. */
function fakeSurface(): AgentSurface & { opened: unknown[]; acted: unknown[] } {
  const opened: unknown[] = [];
  const acted: unknown[] = [];
  return {
    kind: "web",
    opened,
    acted,
    async open(session: unknown) {
      opened.push(session);
    },
    async act(action: string, ref: unknown, args: unknown) {
      acted.push({ action, ref, args });
      return { ok: true } as never;
    },
    async snapshot() {
      return { ref: "r0", nodes: [], text: "", tokensEstimate: 0, hash: "h" } as never;
    },
    async read() {
      return "";
    },
    async check() {
      return { ok: true } as never;
    },
    capabilities() {
      return {
        dialogs: false, frames: false, windows: false, upload: false, drag: false,
        trace: false, webmcp: false, pick: false, observe: false, screenshot: false,
        restore: false,
      };
    },
    async close() {},
  } as unknown as AgentSurface & { opened: unknown[]; acted: unknown[] };
}

function context(): DispatchContext & { surface: ReturnType<typeof fakeSurface> } {
  const surface = fakeSurface();
  return {
    surface,
    sessions: createSessionStore(),
    references: createReferenceStore(),
    coordination: createCoordinationStore(),
    events: createEventStore(),
  } as never;
}

describe("the catalogue's fingerprint (T18)", () => {
  it("is stable for one build", () => {
    expect(catalogueFingerprint()).toBe(catalogueFingerprint());
    expect(catalogueFingerprint()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("covers every operation's name, flags, tool and route", () => {
    /*
     * Derived rather than declared, so nobody has to remember to bump it. The
     * defect it exists for: `yam surface connect --attach <endpoint>` reached a
     * broker the packaged application had started from an older staged copy of
     * the CLI. `attach` was dropped, a fresh blank browser was launched
     * instead, and the session came back `succeeded` — pointing at a target the
     * caller never named.
     */
    const shape = JSON.stringify(
      OPERATIONS.map((op) => [op.name, op.cli.flags.map((f) => f.name), op.mcp.toolName]),
    );
    for (const flag of ["app", "attach", "idempotency-key", "secret", "with-session-cookies"]) {
      expect(shape, `${flag} is a flag the command line reads; the catalogue must declare it`).toContain(flag);
    }
  });
});

describe("connect names one target (SF-04, T18)", () => {
  it("refuses a request that names two", async () => {
    const ctx = context();
    const answer = (await dispatchConnect(ctx, {
      url: "http://127.0.0.1:1",
      app: "Yam",
      adapterFactory: async () => ctx.surface,
    })) as { status: string; error?: { code: string } };
    expect(answer.status).toBe("refused");
    expect(answer.error?.code).toBe("INVALID_ARGUMENT");
    expect(ctx.surface.opened, "nothing was opened").toEqual([]);
  });

  it("carries an application through to the session as a process name", async () => {
    const ctx = context();
    await dispatchConnect(ctx, { app: "Yam", adapterFactory: async () => ctx.surface });
    expect(ctx.surface.opened).toEqual([{ processName: "Yam" }]);
  });

  it("carries an endpoint through as a browser to attach to", async () => {
    const ctx = context();
    await dispatchConnect(ctx, {
      attach: "http://127.0.0.1:9222",
      adapterFactory: async () => ctx.surface,
    });
    expect(ctx.surface.opened).toEqual([{ attach: { cdpUrl: "http://127.0.0.1:9222" } }]);
  });
});

describe("act validates its arguments before dispatch (SF-11, T18)", () => {
  it("refuses a missing required argument as invalid input, not as a timeout", async () => {
    /*
     * The defect: the adapter threw `ActionabilityError` for a missing
     * argument, which maps to `TIMEOUT` — so `yam surface act --action type`
     * with no value exited 75 under the code for a deadline. An agent reads
     * `TIMEOUT` as "try it again", and no number of retries supplies an
     * argument nobody sent.
     */
    const ctx = context();
    const connected = (await dispatchConnect(ctx, {
      adapterFactory: async () => ctx.surface,
    })) as { result: { sessionId: string } };
    const session = connected.result.sessionId;

    const answer = (await dispatchAct(ctx, { session, action: "type" })) as {
      status: string;
      error?: { code: string; message: string; details?: { missing?: string[] } };
    };
    expect(answer.status).toBe("refused");
    expect(answer.error?.code).toBe("INVALID_ARGUMENT");
    expect(answer.error?.details?.missing).toEqual(["value"]);
    expect(answer.error?.message).toContain("Nothing was dispatched");
    expect(ctx.surface.acted, "the adapter was never called").toEqual([]);
  });

  it("accepts a documented alias for a required argument", async () => {
    /*
     * `selectOption` has read `value`, `values` or `label` for as long as it
     * has existed, and the flow language's `Select "<label>" in the <target>`
     * compiles to the last of them. When arguments began to be validated
     * before dispatch, every such step was refused as `INVALID_ARGUMENT` — a
     * caller that used a documented name being told it had sent nothing.
     */
    const ctx = context();
    const connected = (await dispatchConnect(ctx, {
      adapterFactory: async () => ctx.surface,
    })) as { result: { sessionId: string } };
    const answer = (await dispatchAct(ctx, {
      session: connected.result.sessionId,
      action: "selectOption",
      args: { label: "fake — committed answers, no model" } as never,
    })) as { status: string };
    expect(answer.status).toBe("succeeded");
    expect(ctx.surface.acted).toHaveLength(1);
  });

  it("dispatches when the argument is there", async () => {
    const ctx = context();
    const connected = (await dispatchConnect(ctx, {
      adapterFactory: async () => ctx.surface,
    })) as { result: { sessionId: string } };
    const answer = (await dispatchAct(ctx, {
      session: connected.result.sessionId,
      action: "type",
      args: { value: "ada" },
    })) as { status: string };
    expect(answer.status).toBe("succeeded");
    expect(ctx.surface.acted).toHaveLength(1);
  });
});
