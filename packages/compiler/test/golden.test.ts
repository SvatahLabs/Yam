/**
 * T2.4 Validate — "100 percent on `tier: 1` golden".
 *
 * `evals/compiler/golden.jsonl` is the contract: 148 sentences and the exact IR
 * each must produce. Exact, not equivalent — a compiler that emits a
 * *reasonable* step for each sentence is a compiler nobody can depend on, because
 * the plan is the artifact a foreign runtime replays (REQ-STD-3).
 *
 * The golden entries compile against `evals/compiler/project`, which holds the
 * three things a sentence cannot carry: the data file whose `secrets:` list makes
 * `{data.card.number}` secret, the `targets.yaml` that names `accounts.current`
 * and says the frame button lives in a frame, and the Tier 0 steps the `custom`
 * entries invoke.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { formatDiagnostic, parseTargets, readData, TargetDictionary } from "@svatah/spec";
import { lowerStep, parseSentence } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PROJECT = join(ROOT, "evals", "compiler", "project");

interface GoldenEntry {
  id: string;
  tier: 0 | 1 | 2 | 3;
  pattern: number;
  rule: string;
  text: string;
  step: Record<string, unknown>;
}

const GOLDEN: GoldenEntry[] = readFileSync(join(ROOT, "evals", "compiler", "golden.jsonl"), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as GoldenEntry);

const TIER_1 = GOLDEN.filter((entry) => entry.tier === 1);

/* ── the project the golden set compiles in ───────────────────────────────── */

const { data } = readData(readFileSync(join(PROJECT, "data.yaml"), "utf8"), "data.yaml", {});
const { targets: declared } = parseTargets(
  parseYaml(readFileSync(join(PROJECT, "targets.yaml"), "utf8")) as unknown,
  "targets.yaml",
);

function dictionary(): TargetDictionary {
  const dict = new TargetDictionary();
  dict.addTargets(declared);
  return dict;
}

/**
 * Compile one sentence and strip the fields the golden set does not carry.
 *
 * `id`, `storyName`, `line`, `text`, `timeoutMs` and `origin` are the step's
 * position and provenance, not its meaning. They are asserted separately, once,
 * rather than repeated on 148 entries.
 */
function compile(entry: GoldenEntry): { step?: Record<string, unknown>; problems: string[] } {
  const where = { file: "golden.jsonl", line: 1 };
  const parsed = parseSentence(entry.text, where);
  if (parsed.raw === undefined) {
    return { problems: parsed.diagnostics.map(formatDiagnostic) };
  }
  const { step, diagnostics } = lowerStep(
    parsed.raw,
    { id: "s1", storyName: "golden", line: 1, text: entry.text, rule: entry.rule },
    { targets: dictionary(), secrets: data.secrets, file: "golden.jsonl", line: 1, stepTimeoutMs: 10_000 },
  );
  const {
    id: _id,
    storyName: _storyName,
    line: _line,
    text: _text,
    timeoutMs: _timeoutMs,
    origin: _origin,
    ...meaning
  } = step as unknown as Record<string, unknown>;
  return {
    step: meaning,
    problems: diagnostics.filter((d) => d.severity === "error").map(formatDiagnostic),
  };
}

describe("the tier 1 golden set (REQ-COMP-9, T2.4)", () => {
  it("has entries to check, so this suite is not vacuous", () => {
    expect(TIER_1.length).toBeGreaterThanOrEqual(120);
  });

  it.each(TIER_1.map((entry) => [entry.id, entry] as const))(
    "%s compiles to exactly the golden step",
    (_id, entry) => {
      const { step, problems } = compile(entry);
      expect(problems, `"${entry.text}"`).toEqual([]);
      expect(step, `"${entry.text}"`).toEqual(entry.step);
    },
  );

  it("is 100 percent, and says so as a number", () => {
    // The per-entry tests above are the diagnosis; this is the headline
    // REQ-COMP-2 asks for, so a partial regression reads as a percentage rather
    // than as "some tests failed".
    /** Key order is not meaning; compare canonically. */
    const canonical = (value: unknown): string =>
      JSON.stringify(value, (_key, v: unknown) =>
        v !== null && typeof v === "object" && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort())
          : v,
      );

    const passed = TIER_1.filter((entry) => {
      const { step, problems } = compile(entry);
      return problems.length === 0 && canonical(step) === canonical(entry.step);
    }).length;
    expect(`${passed}/${TIER_1.length}`).toBe(`${TIER_1.length}/${TIER_1.length}`);
  });
});

describe("what every compiled step carries besides its meaning", () => {
  const where = { file: "f.flow", line: 7 };
  const parsed = parseSentence("Click the sign in button", where);
  const { step } = lowerStep(
    parsed.raw!,
    { id: "s3", storyName: "Validate login", line: 7, text: "Click the sign in button", rule: "click" },
    { targets: dictionary(), secrets: data.secrets, file: "f.flow", line: 7, stepTimeoutMs: 10_000 },
  );

  it("records where it came from", () => {
    expect(step.id).toBe("s3");
    expect(step.storyName).toBe("Validate login");
    expect(step.line).toBe(7);
    expect(step.text).toBe("Click the sign in button");
  });

  it("records the tier, the rule and full confidence (REQ-COMP-1)", () => {
    // Tier 1 is deterministic, so its confidence is 1 and it has no provenance:
    // nothing about it came from a model (REQ-AGT-3).
    expect(step.origin).toEqual({ tier: 1, rule: "click", confidence: 1 });
    expect(step.origin.provenance).toBeUndefined();
  });

  it("carries the step timeout the config gave it", () => {
    expect(step.timeoutMs).toBe(10_000);
  });
});
