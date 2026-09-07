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

/**
 * Let the output reach the other end before the process goes (T18, SF-06).
 *
 * `process.exit()` discards whatever is still buffered, and when stdout is a
 * **pipe** — which it is for `yam … --json | jq`, and for every suite that
 * reads this command's output — a large answer is still buffered when `main`
 * returns. The result was a hard 65 536-byte truncation, exactly one pipe
 * buffer, producing JSON that does not parse:
 *
 *   $ yam surface snapshot --session s_… --max-nodes 400 --json | wc -c
 *   65536                       # truncated mid-token
 *   $ yam surface snapshot --session s_… --max-nodes 400 --json > out.json
 *   130764                      # complete, and parses
 *
 * SF-06 asks that "JSON stdout contains only the result" and that a pipe parses
 * exactly one JSON result per call; half a result is neither. It went unseen
 * because every existing suite redirected to a file or read answers small
 * enough to fit, and it surfaced the first time Yam read a *native*
 * accessibility tree of its own window, which is three hundred nodes.
 *
 * The empty write is the flush: its callback fires once everything queued
 * before it has been handed to the OS. Bounded, because a reader that has gone
 * away must not turn a finished command into a hung one.
 */
async function flush(stream: NodeJS.WriteStream): Promise<void> {
  if (stream.writableLength === 0) return;
  await Promise.race([
    new Promise<void>((done) => stream.write("", () => done())),
    new Promise<void>((done) => setTimeout(done, 5_000).unref()),
  ]);
}

const code = await main(process.argv.slice(2), {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
});

await flush(process.stdout);
await flush(process.stderr);
process.exit(code);
