/**
 * The fine-tune export (T6.5, ADR-4, REQ-COMP-3, REQ-COMP-9).
 *
 * The export is the part of the pipeline that can be wrong *silently*, and it
 * has two properties worth more than the rest of it put together:
 *
 * 1. **Nothing from the golden set is exported.** The golden set is the test
 *    set. A tuned model measured on sentences it was trained on reports an
 *    improvement that means nothing, and REQ-COMP-9's number stops being a
 *    number.
 * 2. **Every pair is in the shape a Tier 2 answer has**, not the finished IR.
 *    The finished `Step` carries an element id, a timeout and a positional id —
 *    project facts a model has no basis for — and training on that shape teaches
 *    the model to emit something the tier's own parser rejects. It would score
 *    *worse* while every pair looked right in the file.
 *
 * Both are checked here rather than in a review.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { modelStepSchema } from "@svatah/compiler";
import { exportPairs, normalise } from "../src/commands/finetune.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GOLDEN = join(ROOT, "evals", "compiler", "golden.jsonl");

const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();

const result = exportPairs({
  root: ROOT,
  // `HEAD` rather than `master`, so the test measures this checkout: it is
  // about the exporter's rules, not about what happens to be merged today.
  ref: head,
  projects: ["evals/fixtures", "evals/migrate/expected"],
  goldenPath: GOLDEN,
});

describe("exporting training pairs from merged flows (T6.5, ADR-4)", () => {
  it("exports pairs at all, from the ref it was given", () => {
    expect(result.pairs.length).toBeGreaterThan(20);
    expect(result.commit).toBe(head);
    expect(result.pairs.every((one) => one.source.startsWith(`${head}:`))).toBe(true);
  });

  it("excludes every sentence the golden set holds, and counts them", () => {
    const golden = new Set(
      readFileSync(GOLDEN, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => normalise((JSON.parse(line) as { text: string }).text)),
    );

    for (const pair of result.pairs) {
      expect(golden.has(normalise(pair.text)), `"${pair.text}" is in the golden set`).toBe(false);
    }
    // And it happened: a count of zero would mean the rule never fired and the
    // check above proves nothing.
    expect(result.excludedGolden).toBeGreaterThan(10);
  });

  it("emits every pair in the shape a Tier 2 answer has, not the finished IR", () => {
    for (const pair of result.pairs) {
      const parsed = modelStepSchema.safeParse(pair.step);
      expect(parsed.success, `${pair.text}: ${JSON.stringify(pair.step)}`).toBe(true);
    }
  });

  it("carries no project fact a model could not know", () => {
    /*
     * The other half of the same point, stated as an absence. An element id, a
     * timeout, a step id, a line number: each is a fact about *this* repository,
     * and a model that learned them would have learned this repository.
     */
    for (const pair of result.pairs) {
      const step = pair.step as Record<string, unknown>;
      for (const field of ["id", "storyName", "line", "timeoutMs", "origin", "sideEffect"]) {
        expect(step[field], `${pair.text} carries ${field}`).toBeUndefined();
      }
      const target = step["target"] as Record<string, unknown> | undefined;
      if (target !== undefined) {
        expect(target["phrase"]).toBeTypeOf("string");
        // The phrase, never the id the dictionary assigned it (REQ-COMP-5).
        expect(target["ref"]).toBeUndefined();
        expect(target["status"]).toBeUndefined();
      }
    }
  });

  it("exports each sentence once, however many flows use it", () => {
    const texts = result.pairs.map((one) => normalise(one.text));
    expect(new Set(texts).size).toBe(texts.length);
    expect(result.excludedDuplicate).toBeGreaterThan(0);
  });

  it("exports only what the grammar compiled", () => {
    // Not a model tier's answer, which would be the model's own guess fed back
    // to it, and not a custom step, whose handler no model could write.
    expect(result.pairs.every((one) => one.tier === 1)).toBe(true);
  });

  it("reads the merged text, not the working tree", async () => {
    /*
     * The rule ADR-4 turns on. A draft in someone's editor is not evidence that
     * anyone accepted a step, so the flows are read through `git show`. Writing
     * a flow into the working tree and re-exporting must change nothing.
     */
    const { writeFileSync, rmSync } = await import("node:fs");
    const scratch = join(ROOT, "evals", "fixtures", "flows", ".finetune-probe.flow");
    writeFileSync(
      scratch,
      "story: A sentence nobody merged\n  Click the never merged button\n\ntest: A sentence nobody merged\n",
      "utf8",
    );
    try {
      const again = exportPairs({
        root: ROOT,
        ref: head,
        projects: ["evals/fixtures", "evals/migrate/expected"],
        goldenPath: GOLDEN,
      });
      expect(again.pairs.map((one) => one.text)).not.toContain("Click the never merged button");
      expect(again.pairs.length).toBe(result.pairs.length);
    } finally {
      rmSync(scratch, { force: true });
    }
  });
});

describe("the prompt's few-shot examples are in a shape the model can answer with", () => {
  /*
   * Found by the export, and worth a test of its own because it is about the
   * *prompt* rather than about training: `asExample` converts a golden entry's
   * IR step into the shape `modelStepSchema` describes, and it did not convert a
   * predicate's value. `{"kind":"var","name":"x"}` is the IR's shape and
   * `{"kind":"var","value":"x"}` is the model's — a different field, not a
   * different spelling — so one example in every Tier 2 prompt was teaching a
   * shape the tier's own parser rejects.
   *
   * An example the model cannot answer with is worse than no example: it is a
   * demonstration of a wrong answer, in the position where the model is looking
   * hardest for a pattern.
   */
  it("converts every golden example, including predicates that carry a reference", async () => {
    const { asExample } = await import("../src/tiers/examples.js");
    const golden = readFileSync(GOLDEN, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { id: string; tier: number; text: string; step: Record<string, unknown> })
      .filter((one) => one.tier === 1);

    expect(golden.length).toBeGreaterThan(100);
    for (const entry of golden) {
      const example = asExample(entry.step);
      const parsed = modelStepSchema.safeParse(example);
      expect(parsed.success, `${entry.id} "${entry.text}": ${JSON.stringify(example)}`).toBe(true);
    }
  });

  it("keeps the reference's meaning while changing its shape", async () => {
    const { asExample } = await import("../src/tiers/examples.js");
    const example = asExample({
      action: "expect",
      target: { ref: "schedule-heading", phrase: "the schedule heading", status: "unbound" },
      expect: {
        subject: "target",
        predicate: { kind: "text", value: { kind: "var", name: "enterprise" } },
      },
    });
    expect(example["expect"]).toEqual({
      subject: "target",
      predicate: { kind: "text", value: { kind: "var", value: "enterprise" } },
    });
  });
});
