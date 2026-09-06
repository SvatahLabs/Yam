/**
 * T1.8 — the healing report is published, and says what it measured.
 *
 * REQ-HEAL-5 asks for "results published per release with the method", and
 * REQ-PKG-4 for the reports to be attached to the release. What can be checked
 * here is that the committed report exists, carries a real number rather than a
 * placeholder, states the method, and that the release workflow would attach it.
 *
 * The one thing that cannot be checked here is the tag itself; see the Phase 1
 * progress record's known gaps.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { fromRoot } from "../src/repo.js";

const report = readFileSync(fromRoot("reports", "eval-healing.md"), "utf8");

describe("reports/eval-healing.md (REQ-HEAL-5, REQ-PKG-4)", () => {
  it("is a real result, not the placeholder", () => {
    expect(report).not.toContain("not yet runnable");
    expect(report).toMatch(/\*\*Relocalize-only recovery: \d+\.\d%\*\*/);
  });

  it("states the method, because a percentage without one is not a number", () => {
    expect(report).toContain("## Method");
    expect(report).toContain("test-id attributes disabled");
    expect(report).toContain("Headline population: `no-test-ids`");
  });

  /*
   * Draft 2.3. Phase 1 verified only that a proposal was findable, which a
   * confidently wrong repair also is. These three assertions are what stop the
   * published number sliding back to that: the report has to say it compared
   * against a ground truth, has to show the count of wrong elements even when it
   * is zero, and has to show both populations rather than only the flattering
   * one.
   */
  it("says recovery was verified against the ground-truth element", () => {
    expect(report).toContain("ground-truth key");
    expect(report).toContain("data-yam-eval");
    expect(report).toContain("bindings.ignoreAttributes");
    expect(report).toContain("Relocalized onto the wrong element");
  });

  it("reports both populations (REQ-HEAL-5, Draft 2.3)", () => {
    expect(report).toContain("## Both populations");
    expect(report).toMatch(/^\| `no-test-ids` \*\*\(headline\)\*\* \|/m);
    expect(report).toMatch(/^\| `with-test-ids` \|/m);
  });

  it("says it used no model", () => {
    expect(report).toContain("No model was involved at any point");
    expect(report).toContain("no-op `Regrounder`");
  });

  it("meets REQ-HEAL-5's relocalize-only threshold", () => {
    const match = /\*\*Relocalize-only recovery: (\d+\.\d)%\*\*/.exec(report);
    expect(match, "the report does not state a recovery rate").not.toBeNull();
    expect(Number(match![1]), "relocalize-only recovery is below 60%").toBeGreaterThanOrEqual(60);
    expect(report).toContain("threshold. Met.");
  });

  it("gives the per-variant table over all twenty deliberate changes", () => {
    expect(report).toContain("## By variant");
    for (let variant = 1; variant <= 20; variant += 1) {
      expect(report, `variant ${variant} is missing from the table`).toMatch(
        new RegExp(`^\\\\| ${variant} \\\\| `, "m"),
      );
    }
  });

  it("names what relocalization does not survive, rather than averaging it away", () => {
    expect(report).toContain("## What relocalization does not survive");
  });

  it("reports the counts the rate is taken over", () => {
    for (const row of [
      "Bindings recorded at variant 0",
      "Locator cases examined",
      "Bindings that stopped resolving entirely",
      "Bindings degraded",
      "Recovered by relocalization",
    ]) {
      expect(report, `the report does not report "${row}"`).toContain(row);
    }
  });
});

describe("the release workflow attaches it (REQ-PKG-4)", () => {
  const workflow = parse(
    readFileSync(fromRoot(".github", "workflows", "release.yml"), "utf8"),
  ) as { jobs: Record<string, { steps: Array<{ name?: string; run?: string; with?: { files?: string } }> }> };

  const steps = workflow.jobs["eval-reports"]!.steps;

  it("generates the reports and attaches the Markdown", () => {
    const commands = steps.filter((s) => s.run !== undefined).map((s) => s.run!);
    expect(commands.join("\n")).toContain("node scripts/eval-reports.mjs --out reports");
    expect(steps.some((s) => s.with?.files === "reports/*.md")).toBe(true);
  });

  it("installs a browser, because the healing suite drives one", () => {
    expect(steps.map((s) => s.run ?? "").join("\n")).toContain("playwright install --with-deps chromium");
  });
});
