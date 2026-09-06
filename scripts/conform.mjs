#!/usr/bin/env node
/**
 * `pnpm conform:playwright` — start the sample application, run the surface
 * conformance suite against the Playwright adapter, and stop the app again.
 *
 * The suite itself needs no such wrapper: `yam surface conform --adapter
 * playwright --base-url <url>` runs against any deployment. This exists so a
 * verifier has one command to type (T1.2).
 */
import { spawn } from "node:child_process";
import { startSampleApp } from "sample-web";

const app = await startSampleApp(0);
console.error(`sample-web on ${app.origin}`);

const args = ["packages/cli/dist/bin.js", "surface", "conform", "--adapter", "playwright", "--base-url", app.origin, ...process.argv.slice(2)];
const child = spawn(process.execPath, args, { stdio: "inherit" });

const code = await new Promise((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
await app.close();
process.exit(code);
