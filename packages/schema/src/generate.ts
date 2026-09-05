import { zodToJsonSchema } from "zod-to-json-schema";
import { canonicalJson } from "./canonical.js";
import { PUBLISHED_SCHEMAS } from "./registry.js";
import { SCHEMA_VERSION } from "./version.js";

/** Base name → generated JSON Schema text, exactly as it is written to disk. */
export type GeneratedSchemas = Record<string, string>;

/** `<name>.schema.json` for a registry entry. */
export function schemaFileName(name: string): string {
  return `${name}.schema.json`;
}

/**
 * Render every published schema (REQ-STD-1).
 *
 * The output is canonical JSON, so regenerating on any machine produces identical
 * bytes and the drift test is a plain string comparison.
 */
export function generateJsonSchemas(): GeneratedSchemas {
  const out: GeneratedSchemas = {};
  for (const { name, description, schema } of PUBLISHED_SCHEMAS) {
    const json = zodToJsonSchema(schema, {
      name,
      target: "jsonSchema7",
      $refStrategy: "root",
      errorMessages: false,
    }) as Record<string, unknown>;

    out[schemaFileName(name)] = canonicalJson({
      ...json,
      $id: `https://svatah.dev/schema/${SCHEMA_VERSION}/${schemaFileName(name)}`,
      title: name,
      description: `${description}. Svatah schemaVersion ${SCHEMA_VERSION}.`,
      "x-svatah-schema-version": SCHEMA_VERSION,
    });
  }
  return out;
}
