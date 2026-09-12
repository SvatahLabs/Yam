/**
 * T9.1 Validate — "every screen loads against the fake service in tests with the
 * state the mockup shows for the fixtures project".
 *
 * The fake's answers are a recording of a real service's, made by
 * `scripts/record-screen-fixtures.mjs` against `evals/fixtures` and the `comp`
 * run of `guards-and-compensation.flow`. That is what makes an assertion here
 * about the *mockup* rather than about a stub someone wrote to match it: the
 * `Main` artboard says "7 files · 22 stories", the `Run` artboard says "6
 * passed 1 failed" and "exit 11", and those numbers are in the recording
 * because a run put them there.
 *
 * Refs: T9.1, REQ-ADE-10, REQ-ADE-13, LLD §13.7.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIONS,
  RAIL,
  SCREENS,
  ago,
  SCREEN_IDS,
  fakeService,
  flowsScreen,
  runScreen,
  screenById,
  applyEvent,
  applyRecordEvent,
  type FakeResponses,
  type FlowsState,
  type ScreenId,
  type AgentsState,
  type RunState,
  loadRecord,
  type RecordLoad,
  type RecordView,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(
  readFileSync(join(HERE, "fixtures", "fixtures-project.json"), "utf8"),
) as FakeResponses;

const service = (): ReturnType<typeof fakeService> => fakeService(FIXTURES);

describe("who is connected over MCP (TV-M05, TV-13)", () => {
  it("has an empty list when the service does not answer", async () => {
    const state = (await screenById("agents").load(service(), {})) as AgentsState;
    expect(state.clients).toEqual([]);
  });

  it("says an agent is driving when it holds a target", async () => {
    /*
     * The screen knew what was exposed and what had been called, and nothing
     * about who was connected — so neither renderer could say an agent was
     * driving, which SF-13 requires before a handoff means anything.
     */
    const fake = fakeService({
      ...FIXTURES,
      agentClients: {
        clients: [
          {
            id: "claude-code",
            name: "claude-code",
            transport: "stdio",
            profile: "surface",
            since: "2026-09-09T18:41:00.000Z",
            holds: "sf-33b8",
          },
          { id: "cursor", name: "cursor", transport: "http", profile: "automation", since: "2026-09-09T18:30:00.000Z" },
        ],
      },
    } as FakeResponses);
    const state = (await screenById("agents").load(fake, {})) as AgentsState;
    expect(state.clients.map((one) => one.name)).toEqual(["claude-code", "cursor"]);
    expect(state.clients[0]!.pill.label).toBe("driving");
    expect(state.clients[1]!.pill.label).toBe("connected");
  });
});

describe("the model covers every screen (LLD §13.7)", () => {
  it("has one screen per id, and no more", () => {
    expect(SCREENS.map((one) => one.id).sort()).toEqual([...SCREEN_IDS].sort());
    expect(new Set(SCREENS.map((one) => one.id)).size).toBe(SCREEN_IDS.length);
  });

  it("gives every rail item a screen, and every old app screen a home", () => {
    for (const item of RAIL) expect(() => screenById(item.screen)).not.toThrow();
    /*
     * "The eleven tabs are removed; each old screen has exactly one home"
     * (§13.7). The old tabs were Project, Flow editor, Plan, Run, Results, API
     * client, Data, Record review, Bindings, Surface explorer, Tool panel.
     * Project and Plan are not screens any more — the project *is* the window's
     * subject and the plan is a tab of the Flows screen — and this records where
     * the other nine went.
     */
    const homes: Record<string, string> = {
      "Flow editor": "flows",
      Plan: "flows",
      Run: "run",
      Results: "runs",
      "API client": "api",
      Data: "data",
      "Record review": "session",
      Bindings: "bindings",
      // T15 replaced the Surface explorer — an adapter chooser and an intent box
      // over a protocol form — with the Surfaces action inspector.
      "Surface explorer": "session",
      "Tool panel": "agents",
    };
    for (const [old, home] of Object.entries(homes)) {
      expect(SCREENS.some((one) => one.id === home), `${old} has no home`).toBe(true);
    }
  });

  it("loads every screen against the fake service without throwing", async () => {
    for (const screen of SCREENS) {
      const state = await screen.load(service(), {});
      expect(state.screen, screen.id).toBe(screen.id);
      expect(state.sources.length, `${screen.id} declared no source`).toBeGreaterThan(0);
      expect(state.error, `${screen.id}: ${state.error ?? ""}`).toBeUndefined();
    }
  });

  it("gives every screen only actions from the one registry", () => {
    for (const screen of SCREENS) {
      for (const action of screen.actions) {
        expect(ACTIONS, `${screen.id}/${action.id}`).toContain(action);
      }
      /*
       * The key half of this check moved with the keys (TV-M03): "a screen
       * binds no unknown action" is now each renderer's to answer about its own
       * table, in `packages/tui/test/keys.test.ts` and the app's.
       */
    }
  });
});

describe("the Flows screen against the fixtures project (the `Main` artboard)", () => {
  it("says what the mockup's toolbar says", async () => {
    const state = (await flowsScreen.load(service(), {})) as FlowsState;
    // "7 files · 22 stories · … bindings, N unverified"
    expect(state.counts.files).toBe(7);
    expect(state.counts.stories).toBe(22);
    expect(state.subtitle).toContain("7 files");
    expect(state.subtitle).toContain("22 stories");
    expect(state.subtitle).toMatch(/\d+ bindings, \d+ unverified/);
  });

  it("lists the seven flow files the mockup lists", async () => {
    const state = (await flowsScreen.load(service(), {})) as FlowsState;
    expect(state.files.map((one) => one.name).sort()).toEqual([
      "booking-compensation.flow",
      "booking-workflow.flow",
      "execution.flow",
      "guards-and-compensation.flow",
      "natural_language_login.flow",
      "simple.flow",
      "svatah.flow",
    ]);
    // Every row carries a status *word*, never a colour alone (§13.7).
    for (const row of state.files) expect(row.status.label).not.toBe("");

    /*
     * And the flow the `comp` run was about carries that run's outcome.
     *
     * `yam run --story <name>` writes `summary.flows` keyed `(selected)`
     * rather than by the file, so a list that matched on the key alone said
     * "not run" beside a run that had just happened. The stories the run's
     * results name belong to a file, and that is the flow the row is about.
     */
    const guards = state.files.find((one) => one.name === "guards-and-compensation.flow")!;
    expect(guards.status.label).toBe("aborted");
    expect(guards.meta.join(" ")).toContain("locator");
    /*
     * And the last run as an *instant* (P9-F4, Draft 2.12 §13.7). "run 4 min
     * ago" is the renderer's; a state that carried it would be a different
     * value every second, which is what made `yam ui --json` unequal to a
     * second load of the same screen.
     */
    expect(guards.lastRunAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(guards.meta.join(" ")).not.toContain("ago");
  });

  it("opens the flow the mockup opens, with its gutter and its lint", async () => {
    const state = (await flowsScreen.load(service(), {
      file: "flows/guards-and-compensation.flow",
    })) as FlowsState;

    expect(state.file).toBe("flows/guards-and-compensation.flow");
    // The mockup's line 17 is `story: I want to see guards decide`.
    const header = state.lines.find((one) => one.text.includes("story: I want to see guards decide"));
    expect(header?.kind).toBe("header");
    // Comments and blanks are lines too: the editor draws the file, not the plan.
    expect(state.lines.some((one) => one.kind === "comment")).toBe(true);
    expect(state.lines.some((one) => one.kind === "step")).toBe(true);
    // The failing step of `comp` is marked in the gutter.
    const failing = state.lines.find((one) => one.text.trim() === "Click the pay button");
    expect(failing?.outcome?.label).toBe("failed");
  });

  it("describes the selected step in the inspector, with its binding", async () => {
    const state = (await flowsScreen.load(service(), {
      file: "flows/guards-and-compensation.flow",
      selected: "line:45",
    })) as FlowsState;
    const inspector = state.inspector;
    expect(inspector, "no inspector for line 45").toBeDefined();
    expect(inspector!.line).toBe(45);
    expect(inspector!.text).toBe("Click the pay button");
    expect(inspector!.target).toBe("checkout.pay-button");
    // The mockup's inspector lists the candidate table for the step's binding.
    expect(inspector!.binding?.candidates.map((one) => one.by)).toEqual([
      "testid",
      "role",
      "text",
      "css",
      "xpath",
    ]);
  });

  it("carries the endpoints it was built from, so the screen rule is visible", async () => {
    const state = (await flowsScreen.load(service(), {})) as FlowsState;
    expect(state.sources).toContain("GET /project");
    expect(state.sources).toContain("POST /compile");
    expect(state.sources).toContain("GET /plan");
    expect(state.sources).toContain("GET /bindings");
  });
});

describe("the Run screen against the `comp` run (the `Run` artboard)", () => {
  it("is the aborted run the mockup draws", async () => {
    const state = (await runScreen.load(service(), { runId: "comp" })) as RunState;
    expect(state.runId).toBe("comp");
    expect(state.outcome.label).toBe("aborted");
    expect(state.totals).toMatchObject({ passed: 6, failed: 1, skipped: 0 });
    expect(state.exitCode).toBe(11);
    expect(state.behavior).toBe("test");
  });

  it("shows the two stories the run touched, and which one compensated", async () => {
    const state = (await runScreen.load(service(), { runId: "comp" })) as RunState;
    expect(state.stories.map((one) => one.story)).toEqual([
      "I want to book and then fail",
      "cancel a booking",
    ]);
    const failing = state.stories[0]!;
    expect(failing.status.label).toBe("failed");
    expect(failing.meta.join(" ")).toContain("compensate");
    expect(state.stories[1]!.status.label).toBe("passed");
  });

  it("shows the five steps of the failing story, with what resolved each", async () => {
    const state = (await runScreen.load(service(), { runId: "comp" })) as RunState;
    const own = state.steps.filter((one) => one.story === "I want to book and then fail");
    expect(own.map((one) => one.text)).toEqual([
      "Click the Book a slot link",
      'Type "Indiranagar" into the location field',
      "Click the Book now button",
      "Remember the text of the booking reference as reference",
      "Click the pay button",
    ]);
    expect(own[0]!.detail).toBe("testid #0");
    // The mockup's fourth row reads "= BK-4471": the value the step captured.
    expect(own[3]!.detail).toMatch(/^= BK-/);
    expect(own[4]!.status.label).toBe("failed");
    expect(own[4]!.failureClass?.label).toBe("locator");
  });

  it("puts the failing step in the inspector with the candidates it tried", async () => {
    const state = (await runScreen.load(service(), { runId: "comp" })) as RunState;
    const inspector = state.inspector!;
    expect(inspector.title).toContain("Click the pay button");
    expect(inspector.failureClass?.label).toBe("locator");
    expect(inspector.session).toContain("/booking");
    expect(inspector.candidatesTried.map((one) => one.by)).toEqual([
      "testid",
      "role",
      "text",
      "css",
      "xpath",
    ]);
    // Every one of them matched nothing, which is why the step failed.
    expect(inspector.candidatesTried.every((one) => one.matched === 0)).toBe(true);
    expect(inspector.screenshot).toMatch(/\.png$/);
  });

  it("has the audit the mockup's bottom pane shows, stamped from the run's start", async () => {
    const state = (await runScreen.load(service(), { runId: "comp" })) as RunState;
    expect(state.audit.length).toBeGreaterThan(5);
    for (const line of state.audit) expect(line.at).toMatch(/^\d\d\.\d\d\d$/);
    expect(state.audit.some((one) => one.kind === "policy" && one.tone === "abort")).toBe(true);
  });

  /*
   * P9-F5, Draft 2.12 §13.7: "The app's audit pane renders the call detail the
   * model carries (`locate · booking.book-now-button · testid #0 · ok`)."
   *
   * The verification found every surface line reading `surface | locate · ok`:
   * the same word in the kind column twenty times, and no way to tell which of
   * the failing step's five candidates a line was about. The auditor records the
   * element and the candidate now (T10.4), and this is the line it produces.
   */
  it("names the element and the candidate on every locate line (T10.4, P9-F5)", async () => {
    const state = (await runScreen.load(service(), { runId: "comp" })) as RunState;
    const locates = state.audit.filter((one) => one.kind === "locate");
    expect(locates.length, "the comp run resolves nine targets").toBeGreaterThan(5);

    // The one the mockup's example names.
    const bookNow = locates.find((one) => one.text.includes("booking.book-now-button"));
    expect(bookNow, JSON.stringify(locates, null, 2)).toBeDefined();
    expect(bookNow!.text).toContain("testid");
    expect(bookNow!.text).toContain("matched 1");
    expect(bookNow!.text).toContain("ok");

    // And the five that matched nothing, each naming its own candidate.
    const failing = locates.filter((one) => one.text.includes("checkout.pay-button"));
    expect(failing).toHaveLength(5);
    expect(failing.map((one) => one.text.split(" · ")[1])).toEqual([
      'testid "pay"',
      'role button "Pay"',
      'text "Pay"',
      'css "[data-testid="pay"]"',
      "xpath \"//*[@data-testid='pay']\"",
    ]);
    for (const one of failing) expect(one.text).toContain("matched nothing");
  });

  it("the kind column is the call, not the word \"surface\" twenty times (P9-F5)", async () => {
    const state = (await runScreen.load(service(), { runId: "comp" })) as RunState;
    expect(state.audit.some((one) => one.kind === "surface")).toBe(false);
    expect(new Set(state.audit.map((one) => one.kind))).toEqual(
      new Set(["run", "story", "state", "locate", "act", "read", "check", "screenshot", "policy", "output"]),
    );
    // And the method is not repeated in the text beside it.
    for (const one of state.audit) {
      expect(one.text.startsWith(`${one.kind} ·`), `"${one.kind} | ${one.text}"`).toBe(false);
    }
  });

  it("offers a resume from the step that failed", async () => {
    const state = (await runScreen.load(service(), { runId: "comp" })) as RunState;
    expect(state.resumeFrom).toBe("I want to book and then fail#5");
    expect(state.live).toBe(false);
  });

  it("says so, rather than throwing, when the project has no runs", async () => {
    const empty = fakeService({ ...FIXTURES, runs: [] });
    const state = (await runScreen.load(empty, {})) as RunState;
    expect(state.error).toBeUndefined();
    expect(state.subtitle).toBe("No runs yet");
    expect(state.steps).toEqual([]);
  });
});

describe("a run happening (LLD §13.5's stream, §13.7's live screen)", () => {
  it("folds step results in and finishes on the summary", async () => {
    const empty = fakeService({ ...FIXTURES, runs: [] });
    let state = (await runScreen.load(empty, {})) as RunState;
    state = { ...state, runId: "live-1" };

    state = applyEvent(state, {
      kind: "step.result",
      runId: "live-1",
      result: { stepId: "s#1", story: "s", text: "Click the Book a slot link", status: "passed" },
    });
    state = applyEvent(state, {
      kind: "step.result",
      runId: "live-1",
      result: { stepId: "s#2", story: "s", text: "Click the pay button", status: "failed" },
    });

    expect(state.steps.map((one) => one.status.label)).toEqual(["passed", "failed"]);
    expect(state.totals).toMatchObject({ passed: 1, failed: 1 });
    expect(state.live).toBe(true);

    state = applyEvent(state, {
      kind: "run.summary",
      runId: "live-1",
      summary: { totals: { passed: 1, failed: 1 }, flows: { f: { status: "aborted" } }, exitCode: 11 },
    });
    expect(state.live).toBe(false);
    expect(state.outcome.label).toBe("aborted");
    expect(state.exitCode).toBe(11);
  });

  it("ignores an event about a different run", async () => {
    const empty = fakeService({ ...FIXTURES, runs: [] });
    const state = { ...((await runScreen.load(empty, {})) as RunState), runId: "live-1" };
    const after = applyEvent(state, {
      kind: "step.result",
      runId: "other",
      result: { stepId: "x#1", status: "passed" },
    });
    expect(after).toBe(state);
  });
});

describe("the other ten screens against the fixtures project", () => {
  it("Runs lists the `comp` run with its totals", async () => {
    const state = await screenById("runs").load(service(), {});
    const rows = (state as unknown as { rows: Array<{ runId: string; status: { label: string } }> }).rows;
    expect(rows.map((one) => one.runId)).toContain("comp");
    expect(rows.find((one) => one.runId === "comp")!.status.label).toBe("aborted");
  });

  it("Bindings lists the store and counts what is unverified", async () => {
    const state = (await screenById("bindings").load(service(), {})) as unknown as {
      rows: Array<{ elementId: string; verified: { label: string } }>;
      unverified: number;
    };
    expect(state.rows.map((one) => one.elementId)).toContain("checkout.pay-button");
    expect(state.rows.every((one) => one.verified.label !== "")).toBe(true);
    expect(state.unverified).toBe(
      state.rows.filter((one) => one.verified.label === "unverified").length,
    );
  });

  it("Record offers only the gateway the service can reach (REQ-ADE-4)", async () => {
    const state = (await loadRecord(service(), {})) as unknown as {
      gateways: Array<{ id: string; available: boolean; label: string }>;
      gateway: string;
    };
    const anthropic = state.gateways.find((one) => one.id === "anthropic")!;
    const fake = state.gateways.find((one) => one.id === "fake")!;
    expect(fake.available).toBe(true);
    expect(fake.label).toContain("committed answers");
    // No credential in the recording, so the screen defaults to the fake and
    // says why the other is not offered.
    expect(anthropic.available).toBe(false);
    expect(anthropic.label).toContain("no credential");
    expect(state.gateway).toBe("fake");
  });

  it("Heal offers the run that has a failure", async () => {
    const state = (await screenById("heal").load(service(), {})) as unknown as {
      candidates: Array<{ runId: string; failed: number }>;
      runId?: string;
    };
    expect(state.candidates.map((one) => one.runId)).toEqual(["comp"]);
    expect(state.runId).toBe("comp");
  });

  it("Data shows the values with the secrets already redacted", async () => {
    const state = (await screenById("data").load(service(), {})) as unknown as {
      rows: Array<{ path: string; value: string; secret: boolean }>;
    };
    expect(state.rows.length).toBeGreaterThan(0);
    for (const row of state.rows.filter((one) => one.secret)) {
      expect(row.value, `${row.path} reached the model unredacted`).toBe("«redacted»");
    }
  });

  it("API lists the project's named requests", async () => {
    const state = (await screenById("api").load(service(), {})) as unknown as {
      requests: Array<{ name: string; method: string }>;
    };
    expect(state.requests.map((one) => one.name)).toContain("active count");
    expect(state.requests.every((one) => one.method === one.method.toUpperCase())).toBe(true);
  });

  it("Settings shows the project's configuration, and never a credential", async () => {
    const state = (await screenById("settings").load(service(), {})) as unknown as {
      rows: Array<{ label: string; value: string }>;
    };
    const byLabel = Object.fromEntries(state.rows.map((one) => [one.label, one.value]));
    // T10.2 groups the rows; the labels within a group are what the screen says.
    expect(byLabel["Name"]).toBe("yam-fixtures");
    expect(byLabel["Adapter"]).toBe("playwright");
    // A boolean, never the key (REQ-NFR-6, REQ-ADE-4).
    expect(["available", "none"]).toContain(byLabel["Model credential"]);
  });

  // T15 replaced the Surface explorer with the Surfaces action inspector, which
  // has its own suite in `surfaces.test.ts` (it needs a broker, not a project).
  it("Agents and Import load and name what they need", async () => {
    for (const id of ["agents", "import"] as const) {
      const state = await screenById(id).load(service(), {});
      expect(state.error, id).toBeUndefined();
      expect(state.title, id).not.toBe("");
    }
  });
});

describe("a screen whose service is down (LLD §13.7)", () => {
  it("is a state with an error, not a thrown exception", async () => {
    const broken = fakeService({});
    const state = await flowsScreen.load(broken, {});
    expect(state.error).toContain("GET /project");
    // A renderer draws the alert; it does not catch.
    expect(state.screen).toBe("flows");
    expect(state.title).toBe("Flows");
  });
});

/**
 * The state is a value: two loads of an unchanged project are equal (T10.4,
 * P9-F4, Draft 2.12 §13.7).
 *
 * > State carries **timestamps**, never a relative time as text; "20 s ago" is
 * > the renderer's, so two loads of one state are equal.
 *
 * The unit-level half of `tui-pty.test.ts`'s ten-round comparison: no service,
 * no terminal, and a clock that is deliberately moved between the loads.
 */
describe("a screen's state does not change when nothing does (T10.4, P9-F4)", () => {
  it("two loads a simulated minute apart are the same object", async () => {
    const service = fakeService(FIXTURES);
    const first = await screenById("flows").load(service, {
      file: "flows/guards-and-compensation.flow",
    });
    const before = Date.now;
    try {
      // A minute later, which is enough to move every "N s ago" and most
      // "N min ago" — the exact thing that flaked on Node 22.
      Date.now = () => before() + 60_000;
      const second = await screenById("flows").load(service, {
        file: "flows/guards-and-compensation.flow",
      });
      expect(second).toEqual(first);
    } finally {
      Date.now = before;
    }
  });

  it("no screen's state carries the word \"ago\"", async () => {
    const service = fakeService(FIXTURES);
    for (const screen of SCREENS) {
      const state = await screen.load(service, {});
      expect(
        JSON.stringify(state),
        `the ${screen.id} screen's state carries a relative time as text`,
      ).not.toContain(" ago");
    }
  });

  it("`ago` turns an instant into the mockup's words", () => {
    const now = Date.parse("2026-09-05T12:00:00.000Z");
    expect(ago("2026-09-05T11:59:40.000Z", now)).toBe("run 20 s ago");
    expect(ago("2026-09-05T11:38:00.000Z", now)).toBe("run 22 min ago");
    expect(ago("2026-09-05T09:00:00.000Z", now)).toBe("run 3 h ago");
    expect(ago("2026-09-01T12:00:00.000Z", now)).toBe("run 4 d ago");
    expect(ago(undefined, now)).toBeUndefined();
    expect(ago("not a date", now)).toBeUndefined();
  });
});

/**
 * A screen with a list opens on its first row (P10-F2, LLD §13.7's artboards).
 *
 * The Phase 10 live gate found the Bindings screen's inspector empty, because
 * nothing was chosen and the inspector is a view of a choice: `app.inspector`
 * looked for `inspector-candidate-table` on a screen that had drawn a list and
 * an empty panel. The artboards draw the first row selected, and both renderers
 * take the selection from a *screen parameter* (§13.7) — so "select the first
 * one" belongs to the model, where the app and the cockpit get it for free, and
 * not to either renderer.
 *
 * Stated once here for every screen that has a list, so a screen added later
 * with a list and no default fails rather than being noticed on a live gate.
 */
describe("a screen with a list opens on its first row (P10-F2)", () => {
  const listScreens: ReadonlyArray<{
    screen: ScreenId;
    param: string;
    /** How to read the chosen row's id back out of the loaded state. */
    chosen: (state: Record<string, unknown>) => unknown;
    /** The list the choice is made from, so an empty one is not a failure. */
    rows: (state: Record<string, unknown>) => readonly unknown[];
  }> = [
    {
      screen: "bindings",
      param: "bindingId",
      chosen: (s) => s["bindingId"],
      rows: (s) => (s["rows"] ?? []) as readonly unknown[],
    },
    {
      screen: "runs",
      param: "runId",
      chosen: (s) => s["runId"],
      rows: (s) => (s["rows"] ?? []) as readonly unknown[],
    },
    {
      screen: "agents",
      param: "selected",
      chosen: (s) => s["selected"],
      rows: (s) => (s["tools"] ?? []) as readonly unknown[],
    },
    {
      screen: "api",
      param: "selected",
      chosen: (s) => s["selected"],
      rows: (s) => (s["requests"] ?? []) as readonly unknown[],
    },
    {
      screen: "data",
      param: "selected",
      chosen: (s) => s["selected"],
      rows: (s) => (s["rows"] ?? []) as readonly unknown[],
    },
  ];

  for (const one of listScreens) {
    it(`${one.screen} chooses a row with no parameter at all`, async () => {
      const state = (await screenById(one.screen).load(service(), {})) as unknown as Record<
        string,
        unknown
      >;
      if (one.rows(state).length === 0) {
        // Nothing to choose is not the defect: an inspector over an empty list
        // is an empty inspector on purpose. What must not happen is a list with
        // rows and nothing chosen.
        expect(one.chosen(state)).toBeUndefined();
        return;
      }
      expect(
        one.chosen(state),
        `${one.screen} loaded with rows and nothing chosen, so its inspector is empty`,
      ).toBeDefined();
    });

    it(`${one.screen} still honours a row the caller asked for`, async () => {
      const first = (await screenById(one.screen).load(service(), {})) as unknown as Record<
        string,
        unknown
      >;
      const chosen = one.chosen(first);
      if (chosen === undefined) return;
      // The default must be a *default*, not an override: loading with the same
      // id explicitly has to reach the same state.
      const again = (await screenById(one.screen).load(service(), {
        [one.param]: String(chosen),
      })) as unknown as Record<string, unknown>;
      expect(one.chosen(again)).toEqual(chosen);
    });
  }

  it("is not vacuous: most of those screens do have rows in the fixtures", async () => {
    let withRows = 0;
    for (const one of listScreens) {
      const state = (await screenById(one.screen).load(service(), {})) as unknown as Record<
        string,
        unknown
      >;
      if (one.rows(state).length > 0) withRows += 1;
    }
    expect(withRows, "no list screen has a row, so the default is untested").toBeGreaterThanOrEqual(
      3,
    );
  });
});

describe("a capture happening (REQ-REC-13, Draft 2.23)", () => {
  /**
   * `yam record` and the app's Record button are one thing: a person drives and
   * the flow is written from what they did. The screen shows the sentences as
   * they arrive, and says where the flow went when the session ends.
   */
  const capture = async (): Promise<RecordLoad> =>
    await loadRecord(service(), { sessionId: "cap-1", capturing: true });

  it("starts empty, collects the sentences, and reports what was written", async () => {
    let state = await capture();
    expect(state.capturing).toBe(true);
    expect(state.sentences).toEqual([]);
    expect(state.subtitle).toContain("recording what you do");

    for (const sentence of ['Go to "/login"', "Type {input.password} into the password field", "Click the sign in button"]) {
      state = applyRecordEvent(state, { kind: "capture.step", sessionId: "cap-1", sentence });
    }
    expect(state.sentences).toEqual([
      'Go to "/login"',
      "Type {input.password} into the password field",
      "Click the sign in button",
    ]);
    // No grounding is waiting: nobody is being asked to decide anything.
    expect(state.decision).toBeUndefined();

    state = applyRecordEvent(state, {
      kind: "capture.finished",
      sessionId: "cap-1",
      captured: {
        file: "flows/sign-in.flow",
        story: "Sign in",
        steps: ['Go to "/login"', "Type {input.password} into the password field", "Click the sign in button"],
        bound: ["login.password-field", "login.sign-in-button"],
        unbound: [],
      },
    });
    expect(state.capturing).toBe(false);
    expect(state.captured).toEqual({
      file: "flows/sign-in.flow",
      story: "Sign in",
      steps: 3,
      bound: 2,
      unbound: [],
    });
  });

  it("names what could not be bound, and turns a failure into advice for the screen", async () => {
    let state = applyRecordEvent(await capture(), {
      kind: "capture.finished",
      sessionId: "cap-1",
      captured: { file: "flows/x.flow", story: "X", steps: [], bound: [], unbound: ["the mystery widget"] },
    });
    expect(state.captured?.unbound).toEqual(["the mystery widget"]);

    state = applyRecordEvent(state, {
      kind: "capture.failed",
      sessionId: "cap-1",
      message: "The playwright adapter cannot watch what a person does.",
    });
    expect(state.capturing).toBe(false);
    expect(state.failure?.message).toMatch(/cannot watch/);
    // Advice for whoever is looking at the window, never a CLI flag (REQ-ADE-4).
    expect(state.failure?.advice).not.toMatch(/--/);
    expect(state.failure?.advice).toMatch(/press Record again/);
  });

  it("offers Record and Bind targets as different actions, on different keys", () => {
    const record = ACTIONS.find((one) => one.id === "capture.start")!;
    const bind = ACTIONS.find((one) => one.id === "record.start")!;
    expect(record.label).toBe("Record");
    expect(record.cli).toBe("yam record");
    expect(bind.label).toBe("Bind targets");
    expect(bind.cli).toBe("yam record --flow <file>");
    /*
     * Draft 2.27: both are still two actions with two keys, and the screen they
     * are declared on is now `session` — Record is a mode of it rather than a
     * destination of its own (TV-M02). The ids did not move; the home did.
     */
    expect(ACTIONS.find((one) => one.id === "capture.stop")!.screen).toBe("session");
  });

  it("starts a capture through the service and lands on Session, in record mode", async () => {
    const fake = service();
    const outcome = await ACTIONS.find((one) => one.id === "capture.start")!.run(fake, { name: "Sign in" });
    expect(outcome.ok).toBe(true);
    expect(outcome.goTo).toBe("session");
    expect(outcome.params?.mode, "a capture lands in the mode that shows it").toBe("record");
    expect(outcome.params).toEqual({ mode: "record", sessionId: "cap-1", capturing: true });

    const stop = await ACTIONS.find((one) => one.id === "capture.stop")!.run(fake, { sessionId: "cap-1" });
    expect(stop.ok).toBe(true);
  });
});

describe("a screen's keys and the action registry agree (T9.1, Draft 2.24)", () => {
  /**
   * Draft 2.23 split Record into two actions, renamed `record.start` to "Bind
   * targets" and moved it to `B` — and left this table alone, so the cockpit's
   * `R` ran the binding session under a label that said it recorded. The
   * action-parity check compares the registry, the palette fixture and the CLI;
   * a screen's own key list was in none of them.
   */
  it("declares no key at all: that is each renderer's table now (TV-M03)", () => {
    /*
     * The model said which key ran which action, in one table both renderers
     * read — and a terminal cannot be sent a `⌘↵`, so one of them was always
     * reading the other's convention. What is asserted here is the absence: a
     * screen has actions, and nothing about keystrokes.
     */
    for (const screen of SCREENS) {
      expect(screen, `${screen.id} still carries a key table`).not.toHaveProperty("keys");
    }
    for (const action of ACTIONS) {
      expect(action, `${action.id} still carries an accelerator`).not.toHaveProperty("key");
    }
  });


});
