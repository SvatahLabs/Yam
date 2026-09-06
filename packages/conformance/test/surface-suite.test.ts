/**
 * T1.2 Validate — "a deliberately broken mock adapter fails with a readable
 * report", and the suite's own shape.
 *
 * The Playwright adapter's half of the Validate item is a real browser run and
 * lives in `packages/adapter-playwright/test/conformance.spec.ts`; this file is
 * the part that needs no browser, so the suite's behaviour is checked in the fast
 * loop and against an adapter whose faults are known exactly.
 *
 * Refs: REQ-SURF-3, REQ-STD-2, LLD §14.
 */
import { describe, expect, it } from "vitest";
import {
  renderMarkdown,
  renderReport,
  runSurfaceConformance,
  SURFACE_CASES,
  type ConformanceReport,
} from "../src/index.js";
import { ALL_FAULTS, BrokenAdapter, type Faults } from "./broken-adapter.js";

/** Run the suite against a mock with the given faults. */
async function run(faults: Faults, only?: string[]): Promise<ConformanceReport> {
  return await runSurfaceConformance({
    adapter: "broken-mock",
    baseUrl: "http://127.0.0.1:4173",
    ...(only === undefined ? {} : { only }),
    openSurface: async () => new BrokenAdapter(faults),
  });
}

describe("the suite itself (LLD §14)", () => {
  it("covers every sample page the flows drive", () => {
    const pages = new Set(SURFACE_CASES.map((c) => c.page));
    for (const page of ["/", "/login", "/dashboard", "/widgets"]) {
      expect(pages, `no conformance case drives ${page}`).toContain(page);
    }
  });

  it("gives every case a stable id and a description", () => {
    const ids = SURFACE_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const one of SURFACE_CASES) {
      expect(one.id, `${one.id} is not <group>.<name>`).toMatch(/^[a-z-]+\.[a-z-]+$/);
      expect(one.description.length, `${one.id} has no description`).toBeGreaterThan(20);
    }
  });

  it("declares the capabilities a case needs, so an adapter is skipped and not failed", async () => {
    // The broken mock claims only `restore`, so every case needing dialogs,
    // frames or windows must be skipped rather than counted as a failure.
    const report = await run({});
    const skipped = report.cases.filter((c) => c.status === "skipped").map((c) => c.id);
    expect(skipped).toContain("widgets.dialog");
    expect(skipped).toContain("widgets.frame");
    expect(skipped).toContain("widgets.windows");
    for (const one of report.cases.filter((c) => c.status === "skipped")) {
      expect(one.skipReason, `${one.id} was skipped without saying why`).toMatch(/capability/);
    }
  });
});

describe("a deliberately broken adapter (T1.2 Validate)", () => {
  it("is not conformant", async () => {
    const report = await run(ALL_FAULTS);
    expect(report.conformant).toBe(false);
    expect(report.totals.failed).toBeGreaterThan(0);
    expect(report.totals.failedChecks).toBeGreaterThan(0);
  });

  it("names each fault in the report, not just that something failed", async () => {
    const report = await run(ALL_FAULTS);
    const text = renderReport(report);

    // Each of these is one deliberate fault, and the report has to be readable
    // enough for an adapter author to know which one to go and fix.
    const expected: Array<[string, RegExp]> = [
      ["missing references", /every node has a reference, a role and a states array/],
      ["missing states", /reports the required state|reports the unchecked state|unticked checkbox/],
      ["hidden nodes rendered", /hidden error banner is not rendered/],
      ["a stale value", /read\(\) sees the typed value/],
      ["locate always returning one", /a candidate matching nothing returns no references/],
      ["a thin describe", /neighbour text is collected|ancestor role path|attributes are reported/],
      ["errors swallowed", /a candidate with no value is a LocateError/],
    ];
    for (const [fault, pattern] of expected) {
      expect(text, `the report does not show the ${fault} fault`).toMatch(pattern);
    }
  });

  it("shows what was expected and what was seen for every failed check", async () => {
    const report = await run(ALL_FAULTS);
    const text = renderReport(report);
    expect(text).toContain("expected:");
    expect(text).toContain("actual:");
    expect(text).toContain('"broken-mock" is NOT conformant (REQ-SURF-3).');
  });

  it("renders the same failures as Markdown for the release notes", async () => {
    const report = await run(ALL_FAULTS);
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("# Surface conformance — `broken-mock`");
    expect(markdown).toContain("**Not conformant.**");
    expect(markdown).toContain("## Failures");
    expect(markdown).toMatch(/\| `login\.describe` \| `\/login` \| failed \|/);
  });

  it("attributes a fault to the case it broke", async () => {
    const one = await run({ refsMissing: true }, ["home.snapshot"]);
    expect(one.cases).toHaveLength(1);
    expect(one.cases[0]!.status).toBe("failed");
    const failed = one.cases[0]!.checks.filter((c) => !c.ok).map((c) => c.description);
    expect(failed).toEqual(["every node has a reference, a role and a states array"]);
  });

  it("a case that throws is reported as a failure naming the throw", async () => {
    const thrower = {
      ...SURFACE_CASES[0]!,
      id: "throwing.case",
      run: async () => {
        throw new TypeError("the adapter returned undefined where a snapshot was required");
      },
    };
    const report = await runSurfaceConformance({
      adapter: "throwing",
      baseUrl: "http://127.0.0.1:4173",
      cases: [thrower],
      openSurface: async () => new BrokenAdapter({}),
    });
    expect(report.cases[0]!.status).toBe("failed");
    expect(report.cases[0]!.error).toContain("TypeError");
    expect(renderReport(report)).toContain("the case threw: TypeError");
  });
});

describe("an adapter with no faults", () => {
  it("passes the cases its capabilities allow it to run", async () => {
    const report = await run({}, [
      "home.snapshot",
      "home.click-navigates",
      "login.snapshot-states",
      "login.type-changes-value",
      "login.checkbox-state",
      "login.describe",
      "login.locate-cardinality",
      "capabilities.descriptor",
    ]);
    const failed = report.cases.filter((c) => c.status === "failed");
    expect(
      failed.map((c) => ({ id: c.id, checks: c.checks.filter((k) => !k.ok) })),
      "the unbroken mock should pass every case it can run",
    ).toEqual([]);
    expect(report.conformant).toBe(true);
    expect(renderReport(report)).toContain('"broken-mock" is conformant.');
  });
});

/**
 * What the desktop reports have to publish (T7.1, Draft 2.8 §7.5).
 *
 * > The desktop conformance report records nodes read, wall time, and
 * > milliseconds per node.
 *
 * The number the *live* gate publishes cannot be checked here — it needs macOS,
 * the Accessibility permission and a window — but the report's contract can:
 * that an adapter measuring its bridge has that measurement carried through the
 * runner into both renderers, that the costliest read wins rather than the last,
 * and that a *recorded* tree is published as a recording rather than as a zero.
 */
describe("a case with no result (Draft 2.9 §7.5, P7-F4)", () => {
  const bare = {
    page: "home",
    description: "a case that observes nothing",
  } as const;

  it("reports a case that made no checks as skipped, not passed", async () => {
    const report = await runSurfaceConformance({
      adapter: "quiet",
      baseUrl: "http://127.0.0.1:4173",
      cases: [{ id: "quiet.nothing", ...bare, run: async () => undefined }],
      openSurface: async () => new BrokenAdapter({}),
    });
    expect(report.cases[0]!.status).toBe("skipped");
    expect(report.cases[0]!.skipReason).toContain("made no checks");
    // And it does not count towards "7 of 7": a case that established nothing
    // must not be able to make an adapter conformant.
    expect(report.totals.passed).toBe(0);
    expect(report.conformant).toBe(false);
  });

  it("lets a case say why it has nothing to measure here", async () => {
    const report = await runSurfaceConformance({
      adapter: "quiet",
      baseUrl: "http://127.0.0.1:4173",
      cases: [
        {
          id: "quiet.baseline",
          ...bare,
          run: async (context) => {
            context.skip("recorded the variant-0 baseline");
          },
        },
      ],
      openSurface: async () => new BrokenAdapter({}),
    });
    expect(report.cases[0]!.status).toBe("skipped");
    expect(report.cases[0]!.skipReason).toBe("recorded the variant-0 baseline");
  });

  it("still fails a case that skipped after a check went wrong", async () => {
    // A skip must never bury a failure: the recording pass of a healing case
    // asks for a control by its key, and a key that is not there is a result.
    const report = await runSurfaceConformance({
      adapter: "quiet",
      baseUrl: "http://127.0.0.1:4173",
      cases: [
        {
          id: "quiet.broken",
          ...bare,
          run: async (context) => {
            context.check("the control is there", false);
            context.skip("recorded the variant-0 baseline");
          },
        },
      ],
      openSurface: async () => new BrokenAdapter({}),
    });
    expect(report.cases[0]!.status).toBe("failed");
  });
});

describe("the bridge cost a desktop report publishes (T7.1, LLD §7.5)", () => {
  /** An adapter that measures a bridge, the way `AxSurface.bridgeCost()` does. */
  interface Cost {
    nodes: number;
    wallMs: number;
    msPerNode: number;
    invocations: number;
    appleEvents?: number;
    axCalls?: number;
  }

  class Measured extends BrokenAdapter {
    constructor(private readonly next: () => Cost) {
      super({});
    }
    bridgeCost(): Cost {
      return this.next();
    }
  }

  const withCost = async (
    costs: ReadonlyArray<Cost>,
  ): Promise<ConformanceReport> => {
    /*
     * Counted when the cost is *asked for*, not when a surface is opened: the
     * runner opens one extra surface before the suite to ask what the adapter
     * is driving, and never asks that one what it cost.
     */
    let asked = 0;
    const next = (): (typeof costs)[number] => costs[Math.min(asked++, costs.length - 1)]!;
    return await runSurfaceConformance({
      adapter: "measured-mock",
      baseUrl: "http://127.0.0.1:4173",
      only: ["home.snapshot", "login.snapshot-states"],
      openSurface: async () => new Measured(next),
    });
  };

  it("publishes the three numbers §7.5 names, in both renderers", async () => {
    const report = await withCost([
      { nodes: 588, wallMs: 890, msPerNode: 1.51, invocations: 1, axCalls: 9_413 },
    ]);
    expect(report.bridge).toMatchObject({ nodes: 588, wallMs: 890, msPerNode: 1.51 });
    for (const rendered of [renderReport(report), renderMarkdown(report)]) {
      expect(rendered).toContain("588 nodes in 890 ms");
      expect(rendered).toContain("1.51 ms per node");
      // Draft 2.9 §7.5's native helper sends no Apple events; what it makes is
      // accessibility calls, and a report that said otherwise would be false.
      expect(rendered).toContain("9413 accessibility calls");
      expect(rendered).toContain("1 process invocation");
    }
  });

  it("keeps the costliest read, not the last one", async () => {
    /*
     * §7.5's budget is about the biggest window the suite touched — the ADE's
     * project screen — and a report that published the *last* read would
     * publish whatever the final case happened to open.
     */
    const report = await withCost([
      { nodes: 488, wallMs: 5_070, msPerNode: 10.39, invocations: 1 },
      { nodes: 35, wallMs: 400, msPerNode: 11.4, invocations: 1 },
    ]);
    expect(report.bridge?.nodes).toBe(488);
  });

  it("says a recorded tree is a recording rather than publishing a zero", async () => {
    const report = await withCost([{ nodes: 199, wallMs: 0, msPerNode: 0, invocations: 0 }]);
    for (const rendered of [renderReport(report), renderMarkdown(report)]) {
      expect(rendered).toContain("not measured");
      expect(rendered).toContain("199-node tree came from a recording");
      expect(rendered).not.toContain("0 ms per node");
    }
  });

  it("has no bridge line at all for an adapter with no process boundary", async () => {
    const report = await run({}, ["home.snapshot"]);
    expect(report.bridge).toBeUndefined();
    expect(renderReport(report)).not.toContain("Bridge:");
  });
});
