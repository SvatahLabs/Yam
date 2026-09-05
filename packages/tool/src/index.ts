/**
 * @svatah/tool
 *
 * The tool behavior (REQ-BEH-3, REQ-AUTO-6, 8, LLD §13.3): selected stories
 * exposed over MCP as deterministic tools.
 *
 * ```ts
 * const { tools, exposure } = toolsFor({ plan, config, expose: "Book a slot" });
 * const result = await callTool(tools[0], { location: "Indiranagar" }, { runner, client });
 * // → { runId, outputs: { booking: "…" }, status: "passed", exitCode: 0 }
 * ```
 *
 * A tool's schema is *derived* from the story's signature, not written beside
 * it: the declaration an agent reads and the function the runtime validates are
 * the same lines of the flow file.
 *
 * `tool ─► workflow, schema` and nothing else (LLD §1). No model, structurally —
 * which is what makes "deterministic tool" a fact about the dependency graph
 * rather than an assurance.
 */
export {
  callTool,
  definitionOf,
  toolsFor,
  type ToolDefinition,
  type ToolResult,
  type ToolServerOptions,
} from "./server.js";
export {
  exposeList,
  exposureFor,
  requiresIdempotent,
  type Exposed,
  type Exposure,
  type Refused,
} from "./expose.js";
export {
  descriptionOf,
  inputSchemaOf,
  toolNameOf,
  type JsonSchemaProperty,
  type ToolSchema,
} from "./schema.js";
