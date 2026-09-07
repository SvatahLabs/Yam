#!/usr/bin/env node
/**
 * An ordinary MCP client, against an installed `yam` (T19, SF-07, SF-20).
 *
 *   node scripts/mcp-probe.mjs <path to the yam binary>
 *
 * It prints `{ "tools": [...] }` and nothing else on stdout. The point is the
 * word *ordinary*: the official SDK, the stdio transport it would use for any
 * server, no Yam-specific anything — which is what SF-07's "no client-specific
 * plugin is required" has to mean if it means anything.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const binary = process.argv[2];
if (binary === undefined) {
  process.stderr.write("usage: node scripts/mcp-probe.mjs <path to the yam binary>\n");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [binary, "mcp"],
  stderr: "ignore",
});
const client = new Client({ name: "mcp-probe", version: "0" });
try {
  await client.connect(transport);
  const listed = await client.listTools();
  process.stdout.write(`${JSON.stringify({ tools: listed.tools.map((one) => one.name) })}\n`);
} finally {
  await client.close().catch(() => undefined);
}
