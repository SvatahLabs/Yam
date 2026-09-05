/**
 * The example runs (T5.6's Validate: "examples run in CI where feasible").
 *
 * An example nobody runs is documentation that drifts. This is the same script
 * `README.md` tells a reader to run, against the sample application on an
 * ephemeral port — so a change to the tool server, to the signature-derived
 * schema, or to what a call returns breaks the example in CI rather than in
 * somebody's terminal a month later.
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { startSampleApp } from "sample-web";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

test("calls a story as a tool and gets its outputs and a runId", async () => {
  const app = await startSampleApp(0);
  try {
    const output = await new Promise((done, fail) => {
      let out = "";
      let err = "";
      const child = spawn(process.execPath, [join(HERE, "call-a-tool.mjs"), "evals/fixtures"], {
        cwd: ROOT,
        env: {
          ...process.env,
          SVATAH_BASE_URL: app.origin,
          SVATAH_SAMPLE_PASSWORD: "qwerty123",
          SVATAH_SAMPLE_CARD_NUMBER: "5123456789012346",
          SVATAH_SAMPLE_CARD_CVV: "123",
        },
      });
      child.stdout.on("data", (chunk) => (out += String(chunk)));
      child.stderr.on("data", (chunk) => (err += String(chunk)));
      child.on("close", (code) => (code === 0 ? done(out) : fail(new Error(`${code}\n${out}\n${err}`))));
    });

    // The tool is derived from the story's signature, and its name from the
    // story's name (LLD §13.3).
    assert.match(output, /book_a_slot/);
    assert.match(output, /required: location/);
    // And the call came back with the story's declared outputs and a runId
    // naming the directory that holds the audit record (REQ-AUTO-6).
    assert.match(output, /book_a_slot → passed/);
    assert.match(output, /"booking":"Slot booked\."/);
    assert.match(output, /runId: {3}\w+/);
  } finally {
    await app.close();
  }
}, { timeout: 240_000 });
