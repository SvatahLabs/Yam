/**
 * T8.4 Validate — the Tier 2 corpus (`evals/compiler/refused.jsonl`).
 *
 * "The corpus export reports its sources and counts and shares no sentence with
 * the golden set."
 *
 * Three properties, and the first is the one Phase 7 got wrong. The fine-tune
 * was trained on eighty-three **tier 1** grammar compiles and scored 86.8 % →
 * 13.2 % on the tier it was supposed to improve (T7.5, P7-F7). A corpus entry
 * that the grammar happily compiles is that mistake again, so every sentence
 * here is put through the compiler and has to come back refused.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compile, modelStepSchema } from "@svatah/compiler";
import { readProject } from "@svatah/spec";
import { fromRoot } from "../src/repo.js";

interface RefusedEntry {
  id: string;
  rule: string;
  text: string;
  step: Record<string, unknown>;
  why: string;
  reviewedBy: string;
}

const read = <T,>(path: string): T[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);

const entries = read<RefusedEntry>(fromRoot("evals", "compiler", "refused.jsonl"));
const golden = read<{ text: string; tier: number }>(fromRoot("evals", "compiler", "golden.jsonl"));
const normalise = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * `asExample`'s conversion, as the export applies it.
 *
 * Not imported: `@svatah/cli` is module (b)'s command line and this tool does
 * not depend on it. What is asserted here is that the *stored* step is a valid
 * `Step` shape; the export's own conversion is covered in `packages/cli/test`.
 */
function modelShape(step: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { action: step["action"] };
  const target = step["target"] as { phrase?: string } | undefined;
  if (target?.phrase !== undefined) out["target"] = { phrase: target.phrase };
  const target2 = step["target2"] as { phrase?: string } | undefined;
  if (target2?.phrase !== undefined) out["target2"] = { phrase: target2.phrase };
  const args: Record<string, unknown> = {};
  const argRefs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries((step["args"] ?? {}) as Record<string, unknown>)) {
    const ref = value as { kind?: string; value?: unknown; path?: string; name?: string };
    if (typeof value !== "object" || value === null) args[name] = value;
    else if (ref.kind === "literal") args[name] = ref.value;
    else if (ref.kind === "data") argRefs[name] = { kind: "data", value: ref.path };
    else argRefs[name] = { kind: "var", value: ref.name };
  }
  if (Object.keys(args).length > 0) out["args"] = args;
  if (Object.keys(argRefs).length > 0) out["argRefs"] = argRefs;
  for (const key of ["expect", "capture", "invoke"]) {
    if (step[key] !== undefined) out[key] = step[key];
  }
  return out;
}

describe("evals/compiler/refused.jsonl (T8.4, ADR-4)", () => {
  it("holds at least 150 reviewed pairs", () => {
    expect(entries.length).toBeGreaterThanOrEqual(150);
  });

  it("has unique, sequential ids and unique sentences", () => {
    const ids = entries.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
    const texts = entries.map((one) => normalise(one.text));
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("shares no sentence with the golden set, which is the test set", () => {
    const test = new Set(golden.map((one) => normalise(one.text)));
    const overlap = entries.filter((one) => test.has(normalise(one.text)));
    expect(overlap.map((one) => one.text)).toEqual([]);
  });

  it("says why every entry is here", () => {
    for (const entry of entries) {
      expect(entry.why.length, entry.id).toBeGreaterThan(4);
      expect(entry.reviewedBy.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("covers more than one action, so the corpus is not one rule's worth", () => {
    expect(new Set(entries.map((one) => one.rule)).size).toBeGreaterThanOrEqual(20);
  });

  it.each(entries.map((one) => [one.id, one.text] as const))(
    "%s — the grammar refuses %s",
    (id) => {
      const entry = entries.find((one) => one.id === id)!;
      const { project } = readProject({
        flows: [{ file: "flows/a.flow", text: `story: S\n  ${entry.text}\n` }],
        env: {},
      });
      const { diagnostics } = compile({ project, projectName: "refused", stable: true });
      expect(
        diagnostics.some((one) => one.code === "E_NO_MATCH"),
        `the grammar compiles "${entry.text}", so it is not Tier 2's work`,
      ).toBe(true);
    },
  );

  it.each(entries.map((one) => [one.id] as const))(
    "%s — its step is a shape a Tier 2 answer can have",
    (id) => {
      const entry = entries.find((one) => one.id === id)!;
      const parsed = modelStepSchema.safeParse(modelShape(entry.step));
      expect(parsed.success ? [] : parsed.error.issues, entry.text).toEqual([]);
    },
  );
});
