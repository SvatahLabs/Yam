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
