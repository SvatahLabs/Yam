/**
 * `actions.yaml` — the published action vocabulary (T2.2, REQ-STD-1).
 *
 * The vocabulary lives in `vocabulary.ts` because it is checked against the IR's
 * `Action` type at compile time; the YAML is generated from it and committed, so
 * that a foreign runtime, `migrate`, or a person auditing the port against
 * `ActionSynonyms.java` can read it without a TypeScript toolchain. This is the
 * same arrangement as the JSON Schemas in `@svatah/schema`: one source, one
 * published artifact, and a drift test that fails when they disagree.
 */
import { VOCABULARY, type Verb } from "./vocabulary.js";

const HEADER = `# The Svatah action vocabulary (T2.2, LLD §4.3, REQ-RUN-10).
#
# GENERATED from packages/spec/src/vocabulary.ts — do not edit by hand.
# Regenerate with \`pnpm --filter @svatah/spec build\`.
#
# A port of the legacy ActionSynonyms.java, verb for verb, onto the v3 IR action
# set. \`legacy\` is the Java name, kept so the port is auditable and so migrate
# can map an old verb by name. \`synonyms\` is every phrase that means the verb,
# lower-cased; the compiler matches the longest one at the start of a sentence.
`;

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function renderScalar(value: string | number | boolean): string {
  return typeof value === "string" ? quote(value) : String(value);
}

function renderVerb(verb: Verb): string {
  const lines: string[] = [`  - legacy: ${quote(verb.legacy)}`];
  lines.push(`    action: ${quote(verb.action)}`);
  if (verb.predicate !== undefined) lines.push(`    predicate: ${quote(verb.predicate)}`);
  if (verb.negate !== undefined) lines.push(`    negate: ${String(verb.negate)}`);
  if (verb.subject !== undefined) lines.push(`    subject: ${quote(verb.subject)}`);
  if (verb.readKind !== undefined) lines.push(`    readKind: ${quote(verb.readKind)}`);
  if (verb.args !== undefined) {
    lines.push("    args:");
    for (const [key, value] of Object.entries(verb.args)) {
      lines.push(`      ${key}: ${renderScalar(value)}`);
    }
  }
  lines.push("    synonyms:");
  for (const synonym of verb.synonyms) lines.push(`      - ${quote(synonym)}`);
  return lines.join("\n");
}

/** The exact bytes `packages/spec/actions.yaml` holds. */
export function generateActionsYaml(vocabulary: readonly Verb[] = VOCABULARY): string {
  return `${HEADER}\nverbs:\n${vocabulary.map(renderVerb).join("\n")}\n`;
}
