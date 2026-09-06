#!/usr/bin/env node
/**
 * An MCP client calling a Yam story as a tool (REQ-BEH-3, REQ-AUTO-6).
 *
 *   node examples/mcp-agent/call-a-tool.mjs [project] [story]
 *
 * Sixty lines and no Yam-specific concept in any of them: the SDK, a stdio
 * transport, `listTools`, `callTool`. Point any MCP client at
 * `yam tool serve` and it sees the same thing.
 *
 * What comes back is the story's declared outputs and a `runId` — the directory
 * holding the step-by-step record and the audit log, which is the only account
 * of why the system changed, because an agent cannot be asked afterwards.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const project = process.argv[2] ?? "evals/fixtures";
const story = process.argv[3] ?? "Book a slot";

/*
 * The server is spawned by the client, which is what MCP over stdio means: the
 * pipe is the transport, and whoever launched the process is the client. That
 * is why the app's tool panel shows the command rather than starting one — a
 * server the app spawned would have the app as its client.
 */
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(ROOT, "packages", "cli", "dist", "bin.js"), "tool", "serve", project, "--expose", story],
  cwd: ROOT,
  env: { ...process.env },
});

const client = new Client({ name: "example-agent", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`${tools.length} tool(s):`);
for (const tool of tools) {
  // The schema is *derived* from the story's signature, so the arguments an
  // agent must pass and the arguments the runtime validates are the same lines
  // of the flow file.
  console.log(`  ${tool.name} — required: ${(tool.inputSchema.required ?? []).join(", ") || "(none)"}`);
}

const tool = tools[0];
if (tool === undefined) {
  console.error(
    `Nothing is exposed. A story needs a signature to become a tool, and one that is not\n` +
      "marked `idempotent` is kept out of an agent's reach when `tool.requireIdempotent` is on\n" +
      "(REQ-AUTO-8). The server said which and why on stderr.",
  );
  process.exit(1);
}

const result = await client.callTool({ name: tool.name, arguments: { location: "Indiranagar" } });
const payload = JSON.parse(result.content[0].text);

console.log(`\n${tool.name} → ${payload.status}`);
console.log(`  outputs: ${JSON.stringify(payload.outputs)}`);
console.log(`  runId:   ${payload.runId}`);
console.log(
  `  the record: ${join(project, "runs", payload.runId)}/audit.jsonl — the invoker, the inputs\n` +
    "  with secrets redacted, and every surface call (REQ-AUTO-6).",
);

await client.close();
