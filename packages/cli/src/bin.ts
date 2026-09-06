#!/usr/bin/env node
/**
 * The `yam` executable.
 *
 * Everything the command does is in `main`, which takes its argv and its output
 * streams, so the CLI is testable without spawning a process — and so the exit
 * code, which is part of the contract in LLD §15, is a return value rather than a
 * side effect.
 */
import { main } from "./cli.js";

const code = await main(process.argv.slice(2), {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
});

process.exit(code);
