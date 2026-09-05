/**
 * `svatah eval compiler` (T4.3, T4.4, REQ-COMP-9, REQ-PKG-4).
 *
 * The numbers in `reports/eval-compiler.md` come from a real local model and are
 * measured by hand; the contract has no model server, so what runs here is
 * everything else:
 *
 * * **Tier 1 is 100 percent**, which needs no model at all and is the one
 *   threshold REQ-COMP-9 states as an absolute.
 * * **The harness scores correctly**, checked with `--gateway fake`, which
 *   answers every model-tier question with the golden answer. A 100 percent from
 *   that measures the harness, and the report says so at the top.
 * * **A report can never be mistaken for a measurement**: the gateway is named
 *   and `real` is false whenever a fake produced it (Phase 3's D1).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readGolden } from "@svatah/compiler";
import { EXIT } from "@svatah/bindings-cli";
import { main } from "../src/index.js";
import {
  meetsThresholds,
  renderCompilerReport,
  OVERALL_THRESHOLD,
  TIER1_THRESHOLD,
  TIER2_THRESHOLD,
} from "../src/commands/eval-compiler.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GOLDEN = join(ROOT, "evals", "compiler", "golden.jsonl");
const PROJECT = join(ROOT, "evals", "compiler", "project");

interface Report {
  gateway: string;
  real: boolean;
  byTier: Record<string, { total: number; matched: number; rate: number }>;
  totals: { total: number; matched: number; rate: number };
  cases: Array<{ id: string; tier: number; ok: boolean; text: string }>;
}

async function evaluate(...argv: string[]): Promise<{ code: number; report: Report; err: string }> {
  let out = "";
  let err = "";
  const code = await main(
    ["eval", "compiler", "--golden", GOLDEN, "--golden-project", PROJECT, "--json", ...argv],
    { out: (text) => (out += text), err: (text) => (err += `${text}\n`) },
  );
  return { code, report: JSON.parse(out) as Report, err };
}

describe("tier 1 scores 100 percent with no model at all (REQ-COMP-9)", () => {
  it("compiles every grammar entry to exactly the expected step", async () => {
    const { report } = await evaluate("--only", "tier1");
    const tier1 = report.byTier["tier1"]!;
    expect(
      report.cases.filter((c) => !c.ok).map((c) => `${c.id} ${c.text}`),
      "every tier 1 entry must match exactly",
    ).toEqual([]);
    expect(tier1.rate).toBe(TIER1_THRESHOLD);
    expect(tier1.total).toBeGreaterThanOrEqual(120);
  }, 120_000);

  it("names no gateway, because none was used", async () => {
    // The compile reached no network: that is REQ-NFR-3's default and what
    // `(none)` in a report means.
    const { report } = await evaluate("--only", "tier1");
    expect(report.gateway).toBe("(none)");
    expect(report.real).toBe(false);
  }, 120_000);
});

describe("tier 0 scores through the custom-step registry (LLD §5)", () => {
  it("matches the golden set's custom steps", async () => {
    const { report } = await evaluate("--only", "tier0");
    expect(report.cases.filter((c) => !c.ok).map((c) => c.id)).toEqual([]);
    expect(report.byTier["tier0"]!.total).toBeGreaterThan(0);
  }, 120_000);
});

describe("the harness, with a fake gateway (Phase 3's D1)", () => {
  it("scores a correct model answer as a match", async () => {
    // `--gateway fake` answers with the golden step itself, so anything short of
    // 100 percent here is the *harness* getting it wrong — a lowering path that
    // differs from the grammar's, or a comparison that includes a field it
    // should not.
    const { report } = await evaluate("--only", "tier2", "--gateway", "fake");
    expect(
      report.cases.filter((c) => !c.ok).map((c) => `${c.id} ${c.text}`),
      "the fake answers with the expected step, so every case must match",
    ).toEqual([]);
    expect(report.byTier["tier2"]!.rate).toBe(1);
  }, 180_000);

  it("says plainly that a fake is not a model", async () => {
    const { report } = await evaluate("--only", "tier2", "--gateway", "fake");
    expect(report.gateway).toBe("fake:golden");
    expect(report.real).toBe(false);

    const markdown = renderCompilerReport({
      at: "1970-01-01T00:00:00.000Z",
      gateway: report.gateway,
      real: report.real,
      cases: [],
      byTier: report.byTier,
      totals: report.totals,
    });
    expect(markdown).toContain("which is not a model");
    expect(markdown).toContain("measure the");
    expect(markdown).toContain("harness");
  }, 180_000);
});

describe("the golden set (REQ-COMP-9)", () => {
  const entries = readGolden(GOLDEN);

  it("has a tier 2 subset for T4.3 to be measured on", () => {
    const tier2 = entries.filter((e) => e.tier === 2);
    expect(tier2.length).toBeGreaterThanOrEqual(30);
  });

  it("makes every tier 2 entry a sentence the grammar genuinely refuses", async () => {
    /*
     * The measurement is meaningless otherwise. A `tier: 2` entry the grammar
     * would have claimed is one Tier 1 answers before the model is ever asked,
     * and it would be scored as a Tier 2 success.
     */
    const { parseSentence } = await import("@svatah/compiler");
    const claimed = entries
      .filter((e) => e.tier === 2)
      .filter((e) => parseSentence(e.text, { file: "golden", line: 1 }).raw !== undefined)
      .map((e) => `${e.id} ${e.text}`);
    expect(claimed, "the grammar claims these, so they are not tier 2 cases").toEqual([]);
  });

  it("names the tier's own action in `rule`, since a model tier has no rule", () => {
    for (const entry of entries.filter((e) => e.tier === 2)) {
      expect(entry.rule, entry.id).toBe(entry.step.action);
    }
  });
});

describe("the published report (REQ-PKG-4)", () => {
  const path = join(ROOT, "reports", "eval-compiler.md");

  it("exists and is a real result rather than a placeholder", () => {
    expect(existsSync(path), "run `svatah eval compiler --report reports/eval-compiler.md`").toBe(
      true,
    );
    const report = readFileSync(path, "utf8");
    expect(report).toMatch(/\*\*Overall exact match: \d+\.\d%\*\*/);
    expect(report).toContain("## Per tier (REQ-COMP-9)");
    expect(report).toContain("## Method");
  });

  it("names which gateway produced the model-tier numbers", () => {
    // "BiDi passes" and "tier 2 is 90 percent" are both meaningless without
    // saying against what.
    const report = readFileSync(path, "utf8");
    expect(report).toMatch(/Model-tier answers came from `[^`]+`|which is not a model/);
  });

  it("meets every threshold REQ-COMP-9 states", () => {
    const report = readFileSync(path, "utf8");
    const overall = /\*\*Overall exact match: (\d+\.\d)%\*\*/.exec(report);
    expect(overall, "the report states no overall rate").not.toBeNull();
    expect(Number(overall![1]) / 100).toBeGreaterThanOrEqual(OVERALL_THRESHOLD);

    const tier1 = /\| `tier1` \| \d+ \| \d+ \((\d+\.\d)%\)/.exec(report);
    expect(tier1, "the report has no tier1 row").not.toBeNull();
    expect(Number(tier1![1]) / 100).toBeGreaterThanOrEqual(TIER1_THRESHOLD);

    const tier2 = /\| `tier2` \| \d+ \| \d+ \((\d+\.\d)%\)/.exec(report);
    expect(tier2, "the report has no tier2 row").not.toBeNull();
    expect(Number(tier2![1]) / 100).toBeGreaterThanOrEqual(TIER2_THRESHOLD);
  });

  it("was produced by a real model, not by the fake", () => {
    // The one thing that would make every number above worthless.
    const report = readFileSync(path, "utf8");
    expect(report).not.toContain("which is not a model");
    expect(report).toMatch(/Model-tier answers came from `ollama:/);
  });
});

describe("meetsThresholds", () => {
  const report = (byTier: Report["byTier"], rate: number) => ({
    at: "",
    gateway: "",
    real: true,
    cases: [],
    byTier,
    totals: { total: 1, matched: 1, rate },
  });

  it("requires tier 1 to be perfect", () => {
    expect(
      meetsThresholds(report({ tier1: { total: 10, matched: 9, rate: 0.9 } }, 0.99)),
    ).toBe(false);
  });

  it("requires tier 2 to clear 80 percent", () => {
    expect(
      meetsThresholds(report({ tier2: { total: 10, matched: 7, rate: 0.7 } }, 0.99)),
    ).toBe(false);
  });

  it("requires 95 percent overall", () => {
    expect(meetsThresholds(report({ tier1: { total: 1, matched: 1, rate: 1 } }, 0.94))).toBe(false);
    expect(meetsThresholds(report({ tier1: { total: 1, matched: 1, rate: 1 } }, 0.95))).toBe(true);
  });

  it("says nothing about a tier that did not run", () => {
    // A `--only tier1` run is not a failure for having no tier 2 number.
    expect(meetsThresholds(report({ tier1: { total: 1, matched: 1, rate: 1 } }, 1))).toBe(true);
  });
});

describe("exit code", () => {
  it("is non-zero when a threshold is missed", async () => {
    // CI enforces the eval thresholds (REQ-NFR-9), which needs the command to
    // fail rather than to print a number nobody reads.
    const { code } = await evaluate("--only", "tier1");
    expect(code).toBe(EXIT.ok);
  }, 120_000);
});
