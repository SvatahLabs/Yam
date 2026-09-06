#!/usr/bin/env node
/**
 * `yam eval compiler`, as a script the release workflow can run (T4.4, REQ-PKG-4).
 *
 *   node scripts/eval-compiler.mjs [--only tier1,tier2] [--report reports/eval-compiler.md]
 *
 * A thin wrapper, deliberately: the measurement is the CLI's, so the number in
 * the release notes and the number a person gets from `yam eval compiler` are
 * produced by the same code rather than by two that could drift.
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");

const status = await new Promise((done) => {
  const child = spawn(
    process.execPath,
    [
      CLI,
      "eval",
      "compiler",
      "--golden",
      join(ROOT, "evals", "compiler", "golden.jsonl"),
      "--golden-project",
      join(ROOT, "evals", "compiler", "project"),
      ...process.argv.slice(2),
    ],
    { cwd: ROOT, stdio: "inherit", env: process.env },
  );
  child.on("close", (code) => done(code ?? 1));
});

process.exit(status);
