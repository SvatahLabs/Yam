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
import {
  actionById,
  fakeService,
  problemFor,
  screenById,
  surfaceOutcomeView,
  type FakeResponses,
  type SurfaceActionOffer,
  type SurfacesState,
} from "../src/index.js";

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

/* ────────────────────────────────────────────────────────────────────────────
 * T15 — the selected-target action inspector
 * ──────────────────────────────────────────────────────────────────────────── */

const CAPS = ok({
  adapter: "playwright",
  kind: "web",
  capabilities: { drag: true, upload: false, dialogs: false, frames: false, windows: true, screenshot: true },
});

const SNAP = ok({
  snapshotId: "snap_1",
  generation: 0,
  truncated: false,
  nodes: [
    { ref: "r0", role: "form", depth: 0, states: [] },
    { ref: "r1", role: "textbox", name: "Username", depth: 1, states: [], value: "" },
    { ref: "r2", role: "button", name: "Sign in", depth: 1, states: [] },
  ],
});

const ONE_SESSION = ok({
  sessions: [{ sessionId: "s_1", adapter: "playwright", kind: "web", status: "ready" }],
});

const connected = async (
  extra: Partial<NonNullable<FakeResponses["surface"]>> = {},
  params: Record<string, unknown> = {},
): Promise<SurfacesState> =>
  (await screenById("surfaces").load(
    fakeService({
      surface: {
        targets: ok({ adapters: ADAPTERS, targets: [] }),
        sessions: ONE_SESSION,
        capabilities: CAPS,
        snapshot: SNAP,
        ...extra,
      },
    }),
    { selected: "s_1", ...params },
  )) as SurfacesState;

describe("the connected surface: a tree to select from (T15, SF-10)", () => {
  it("draws the semantic tree, which is available where a screenshot is not", async () => {
    const state = await connected();
    expect(state.session?.adapter).toBe("playwright");
    expect(state.tree.map((one) => one.ref)).toEqual(["r0", "r1", "r2"]);
    expect(state.tree[1]).toMatchObject({ role: "textbox", name: "Username", depth: 1 });
    expect(state.snapshotId).toBe("snap_1");
  });

  it("describes the selected control and says what it is", async () => {
    const state = await connected(
      { describe: ok({ ref: "r1", role: "textbox", name: "Username", states: [], value: "" }) },
      { ref: "r1" },
    );
    expect(state.element?.name).toBe("Username");
    // "Text field · Enabled", the mockup's own line.
    expect(state.element?.summary).toBe("Text field · Enabled");
    expect(state.tree.find((one) => one.selected)?.ref).toBe("r1");
  });

  it("a reference that no longer describes is the stale state, with the way out", async () => {
    const state = await connected(
      {
        describe: {
          schemaVersion: "1.0", requestId: "r", status: "refused",
          error: { code: "STALE_REFERENCE", message: "Reference \"r9\" was not in snapshot snap_1.", retryable: false },
        },
      },
      { ref: "r9" },
    );
    expect(state.problem?.kind).toBe("stale");
    expect(state.problem?.nextAction).toBe("Refresh and select again");
    expect(state.problem?.nextActionId).toBe("surface.refresh");
  });
});

describe("the action form comes from the catalogue (T15, SF-09, SF-11)", () => {
  it("offers only what the adapter can do, and never an action it cannot", async () => {
    const state = await connected();
    const offered = state.offers.map((one) => one.action);
    // `drag` is a capability this adapter has; `upload` and `dialog` are not.
    expect(offered).toContain("dragTo");
    expect(offered).not.toContain("upload");
    expect(offered).not.toContain("dialog");
  });

  it("gives fill a value, click the control, drag two, navigate a URL", async () => {
    const state = await connected();
    const form = (action: string): SurfaceActionOffer =>
      state.offers.find((one) => one.action === action)!;

    expect(form("type").fields.map((f) => f.name)).toEqual(["value"]);
    expect(form("type").needsRef).toBe(true);

    expect(form("click").fields).toEqual([]);
    expect(form("click").needsRef).toBe(true);

    expect(form("dragTo").needsRef).toBe(true);
    expect(form("dragTo").needsRef2).toBe(true);

    expect(form("navigate").fields.map((f) => f.name)).toEqual(["url"]);
    expect(form("navigate").needsRef).toBe(false);
  });

  it("opens on the action that suits the control, so 'Choose an action' is never a dead end", async () => {
    const onText = await connected(
      { describe: ok({ ref: "r1", role: "textbox", name: "Username", states: [] }) },
      { ref: "r1" },
    );
    expect(onText.action).toBe("type");

    const onButton = await connected(
      { describe: ok({ ref: "r2", role: "button", name: "Sign in", states: [] }) },
      { ref: "r2" },
    );
    expect(onButton.action).toBe("click");

    // And an action is always chosen, even with nothing selected.
    const nothing = await connected();
    expect(nothing.action).toBeDefined();
    expect(nothing.offers.some((one) => one.chosen)).toBe(true);
  });

  it("an HTTP surface has no element form; it has the request form", async () => {
    const state = await connected({
      capabilities: ok({ adapter: "http", kind: "http", capabilities: {} }),
      sessions: ok({ sessions: [{ sessionId: "s_1", adapter: "http", kind: "http", status: "ready" }] }),
    });
    expect(state.httpSurface).toBe(true);
    expect(state.offers).toEqual([]);
    expect(state.tree).toEqual([]);
  });
});

describe("dispatch and verification are two things (T15, SF-11)", () => {
  const actOk = ok({ ok: true, ref: "r1" });

  it("an act with no postcondition is dispatched and NOT verified", async () => {
    const view = surfaceOutcomeView({ act: actOk })!;
    expect(view.dispatched).toBe(true);
    expect(view.verified).toBe(false);
    expect(view.verification).toBe("none");
    expect(view.summary).toContain("Not verified");
  });

  it("a postcondition that passed is the only thing that makes it verified", async () => {
    const view = surfaceOutcomeView({ act: actOk, check: ok({ ok: true, actual: "ada", expected: "ada" }) })!;
    expect(view.verified).toBe(true);
    expect(view.verification).toBe("passed");
  });

  it("a deliberately wrong postcondition reads FAILED, never verified", async () => {
    // The gate's own case: a check that does not hold must not report success.
    const view = surfaceOutcomeView({
      act: actOk,
      check: ok({ ok: false, actual: "ada", expected: "not-what-was-typed" }),
    })!;
    expect(view.dispatched).toBe(true);
    expect(view.verified).toBe(false);
    expect(view.verification).toBe("failed");
    expect(view.actual).toBe("ada");
    expect(view.expected).toBe("not-what-was-typed");
    expect(view.summary).toContain("did not hold");
  });

  it("a refused act is not dispatched, and carries the state it put the surface in", async () => {
    const view = surfaceOutcomeView({
      act: {
        schemaVersion: "1.0", requestId: "r", status: "refused",
        error: { code: "CONTROL_BUSY", message: "Another client holds the lease.", retryable: true },
      },
    })!;
    expect(view.dispatched).toBe(false);
    expect(view.verified).toBe(false);
    expect(view.problem?.kind).toBe("busy");
  });

  it("never offers an unqualified retry for an unknown outcome (SF-14)", () => {
    const problem = problemFor("OUTCOME_UNKNOWN", "The response was lost.")!;
    expect(problem.kind).toBe("unknown");
    expect(problem.nextAction).toContain("Inspect the current state");
    expect(problem.nextAction.toLowerCase()).not.toContain("retry");
  });
});

describe("the act action sends a schema-valid request (T15, SF-11)", () => {
  it("sends the action, the ref, the snapshot and the typed args", async () => {
    const service = fakeService({ surface: { act: ok({ ok: true, ref: "r1" }) } });
    const outcome = await actionById("surface.act")!.run(service, {
      selected: "s_1",
      ref: "r1",
      action: "type",
      snapshot: "snap_1",
      args: { value: "ada" },
    });
    expect(outcome.ok).toBe(true);
    const call = service.calls.find((one) => one.method === "postSessionsBySessionAct")!;
    expect(call.args[0]).toBe("s_1");
    expect(call.args[1]).toEqual({ action: "type", ref: "r1", snapshot: "snap_1", args: { value: "ada" } });
    // No postcondition was asked for, so no check ran and nothing is verified.
    expect(service.calls.some((one) => one.method === "postSessionsBySessionCheck")).toBe(false);
    expect(outcome.message).toContain("Not verified");
  });

  it("runs the postcondition when one is given, and reports it failing", async () => {
    const service = fakeService({
      surface: { act: ok({ ok: true, ref: "r1" }), check: ok({ ok: false, actual: "ada", expected: "zoe" }) },
    });
    const outcome = await actionById("surface.act")!.run(service, {
      selected: "s_1", ref: "r1", action: "type", args: { value: "ada" },
      verify: { kind: "value", value: "zoe" },
    });
    const check = service.calls.find((one) => one.method === "postSessionsBySessionCheck")!;
    expect(check.args[1]).toEqual({ predicate: { kind: "value", value: "zoe" }, subject: "ref", ref: "r1" });
    expect(outcome.message).toContain("did not hold");
    expect(surfaceOutcomeView(outcome.value)!.verified).toBe(false);
  });

  it("carries the service's refusal reason rather than one of its own", async () => {
    const service = fakeService({
      surface: {
        act: {
          schemaVersion: "1.0", requestId: "r", status: "refused",
          error: { code: "STALE_REFERENCE", message: "The target has changed. Take a new snapshot.", retryable: false },
        },
      },
    });
    const outcome = await actionById("surface.act")!.run(service, {
      selected: "s_1", ref: "r1", action: "click",
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Take a new snapshot");
    expect(surfaceOutcomeView(outcome.value)!.problem?.kind).toBe("stale");
  });

  it("an HTTP request sends method and path, and reports the status", async () => {
    const service = fakeService({
      surface: { request: ok({ response: { status: 201, statusText: "Created", headers: {}, body: "{}", durationMs: 3 } }) },
    });
    const outcome = await actionById("surface.request")!.run(service, {
      selected: "s_1", method: "post", url: "/things",
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toBe("POST /things → 201");
    const call = service.calls.find((one) => one.method === "postSessionsBySessionRequest")!;
    expect(call.args[1]).toEqual({ request: { name: "request", method: "POST", url: "/things" } });
  });
});
