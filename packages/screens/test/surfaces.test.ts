/**
 * Surfaces — the connect flow's model, state by state (T14, SF-04, SF-05, SF-17).
 *
 * These drive the screen the way `yam ui --json` and the app both drive it: load
 * it against a fake broker, and run its actions. The fake's answers are the
 * catalogue's `ResultEnvelope`, the same shape a real broker returns — so an
 * assertion here is about the model, not about a stub written to match it.
 *
 * Every SF-17 state a *connect* flow can be in gets a case: empty, an
 * unsupported adapter with its exact prerequisite, a disconnected session, a
 * discovery failure, and the connected list. The action inspector's states
 * (busy, stale, unknown outcome) are T15's, on the selected session.
 */
import { describe, expect, it } from "vitest";
import { actionById, fakeService, screenById, type FakeResponses, type SurfacesState } from "../src/index.js";

/** A succeeded envelope around a result, as the broker returns it. */
const ok = (result: unknown): unknown => ({
  schemaVersion: "1.0",
  requestId: "req_test",
  status: "succeeded",
  result,
});

const ADAPTERS = [
  {
    adapter: "playwright",
    registered: true,
    available: true,
    platform: ["darwin", "linux", "win32"],
    prerequisites: ["Chromium browser (bundled)"],
  },
  {
    adapter: "http",
    registered: true,
    available: true,
    platform: ["darwin", "linux", "win32"],
    prerequisites: [],
  },
  {
    adapter: "uia",
    registered: true,
    available: false,
    platform: ["win32"],
    reason: 'Adapter "uia" requires win32; this host is darwin.',
    prerequisites: ["Windows UI Automation runtime"],
  },
];

const load = async (responses: FakeResponses["surface"], selected?: string): Promise<SurfacesState> =>
  (await screenById("surfaces").load(
    fakeService({ surface: responses }),
    selected === undefined ? {} : { selected },
  )) as SurfacesState;

describe("Surfaces discovery, grouped by platform with honest states (SF-04, SF-17)", () => {
  it("groups adapters by family and reports how many are ready", async () => {
    const state = await load({ targets: ok({ adapters: ADAPTERS, targets: [] }), sessions: ok({ sessions: [] }) });
    expect(state.discovery).toBe("ready");
    const families = state.groups.map((one) => one.family);
    expect(families).toContain("Browser");
    expect(families).toContain("API");
    expect(families).toContain("Native app");
    // "2 of 3 adapters ready" — the subtitle is the count, not a guess.
    expect(state.subtitle).toContain("2 of 3 adapters ready");
    expect(state.anyConnectable).toBe(true);
  });

  it("shows an unavailable adapter's exact prerequisite, never hides it", async () => {
    const state = await load({ targets: ok({ adapters: ADAPTERS, targets: [] }), sessions: ok({ sessions: [] }) });
    const native = state.groups.find((one) => one.family === "Native app")!;
    const uia = native.adapters.find((one) => one.adapter === "uia")!;
    expect(uia.available).toBe(false);
    expect(uia.pill.label).toBe("unavailable");
    // The reason is the service's own words, and the prerequisite is spelled out.
    expect(uia.reason).toContain("requires win32");
    expect(uia.prerequisites).toContain("Windows UI Automation runtime");
  });

  it("is the empty state when nothing is open, with the design's own words", async () => {
    const state = await load({ targets: ok({ adapters: ADAPTERS, targets: [] }), sessions: ok({ sessions: [] }) });
    expect(state.sessions).toEqual([]);
    expect(state.status).toBe("Choose a browser, app, device or API to control.");
  });

  it("carries a discovery failure inline, never blanks the screen (SF-17)", async () => {
    // The broker did not answer: targets is a refusal, not a succeeded envelope.
    const state = await load({
      targets: { schemaVersion: "1.0", requestId: "r", status: "refused", error: { message: "broker down", retryable: true } },
      sessions: ok({ sessions: [] }),
    });
    expect(state.discovery).toBe("error");
    expect(state.discoveryMessage).toBe("broker down");
    // The base error is *not* set, so the shell still draws the connect form.
    expect(state.error).toBeUndefined();
  });
});

describe("Surfaces sessions — an agent's as much as a person's (SF-05, SF-13)", () => {
  const SESSIONS = ok({
    sessions: [
      { sessionId: "s_ready", adapter: "playwright", kind: "web", status: "ready", createdAt: "2026-09-08T00:00:00Z" },
      { sessionId: "s_gone", adapter: "playwright", kind: "web", status: "disconnected", createdAt: "2026-09-08T00:01:00Z" },
    ],
  });

  it("lists open sessions with a status pill that is never a bare colour", async () => {
    const state = await load({ targets: ok({ adapters: ADAPTERS, targets: [] }), sessions: SESSIONS });
    expect(state.sessions.map((one) => one.sessionId)).toEqual(["s_ready", "s_gone"]);
    expect(state.sessions[0]!.pill).toEqual({ tone: "pass", label: "ready" });
    // A disconnected session reads disconnected, not blank (SF-17).
    expect(state.sessions[1]!.pill).toEqual({ tone: "abort", label: "disconnected" });
  });

  it("marks the selected session, which T15's inspector reads", async () => {
    const state = await load({ targets: ok({ adapters: ADAPTERS, targets: [] }), sessions: SESSIONS }, "s_gone");
    expect(state.selected).toBe("s_gone");
    expect(state.sessions.find((one) => one.selected)?.sessionId).toBe("s_gone");
  });
});

describe("Surfaces actions run against the broker (SF-04, SF-05)", () => {
  it("connect refuses with no URL, and never touches the broker", async () => {
    const service = fakeService({ surface: { targets: ok({ adapters: ADAPTERS, targets: [] }) } });
    const outcome = await actionById("surface.connect")!.run(service, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Enter a URL");
    expect(service.calls.some((one) => one.method === "postSessions")).toBe(false);
  });

  it("connect reports the adapter the service used, not the one asked for", async () => {
    // Asked for nothing; the service chose bidi. The message says bidi.
    const service = fakeService({
      surface: { connect: ok({ sessionId: "s_new", adapter: "bidi", kind: "web" }) },
    });
    const outcome = await actionById("surface.connect")!.run(service, { url: "http://127.0.0.1:4173" });
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toBe("Connected with the bidi adapter.");
    expect(outcome.goTo).toBe("surfaces");
    expect(outcome.params?.selected).toBe("s_new");
    const call = service.calls.find((one) => one.method === "postSessions");
    expect(call?.args[0]).toEqual({ url: "http://127.0.0.1:4173" });
  });

  it("connect surfaces the service's refusal reason, not a generic one (SF-17)", async () => {
    const service = fakeService({
      surface: {
        connect: {
          schemaVersion: "1.0",
          requestId: "r",
          status: "refused",
          error: { code: "ADAPTER_UNAVAILABLE", message: 'Adapter "uia" requires win32; this host is darwin.', retryable: false },
        },
      },
    });
    const outcome = await actionById("surface.connect")!.run(service, { url: "app://x", adapter: "uia" });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("requires win32");
  });

  it("disconnect is only offered with a session selected, and closes it", async () => {
    const connectAction = actionById("surface.disconnect")!;
    // availableWhen needs a selected session.
    expect(connectAction.availableWhen({ screen: "surfaces", title: "", subtitle: "", status: "", sources: [] })).toBe(false);
    expect(
      connectAction.availableWhen({ screen: "surfaces", title: "", subtitle: "", status: "", sources: [], selected: "s_1" } as never),
    ).toBe(true);

    const service = fakeService({});
    const outcome = await connectAction.run(service, { selected: "s_1" });
    expect(outcome.ok).toBe(true);
    expect(outcome.params?.selected).toBeUndefined();
    expect(service.calls.find((one) => one.method === "deleteSessionsBySession")?.args[0]).toBe("s_1");
  });

  it("recheck reports readiness and reloads discovery", async () => {
    const service = fakeService({ surface: { targets: ok({ adapters: ADAPTERS, targets: [] }) } });
    const outcome = await actionById("surface.discover")!.run(service, {});
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toBe("2 of 3 adapters ready.");
    expect(outcome.goTo).toBe("surfaces");
  });
});
