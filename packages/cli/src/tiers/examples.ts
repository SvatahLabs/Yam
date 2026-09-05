/**
 * The golden set, as few-shot examples (T4.3, REQ-COMP-9).
 *
 * `evals/compiler/golden.jsonl` is the compiler's eval corpus: a sentence, the
 * step it means, and the tier expected to produce it. The Tier 1 entries are
 * therefore a few hundred worked examples of exactly the job Tier 2 is being
 * asked to do, already written and already checked against the published step
 * schema — so retrieval draws on them rather than on a second corpus that would
 * drift away from the first.
 *
 * Only Tier 1 entries are examples. A Tier 2 entry is a sentence the grammar
 * refuses, which is the *question*, and putting the answers to the questions in
 * the prompt would make the measurement meaningless.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface GoldenExample {
  readonly id: string;
  readonly text: string;
  /** The step, in the shape `modelStepSchema` describes rather than the IR's. */
  readonly step: Record<string, unknown>;
}

/** Where the golden set lives, relative to this package inside the workspace. */
function goldenPath(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  // `src/tiers` when running from source, `dist` when built; both are inside
  // `packages/cli`, so walking up until `evals/` appears finds it either way.
  let cursor = here;
  for (let up = 0; up < 8; up += 1) {
    const candidate = join(cursor, "evals", "compiler", "golden.jsonl");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return undefined;
}

interface GoldenLine {
  id: string;
  tier: number;
  text: string;
  step: Record<string, unknown>;
}

/**
 * A golden entry's IR step, in the shape the model is asked for.
 *
 * The golden set stores the finished `Step` fields; the model answers in the
 * narrower shape of `modelStepSchema` (see `@svatah/compiler`'s `raw-schema.ts`).
 * Showing an example in a shape the model cannot produce would be showing it the
 * wrong thing, so the two are converted here — literal arguments flattened to
 * plain strings, references left as `argRefs`, everything else dropped.
 */
export function asExample(step: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { action: step["action"] };

  const target = step["target"] as { phrase?: string; scope?: string } | undefined;
  if (target?.phrase !== undefined) {
    out["target"] = target.scope === undefined ? { phrase: target.phrase } : { phrase: target.phrase, scope: target.scope };
  }

  const args: Record<string, unknown> = {};
  const argRefs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries((step["args"] ?? {}) as Record<string, unknown>)) {
    const ref = value as { kind?: string; value?: string; path?: string; name?: string; story?: string };
    if (typeof value !== "object" || value === null) {
      args[name] = value;
      continue;
    }
    switch (ref.kind) {
      case "literal":
        args[name] = ref.value;
        break;
      case "data":
        argRefs[name] = { kind: "data", value: ref.path };
        break;
      case "input":
        argRefs[name] = { kind: "input", value: ref.name };
        break;
      case "var":
        argRefs[name] = {
          kind: "var",
          value: ref.name,
          ...(ref.story === undefined ? {} : { story: ref.story }),
        };
        break;
      default:
        // A template, which the model's schema has no form for. Left out rather
        // than shown in a shape the model cannot answer with.
        break;
    }
  }
  if (Object.keys(args).length > 0) out["args"] = args;
  if (Object.keys(argRefs).length > 0) out["argRefs"] = argRefs;

  /*
   * A predicate's `value` is a `ValueRef` too, and it needs the same conversion
   * (T6.5).
   *
   * This was missed. `{"kind":"var","name":"enterprise"}` is the IR's shape; the
   * model's is `{"kind":"var","value":"enterprise"}` — a different *field*, not
   * a different spelling — so `g-098` ("The schedule heading should say
   * {enterprise}") was shown to the model in a shape `modelStepSchema` rejects.
   * One example in the prompt teaching a shape the parser refuses is a quiet way
   * to lose accuracy on exactly the sentences it was meant to help with, and the
   * fine-tune export is what surfaced it: every pair has to parse.
   */
  if (step["expect"] !== undefined) {
    const expect = step["expect"] as { subject?: unknown; predicate?: Record<string, unknown> };
    out["expect"] =
      expect.predicate === undefined
        ? expect
        : { ...expect, predicate: asModelPredicate(expect.predicate) };
  }
  if (step["capture"] !== undefined) out["capture"] = step["capture"];
  return out;
}

/** A predicate with its `value` in the shape `rawValueSchema` describes. */
function asModelPredicate(predicate: Record<string, unknown>): Record<string, unknown> {
  const value = predicate["value"] as
    | { kind?: string; value?: string; path?: string; name?: string; story?: string }
    | undefined;
  if (value === undefined || typeof value !== "object") return predicate;

  switch (value.kind) {
    case "literal":
      return { ...predicate, value: { kind: "literal", value: value.value ?? "" } };
    case "data":
      return { ...predicate, value: { kind: "data", value: value.path ?? "" } };
    case "input":
      return { ...predicate, value: { kind: "input", value: value.name ?? "" } };
    case "var":
      return {
        ...predicate,
        value: {
          kind: "var",
          value: value.name ?? "",
          ...(value.story === undefined ? {} : { story: value.story }),
        },
      };
    default: {
      // A template, which the model's schema has no form for. The predicate is
      // kept without its value rather than shown in a shape it cannot answer.
      const { value: _dropped, ...rest } = predicate;
      return rest;
    }
  }
}

let cached: readonly GoldenExample[] | undefined;

/** Every Tier 1 golden entry, as an example. Read once. */
export function readGoldenSet(path = goldenPath()): readonly GoldenExample[] {
  if (cached !== undefined) return cached;
  if (path === undefined || !existsSync(path)) {
    cached = [];
    return cached;
  }
  const out: GoldenExample[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const entry = JSON.parse(line) as GoldenLine;
    if (entry.tier !== 1) continue;
    out.push({ id: entry.id, text: entry.text, step: asExample(entry.step) });
  }
  cached = out;
  return cached;
}

/** For the tests, which read a fixture rather than the workspace's own set. */
export function clearGoldenCache(): void {
  cached = undefined;
}
