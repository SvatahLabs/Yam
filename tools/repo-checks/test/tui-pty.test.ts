/**
 * T9.4 Validate — "`yam ui` runs `comp` in a pseudo-terminal test and its
 * `--json` output equals the model's state" (REQ-TUI-1, REQ-ADE-13, LLD §13.7).
 *
 * Two claims, and they need different things:
 *
 * 1. **The cockpit draws in a pseudo-terminal.** Ink asks stdout whether it is a
 *    terminal and refuses raw mode when it is not, so a `spawn` with a pipe
 *    proves nothing about the product. `script(1)` allocates a real
 *    pseudo-terminal on macOS, Linux and the BSDs, and is in every base
 *    install — so no dependency, and no `node-pty` to compile.
 * 2. **`--json` equals the model's state.** The cockpit's `--json` is compared,
 *    key for key, with `screenById("run").load(client, { runId: "comp" })` run
 *    in this process against the same service. A cockpit that had massaged a
 *    number for the terminal fails here, which is the point of the comparison.
 *
 * The phase's environment note allows `ink-testing-library` where no
 * pseudo-terminal is available; `packages/tui/test/cockpit.test.tsx` is that,
 * and it runs everywhere. This file is the stronger check and skips — loudly,
 * with the reason — when `script(1)` is not there.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

const CLI = fromRoot("packages/cli/dist/bin.js");
const FIXTURES = fromRoot("evals/fixtures");
const TOKEN = "tui-pty";
const RUN_ID = "comp";
const STORIES = ["I want to book and then fail", "cancel a booking"];

/** `script(1)`, which is how a test gets a real pseudo-terminal with no dependency. */
const hasScript = spawnSync("script", ["-h"], { encoding: "utf8" }).status !== null;

let app: { origin: string; close(): Promise<void> };
let project: string;
let serve: ReturnType<typeof spawn> | undefined;
let connection: { url: string; token: string };

beforeAll(async () => {
  if (!existsSync(CLI)) throw new Error("Run `pnpm -r build` first.");

  const { startSampleApp } = (await import("sample-web")) as {
    startSampleApp(port: number): Promise<{ origin: string; close(): Promise<void> }>;
  };
  app = await startSampleApp(0);

  project = mkdtempSync(join(tmpdir(), "yam-tui-pty-"));
  cpSync(FIXTURES, project, {
    recursive: true,
    filter: (from) => !from.includes("node_modules") && !from.includes(`${"runs"}`),
  });
  writeFileSync(
    join(project, "yam.config.yaml"),
    `schemaVersion: "1.0.0"
project: "yam-fixtures"
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
  screenshots: never
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

  /*
   * The `comp` run the mockup is drawn from: two scenarios, exit 11.
   *
   * Asynchronously, and that is load-bearing rather than stylistic:
   * `apps/sample-web` runs *in this process*, and a synchronous `spawnSync`
   * would block the event loop that has to answer the child's `page.goto` —
   * every step then fails with a navigation timeout against an application that
   * is up. `apps/desktop/test/parity.test.ts` records the same trap.
   */
  const ran = await new Promise<{ code: number; output: string }>((done) => {
    let output = "";
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
        ...STORIES.flatMap((story) => ["--story", story]),
        "--run-id",
        RUN_ID,
        "--base-url",
        app.origin,
      ],
      { cwd: REPO_ROOT },
    );
    child.stdout?.on("data", (chunk) => (output += String(chunk)));
    child.stderr?.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
  expect(ran.code, ran.output).toBe(11);

  connection = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [CLI, "serve", project, "--port", "0", "--token", TOKEN],
      { cwd: REPO_ROOT, env: { ...process.env, YAM_BASE_URL: app.origin } },
    );
    serve = child;
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("no handshake")), 30_000);
    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      const match = /^yam serve listening url=(\S+) token=(\S+)$/m.exec(buffer);
      if (match !== null) {
        clearTimeout(timer);
        resolve({ url: match[1]!, token: match[2]! });
      }
    });
    child.on("error", reject);
  });
}, 300_000);

afterAll(async () => {
  serve?.kill("SIGTERM");
  await app?.close();
  rmSync(project, { recursive: true, force: true });
});

/**
 * Run `yam ui` inside a pseudo-terminal and capture what it drew.
 *
 * `script(1)` allocates a real pseudo-terminal on macOS, Linux and the BSDs and
 * is in every base install — so no dependency, and no `node-pty` to compile.
 * Its own stdin must be a terminal or it refuses with
 * `tcgetattr/ioctl: Operation not supported on socket`, which is why the child
 * is spawned with `stdio: ["ignore", …]` rather than with a pipe.
 *
 * ## Why the cockpit is left with `--capture` rather than with a key
 *
 * Typing into a pseudo-terminal means writing to its *master*, and `script`
 * gives a caller no way to reach one: its only input is its own stdin, which
 * must already be a terminal. So this proves the half a pipe cannot —
 * **that the cockpit draws in a real terminal, in colour, with its panes** —
 * and the keys are proven in `packages/tui/test/cockpit.test.tsx`, which drives
 * `useInput` directly through `ink-testing-library`. The phase's environment
 * note allows exactly that split and asks that it be said; it is said here and
 * in `docs/spec/progress/phase-9.md`.
 *
 * `--capture <ms>` is the product's own flag, not a test hook: a cockpit that
 * can only be left by pressing a key cannot be captured by anything that is not
 * a person, and REQ-ADE-13's point is that an agent gets what a person gets.
 */
function inPty(
  args: string[],
  captureMs = 3_000,
  size: { columns: number; rows: number } = { columns: 160, rows: 48 },
): string {
  const command = [
    process.execPath,
    CLI,
    "ui",
    project,
    ...args,
    "--url",
    connection.url,
    "--token",
    connection.token,
    "--capture",
    String(captureMs),
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
       * `stty` first (T10.4, P9-F4).
       *
       * A `script` spawned with no controlling terminal allocates a pty of
       * `0×0`, so `process.stdout.columns` inside it is 0 and `COLUMNS` in the
       * environment is not what a terminal-aware program reads. Setting the
       * pty's size is what makes "captured at 100 columns" a statement about
       * the terminal rather than about an environment variable.
       */
      `stty cols ${size.columns} rows ${size.rows}; ${command}`,
    ],
    {
      encoding: "utf8",
      cwd: REPO_ROOT,
      // Never a pipe: `script` calls `tcgetattr` on its own stdin and refuses one.
      stdio: ["ignore", "pipe", "pipe"],
      timeout: captureMs + 30_000,
      env: {
        ...process.env,
        COLUMNS: String(size.columns),
        LINES: String(size.rows),
        FORCE_COLOR: "1",
        TERM: "xterm-256color",
      },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/**
 * A backspace erases the character before it, so a capture read as text has to
 * honour it (P11).
 *
 * The pty echoes the EOF it is handed as the two characters `^D` and the
 * terminal then writes two backspaces to take them back — so a capture that
 * kept the backspaces as characters kept the `^D` too. It lands before the
 * first frame on an idle machine and *inside* one on a loaded machine, which is
 * how a correctly truncated hundred-column header was once measured at a
 * hundred and two.
 */
const backspaced = (text: string): string => {
  const out: string[] = [];
  for (const character of text) {
    // A backspace at the left margin does nothing in a terminal, and must not
    // eat the newline before it here either.
    if (character === "\b") {
      if (out.length > 0 && out[out.length - 1] !== "\n") out.pop();
    } else out.push(character);
  }
  return out.join("");
};

/** ANSI out, so an assertion is about words rather than about colour codes. */
const plain = (text: string): string =>
  backspaced(
    // eslint-disable-next-line no-control-regex
    text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\u001b[()][A-Z0-9]/g, ""),
  );

describe.runIf(hasScript)("`yam ui` draws in a pseudo-terminal (T9.4)", () => {
  it("opens on the `comp` run and draws its four panes", () => {
    const captured = plain(inPty(["--screen", "run", "--run", RUN_ID]));

    // The panes, numbered, as the `TUI` artboard draws them.
    expect(captured).toContain("Stories");
    expect(captured).toContain(`Run ${RUN_ID}`);
    expect(captured).toContain("Audit");

    // The run itself: the steps, the failure, the policy, the exit code.
    expect(captured).toContain("Click the Book a slot link");
    expect(captured).toContain("Click the pay button");
    expect(captured).toContain("aborted");
    expect(captured).toContain("exit 11");

    // The footer's keys.
    expect(captured).toContain("^K");
    expect(captured).toContain("1-4");
  }, 60_000);

  it("draws in colour, which it cannot do outside a terminal", () => {
    const captured = inPty(["--screen", "run", "--run", RUN_ID]);
    /*
     * The point of the pseudo-terminal. `ink-testing-library` writes to a
     * stream that is not a TTY, so chalk emits no colour and the status tones
     * of `@svatah/yam-ui-tokens` cannot be checked there at all.
     */
    // eslint-disable-next-line no-control-regex
    expect(captured).toMatch(/\[3[0-9]m/);
  }, 60_000);

  it("offers the keys the artboard's footer offers", () => {
    const captured = plain(inPty(["--screen", "run", "--run", RUN_ID]));
    for (const key of ["^K", "1-4", "Tab", "j k", "Enter", "q"]) {
      expect(captured, `the footer does not offer ${key}`).toContain(key);
    }
  }, 60_000);

  it("gives the terminal back: `--capture` quits on its own", () => {
    const captured = inPty(["--screen", "run", "--run", RUN_ID], 1_500);
    // A cockpit that had to be killed would have produced nothing on stdout
    // before the signal; this one drew, then exited.
    expect(captured.length).toBeGreaterThan(200);
  }, 60_000);

  it("draws the Flows screen too", () => {
    const captured = plain(
      inPty(["--screen", "flows", "--flow", "flows/guards-and-compensation.flow"]),
    );
    expect(captured).toContain("guards-and-compensation.flow");
    expect(captured).toContain("simple.flow");
  }, 60_000);

  /*
   * T10.4 Validate: "a 100-column capture shows three panes and says its size."
   *
   * The Phase 9 capture had the inspector clipped at the captured width, with
   * nothing in the file to say what that width had been. Draft 2.12 §13.7 says
   * the cockpit sizes its panes to the terminal, collapses the inspector below
   * 120 columns rather than clipping it, and that a capture records its size.
   */
  it("at 100 columns: three whole panes, no clipped fourth, and the size (T10.4)", () => {
    const captured = plain(
      inPty(["--screen", "run", "--run", RUN_ID], 3_000, { columns: 100, rows: 30 }),
    );

    // It says how big it was.
    expect(captured, "the capture does not record the size it was taken at").toContain("100×30");
    // Three panes, whole.
    expect(captured).toContain("Stories");
    expect(captured).toContain(`Run ${RUN_ID}`);
    expect(captured).toContain("Audit");
    // The fourth is collapsed rather than cut in half, and it says so.
    expect(captured).toContain("inspector collapsed at 100 cols");
    expect(captured).not.toContain("CANDIDATES TRIED");

    /*
     * And nothing was drawn past the right edge, which is the defect itself.
     * The pane borders are the check: a box that ran off the terminal is a line
     * longer than the terminal is wide.
     */
    const lines = captured.split("\n").map((one) => one.replace(/\r/g, "").trimEnd());
    const widest = Math.max(...lines.map((one) => one.length));
    // A failure has to say *which* line ran over, or the next reader measures
    // it again from nothing: this one ran over once under a loaded `pnpm -r
    // test` and the number alone said nothing about where it came from.
    const over = lines.filter((one) => one.length > 100).map((one) => `${one.length}: ${one}`);
    expect(
      widest,
      `a line of ${widest} characters on a 100-column terminal:\n${over.join("\n")}`,
    ).toBeLessThanOrEqual(100);
  }, 60_000);

  /*
   * T10.1 and T10.2's Validate: "each screen driven end to end through its own
   * controls … in `yam ui` under a pseudo-terminal, against the fixtures
   * project with the fake gateway."
   *
   * Every one of the twelve, in a real terminal, against a real service — which
   * is what `packages/tui/test/cockpit.test.tsx` cannot say, because
   * `ink-testing-library` writes into a stream and the fake service is a
   * recording. What each screen *shows* is checked there and in
   * `@svatah/yam-screens`; what this says is that it draws, in colour, with its
   * four numbered panes, on a project a person could open.
   */
  it.each([
    ["session", "Session"],
    ["flows", "Flows"],
    ["runs", "Runs"],
    ["run", "Run"],
    ["heal", "Heal review"],
    ["bindings", "Bindings"],
    ["agents", "Agents and tools"],
    ["api", "API"],
    ["data", "Data"],
    ["import", "Import prototype database"],
    ["settings", "Settings"],
  ] as const)("draws the %s screen in a real terminal (T10.1, T10.2)", (screen, title) => {
    const captured = plain(inPty(["--screen", screen], 2_500));

    // Its own title, from the model, on the header.
    expect(captured, `the ${screen} screen drew no title`).toContain(title);
    // Four numbered panes, which is what the `TUI` artboard draws.
    for (const number of ["1 ", "2 ", "3 ", "4 "]) {
      expect(captured, `the ${screen} screen is missing pane ${number.trim()}`).toContain(number);
    }
    // And the footer's keys, so a person can get out of it.
    expect(captured).toContain("^K");
    expect(captured).toContain("q");
  }, 90_000);

  it("at 160 columns: four panes, and that size", () => {
    const captured = plain(
      inPty(["--screen", "run", "--run", RUN_ID], 3_000, { columns: 160, rows: 40 }),
    );
    expect(captured).toContain("160×40");
    expect(captured).toContain("CANDIDATES TRIED");
    expect(captured).not.toContain("inspector collapsed");
  }, 60_000);
});

describe("`yam ui --json` is the model's state (T9.4, REQ-ADE-13)", () => {
  /** `yam ui … --json`, parsed. No terminal needed: it draws nothing. */
  function json(args: string[]): Record<string, unknown> {
    const result = spawnSync(
      process.execPath,
      [CLI, "ui", project, ...args, "--url", connection.url, "--token", connection.token, "--json"],
      { encoding: "utf8", cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 },
    );
    expect(result.status, `${result.stdout ?? ""}${result.stderr ?? ""}`).toBe(0);
    return JSON.parse(result.stdout) as Record<string, unknown>;
  }

  it("prints exactly what the model loads, for the `comp` run", async () => {
    const printed = json(["--screen", "run", "--run", RUN_ID]);

    /*
     * The other side of the comparison: the model, loaded in *this* process
     * against the same service through the SDK. Not a copy of the expected
     * JSON — a second evaluation of the same function, which is what "equals
     * the model's state" means.
     */
    const { screenById } = await import("@svatah/yam-screens");
    const { YamClient } = await import("@svatah/yam-sdk");
    const state = await screenById("run").load(new YamClient(connection), { runId: RUN_ID });

    expect(printed["screen"]).toBe("run");
    expect(printed["params"]).toEqual({ runId: RUN_ID });
    expect(printed["state"]).toEqual(JSON.parse(JSON.stringify(state)));
  }, 120_000);

  it("prints the Flows screen the same way", async () => {
    const file = "flows/guards-and-compensation.flow";
    const printed = json(["--screen", "flows", "--flow", file]);

    const { screenById } = await import("@svatah/yam-screens");
    const { YamClient } = await import("@svatah/yam-sdk");
    const state = await screenById("flows").load(new YamClient(connection), { file });

    expect(printed["state"]).toEqual(JSON.parse(JSON.stringify(state)));
  }, 120_000);

  /*
   * T10.4 Validate: "the `--json` equality test runs ten times without a diff."
   *
   * P9-F4: the Flows state used to carry `"run 20 s ago"` as text, so two loads
   * a second apart were unequal for a project nothing had happened to, and this
   * comparison flaked on Node 22 with `"run 19 s ago"`. The model carries the
   * timestamp now and the renderers format it, which makes the state a value —
   * and a value can be compared ten times.
   */
  it("prints the same Flows state ten times running (T10.4, P9-F4)", async () => {
    const file = "flows/guards-and-compensation.flow";
    const { screenById } = await import("@svatah/yam-screens");
    const { YamClient } = await import("@svatah/yam-sdk");
    const client = new YamClient(connection);

    const first = JSON.stringify(json(["--screen", "flows", "--flow", file]));
    for (let round = 1; round <= 10; round += 1) {
      const printed = json(["--screen", "flows", "--flow", file]);
      expect(JSON.stringify(printed), `round ${round} differs from round 1`).toBe(first);
      /*
       * And against the model loaded in *this* process at this instant — the
       * comparison that actually flaked, because the two evaluations are a
       * second or so apart.
       */
      const state = await screenById("flows").load(client, { file });
      expect(printed["state"], `round ${round} differs from the model`).toEqual(
        JSON.parse(JSON.stringify(state)),
      );
    }
  }, 300_000);

  it("carries the last run as a timestamp, not as words (P9-F4)", () => {
    const printed = json([
      "--screen",
      "flows",
      "--flow",
      "flows/guards-and-compensation.flow",
    ]);
    const files = (printed["state"] as { files: Array<Record<string, unknown>> }).files;
    const ran = files.filter((one) => one["lastRunAt"] !== undefined);
    expect(ran.length, "no flow in the fixtures project has a last run").toBeGreaterThan(0);
    for (const one of ran) {
      expect(String(one["lastRunAt"])).toMatch(/^\d{4}-\d\d-\d\dT/);
    }
    // And nowhere in the state does the word "ago" appear: that is a renderer's.
    expect(JSON.stringify(printed["state"])).not.toContain(" ago");
  }, 60_000);

  it("draws nothing at all: the output is one JSON document", () => {
    const result = spawnSync(
      process.execPath,
      [
        CLI,
        "ui",
        project,
        "--screen",
        "run",
        "--run",
        RUN_ID,
        "--url",
        connection.url,
        "--token",
        connection.token,
        "--json",
      ],
      { encoding: "utf8", cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 },
    );
    expect(result.stdout.trimStart().startsWith("{")).toBe(true);
    expect(result.stdout.trimEnd().endsWith("}")).toBe(true);
    // No escape sequences: `--json` is for an agent, and an agent parsing an
    // Ink frame would be parsing a picture.
    // eslint-disable-next-line no-control-regex
    expect(result.stdout).not.toMatch(/\[/);
  }, 60_000);

  it("refuses a screen the model does not have, and says what it does have", () => {
    const result = spawnSync(
      process.execPath,
      [CLI, "ui", project, "--screen", "dashboard", "--url", connection.url, "--token", connection.token, "--json"],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('No screen "dashboard"');
    expect(`${result.stdout}${result.stderr}`).toContain("flows");
  }, 60_000);
});

describe("the pseudo-terminal is available on this host", () => {
  it("says so, rather than silently skipping (the phase's environment rule)", () => {
    if (!hasScript) {
      process.stderr.write(
        "script(1) is not on this host, so `yam ui` was checked with " +
          "ink-testing-library only (packages/tui/test/cockpit.test.tsx). The phase's " +
          "environment note allows that and requires it to be said.\n",
      );
    }
    expect(typeof hasScript).toBe("boolean");
  });
});
