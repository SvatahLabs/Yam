#!/usr/bin/env node
/**
 * A stand-in MCP server over stdio, for the connection test's own tests (T16).
 *
 * Newline-delimited JSON-RPC, as the SDK's stdio transport speaks it, and just
 * enough of the protocol to be told apart from a server that is not speaking it:
 * `initialize`, `notifications/initialized`, and a `tools/list` split over two
 * pages. It never touches the network, which is the point of it.
 *
 *   node fake-mcp-server.mjs <pid-file> [--refuse | --silent | --exit | --garbage | --ping]
 *
 * It writes its pid to <pid-file> so a test can see it was stopped.
 */
import { writeFileSync } from "node:fs";
import { setInterval } from "node:timers";

const [pidFile, mode = ""] = process.argv.slice(2);
if (pidFile !== undefined) writeFileSync(pidFile, String(process.pid));

process.stderr.write("fake-mcp-server: listening on stdio\n");

if (mode === "--exit") {
  process.stderr.write("fake-mcp-server: cannot find module @svatah/yam-mcp\n");
  process.exit(3);
}

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
let initialized = false;
let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let at = buffer.indexOf("\n");
  while (at !== -1) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    at = buffer.indexOf("\n");
    if (line.trim() === "") continue;
    const message = JSON.parse(line);
    if (mode === "--silent") continue;
    if (mode === "--garbage") {
      process.stdout.write("Need to install the following packages: @svatah/yam-mcp\n");
      continue;
    }
    if (message.method === "initialize") {
      if (mode === "--refuse") {
        send({ id: message.id, error: { code: -32602, message: "Unsupported protocol version" } });
        continue;
      }
      if (mode === "--ping") send({ id: "server-1", method: "ping" });
      send({
        id: message.id,
        result: {
          protocolVersion: message.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "fake-yam", version: "9.9.9" },
        },
      });
    } else if (message.method === "notifications/initialized") {
      initialized = true;
    } else if (message.method === "tools/list") {
      if (!initialized) {
        send({ id: message.id, error: { code: -32002, message: "tools/list before notifications/initialized" } });
      } else if (message.params?.cursor === undefined) {
        send({ id: message.id, result: { tools: [{ name: "a" }, { name: "b" }], nextCursor: "page-2" } });
      } else {
        send({ id: message.id, result: { tools: [{ name: "c" }] } });
      }
    }
  }
});

// Stays up until it is stopped, as a real server does.
setInterval(() => undefined, 60_000);
