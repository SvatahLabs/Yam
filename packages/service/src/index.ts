/**
 * @svatah/yam-service
 *
 * The local HTTP and event-stream service (REQ-ADE-1, LLD §13.5): the only
 * integration point for the Yam app and for any other client.
 *
 * Every handler calls the same function the CLI calls. LLD §1's import boundary
 * is what keeps that true — this package may import `@svatah/yam` and
 * `@svatah/yam-schema` and nothing else — so the app and the CLI cannot end up
 * disagreeing about what a run is.
 */
export {
  createService,
  keepRedacted,
  missingInputs,
  REDACTED,
  storiesInvokedDirectly,
  type MissingInput,
  type RunningService,
  type ServeOptions,
} from "./server.js";
export type { CompileOutcome, ProjectHandle, RunOutcome, ServiceApi } from "./api.js";
export { EventBus, SERVICE_EVENT_KINDS, type ServiceEvent } from "./events.js";
export { openApiDocument, OPENAPI_VERSION } from "./openapi.js";
export {
  MCP_TEST_COMMAND,
  MCP_TEST_PROTOCOL,
  MCP_TEST_TIMEOUT_MS,
  mcpTestCommand,
  mcpTestTimeout,
  testMcpServer,
  type McpTestResult,
  type McpTestStage,
} from "./agent-test.js";
