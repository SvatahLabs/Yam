/**
 * A story's signature as an MCP tool schema (REQ-BEH-3, LLD §13.3, T5.3).
 *
 * "An MCP server whose tools are derived from story signatures (`inputSchema`
 * from `inputs`, description from meta or the first comment line)."
 *
 * Derived, not written: the tool an agent sees and the function the runtime runs
 * are the same declaration. A hand-written schema beside a signature is two
 * declarations of one thing, and the day they disagree an agent passes an
 * argument the story will not accept and finds out at step three.
 *
 * ## What is deliberately absent
 *
 * There is no way to expose a story's *steps*, its bindings, or its plan through
 * a tool. An agent calling `book_a_slot` is calling a function; how the function
 * gets it done is the determinism layer's business and changing it must not
 * change the tool. That is REQ-BEH-5 seen from the outside.
 */
import type { Signature, Story } from "@svatah/yam-schema";

/** A JSON Schema for one story's inputs, as MCP's `inputSchema`. */
export interface ToolSchema {
  readonly type: "object";
  readonly properties: Record<string, JsonSchemaProperty>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export interface JsonSchemaProperty {
  readonly type: "string" | "number" | "boolean" | "object";
  readonly description?: string;
  readonly default?: unknown;
}

/** A story name as an MCP tool name: lower case, underscores, nothing else. */
export function toolNameOf(story: string): string {
  const name = story
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return name === "" ? "story" : name;
}

/**
 * The IR's types as JSON Schema's.
 *
 * `secret` is a string. An MCP client has to be able to *send* one — that is the
 * whole point of an input the story does not hard-code — and the protecting
 * happens on this side: the value is redacted in the audit, in the results and
 * in screenshots (REQ-NFR-6), and is never written to the run directory.
 */
function jsonType(type: Signature["inputs"][string]["type"]): JsonSchemaProperty["type"] {
  switch (type) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "json":
      return "object";
    default:
      return "string";
  }
}

/** The `inputSchema` for a story (LLD §13.3). */
export function inputSchemaOf(story: Story): ToolSchema {
  const inputs = story.signature?.inputs ?? {};
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [name, declared] of Object.entries(inputs)) {
    properties[name] = {
      type: jsonType(declared.type),
      ...(declared.description === undefined ? {} : { description: declared.description }),
      ...("default" in declared ? { default: declared.default } : {}),
      ...(declared.type === "secret"
        ? {
            description:
              (declared.description === undefined ? "" : `${declared.description} `) +
              "(secret: redacted in the audit log, the results and screenshots)",
          }
        : {}),
    };
    // An input with a default is optional, which is the same rule the runtime
    // validates by (REQ-AUTO-5). Two places, one rule, derived from one line.
    if (!("default" in declared)) required.push(name);
  }

  return { type: "object", properties, required: required.sort(), additionalProperties: false };
}

/**
 * What the tool says it does.
 *
 * The story's own words, in this order: an explicit `description` in the
 * signature has none today, so it is the tags and the name. A tool with a
 * useless description is a tool an agent will not choose correctly, and the
 * honest fallback is the story's name — which the author wrote as a sentence.
 */
export function descriptionOf(story: Story): string {
  const parts = [`Runs the Yam story "${story.name}" as a deterministic function.`];

  const outputs = Object.keys(story.signature?.outputs ?? {});
  if (outputs.length > 0) parts.push(`Returns: ${outputs.sort().join(", ")}.`);

  parts.push(
    story.meta.idempotent === true
      ? "Idempotent: running it twice is the same as running it once."
      : "Not marked idempotent: it may have an effect on the target system.",
  );
  parts.push("No model is involved; the same plan and bindings run every time.");

  return parts.join(" ");
}
