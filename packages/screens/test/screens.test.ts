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
  SCREEN_IDS,
  fakeService,
  flowsScreen,
  runScreen,
  screenById,
  applyEvent,
  type FakeResponses,
  type FlowsState,
  type RunState,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(
  readFileSync(join(HERE, "fixtures", "fixtures-project.json"), "utf8"),
) as FakeResponses;

const service = (): ReturnType<typeof fakeService> => fakeService(FIXTURES);

describe("the model covers every screen (LLD §13.7)", () => {
  it("has one screen per id, and no more", () => {
    expect(SCREENS.map((one) => one.id).sort()).toEqual([...SCREEN_IDS].sort());
    expect(new Set(SCREENS.map((one) => one.id)).size).toBe(SCREEN_IDS.length);
  });

  it("gives every rail item a screen, and every old ADE screen a home", () => {
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
      "Record review": "record",
      Bindings: "bindings",
      "Surface explorer": "explorer",
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
      for (const key of screen.keys) {
        expect(
          ACTIONS.some((one) => one.id === key.action),
          `${screen.id} binds ${key.key} to unknown action ${key.action}`,
        ).toBe(true);
      }
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
    const state = (await screenById("record").load(service(), {})) as unknown as {
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
    expect(byLabel["Project"]).toBe("svatah-fixtures");
    expect(byLabel["Adapter"]).toBe("playwright");
    // A boolean, never the key (REQ-NFR-6, REQ-ADE-4).
    expect(["available", "none"]).toContain(byLabel["Model credential"]);
  });

  it("Agents, Explorer and Import load and name what they need", async () => {
    for (const id of ["agents", "explorer", "import"] as const) {
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
