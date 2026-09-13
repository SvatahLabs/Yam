/**
 * `@svatah/yam-mcp` — the MCP server, as its own installable (PK-05).
 *
 * It was `yam mcp`, a subcommand, and the `@modelcontextprotocol/sdk` it needs
 * is six megabytes against six for everything Yam wrote. Every CLI install paid
 * a hundred per cent overhead for a feature most never touch.
 *
 * It depends on `@svatah/yam`, so the operation tools — compile, lint, run,
 * record, heal — are here when a project is. What moved is the entry point, not
 * the capability, and there is exactly one of it: two entry points to one server
 * is how the app and the CLI ended up with two copies of everything else.
 *
 * An agent's configuration says `npx -y @svatah/yam-mcp`, which installs nothing
 * permanently and fetches on demand.
 */
export { buildMcpServer, mcpCommand, type McpServerOptions } from "./server.js";
export {
  startHttpMcp,
  httpMcpCommand,
  createEventStore,
  PINNED_PROTOCOL_VERSION,
  SDK_LATEST_PROTOCOL_VERSION,
  type HttpMcpOptions,
  type RunningHttpMcp,
} from "./http.js";
