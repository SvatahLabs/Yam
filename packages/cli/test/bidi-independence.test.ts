/**
 * T4.1's Validate list, inside the verification contract.
 *
 * > Passes the surface conformance suite on stock Chrome and Firefox; fixtures
 * > replay on BiDi with identical statuses to Playwright (runtime conformance).
 *
 * `scripts/bidi-independence.mjs` is the command a verifier re-runs by hand and
 * the thing that writes `reports/adapter-bidi.md`. This runs the same script, so
 * `pnpm -r test` cannot go green while the independence proof is failing — and
 * so the report and the gate can never be measuring two different things.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bidiAvailable } from "@svatah/adapter-bidi";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(ROOT, "scripts", "bidi-independence.mjs");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");

const available = bidiAvailable();

if (!available) {
  console.warn(
    "bidi independence: no WebDriver BiDi endpoint and no Gecko browser, so the proof is " +
      "skipped. `pnpm browsers` downloads one, or set SVATAH_BIDI_URL.",
  );
}

describe.runIf(available)("the BiDi independence proof (T4.1, REQ-ADP-4, REQ-STD-2)", () => {
  it("passes the surface suite and replays the fixtures identically to Playwright", async () => {
    expect(existsSync(CLI), "run `pnpm -r build` first").toBe(true);

    const { code, output } = await new Promise<{ code: number; output: string }>((done) => {
      let output = "";
      const child = spawn(process.execPath, [SCRIPT], { cwd: ROOT, env: process.env });
      child.stdout.on("data", (chunk) => (output += String(chunk)));
      child.stderr.on("data", (chunk) => (output += String(chunk)));
      child.on("close", (status) => done({ code: status ?? 1, output }));
    });

    // The whole output on failure: which case failed, or which step disagreed,
    // is the only useful thing to read here.
    expect(output, output).toMatch(/surface conformance: \d+ passed, 0 failed/);
    expect(output, output).toContain("0 difference(s) from the Playwright baseline");
    expect(output, output).toMatch(/two BiDi runs agree over \d+ steps/);
    expect(code, output).toBe(0);
  }, 900_000);
});
