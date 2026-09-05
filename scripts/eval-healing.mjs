#!/usr/bin/env node
/**
 * `pnpm eval:healing` — start the sample application, run the healing eval
 * against it, and write the report (T1.8, REQ-HEAL-5, REQ-PKG-4).
 *
 * The eval itself needs no wrapper: `svatah eval healing --base-url <url>` runs
 * against any deployment of `apps/sample-web`. This exists so a verifier, and the
 * release workflow, have one command.
 *
 * The exit code is the eval's: non-zero when the relocalize-only number is below
 * REQ-HEAL-5's threshold. The report is written either way — HLD §14's mitigation
 * for "healing numbers disappoint" is to publish anyway.
 */
import { spawn } from "node:child_process";
import { startSampleApp } from "sample-web";

const app = await startSampleApp(0);
console.error(`sample-web on ${app.origin}`);

const args = [
  "packages/cli/dist/bin.js",
  "eval",
  "healing",
  "--no-model",
  "--base-url",
  app.origin,
  ...process.argv.slice(2),
];
const child = spawn(process.execPath, args, { stdio: "inherit" });

const code = await new Promise((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
await app.close();
process.exit(code);
