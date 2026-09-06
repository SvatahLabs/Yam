/**
 * The Tier 2 corpus and its export (T8.4, T6.5, ADR-4, REQ-COMP-3).
 *
 * Phase 7's export drew from *merged flows* — 83 sentences, every one a tier 1
 * grammar compile — and the tuned model fell from 86.8 % to 13.2 % on the tier
 * it was meant to improve. The properties below are the ones that would have
 * caught it: what the corpus is made of, that nothing in the test set leaks
 * into it, and that every pair is in a shape the tier's own parser accepts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { modelStepSchema } from "@svatah/yam-compiler";
import { normalise, readCorpus, reviewCandidates } from "../src/commands/finetune.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const paths = {
  root: ROOT,
  goldenPath: join(ROOT, "evals", "compiler", "golden.jsonl"),
  refusedPath: join(ROOT, "evals", "compiler", "refused.jsonl"),
  reviewPath: join(ROOT, "evals", "migrate", "expected", "migration-review.md"),
};

const corpus = readCorpus(paths);

describe("the corpus reports its sources and counts (T8.4)", () => {
  it("draws on three sources and says what each contributed", () => {
    expect(corpus.sources.map((one) => one.kind)).toEqual(["test-set", "candidate", "reviewed"]);
    const reviewed = corpus.sources.find((one) => one.kind === "reviewed")!;
    expect(reviewed.exported).toBe(corpus.pairs.length);
    expect(reviewed.found).toBeGreaterThanOrEqual(150);
  });

  it("exports nothing from the test set, whatever it finds there", () => {
    const test = corpus.sources.find((one) => one.kind === "test-set")!;
    expect(test.found).toBeGreaterThan(0);
    expect(test.exported).toBe(0);
  });

  it("collects the migration's flagged sentences without exporting them", () => {
    const candidate = corpus.sources.find((one) => one.kind === "candidate")!;
    expect(candidate.found).toBeGreaterThan(0);
    expect(candidate.exported).toBe(0);
    // They are the legacy lines, sigils and all: refused by construction, and
    // with no reviewed step they are a to-do list rather than a training set.
    expect(corpus.candidates.some((one) => one.includes("+click+"))).toBe(true);
  });
});

describe("what an exported pair is", () => {
  it("shares no sentence with the golden set", () => {
    const golden = new Set(
      readFileSync(paths.goldenPath, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => normalise((JSON.parse(line) as { text: string }).text)),
    );
    expect(corpus.pairs.filter((one) => golden.has(normalise(one.text)))).toEqual([]);
  });

  it("is in the shape a Tier 2 answer has, not the finished IR", () => {
    for (const pair of corpus.pairs) {
      const parsed = modelStepSchema.safeParse(pair.step);
      expect(parsed.success ? [] : parsed.error.issues, pair.text).toEqual([]);
    }
  });

  it("carries no project fact a model could not know", () => {
    for (const pair of corpus.pairs) {
      const step = pair.step as Record<string, unknown>;
      expect(Object.keys(step)).not.toContain("id");
      expect(Object.keys(step)).not.toContain("timeoutMs");
      expect(Object.keys(step)).not.toContain("origin");
      const target = step["target"] as Record<string, unknown> | undefined;
      if (target !== undefined) expect(Object.keys(target)).not.toContain("ref");
    }
  });

  it("keeps a drag's destination, which the converter used to drop", () => {
    // `modelStepSchema` has had `target2` since Draft 2 and `asExample` dropped
    // it, so every `dragTo` example in the prompt showed a drag with a source
    // and nowhere to put it (T8.4).
    const drag = corpus.pairs.find((one) => (one.step as { action?: string }).action === "dragTo");
    expect(drag).toBeDefined();
    expect((drag!.step as { target2?: { phrase?: string } }).target2?.phrase).toBeTruthy();
  });

  it("says where it came from and why the grammar refuses it", () => {
    for (const pair of corpus.pairs) {
      expect(pair.source).toMatch(/refused\.jsonl#r-\d+$/);
      expect(pair.why.length).toBeGreaterThan(4);
    }
  });
});

describe("reading the migration review notes", () => {
  it("takes the blockquoted legacy line and nothing else", () => {
    const found = reviewCandidates(
      ["- **a.flow:2** — some note.", "  > `+click+ on the tab using ~id:x~`", "", "prose"].join("\n"),
    );
    expect(found).toEqual(["+click+ on the tab using ~id:x~"]);
  });
});
