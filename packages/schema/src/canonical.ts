import { createHash } from "node:crypto";
import { stringify as yamlStringify } from "yaml";

/**
 * Canonical serialisation (LLD §3, REQ-COMP-7).
 *
 * `plan.json` must be byte-stable for identical inputs, and the bindings store is
 * canonical YAML so a re-record produces a reviewable diff rather than noise. Both
 * come from one rule: object keys are emitted in ascending code-unit order, arrays
 * keep their order, and `undefined` members are dropped.
 */

/** Recursively sort object keys; arrays keep their order, other values pass through. */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const v = source[key];
    if (v === undefined) continue;
    out[key] = canonicalise(v);
  }
  return out;
}

/**
 * Deterministic JSON: sorted keys, two-space indent, one trailing newline.
 * Two structurally equal values always produce identical bytes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value), null, 2) + "\n";
}

/** Deterministic JSON with no whitespace — the form hashes are taken over. */
export function canonicalJsonCompact(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

/** Deterministic YAML: sorted keys, block style, no line folding. */
export function canonicalYaml(value: unknown): string {
  return yamlStringify(canonicalise(value), {
    indent: 2,
    lineWidth: 0,
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
    sortMapEntries: true,
    nullStr: "null",
  });
}

/** sha256 of the compact canonical form, hex encoded. */
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJsonCompact(value), "utf8").digest("hex");
}

/**
 * Hash of a plan's *content* (REQ-COMP-7, REQ-AUTO-3).
 *
 * Excludes two fields, for two different reasons:
 *
 * * `hash` itself, so a plan can carry its own hash without the hash depending
 *   on itself;
 * * `generatedAt`, because it is when the compile ran and not what it produced.
 *   `--resume` refuses a run whose plan hash has changed (REQ-AUTO-3); if the
 *   timestamp counted, recompiling the very same flows would make every
 *   in-flight run unresumable, and the check would be worse than useless — it
 *   would fire on the one case it exists to permit.
 */
export function planHash(plan: Record<string, unknown>): string {
  const { hash: _ignored, generatedAt: _when, ...rest } = plan;
  return canonicalHash(rest);
}

/**
 * Hash of a whole bindings store: the id → file map, hashed canonically. Used in
 * `Summary.bindingsHash` and verified on resume (REQ-AUTO-3).
 */
export function bindingsHash(files: Record<string, unknown>): string {
  return canonicalHash(files);
}
