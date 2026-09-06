#!/usr/bin/env node
/** The `yam-bindings` executable. */
import { main } from "./cli.js";

const code = await main(process.argv.slice(2), {
  out: (text: string) => process.stdout.write(`${text}\n`),
  err: (text: string) => process.stderr.write(`${text}\n`),
});
process.exitCode = code;
