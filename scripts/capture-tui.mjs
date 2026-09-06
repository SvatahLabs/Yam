#!/usr/bin/env node
/**
 * Capture `svatah ui`'s panes in a real terminal (T9.4, T9.5).
 *
 *   pnpm ui:capture
 *
 * T9.5 asks for screenshots of both renderers for the two screens. A terminal
 * has no pixels worth photographing — what it has is what it drew — so this
 * writes `reports/ui-flows.txt` and `reports/ui-run.txt`: the cockpit's own
 * frames, taken inside a pseudo-terminal, with the ANSI removed so they can be
 * read in a progress file and diffed in a review.
 *
 * `script(1)` allocates the pseudo-terminal, which is what makes this a capture
 * of the product rather than of a pipe: Ink asks stdout whether it is a terminal
 * and draws nothing when it is not. `--capture <ms>` is what gives the terminal
 * back afterwards.
 *
 * ## Two sizes, and each capture says which it is (T10.4, P9-F4)
 *
 * Draft 2.12 §13.7: "The cockpit sizes its panes to the terminal and collapses
 * the inspector below 120 columns rather than clipping it; a capture records the
 * size it was taken at." The Phase 9 capture was taken at whatever width the
 * pseudo-terminal happened to be and showed the inspector cut in half, with
 * nothing in the file to say how wide it had been.
 *
 * So every screen is captured twice — 160×40, where four panes fit, and 100×30,
 * where three do — and the size is set on the pseudo-terminal with `stty` rather
 * than hoped for. `script` with no controlling terminal makes a pty whose size is
 * `0×0`, which is how the first version ended up guessing.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp } from "sample-web";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
const OUT = join(ROOT, "reports");
const RUN_ID = "comp";

if (spawnSync("script", ["-h"], { encoding: "utf8" }).status === null) {
  process.stderr.write(
    "`script(1)` is not on this host, so no pseudo-terminal could be allocated and no capture " +
      "was taken. `packages/tui/test/cockpit.test.tsx` checks the same frames through " +
      "ink-testing-library, which needs no terminal.\n",
  );
  process.exit(2);
}

const app = await startSampleApp(0);
const project = mkdtempSync(join(tmpdir(), "svatah-ui-capture-"));
cpSync(join(ROOT, "evals", "fixtures"), project, {
  recursive: true,
  filter: (from) => !from.includes("node_modules") && !from.includes(`${"runs"}`),
});
writeFileSync(
  join(project, "svatah.config.yaml"),
  `schemaVersion: "1.0.0"
project: "svatah-fixtures"
environment: test
adapter: playwright
app: { baseUrl: "${app.origin}" }
flows: { dir: flows }
steps: { dir: steps }
bindings: { dir: bindings, testIdAttributes: ["data-testid", "data-test", "data-qa"] }
data: { file: data.yaml }
api: { dir: api }
run:
  workers: 1
  headless: true
  stepTimeoutMs: 10000
  candidateTimeoutMs: 2000
  screenshots: onFailure
  trace: false
  outputDir: runs
  checkpoints: false
  audit: true
compile: { confidenceThreshold: 0.8 }
record: { model: "none", maxSnapshotTokens: 4000, visionFallback: false }
heal: { onFail: false, relocalizeThreshold: 0.72, margin: 0.1, useModel: false }
`,
  "utf8",
);

let serve;
try {
  /* The `comp` run the Run screen is drawn from. */
  await new Promise((done) => {
    const child = spawn(
      process.execPath,
      [
        CLI,
        "run",
        project,
        "--host",
        "none",
        "--flow",
        "flows/guards-and-compensation.flow",
        "--story",
        "I want to book and then fail",
        "--story",
        "cancel a booking",
        "--run-id",
        RUN_ID,
        "--base-url",
        app.origin,
      ],
      { cwd: ROOT, stdio: "ignore" },
    );
    child.on("close", done);
  });

  const handshake = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, "serve", project, "--port", "0"], {
      cwd: ROOT,
      env: { ...process.env, SVATAH_BASE_URL: app.origin },
    });
    serve = child;
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("no handshake")), 30_000);
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const match = /^svatah serve listening url=(\S+) token=(\S+)$/m.exec(buffer);
      if (match !== null) {
        clearTimeout(timer);
        resolve({ url: match[1], token: match[2] });
      }
    });
    child.stderr.on("data", () => undefined);
    child.on("error", reject);
  });

  mkdirSync(OUT, { recursive: true });

  /**
   * A backspace erases the character before it, so a capture read as text has to
   * honour it (P11). The pty echoes the EOF it is handed as the two characters
   * `^D` and the terminal writes two backspaces to take them back; a capture
   * that kept the backspaces as characters kept the `^D` too — at the head of
   * every one of these files, and, on a loaded machine, in the middle of a
   * frame, where it made a hundred-column line a hundred-and-two-column one.
   */
  const backspaced = (text) => {
    const out = [];
    for (const character of text) {
      // A backspace at the left margin does nothing in a terminal.
      if (character === "\b") {
        if (out.length > 0 && out[out.length - 1] !== "\n") out.pop();
      } else out.push(character);
    }
    return out.join("");
  };

  /** One capture, inside a pseudo-terminal of a stated size, with the ANSI out. */
  const capture = (args, file, columns, rows) => {
    const command = [
      process.execPath,
      CLI,
      "ui",
      project,
      ...args,
      "--url",
      handshake.url,
      "--token",
      handshake.token,
      "--capture",
      "3000",
    ]
      .map((one) => `'${one.replace(/'/g, "'\\''")}'`)
      .join(" ");

    const result = spawnSync(
      "script",
      [
        "-q",
        "/dev/null",
        "/bin/sh",
        "-c",
        /*
         * `stty` first. A `script` launched with no controlling terminal gets a
         * pty of `0×0`, so the cockpit would fall back to its default and the
         * capture would not be of the size this asked for (T10.4).
         */
        `stty cols ${columns} rows ${rows}; ${command}`,
      ],
      {
        encoding: "utf8",
        cwd: ROOT,
        // Never a pipe: `script` calls `tcgetattr` on its own stdin and refuses one.
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
        env: {
          ...process.env,
          COLUMNS: String(columns),
          LINES: String(rows),
          FORCE_COLOR: "1",
          TERM: "xterm-256color",
        },
        maxBuffer: 32 * 1024 * 1024,
      },
    );

    const raw = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    /*
     * The *last* frame, not every frame: Ink redraws the whole screen on each
     * update and a capture of the stream is a dozen copies of the cockpit. Each
     * redraw begins with the cursor-home sequence, so the tail after the final
     * one is what was on the screen when it exited.
     */
    const frames = raw.split("[1;1H");
    const last = frames[frames.length - 1] ?? raw;
    const plain = backspaced(
      last
        // eslint-disable-next-line no-control-regex
        .replace(/\[[0-9;?]*[A-Za-z]/g, "")
        // eslint-disable-next-line no-control-regex
        .replace(/[()][A-Z0-9]/g, "")
    )
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    writeFileSync(join(OUT, file), `${plain}\n`, "utf8");
    process.stdout.write(
      `wrote ${join(OUT, file)} at ${columns}×${rows} (${plain.split("\n").length} lines)\n`,
    );
  };

  /*
   * Wide, then narrow. The cockpit prints its own size in the header, so each
   * file says what it was taken at without this script annotating it — which is
   * what T10.4 asks for, and what makes a capture a thing that can be read a
   * month later.
   */
  const flows = ["--screen", "flows", "--flow", "flows/guards-and-compensation.flow"];
  const run = ["--screen", "run", "--run", RUN_ID];
  capture(flows, "ui-flows.txt", 160, 40);
  capture(run, "ui-run.txt", 160, 40);
  capture(flows, "ui-flows-100.txt", 100, 30);
  capture(run, "ui-run-100.txt", 100, 30);
} finally {
  serve?.kill("SIGTERM");
  await app.close();
  rmSync(project, { recursive: true, force: true });
}
