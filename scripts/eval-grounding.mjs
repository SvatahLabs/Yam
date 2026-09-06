#!/usr/bin/env node
/**
 * `pnpm eval:grounding` — start the sample application, run the grounding eval
 * against it, and stop the app again (T3.4, REQ-REC-10).
 *
 *   pnpm eval:grounding                       # needs a credential
 *   pnpm eval:grounding -- --gateway fake     # checks the harness, not grounding
 *
 * The suite itself needs no wrapper: `yam eval grounding --base-url <url>`
 * runs against any deployment. This exists so a verifier has one command to type,
 * and so the ephemeral port the sample application takes is handled for them.
 */
import { spawn } from "node:child_process";
import { startSampleApp } from "sample-web";

const app = await startSampleApp(0);
console.error(`sample-web on ${app.origin}`);

const args = [
  "packages/cli/dist/bin.js",
  "eval",
  "grounding",
  "--base-url",
  app.origin,
  ...process.argv.slice(2),
];
const child = spawn(process.execPath, args, { stdio: "inherit" });
const code = await new Promise((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
await app.close();
process.exit(code);
