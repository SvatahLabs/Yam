/**
 * `yam eval compiler` (T4.3, T4.4, REQ-COMP-9, REQ-PKG-4).
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readGolden } from "@svatah/yam-compiler";
import { EXIT } from "@svatah/yam-bindings-cli";
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

/*
 * The golden project's steps are code, imported only in a trusted project
 * (SF-15). It is this repository's own, so the suite trusts it the way CI's
 * `CI=true` does, and a local run without `CI` scores the same.
 */
const savedTrust = process.env["YAM_TRUST_PROJECT"];
beforeAll(() => {
  process.env["YAM_TRUST_PROJECT"] = "1";
});
afterAll(() => {
  if (savedTrust === undefined) delete process.env["YAM_TRUST_PROJECT"];
  else process.env["YAM_TRUST_PROJECT"] = savedTrust;
});

interface Report {
  gateway: string;
  real: boolean;
  byTier: Record<string, { total: number; matched: number; rate: number }>;
  totals: { total: number; matched: number; rate: number };
  cases: Array<{ id: string; tier: number; ok: boolean; text: string }>;
  notMeasured?: Record<string, string>;
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
    const { parseSentence } = await import("@svatah/yam-compiler");
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

/**
 * The configuration the number is reproducible from (P4-F2, Draft 2.6, LLD §16).
 *
 * Phase 4's verifier ran `yam eval compiler --tier2` on a clean checkout and
 * got 0 of 41 and "Below REQ-COMP-9's thresholds". The eval read `compile.tier2`
 * from the config at `--project` (default `.`), the repository root has none, so
 * no model was registered and every tier 2 sentence was scored as a wrong
 * answer. The published 90.2 percent had come from a config on a machine.
 *
 * Two things fix it and both are checked here: the golden project has its own
 * committed config with the pinned digest, and a tier that could not be
 * configured is `not measured` rather than zero.
 */
describe("the golden project's own config (P4-F2, LLD §16)", () => {
  const configPath = join(PROJECT, "yam.config.yaml");

  it("is committed, with the model and the digest the report names", () => {
    expect(existsSync(configPath), "evals/compiler/project/yam.config.yaml").toBe(true);
    const config = readFileSync(configPath, "utf8");
    expect(config).toContain("qwen2.5:3b");
    expect(config).toContain(
      "357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b",
    );
  });

  it("is what the eval reads, not the directory it was invoked from", async () => {
    /*
     * `--golden-project` points at the committed project; nothing points at a
     * config, and the tier 2 subset is still measured — which can only be
     * because the eval found `compile.tier2` beside the golden project. With
     * Phase 4's resolution it would have looked in the working directory, found
     * nothing, and reported tier 2 as not measured.
     *
     * `--gateway fake` so this needs no model server: what is under test is
     * where the configuration is read from, and the fake is registered only for
     * the tiers the eval asked for.
     */
    const { report } = await evaluate("--only", "tier2", "--gateway", "fake");
    expect(report.notMeasured).toBeUndefined();
    expect(report.byTier["tier2"]!.total).toBeGreaterThan(0);
  }, 180_000);

  it("reports a tier it cannot configure as not measured, never as 0/N", async () => {
    /*
     * Phase 4's defect, reproduced and then required to answer differently:
     * `--project` at a directory with no config is exactly the clean checkout
     * the verifier ran in. The 41 tier 2 sentences must vanish from the scoring
     * — not be compiled with no model registered and counted as 41 wrong
     * answers, which is what produced "tier2 0/41, Below thresholds".
     */
    const empty = mkdtempSync(join(tmpdir(), "yam-eval-noconfig-"));
    try {
      const { report, code, err } = await evaluate("--only", "tier2", "--project", empty);
      expect(report.notMeasured?.["tier2"]).toBeTypeOf("string");
      expect(report.byTier["tier2"]).toBeUndefined();
      expect(report.totals.total).toBe(0);
      expect(err).toContain("not measured");
      // And it is not a failure: nothing was measured, so nothing fell short.
      expect(code).toBe(EXIT.ok);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }, 180_000);

  it("leaves the tiers it can measure alone", async () => {
    // Tier 3 is unconfigured everywhere — no credential ever reaches a golden
    // project — and asking for it must not disturb tier 1's 100 percent.
    const { report, code } = await evaluate("--only", "tier1", "--tier3");
    expect(report.notMeasured?.["tier3"]).toBeTypeOf("string");
    expect(report.byTier["tier1"]!.rate).toBe(TIER1_THRESHOLD);
    expect(code).toBe(EXIT.ok);
  }, 180_000);

  it("says so in the report a release publishes", () => {
    const markdown = renderCompilerReport({
      at: "1970-01-01T00:00:00.000Z",
      gateway: "(none)",
      real: false,
      cases: [],
      byTier: { tier1: { total: 10, matched: 10, rate: 1 } },
      totals: { total: 10, matched: 10, rate: 1 },
      notMeasured: { tier2: "`compile.tier2` is not configured in evals/compiler/project" },
    });
    expect(markdown).toContain("*not measured*");
    expect(markdown).toContain("### Not measured");
    expect(markdown).toContain("Excluded from the thresholds");
    // The reading the Phase 4 report invited, and the one this must never allow.
    expect(markdown).not.toMatch(/\| `tier2` \| \d+ \| 0 \(0\.0%\)/);
  });
});

describe("the published report (REQ-PKG-4)", () => {
  const path = join(ROOT, "reports", "eval-compiler.md");

  it("exists and is a real result rather than a placeholder", () => {
    expect(existsSync(path), "run `yam eval compiler --report reports/eval-compiler.md`").toBe(
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
