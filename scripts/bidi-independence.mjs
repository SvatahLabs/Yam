#!/usr/bin/env node
/**
 * The independence proof (T4.1, REQ-ADP-4, REQ-SURF-3, REQ-STD-2).
 *
 *   node scripts/bidi-independence.mjs [--report reports/adapter-bidi.md]
 *
 * T4.1's Validate list, as one runnable command:
 *
 * 1. **The surface conformance suite passes on BiDi.** Every case, every check,
 *    against a real browser over the W3C protocol (REQ-SURF-3).
 * 2. **The fixtures replay on BiDi with statuses identical to Playwright.** The
 *    same plan, the same bindings, a different adapter, compared step by step on
 *    status *and* matched candidate kind against the committed runtime
 *    conformance fixture (REQ-STD-2).
 * 3. **Two BiDi runs agree with each other** (REQ-RUN-2).
 * 4. **The stock-Chrome attach works**, whenever a chromedriver is on PATH or
 *    named by `YAM_CHROMEDRIVER` (Draft 2.6, LLD §7.3). Phase 4's report
 *    described that route as implemented while it failed on its first message,
 *    because nothing in the suite ever took it: the proof ran on the Gecko
 *    launch route, which needs no driver. A route documented in a README and
 *    exercised by nothing is a route that is broken and does not know it.
 *
 * That is what "the surface is a real boundary" means as a measurement rather
 * than as a claim: if any of the three fails, either the boundary leaks or one
 * of the adapters is wrong, and the report says which step disagreed.
 *
 * The report names the browser that answered, because "BiDi passes" is not a
 * result without it (LLD §7.3).
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { startSampleApp } from "sample-web";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
const BASELINE = join(ROOT, "evals", "conformance", "runtime", "results.jsonl");

/** The four migrated fixtures, as `scripts/compatibility.mjs` runs them. */
const FLOWS = [
  "flows/simple.flow",
  "flows/svatah.flow",
  "flows/natural_language_login.flow",
  "flows/execution.flow",
];

/** The secrets the fixtures read. Fixed, so two runs type the same characters. */
const SECRETS = {
  YAM_SAMPLE_PASSWORD: "qwerty123",
  YAM_SAMPLE_CARD_NUMBER: "5123456789012346",
  YAM_SAMPLE_CARD_CVV: "123",
};

function run(args, env = {}) {
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...SECRETS, ...env },
    });
    child.stdout.on("data", (c) => (output += String(c)));
    child.stderr.on("data", (c) => (output += String(c)));
    child.on("close", (code) => done({ status: code ?? 1, output }));
  });
}

const readResults = (path) =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));

/** Status and matched candidate: the two things a conformant runtime reproduces. */
const comparable = (result) => ({
  story: result.story,
  text: result.text,
  status: result.status,
  by: result.matched?.by ?? null,
});

/** A chromedriver to attach through, if this machine has one. */
function findChromedriver(env = process.env) {
  const named = env["YAM_CHROMEDRIVER"];
  if (named !== undefined && named !== "" && existsSync(named)) return named;
  for (const dir of (env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const name of ["chromedriver", "chromedriver.exe", "msedgedriver", "msedgedriver.exe"]) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * The stock-browser attach route, end to end (Draft 2.6, LLD §7.3).
 *
 * Exactly the commands `packages/adapter-bidi/README.md` gives: start the
 * driver, create a *classic* session with `webSocketUrl: true`, and point
 * `YAM_BIDI_URL` at the `…/session/<id>` it hands back. The adapter must
 * attach to that session rather than create a second one — `session.new` there
 * is answered with `session not created: session already exists`, which is what
 * used to happen on the adapter's first message.
 *
 * Returns what the driver said the browser is, so the report can name it.
 */
async function attachThroughDriver(binary, baseUrl, say) {
  const port = 9515 + Math.floor(Math.random() * 400);
  const driver = spawn(binary, [`--port=${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  const reap = () => {
    if (driver.exitCode === null && driver.signalCode === null) driver.kill("SIGKILL");
  };
  process.once("exit", reap);

  let sessionId;
  try {
    /*
     * Wait for the port, not for a line of output.
     *
     * chromedriver prints "Starting ChromeDriver …" *before* it binds, so a
     * readiness check that matched the log raced the listener and every request
     * came back `fetch failed`. `GET /status` is the driver's own answer to "are
     * you up", and polling it is the only thing that cannot be early.
     */
    let log = "";
    driver.stdout.on("data", (chunk) => (log += String(chunk)));
    driver.stderr.on("data", (chunk) => (log += String(chunk)));

    const deadline = Date.now() + 30_000;
    for (;;) {
      if (driver.exitCode !== null) throw new Error(`${binary} exited:\n${log}`);
      const up = await fetch(`http://127.0.0.1:${port}/status`)
        .then((r) => r.ok)
        .catch(() => false);
      if (up) break;
      if (Date.now() > deadline) {
        throw new Error(`${binary} did not answer on port ${port} within 30 s:\n${log}`);
      }
      await new Promise((done) => setTimeout(done, 200));
    }

    const created = await fetch(`http://127.0.0.1:${port}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilities: {
          alwaysMatch: {
            webSocketUrl: true,
            /*
             * `ignore`, or the driver answers every prompt itself.
             *
             * WebDriver's default is dismiss-and-notify, so a confirm the flow
             * said to accept was already dismissed when the adapter's
             * `handleUserPrompt` arrived, and "an accepted confirm reports
             * confirmed" failed wherever a chromedriver was on PATH — first on
             * GitHub's runners. The adapter asks for `ignore` when it creates
             * a session (`session.ts`); a session someone else creates has to
             * be created with it.
             */
            unhandledPromptBehavior: "ignore",
            "goog:chromeOptions": { args: ["--headless=new", "--no-sandbox"] },
            "ms:edgeOptions": { args: ["--headless=new", "--no-sandbox"] },
          },
        },
      }),
    }).then((r) => r.json());

    const capabilities = created.value?.capabilities;
    sessionId = created.value?.sessionId;
    const url = capabilities?.webSocketUrl;
    if (url === undefined) {
      throw new Error(
        `${binary} created no BiDi session: ${JSON.stringify(created).slice(0, 300)}`,
      );
    }

    const browser = [capabilities.browserName, capabilities.browserVersion]
      .filter((one) => one !== undefined)
      .join(" ");
    /*
     * The driver's *name*, not its path, and the URL's *shape*, not its port.
     * `reports/adapter-bidi.md` is committed, and a report that recorded
     * `/Users/someone/...` or an ephemeral port would record whose machine ran
     * it and when (LLD §16's hygiene rule).
     */
    say(
      `stock-browser attach: ${browser} through ${basename(binary)}, ` +
        "over a driver-hosted session (…/session/<id>)",
    );

    const conform = await run(
      ["surface", "conform", "--adapter", "bidi", "--base-url", baseUrl, "--json"],
      { YAM_BIDI_URL: url },
    );
    const json = conform.output.slice(conform.output.indexOf("{"));
    let suite;
    try {
      suite = JSON.parse(json);
    } catch {
      throw new Error(`the attached run produced no JSON report:\n${conform.output.slice(-2000)}`);
    }
    say(
      `  surface conformance over the attached session: ${suite.totals.passed} passed, ` +
        `${suite.totals.failed} failed, ${suite.totals.skipped} skipped ` +
        `(${suite.totals.checks} checks)`,
    );
    for (const one of (suite.cases ?? []).filter((c) => c.status === "failed")) {
      say(`  FAIL ${one.id}: ${one.checks.filter((c) => !c.ok).map((c) => c.description).join("; ")}`);
    }
    return { browser, conformant: suite.conformant === true, detail: suite.adapterDetail };
  } finally {
    if (sessionId !== undefined) {
      await fetch(`http://127.0.0.1:${port}/session/${sessionId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
    process.removeListener("exit", reap);
    reap();
  }
}

async function main() {
  const reportAt = process.argv.indexOf("--report");
  const reportPath = reportAt >= 0 ? process.argv[reportAt + 1] : undefined;
  const lines = [];
  const say = (line) => {
    console.log(line);
    lines.push(line);
  };

  const app = await startSampleApp(0);
  console.log(`sample-web on ${app.origin}`);

  /* A copy of the fixtures with `adapter: bidi`, so the committed project is
     untouched and the only difference from the baseline run is the adapter. */
  const project = join(mkdtempSync(join(tmpdir(), "yam-bidi-")), "fixtures");
  mkdirSync(project, { recursive: true });
  for (const entry of ["bindings", "flows", "api", "data.yaml", "yam.config.yaml"]) {
    cpSync(join(FIXTURES, entry), join(project, entry), { recursive: true });
  }
  writeFileSync(
    join(project, "yam.config.yaml"),
    readFileSync(join(project, "yam.config.yaml"), "utf8").replace(
      /^adapter: .*$/m,
      "adapter: bidi",
    ),
    "utf8",
  );

  let failures = 0;
  /** What the driver said, when the attach route ran. Named in the report. */
  let attachedBrowser;

  try {
    /* ── 1. the surface conformance suite ─────────────────────────────────── */
    const jsonReport = join(project, "conformance.json");
    const conform = await run(
      ["surface", "conform", "--adapter", "bidi", "--base-url", app.origin, "--json"],
      {},
    );
    writeFileSync(jsonReport, conform.output.slice(conform.output.indexOf("{")), "utf8");
    let suite;
    try {
      suite = JSON.parse(readFileSync(jsonReport, "utf8"));
    } catch {
      console.log(conform.output);
      throw new Error("`surface conform --adapter bidi` did not produce a JSON report.");
    }
    say(`driving: ${suite.adapterDetail ?? "(the adapter did not say)"}`);
    say(
      `surface conformance: ${suite.totals.passed} passed, ${suite.totals.failed} failed, ` +
        `${suite.totals.skipped} skipped (${suite.totals.checks} checks)`,
    );
    if (!suite.conformant) {
      failures += 1;
      for (const one of suite.cases.filter((c) => c.status === "failed")) {
        say(`  FAIL ${one.id}: ${one.checks.filter((c) => !c.ok).map((c) => c.description).join("; ")}`);
      }
    }

    /* ── 2 and 3. the fixtures, twice ─────────────────────────────────────── */
    const runs = [];
    for (const id of ["bidi-1", "bidi-2"]) {
      const result = await run(
        [
          "run",
          project,
          "--host",
          "none",
          "--run-id",
          id,
          "--base-url",
          app.origin,
          "--input",
          "email=connected2atul@gmail.com",
          "--input",
          `password=${SECRETS.YAM_SAMPLE_PASSWORD}`,
          ...FLOWS.flatMap((flow) => ["--flow", flow]),
        ],
        {},
      );
      runs.push({ id, dir: join(project, "runs", id), status: result.status, output: result.output });
      console.log(`bidi run ${id}: exit ${result.status}`);
    }

    const [first, second] = runs.map((r) => readResults(join(r.dir, "results.jsonl")).map(comparable));

    const determinism = JSON.stringify(first) === JSON.stringify(second);
    say(`determinism (REQ-RUN-2): two BiDi runs ${determinism ? "agree" : "DIFFER"} over ${first.length} steps`);
    if (!determinism) failures += 1;

    const baseline = readResults(BASELINE).map(comparable);
    const byStep = new Map(first.map((r) => [`${r.story} ${r.text}`, r]));
    const differences = [];
    for (const expected of baseline) {
      const actual = byStep.get(`${expected.story} ${expected.text}`);
      if (actual === undefined) {
        differences.push(`${expected.story} :: ${expected.text} — missing from the BiDi run`);
        continue;
      }
      if (actual.status !== expected.status || actual.by !== expected.by) {
        differences.push(
          `${expected.story} :: ${expected.text} — playwright ${expected.status}/${expected.by}, ` +
            `bidi ${actual.status}/${actual.by}`,
        );
      }
    }
    say(
      `runtime conformance (REQ-STD-2): ${baseline.length} steps compared, ` +
        `${differences.length} difference(s) from the Playwright baseline`,
    );
    for (const line of differences) say(`  ${line}`);
    if (differences.length > 0) failures += 1;

    /* ── 4. the stock-browser attach route (Draft 2.6, LLD §7.3) ──────────── */
    const chromedriver = findChromedriver();
    if (chromedriver === undefined) {
      say(
        "stock-browser attach: not run — no chromedriver on PATH and no YAM_CHROMEDRIVER. " +
          "The launch route above proves the protocol; this proves the route stock Chrome and " +
          "Edge take.",
      );
    } else {
      try {
        const attached = await attachThroughDriver(chromedriver, app.origin, say);
        attachedBrowser = attached.browser;
        if (!attached.conformant) failures += 1;
      } catch (error) {
        say(`stock-browser attach: FAILED — ${error instanceof Error ? error.message : error}`);
        failures += 1;
      }
    }

    if (reportPath !== undefined) {
      const out = resolve(ROOT, reportPath);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(
        out,
        [
          "# WebDriver BiDi adapter — independence report",
          "",
          `Generated by \`node scripts/bidi-independence.mjs\` on ${new Date().toISOString()}.`,
          "",
          "## Browser",
          "",
          "```",
          suite.adapterDetail ?? "(the adapter did not say)",
          "```",
          "",
          ...(attachedBrowser === undefined
            ? [
                "The stock-browser attach route was not exercised on this machine: no",
                "chromedriver on `PATH` and no `YAM_CHROMEDRIVER`. Install one matching",
                "your Chrome or Edge and re-run to include it.",
                "",
              ]
            : [
                "Attached, through a driver-hosted session (`…/session/<id>`, LLD §7.3):",
                "",
                "```",
                attachedBrowser,
                "```",
                "",
              ]),
          "## Result",
          "",
          "```",
          ...lines,
          "```",
          "",
          "## What this measures",
          "",
          "1. `yam surface conform --adapter bidi` — the surface conformance suite",
          "   (REQ-SURF-3): the adapter is conformant only when every case passes.",
          "2. The four migrated fixtures replayed on BiDi and compared step by step",
          "   against `evals/conformance/runtime/results.jsonl`, the committed",
          "   Playwright baseline, on **status** and **matched candidate kind**",
          "   (REQ-STD-2). Timestamps, durations and the run id belong to the run",
          "   rather than to the plan and are not compared.",
          "3. Two BiDi runs of the same plan, compared with each other (REQ-RUN-2).",
          "4. The stock-browser attach route, whenever a chromedriver or msedgedriver is",
          "   on `PATH` or named by `YAM_CHROMEDRIVER`: a classic session created with",
          "   `webSocketUrl: true`, then `yam surface conform --adapter bidi` against",
          "   the `…/session/<id>` it hands back (LLD §7.3, Draft 2.6). The adapter must",
          "   attach to that session, not create a second one.",
          "",
          "A difference in (2) means either the surface boundary leaks or one of the",
          "two adapters is wrong. Either way it is a defect, not a tolerance.",
          "",
        ].join("\n"),
        "utf8",
      );
      console.log(`wrote ${reportPath}`);
    }
  } finally {
    await app.close();
    rmSync(dirname(project), { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nBiDi is conformant and replays identically to Playwright.");
}

await main();
