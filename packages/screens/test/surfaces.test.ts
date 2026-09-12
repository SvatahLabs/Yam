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
import { DESKTOP_HOLDER } from "../src/holder.js";
import {
  actionById,
  fakeService,
  problemFor,
  screenById,
  surfaceOutcomeView,
  type FakeResponses,
  type SurfaceActionOffer,
  loadSurface,
  type SurfaceLoad,
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

/*
 * TV-M04: Surfaces is the **do** mode of Session and its id is gone, so what is
 * loaded here is the half — the same function `session.ts` calls, so these cases
 * still exercise the thing the product runs.
 */
const load = async (responses: FakeResponses["surface"], selected?: string): Promise<SurfaceLoad> =>
  await loadSurface(fakeService({ surface: responses }), selected === undefined ? {} : { selected });

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

  /*
   * An empty list is either an answer or the absence of one (SF-17).
   *
   * Found in the running product: with no broker, Surfaces drew "Could not
   * reach the surface broker" in its alert and "No adapter is installed" in the
   * pane underneath — on a machine with eight adapters installed. The pane
   * turned Yam's own failure to ask into a claim about the user's system, and
   * contradicted the alert above it while doing so.
   */
  it("says nothing could be asked, rather than that nothing is installed", async () => {
    const state = await load({
      targets: {
        schemaVersion: "1.0",
        requestId: "r",
        status: "refused",
        error: { message: "broker down", retryable: true },
      },
      sessions: ok({ sessions: [] }),
    });
    expect(state.groups).toEqual([]);
    expect(state.discoveryEmpty).toMatch(/could not ask/i);
    expect(state.discoveryEmpty).toMatch(/not a statement about what you have installed/i);
    expect(state.discoveryEmpty).not.toMatch(/no adapter is installed/i);
  });

  it("says nothing is installed only when the broker answered and listed nothing", async () => {
    const state = await load({
      targets: ok({ adapters: [], targets: [] }),
      sessions: ok({ sessions: [] }),
    });
    expect(state.discovery).toBe("ready");
    expect(state.groups).toEqual([]);
    expect(state.discoveryEmpty).toMatch(/no adapter is installed/i);
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
  /*
   * The refusal stands; its wording does not.
   *
   * This asserted "Enter a URL", which was the copy over-promising: it went on
   * to say "a browser, app, device or API" for a field that took the first only,
   * while the runtime has taken three named targets since SF-04. The test was
   * holding the wrong sentence in place, so it is the sentence that changed.
   */
  it("connect refuses with no target, and never touches the broker", async () => {
    const service = fakeService({ surface: { targets: ok({ adapters: ADAPTERS, targets: [] }) } });
    const outcome = await actionById("surface.connect")!.run(service, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Name a target");
    expect(service.calls.some((one) => one.method === "postSessions")).toBe(false);
  });

  it("connect reports the adapter the service used, not the one asked for", async () => {
    // Asked for nothing; the service chose bidi. The message says bidi.
    const service = fakeService({
      surface: { connect: ok({ sessionId: "s_new", adapter: "bidi", kind: "web" }) },
    });
    const outcome = await actionById("surface.connect")!.run(service, { url: "http://127.0.0.1:4173" });
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toBe("Connected with the bidi adapter, and the window is visible.");
    expect(outcome.goTo).toBe("session");
    expect(outcome.params?.selected).toBe("s_new");
    const call = service.calls.find((one) => one.method === "postSessions");
    /*
     * `headed` is sent, and sent true: the runtime has taken it since the
     * adapter factory was written and neither renderer offered it, so connecting
     * from the Session screen drove a browser nobody could see.
     */
    expect(call?.args[0]).toEqual({ url: "http://127.0.0.1:4173", headed: true });
  });

  it("connects hidden when asked to, and says so", async () => {
    const service = fakeService({
      surface: { connect: ok({ sessionId: "s_new", adapter: "playwright", kind: "web" }) },
    });
    const outcome = await actionById("surface.connect")!.run(service, {
      url: "http://127.0.0.1:4173",
      headed: false,
    });
    expect(outcome.message).toContain("no window");
    const call = service.calls.find((one) => one.method === "postSessions");
    expect((call?.args[0] as { headed?: boolean }).headed).toBe(false);
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
    expect(connectAction.availableWhen({ screen: "session", title: "", subtitle: "", status: "", sources: [] })).toBe(false);
    expect(
      connectAction.availableWhen({ screen: "session", title: "", subtitle: "", status: "", sources: [], selected: "s_1" } as never),
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
    expect(outcome.goTo).toBe("session");
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
): Promise<SurfaceLoad> =>
  (await loadSurface(
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
  )) as SurfaceLoad;

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
    expect(call.args[1]).toEqual({
      action: "type",
      holder: DESKTOP_HOLDER,
      ref: "r1",
      snapshot: "snap_1",
      args: { value: "ada" },
    });
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
    expect(call.args[1]).toEqual({
      request: { name: "request", method: "POST", url: "/things" },
      holder: DESKTOP_HOLDER,
    });
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * T16 — shared control, and the agent that shares it
 * ──────────────────────────────────────────────────────────────────────────── */

describe("a person and an agent share one target (T16, SF-13)", () => {
  const heldBy = (holder: string): unknown =>
    ok({
      sessions: [
        { sessionId: "s_1", adapter: "playwright", kind: "web", status: "ready", controller: holder },
      ],
    });

  it("says who holds a session, in words rather than a colour", async () => {
    const mine = await load({ targets: ok({ adapters: ADAPTERS, targets: [] }), sessions: heldBy("Yam desktop") });
    expect(mine.sessions[0]!.control).toBe("You control");
    expect(mine.sessions[0]!.heldByYou).toBe(true);

    const theirs = await load({ targets: ok({ adapters: ADAPTERS, targets: [] }), sessions: heldBy("agent-1") });
    expect(theirs.sessions[0]!.control).toBe("agent-1 controls");
    expect(theirs.sessions[0]!.heldByYou).toBe(false);

    const nobody = await load({ targets: ok({ adapters: ADAPTERS, targets: [] }), sessions: ONE_SESSION });
    expect(nobody.sessions[0]!.control).toBe("Nobody");
  });

  it("a target somebody else holds is the busy state, naming them and the handoff", async () => {
    const state = await connected({ sessions: heldBy("agent-1"), capabilities: CAPS, snapshot: SNAP });
    expect(state.problem?.kind).toBe("busy");
    expect(state.problem?.message).toContain("agent-1");
    expect(state.problem?.nextAction).toContain("Take control");
    expect(state.problem?.nextActionId).toBe("surface.take-control");
    expect(state.session?.control).toBe("agent-1 controls");
  });

  it("take control is offered only when someone else has it, and release only when you do", async () => {
    const take = actionById("surface.take-control")!;
    const release = actionById("surface.release-control")!;
    const base = { screen: "session", title: "", subtitle: "", status: "", sources: [] };

    expect(take.availableWhen({ ...base, session: { heldByYou: false } } as never)).toBe(true);
    expect(take.availableWhen({ ...base, session: { heldByYou: true } } as never)).toBe(false);
    expect(release.availableWhen({ ...base, session: { heldByYou: true } } as never)).toBe(true);
    expect(release.availableWhen({ ...base, session: { heldByYou: false } } as never)).toBe(false);
    // With no session at all, neither is offered.
    expect(take.availableWhen(base as never)).toBe(false);
    expect(release.availableWhen(base as never)).toBe(false);
  });

  it("taking control is an explicit handoff, and says who is driving after it", async () => {
    const service = fakeService({ surface: { control: ok({ holder: "Yam desktop", heldByYou: true }) } });
    const outcome = await actionById("surface.take-control")!.run(service, { selected: "s_1" });
    expect(outcome.ok).toBe(true);
    const call = service.calls.find((one) => one.method === "postSessionsBySessionControl")!;
    // `force` is what a person means by pressing Take control (SF-13).
    expect(call.args[1]).toEqual({ action: "take", holder: "Yam desktop", force: true });
  });

  it("giving up control leaves the target free", async () => {
    const service = fakeService({ surface: { control: ok({ heldByYou: false }) } });
    const outcome = await actionById("surface.release-control")!.run(service, { selected: "s_1" });
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain("Anyone can drive");
    expect(service.calls.find((one) => one.method === "postSessionsBySessionControl")!.args[1])
      .toEqual({ action: "release", holder: "Yam desktop" });
  });
});

describe("connecting an agent (T16, SF-07)", () => {
  it("offers a generic configuration, not a Yam-specific one, and no story to choose", async () => {
    const state = await load({ targets: ok({ adapters: ADAPTERS, targets: [] }), sessions: ok({ sessions: [] }) });
    const config = JSON.parse(state.agent.config) as {
      mcpServers: { yam: { command: string; args: string[] } };
    };
    expect(config.mcpServers.yam.command).toBe("npx");
    expect(config.mcpServers.yam.args).toContain("@svatah/yam");
    expect(config.mcpServers.yam.args).toContain("mcp");
    expect(state.agent.brokerReady).toBe(true);
  });

  it("claims only what it checked", async () => {
    const reachable = await load({ targets: ok({ adapters: ADAPTERS, targets: [] }), sessions: ok({ sessions: [] }) });
    expect(reachable.agent.checks.join(" ")).toContain("reaches the same sessions");

    const down = await load({
      targets: { schemaVersion: "1.0", requestId: "r", status: "refused", error: { message: "no broker", retryable: true } },
      sessions: ok({ sessions: [] }),
    });
    expect(down.agent.brokerReady).toBe(false);
    expect(down.agent.checks.join(" ")).toContain("did not answer");
  });

  it("the connection test reports the broker, and refuses honestly when it is down", async () => {
    const up = fakeService({ surface: { targets: ok({ adapters: ADAPTERS, targets: [] }) } });
    const good = await actionById("surface.test-agent")!.run(up, {});
    expect(good.ok).toBe(true);
    expect(good.message).toContain("3 adapters");

    const down = fakeService({
      surface: {
        targets: { schemaVersion: "1.0", requestId: "r", status: "refused", error: { message: "no broker", retryable: true } },
      },
    });
    const bad = await actionById("surface.test-agent")!.run(down, {});
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("no broker");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * T17 — Save as automation
 * ──────────────────────────────────────────────────────────────────────────── */

describe("promoting a session into a proposal (T17, SF-19)", () => {
  const STEPS = [
    { seq: 1, at: "2026-09-08T00:00:00Z", call: "act", args: { action: "type", value: "ada" }, ref: "r1" },
    { seq: 2, at: "2026-09-08T00:00:01Z", call: "act", args: { action: "click" }, ref: "r2" },
  ];

  it("promotes what the session did, and says the bindings are unverified", async () => {
    const service = fakeService({
      surface: { events: ok({ events: [], steps: STEPS }) },
    });
    const outcome = await actionById("surface.save-automation")!.run(service, { selected: "s_1" });
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain("2 step(s)");
    // SF-19: promotion creates unverified proposals only.
    expect(outcome.message).toContain("unverified");

    // It reads what happened from the broker, then compiles those lines — it
    // does not replay what this client believes it asked for.
    expect(service.calls.some((one) => one.method === "getSessionsBySessionEvents")).toBe(true);
    const compile = service.calls.find((one) => one.method === "postTrajectoryCompile")!;
    expect((compile.args[0] as { lines?: unknown[] }).lines).toEqual(STEPS);
  });

  it("refuses a session that has only been looked at, rather than writing an empty proposal", async () => {
    const service = fakeService({ surface: { events: ok({ events: [], steps: [] }) } });
    const outcome = await actionById("surface.save-automation")!.run(service, { selected: "s_1" });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("looked at, not acted on");
    expect(service.calls.some((one) => one.method === "postTrajectoryCompile")).toBe(false);
  });

  it("forces neither a flow nor a run: it compiles a trajectory and nothing else", async () => {
    const service = fakeService({ surface: { events: ok({ events: [], steps: STEPS }) } });
    await actionById("surface.save-automation")!.run(service, { selected: "s_1" });
    const called = service.calls.map((one) => one.method);
    expect(called).not.toContain("postRun");
    expect(called).not.toContain("postCompile");
    expect(called).not.toContain("putFlowsByFile");
  });
});

/*
 * Verification of wave 3 (SF-11, SF-13, SF-17).
 *
 * Two defects the driven checks missed because nothing acted *after* taking
 * control, and nothing read the pill after a failure: the desktop named itself
 * when it took a target and not when it acted on it, so the broker refused its
 * next action as held by "Yam desktop"; and a timed-out navigation read as
 * "refused" — never sent — when its outcome was unknown.
 */
describe("the desktop names itself on every mutation, and says what an outcome was", () => {

  it("act carries the desktop's own name, the one take-control used", async () => {
    const service = fakeService({});
    const act = actionById("surface.act")!;
    await act.run(service, { selected: "s_1", action: "click", ref: "r1" });
    const sent = service.calls.find((one) => one.method === "postSessionsBySessionAct");
    expect((sent?.args[1] as { holder?: string }).holder).toBe(DESKTOP_HOLDER);
  });

  it("request carries it too — a request is a mutation", async () => {
    const service = fakeService({});
    const request = actionById("surface.request")!;
    await request.run(service, { selected: "s_1", url: "/things", method: "get" });
    const sent = service.calls.find((one) => one.method === "postSessionsBySessionRequest");
    expect((sent?.args[1] as { holder?: string }).holder).toBe(DESKTOP_HOLDER);
  });

  it("a timed-out act is an UNKNOWN outcome with inspection as the way out, never 'refused'", () => {
    const view = surfaceOutcomeView({
      act: {
        status: "failed",
        error: { code: "TIMEOUT", message: "page.goto: Timeout 10000ms exceeded." },
      },
    })!;
    expect(view.dispatched).toBe(false);
    expect(view.outcome).toBe("unknown");
    expect(view.problem?.kind).toBe("unknown");
    expect(view.problem?.nextAction).toMatch(/inspect/i);
    expect(view.problem?.nextAction).not.toMatch(/retry/i);
  });

  it("a failed act is 'failed', a refused one 'refused', a dispatched one 'succeeded'", () => {
    const failed = surfaceOutcomeView({
      act: { status: "failed", error: { code: "CHECK_FAILED", message: "no" } },
    })!;
    const refused = surfaceOutcomeView({
      act: { status: "refused", error: { code: "STALE_REFERENCE", message: "gone" } },
    })!;
    const fine = surfaceOutcomeView({ act: { status: "succeeded", result: { ok: true } } })!;
    expect([failed.outcome, refused.outcome, fine.outcome]).toEqual(["failed", "refused", "succeeded"]);
  });
});

describe("a selected control belongs to the snapshot it was chosen from (SF-10)", () => {
  /**
   * Verification of wave 3. The screen re-snapshots on every reload and the
   * ids come back the same, so a control chosen before a navigation described
   * successfully afterwards — as whatever held its id on the new page. The
   * stale state could not occur. Now the selection carries its snapshot and
   * the broker decides.
   */
  it("passes the snapshot the control came from to describe", async () => {
    const service = fakeService({
      surface: {
        sessions: ok({ sessions: [{ sessionId: "s_1", adapter: "playwright", kind: "web", status: "ready", createdAt: "now" }] }),
        capabilities: ok({ adapter: "playwright", kind: "web", capabilities: {} }),
        snapshot: ok({ snapshotId: "snap_2", nodes: [{ ref: "r0", role: "textbox", name: "Username", depth: 0 }] }),
        describe: ok({ ref: "r0", role: "textbox", name: "Username" }),
      },
    });
    await loadSurface(service, { selected: "s_1", ref: "r0", snapshot: "snap_1" });
    const described = service.calls.find((one) => one.method === "postSessionsBySessionDescribe")!;
    expect((described.args[1] as { snapshot?: string }).snapshot).toBe("snap_1");
  });

  it("refreshing forgets the control and its snapshot together", async () => {
    const outcome = await actionById("surface.refresh")!.run(fakeService({}), { selected: "s_1" });
    expect(outcome.params).toEqual({ selected: "s_1", ref: undefined, snapshot: undefined });
  });
});

describe("a proposal needs a project (T14, T17)", () => {
  /**
   * Verification of wave 3. The app's private surfaces workspace loads like a
   * project, so a promotion with none open "succeeded" — into a directory
   * under the app's own data that nobody chose and nobody would find. The
   * registry's own "needs a project" branch was unreachable.
   */
  it("refuses to promote when the app is on its private workspace, and says where to get one", async () => {
    const service = fakeService({
      surface: { events: ok({ events: [], steps: [{ seq: 1, at: "now", call: "act", args: { action: "click" }, ref: "r1" }] }) },
    });
    const outcome = await actionById("surface.save-automation")!.run(service, { selected: "s_1", projectless: true });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Open a project");
    expect(service.calls.some((one) => one.method === "postTrajectoryCompile")).toBe(false);
  });
});

/**
 * Connecting belongs to Do, and says where its result is (P-W2-F9).
 *
 * It was offered in every mode. In Record it was a dead end: the session it
 * makes is stored as `selected`, which is what the surface half reads, while the
 * record half reads `sessionId`. Pressing Connect on the Record screen therefore
 * opened a browser and left the pane saying "No session" — the mode did not
 * change, but the result was visible only in another one.
 */
describe("connect belongs to the mode that can show what it made", () => {
  it("is a Do-mode action", () => {
    expect(actionById("surface.connect")?.modes).toEqual(["do"]);
  });

  it("carries the mode its result is visible in", async () => {
    const service = fakeService({
      surface: { connect: ok({ sessionId: "s_new", adapter: "playwright", kind: "web" }) },
    });
    /* As if run from the palette while Record was showing. */
    const outcome = await actionById("surface.connect")!.run(service, {
      mode: "record",
      target: "https://example.com",
    });
    expect(outcome.params?.["mode"]).toBe("do");
    expect(outcome.params?.["selected"]).toBe("s_new");
  });

  /*
   * The two halves read different keys, which is the whole of the defect. If
   * they ever become one key this test should fail and be deleted deliberately.
   */
  it("stores the session where the surface half reads it, not the record half", async () => {
    const service = fakeService({
      surface: { connect: ok({ sessionId: "s_new", adapter: "playwright", kind: "web" }) },
    });
    const outcome = await actionById("surface.connect")!.run(service, { target: "https://x.test" });
    expect(outcome.params?.["sessionId"]).toBeUndefined();
  });
});
