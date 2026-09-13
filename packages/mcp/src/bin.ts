#!/usr/bin/env node
/**
 * The `yam-mcp` executable (PK-05).
 *
 * An agent's configuration is `npx -y @svatah/yam-mcp`, which fetches on demand
 * and installs nothing permanently. `--http` serves Streamable HTTP instead of
 * stdio; every other flag is the server's own and is unchanged from when this
 * was `yam mcp`.
 *
 * The arguments go through `parseArgs`, which is the parser every other command
 * in this product uses. The first version of this file rolled its own — the
 * commands expect `{ command, options, rest }` and got `{ positional, options }`,
 * so the server exited with "Cannot read properties of undefined" before it had
 * read a single flag.
 */
import { parseArgs, EXIT } from "@svatah/yam-bindings-cli";
import { mcpCommand } from "./server.js";
import { httpMcpCommand } from "./http.js";

const args = parseArgs(process.argv.slice(2));
const io = {
  out: (text: string) => process.stdout.write(`${text}\n`),
  err: (text: string) => process.stderr.write(`${text}\n`),
};

const http = args.options["http"] === true || args.options["http"] === "true";
const run = http ? httpMcpCommand : mcpCommand;

run(args, io)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((cause: unknown) => {
    io.err(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = EXIT.failed;
  });
