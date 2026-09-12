/**
 * Session — one session, three modes (REQ-ADE-14, Draft 2.27, TV-M01).
 *
 * The merge is only worth making if it is a merge and not a third screen beside
 * the two it replaces. So what is asserted here is exactly that: the surface
 * half and the record half are the states those loaders already produce, the
 * mode is a screen parameter rather than renderer state, the actions are the
 * two screens' actions *by their original ids*, and one `sources` list carries
 * the provenance of both halves in call order.
 *
 * The fake's answers are the catalogue's envelopes, as in `surfaces.test.ts`:
 * an assertion here is about the model and not about a stub written to match it.
 */
import { describe, expect, it } from "vitest";
import {
  SESSION_MODES,
  fakeService,
  modeFrom,
  screenById,
  type FakeResponses,
  type SessionState,
  type SurfacesState,
} from "../src/index.js";

const ok = (result: unknown): unknown => ({
  schemaVersion: "1.0",
  requestId: "req_test",
  status: "succeeded",
  result,
});

const SURFACE: FakeResponses["surface"] = {
  targets: ok({
    adapters: [
      {
        adapter: "playwright",
        registered: true,
        available: true,
        platform: ["darwin"],
        prerequisites: ["Chromium browser (bundled)"],
      },
    ],
    targets: [{ adapter: "playwright", targetId: "localhost:5173", kind: "web", title: "Booking" }],
  }),
  sessions: ok({ sessions: [] }),
};

const load = async (params: Record<string, unknown> = {}): Promise<SessionState> =>
  (await screenById("session").load(fakeService({ surface: SURFACE }), params)) as SessionState;

describe("the mode is a screen parameter (REQ-ADE-14)", () => {
  it("defaults to do, and takes the three the model declares", async () => {
    expect((await load()).mode).toBe("do");
    for (const mode of SESSION_MODES) {
      expect((await load({ mode })).mode).toBe(mode);
    }
  });

  it("refuses a mode nobody declared rather than rendering it", () => {
    expect(modeFrom("shout")).toBe("do");
    expect(modeFrom(undefined)).toBe("do");
    expect(modeFrom("say")).toBe("say");
  });

  it("says which mode it is in, so a capture and a sentence are not one word", async () => {
    expect((await load({ mode: "say" })).subtitle).toContain("say");
    expect((await load({ mode: "record" })).subtitle).toContain("record");
  });
});

describe("the halves are the states their loaders already produced (TV-M01)", () => {
  it("carries the surface half unchanged, field for field", async () => {
    const service = fakeService({ surface: SURFACE });
    const alone = (await screenById("surfaces").load(service, {})) as SurfacesState;
    const merged = await load();
    const { screen, title, subtitle, status, sources, error, ...rest } = alone;
    void screen, title, subtitle, status, sources, error;
    expect(merged.surface).toEqual(rest);
  });

  it("carries the record half, and derives the say half from what it says", async () => {
    const merged = await load({ mode: "say" });
    expect(merged.record).toHaveProperty("capturing");
    expect(merged.say.sentences.map((one) => one.text)).toEqual([...merged.record.sentences]);
    /* Nothing is on disk until it is written: a fresh session has written nothing. */
    expect(merged.say.written).toBe(false);
  });

  it("does not invent a sentence nobody said", async () => {
    const merged = await load({ mode: "say" });
    expect(merged.say.pending).toBeUndefined();
    expect(merged.say.unbound).toBeUndefined();
  });
});

describe("one screen, one provenance (TV-M01)", () => {
  it("joins both halves' sources in call order, without losing any", async () => {
    const service = fakeService({ surface: SURFACE });
    const surfaces = await screenById("surfaces").load(service, {});
    const record = await screenById("record").load(service, {});
    const merged = await load();
    expect(merged.sources).toEqual([...surfaces.sources, ...record.sources]);
  });
});

describe("the actions keep their ids (TV-M02)", () => {
  it("offers what the two screens offered, by their original ids", () => {
    const session = screenById("session");
    const ids = new Set(session.actions.map((one) => one.id));
    for (const id of ["surface.connect", "surface.act", "surface.check", "record.accept", "capture.stop"]) {
      expect(ids.has(id), `${id} is reachable from Session`).toBe(true);
    }
  });

  it("invents no action of its own", () => {
    const session = screenById("session");
    const known = new Set([
      ...screenById("surfaces").actions.map((one) => one.id),
      ...screenById("record").actions.map((one) => one.id),
    ]);
    for (const action of session.actions) expect(known.has(action.id)).toBe(true);
  });

  it("gates an action by the mode it belongs to (TV-15)", () => {
    const act = screenById("session").actions.find((one) => one.id === "surface.act")!;
    const accept = screenById("session").actions.find((one) => one.id === "record.accept")!;
    const base = { screen: "session", title: "", subtitle: "", status: "", sources: ["x"] } as const;
    const connected = { ...base, surface: { session: {} }, record: { decision: {} } };

    expect(act.availableWhen({ ...connected, mode: "do" } as never)).toBe(true);
    expect(act.availableWhen({ ...connected, mode: "record" } as never)).toBe(false);
    expect(accept.availableWhen({ ...connected, mode: "record" } as never)).toBe(true);
    expect(accept.availableWhen({ ...connected, mode: "do" } as never)).toBe(false);
  });

  it("asks the mode question only of a screen that has modes", () => {
    /*
     * A screen with no `mode` is not a screen with modes: the gate says which
     * modes an action belongs to, and must never make an action unavailable by
     * answering a question nobody asked.
     */
    const act = screenById("session").actions.find((one) => one.id === "surface.act")!;
    const flat = { screen: "surfaces", title: "", subtitle: "", status: "", sources: ["x"], session: {} };
    expect(act.availableWhen(flat as never)).toBe(true);
  });

  it("does not gate connecting, which every mode needs first", () => {
    const connect = screenById("session").actions.find((one) => one.id === "surface.connect")!;
    const base = { screen: "session", title: "", subtitle: "", status: "", sources: ["x"], surface: {} };
    for (const mode of SESSION_MODES) {
      expect(connect.availableWhen({ ...base, mode } as never), mode).toBe(true);
    }
  });

  it("declares no keys: the cockpit and the app each keep their own (TV-M03)", () => {
    expect(screenById("session")).not.toHaveProperty("keys");
  });
});
