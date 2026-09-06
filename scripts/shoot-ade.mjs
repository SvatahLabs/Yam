#!/usr/bin/env node
/**
 * Screenshot the packaged ADE's two rebuilt screens (T9.4, T9.5).
 *
 *   pnpm ade:shoot
 *
 * T9.5 asks for "screenshots of both renderers for the two screens, the ADE's
 * taken through the AX adapter". This takes both:
 *
 *   * `reports/ade-flows.png` and `reports/ade-run.png` — the renderer's own
 *     pixels, through the DevTools protocol. Always available.
 *   * `reports/ade-flows-ax.png` — the *window*, through
 *     `@svatah/adapter-ax`'s `screenshot()`, which is `screencapture` scoped to
 *     the window's box. Needs macOS and the Screen Recording grant; when the
 *     grant is missing the script says so with the `svatah surface doctor` line
 *     and takes the other two, rather than fabricating one (the phase's
 *     environment rule).
 *
 * The application is the packaged one and it is opened on a copy of the fixtures
 * project through `SVATAH_ADE_PROJECT` — the same way the desktop gate opens it
 * (LLD §13.6).
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startSampleApp } from "sample-web";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
const OUT = join(ROOT, "reports");
const PORT = 9412;

/** The packaged application, whatever the platform called its directory. */
function packagedApp() {
  const out = join(ROOT, "apps", "ade", "out");
  if (!existsSync(out)) return undefined;
  for (const entry of readdirSync(out)) {
    const mac = join(out, entry, "Svatah ADE.app", "Contents", "MacOS", "Svatah ADE");
    if (existsSync(mac)) return mac;
    for (const name of ["Svatah ADE.exe", "svatah-ade", "Svatah ADE"]) {
      const other = join(out, entry, name);
      if (existsSync(other)) return other;
    }
  }
  return undefined;
}

const executable = packagedApp();
if (executable === undefined) {
  process.stderr.write(
    "No packaged ADE under apps/ade/out. Run `pnpm --filter @svatah/ade package` first.\n",
  );
  process.exit(2);
}

const app = await startSampleApp(0);
const project = mkdtempSync(join(tmpdir(), "svatah-ade-shots-"));
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

/* The `comp` run the Run screen is drawn from, so the screenshot has one. */
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
      "comp",
      "--base-url",
      app.origin,
    ],
    { cwd: ROOT, stdio: "ignore" },
  );
  child.on("close", done);
});

mkdirSync(OUT, { recursive: true });

const ade = spawn(executable, [`--remote-debugging-port=${PORT}`], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    SVATAH_ADE_PROJECT: project,
    SVATAH_A11Y: "1",
    SVATAH_CLI: CLI,
    SVATAH_BASE_URL: app.origin,
    SVATAH_ADE_SMOKE: "",
  },
});
// Drained, or a full pipe blocks the application (see apps/ade/test/shell.spec.ts).
ade.stdout.on("data", () => undefined);
ade.stderr.on("data", () => undefined);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

try {
  let browser;
  for (let at = 0; at < 120 && browser === undefined; at += 1) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => undefined);
    if (browser === undefined) await sleep(500);
  }
  if (browser === undefined) throw new Error("the ADE published no DevTools endpoint");

  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent("page"));
  await page.locator("#rail-flows").waitFor({ timeout: 120_000 });

  /* Flows, with a flow and a step chosen so the inspector has a subject. */
  await page.locator("#flows-list").getByText("guards-and-compensation.flow").click();
  await page.locator(".sv-code-line").nth(44).click().catch(() => undefined);
  await sleep(500);
  await page.screenshot({ path: join(OUT, "ade-flows.png") });
  process.stdout.write(`wrote ${join(OUT, "ade-flows.png")}\n`);

  /* Run, opened on `comp` through the palette's Go to row. */
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByLabel("Search or run a command").fill("Go to Run");
  await palette.getByText("Go to Run", { exact: true }).click();
  await sleep(1_000);
  /*
   * The failing step, not the first: the artboard's inspector is about the step
   * that could not resolve, which is the one a person opens the screen for.
   */
  const failing = page.locator(".sv-step", { has: page.locator(".sv-tone-fail") }).first();
  await failing.click().catch(() => undefined);
  await sleep(500);
  await page.screenshot({ path: join(OUT, "ade-run.png") });
  process.stdout.write(`wrote ${join(OUT, "ade-run.png")}\n`);

  await page.locator("#rail-flows").click();
  await sleep(500);
  await browser.close();

  /* ── and the same window through the AX adapter (T9.5) ─────────────────── */

  if (process.platform !== "darwin") {
    process.stderr.write(
      "The AX screenshot needs macOS; the two renderer screenshots above are what this host can take.\n",
    );
  } else {
    const doctor = spawnSync(process.execPath, [CLI, "surface", "doctor", "--adapter", "ax"], {
      encoding: "utf8",
    });
    process.stderr.write(doctor.stdout ?? "");
    const { osascriptBridge } = await import(
      join(ROOT, "packages", "adapter-ax", "dist", "index.js")
    );
    const bridge = osascriptBridge({ process: "Svatah ADE" });
    const permission = await bridge.permission();
    if (permission.state !== "granted") {
      process.stderr.write(
        `The Accessibility permission is ${permission.state}, so no AX screenshot was taken.\n` +
          `${permission.advice}\n`,
      );
    } else {
      const window = await bridge.window({ process: "Svatah ADE", maxNodes: 2_000 });
      const box = window.nodes[0]?.box;
      const path = join(OUT, "ade-flows-ax.png");
      await bridge.screenshot(path, box);
      if (existsSync(path)) {
        process.stdout.write(
          `wrote ${path} — ${window.nodes.length} nodes read in ${window.cost.wallMs} ms ` +
            `(${window.cost.msPerNode} ms per node, load average ${window.cost.loadAverage1m} ` +
            `over ${window.cost.cpus} CPUs)\n`,
        );
      } else {
        process.stderr.write(
          "`screencapture` wrote nothing: the Screen Recording permission belongs to the " +
            "terminal running this, and it is a separate grant from the Accessibility one. " +
            "No screenshot was fabricated.\n",
        );
      }
    }
  }
} finally {
  ade.kill("SIGTERM");
  await app.close();
  rmSync(project, { recursive: true, force: true });
}
