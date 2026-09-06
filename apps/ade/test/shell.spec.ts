/**
 * T9.4 Validate — "a record and a run driven through the new Run screen's
 * buttons under Playwright" (REQ-ADE-11, REQ-ADE-12, LLD §13.7).
 *
 * The **packaged** ADE, launched by Playwright's Electron support, opened on the
 * fixtures project through `SVATAH_ADE_PROJECT`, against a real
 * `apps/sample-web`. Every click is a click on a control the desktop adapters
 * would find by the same name and the same id.
 *
 * What is driven, in order:
 *
 *   1. the ADE opens **into the new Flows screen** — the rail, the toolbar, the
 *      flow list and the editor, not the eleven tabs;
 *   2. **Record** on the Flows screen starts a session with the fake gateway;
 *   3. **Run** starts a run and the shell goes to the Run screen;
 *   4. the Run screen's **steps, audit and inspector** carry what the run wrote,
 *      and **Run again** starts another one from that screen's own button;
 *   5. the command palette opens on ⌘K and lists the registry's actions;
 *   6. the Legacy rail item still reaches the eleven screens (T9.4's scope).
 *
 * ## Why the packaged application, and why CDP rather than `_electron`
 *
 * REQ-ADE-6: the conformance target is the packaged ADE, and Phase 8 found the
 * hard way that a development Electron cannot fail the way the product fails
 * (the `RunAsNode` fuse, the bundled CLI, the resolved Node). A test against a
 * Vite dev server would be a test of the screens; this is a test of the
 * application.
 *
 * Playwright's `_electron.launch` cannot open it. It attaches to Electron's
 * **Node** inspector, and a packaged build has the `RunAsNode` and
 * `EnableNodeCliInspectArguments` fuses off — which is exactly what T8.1 turned
 * off and must stay off. The renderer's own DevTools endpoint is a different
 * thing and is available: the application is started with
 * `--remote-debugging-port` and driven through `chromium.connectOverCDP`, which
 * is the same protocol Playwright drives a browser with. What that gives up is
 * the main process; what it keeps is the packaged product's real renderer,
 * which is what the screens are.
 *
 * It **skips with the reason** when `apps/ade/out/` has no packaged build:
 * packaging is `pnpm --filter @svatah/ade package` and takes about fifteen
 * seconds, and a test that packaged silently would make every run of the suite
 * a build.
 */
import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/*
 * `process.cwd()`, not `import.meta.url`: `apps/ade` is not `"type": "module"`
 * — its main and preload bundles are CommonJS because a sandboxed preload has
 * no ES module loader (LLD §13.6) — and Playwright transpiles a spec to CJS,
 * where `import.meta` is a syntax error. Playwright runs from the directory
 * holding `playwright.config.ts`, which is this package.
 */
const ADE = resolve(process.cwd());
const ROOT = join(ADE, "..", "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
const FIXTURES = join(ROOT, "evals", "fixtures");

/**
 * Start `apps/sample-web` as a child process and read its origin off stdout.
 *
 * A child rather than `import { startSampleApp }`: `sample-web` is ESM-only and
 * Playwright transpiles a spec to CommonJS, where `require` of an
 * `exports.import` package fails. Its own `cli.js` prints the origin, which is
 * what a person reads too.
 */
async function startSampleWeb(): Promise<{ origin: string; child: ChildProcess }> {
  const child = spawn(process.execPath, [join(ROOT, "apps", "sample-web", "dist", "cli.js")], {
    env: { ...process.env, PORT: "0" },
  });
  return await new Promise((done, fail) => {
    let buffer = "";
    const timer = setTimeout(() => fail(new Error("sample-web printed no origin")), 30_000);
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const match = /sample-web listening on (\S+)/.exec(buffer);
      if (match !== null) {
        clearTimeout(timer);
        done({ origin: match[1]!, child });
      }
    });
    child.on("error", fail);
  });
}

/**
 * The window that is open now.
 *
 * Electron recreates a `BrowserWindow` on `activate` when none is left
 * (`main/index.ts`), and a page object for a window that has gone is a page
 * object that answers "closed" to everything. Every test asks for the current
 * one rather than holding the first, which is also what a person looking at the
 * application does.
 */
async function currentPage(): Promise<Page> {
  const context = browser.contexts()[0]!;
  const until = Date.now() + 60_000;
  for (;;) {
      if (process.env["SVATAH_ADE_SPEC_VERBOSE"] === "1") {
      process.stderr.write(
        `[pages] ${context
          .pages()
          .map((one) => `${one.isClosed() ? "closed" : "open"} ${one.url().slice(-50)}`)
          .join(" | ")}\n`,
      );
    }
    const open = context.pages().filter((one) => !one.isClosed());
    if (open.length > 0) return open[open.length - 1]!;
    if (Date.now() > until) throw new Error("The ADE has no open window.");
    await new Promise((done) => setTimeout(done, 250));
  }
}

/** Wait for the renderer's DevTools endpoint, then attach to it. */
async function connectWhenReady(): Promise<Browser> {
  const until = Date.now() + 120_000;
  let last: unknown;
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
    } catch (cause) {
      last = cause;
      if (Date.now() > until) {
        throw new Error(
          `The packaged ADE published no DevTools endpoint on ${DEBUG_PORT} within 120 s: ` +
            `${last instanceof Error ? last.message : String(last)}`,
        );
      }
      await new Promise((done) => setTimeout(done, 500));
    }
  }
}

/** The packaged application, whatever the platform called its directory. */
function packagedApp(): string | undefined {
  const out = join(ADE, "out");
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

let app: { origin: string; child: ChildProcess };
let project: string;
let ade: ChildProcess;
let browser: Browser;
let page: Page;

/** A port nobody else in this repository's test suite uses. */
const DEBUG_PORT = 9411;

const executable = packagedApp();

test.skip(
  executable === undefined,
  "No packaged ADE under apps/ade/out. Run `pnpm --filter @svatah/ade package` first: " +
    "REQ-ADE-6's conformance target is the packaged application, and a development " +
    "Electron cannot fail the way the product failed in Phase 8.",
);

test.beforeAll(async () => {
  if (executable === undefined) return;
  if (!existsSync(CLI)) throw new Error("Run `pnpm -r build` first.");

  app = await startSampleWeb();

  /*
   * A copy of the fixtures project: a run writes `runs/`, and a test that
   * dirtied the repository would be one nobody could run twice.
   */
  project = mkdtempSync(join(tmpdir(), "svatah-ade-shell-"));
  cpSync(FIXTURES, project, {
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
record: { model: "none", maxSnapshotTokens: 4000, visionFallback: false, decisionDeadlineMs: 30000 }
heal: { onFail: false, relocalizeThreshold: 0.72, margin: 0.1, useModel: false }
`,
    "utf8",
  );

  ade = spawn(executable, [`--remote-debugging-port=${DEBUG_PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // §13.6: the gate and this test open the project without a dialog.
      SVATAH_ADE_PROJECT: project,
      SVATAH_A11Y: "1",
      // The packaged application carries its own CLI; this points at the
      // workspace's so a rebuild is picked up without repackaging.
      SVATAH_CLI: CLI,
      SVATAH_BASE_URL: app.origin,
      SVATAH_ADE_SMOKE: "",
    },
  });

  /*
   * Read the application's own output, and keep reading it.
   *
   * A piped stdio that nobody drains fills its 64 KB buffer and then *blocks the
   * writer* — the ADE spawns `svatah serve`, whose logs are chatty, so the
   * window froze part-way through this file and Playwright reported a closed
   * page. Draining is the whole fix; printing it is what makes a failure here
   * legible.
   */
  const say = (prefix: string) => (chunk: Buffer) => {
    if (process.env["SVATAH_ADE_SPEC_VERBOSE"] === "1") {
      process.stderr.write(`[${prefix}] ${String(chunk)}`);
    }
  };
  ade.stdout?.on("data", say("ade"));
  ade.stderr?.on("data", say("ade!"));

  // The endpoint appears when the renderer does; polling it is how a caller
  // knows the window exists without asking the window.
  browser = await connectWhenReady();
  page = await currentPage();
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (error) => process.stderr.write(`[renderer] ${error.message}\n`));
  page.on("console", (message) => {
    if (message.type() === "error") process.stderr.write(`[console] ${message.text()}\n`);
  });
  page.on("close", () => process.stderr.write("[renderer] the window closed\n"));
  page.on("crash", () => process.stderr.write("[renderer] the window crashed\n"));
  ade.on("exit", (code, signal) =>
    process.stderr.write(`[ade] exited code=${code ?? "null"} signal=${signal ?? "null"}\n`),
  );
  browser.contexts()[0]?.on("page", (one) =>
    process.stderr.write(`[renderer] a new window: ${one.url().slice(-60)}\n`),
  );
  // The project opens after `ready`, so the shell arrives a moment later.
  await page.locator("#rail-flows").waitFor({ state: "visible", timeout: 120_000 });
});

test.afterAll(async () => {
  await browser?.close().catch(() => undefined);
  ade?.kill("SIGTERM");
  app?.child.kill("SIGTERM");
  if (project !== undefined) rmSync(project, { recursive: true, force: true });
});

test.beforeEach(async () => {
  page = await currentPage();
  await page.locator("#rail-flows, #screen-project").first().waitFor({ timeout: 60_000 });
});

test("opens into the new Flows screen, not the eleven tabs", async () => {
  // The rail (LLD §13.7's information architecture), by its own ids.
  for (const id of [
    "rail-flows",
    "rail-runs",
    "rail-bindings",
    "rail-agents",
    "rail-api",
    "rail-data",
    "rail-import",
    "rail-settings",
    "rail-legacy",
  ]) {
    await expect(page.locator(`#${id}`), `${id} is missing from the rail`).toBeVisible();
  }

  // The toolbar says what the mockup's says, from the model.
  await expect(page.getByRole("heading", { name: "Flows" })).toBeVisible();
  await expect(page.locator(".sv-toolbar-sub")).toContainText("7 files");
  await expect(page.locator(".sv-toolbar-sub")).toContainText("22 stories");

  // The flow list, and the editor beside it.
  await expect(page.getByText("guards-and-compensation.flow").first()).toBeVisible();
  await expect(page.locator("#flows-list")).toBeVisible();
  await expect(page.locator("#flows-tabs")).toBeVisible();

  // And the eleven tabs are *not* on screen: they are behind the rail item.
  await expect(page.locator("#screen-project")).toHaveCount(0);
});

test("every interactive control on the Flows screen is named and id'd (P8-F3)", async () => {
  const unnamed = await page.evaluate(() => {
    const interactive = [
      ...document.querySelectorAll(
        "button, a[href], input, select, textarea, [role='button'], [role='tab']",
      ),
    ].filter((node) => {
      for (let one: Element | null = node; one !== null; one = one.parentElement) {
        if (one.getAttribute("aria-hidden") === "true") return false;
      }
      return true;
    });
    const nameOf = (node: Element): string => {
      const aria = node.getAttribute("aria-label");
      if (aria !== null && aria.trim() !== "") return aria.trim();
      const id = node.getAttribute("id");
      if (id !== null) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label !== null) return (label.textContent ?? "").trim();
      }
      const clone = node.cloneNode(true) as Element;
      for (const hidden of clone.querySelectorAll("[aria-hidden='true']")) hidden.remove();
      return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
    };
    return interactive
      .filter((node) => nameOf(node) === "" || (node.getAttribute("id") ?? "") === "")
      .map((node) => node.outerHTML.slice(0, 160));
  });
  expect(unnamed, unnamed.join("\n")).toEqual([]);
});

test("Record on the Flows screen starts a session with the fake gateway", async () => {
  /*
   * One flow, chosen first.
   *
   * `record.start` records what the Flows screen has open, and the screen opens
   * on the first file when nothing is selected — so a test that pressed Record
   * without choosing would record all seven and sit through every decision.
   * `simple.flow`'s targets are already bound in the fixtures store and the
   * action does not ask for `--rebind`, so the session reuses them, raises no
   * decision and finishes on its own. That is the shape a person sees when they
   * press Record on a flow they have recorded before.
   */
  await page.locator("#flows-list").getByText("simple.flow", { exact: true }).click();

  const record = page.locator("#action-record-start");
  await expect(record).toBeVisible();
  await expect(record).toContainText("Record");

  await record.click();

  // The button started a session: the status bar carries the model's message.
  await expect(page.locator("#status-context")).toContainText(/Recording session .* started\./, {
    timeout: 120_000,
  });

  /*
   * `record.start` goes to the `record` screen, which Phase 9 has not rebuilt —
   * so the shell falls back to the Legacy rail item, which is exactly T9.4's
   * scope. Back to Flows for the run.
   */
  page = await currentPage();
  await page.locator("#rail-flows").click();
  await expect(page.getByRole("heading", { name: "Flows" })).toBeVisible();
});

test("Run on the Flows screen starts a run and opens the Run screen", async () => {
  await page.locator("#flows-list").getByText("guards-and-compensation.flow").click();

  const run = page.locator("#action-run-flow");
  await expect(run).toBeVisible();
  await run.click();

  // The shell goes to the Run screen: the model's action said so.
  await expect(page.getByRole("heading", { name: /^Run / })).toBeVisible({ timeout: 180_000 });
  await expect(page.locator("#run-stories")).toBeVisible();

  // The steps arrive on the stream and the model folds them in.
  await expect(page.locator(".sv-step").first()).toBeVisible({ timeout: 180_000 });
  await expect(page.locator("#status-context")).toContainText(/Started run/);
});

test("the Run screen shows the run's steps, audit and inspector", async () => {
  /*
   * Still on the Run screen the previous test navigated to. The rail's `Runs`
   * item goes to the *Legacy* screens in Phase 9 — `runs` is one of the ten this
   * phase models and does not render (T9.4's scope) — so clicking it here would
   * leave the screen under test.
   */
  await expect(page.getByRole("heading", { name: /^Run / })).toBeVisible({ timeout: 60_000 });

  // Steps, with the candidate that resolved each.
  const steps = page.locator(".sv-step");
  await expect(steps.first()).toBeVisible({ timeout: 60_000 });
  expect(await steps.count()).toBeGreaterThan(0);

  // The audit beside them, stamped from the run's start.
  await expect(page.locator(".sv-audit li").first()).toBeVisible();
  await expect(page.locator(".sv-audit-at").first()).toHaveText(/^\d\d\.\d\d\d$/);

  // Choosing a step fills the inspector, which is the model re-loading with a
  // different `selected` — the same thing `svatah ui` does with Enter.
  await steps.first().click();
  await expect(page.locator("#inspector-step")).toBeVisible();
});

/*
 * P9-F5, Draft 2.12 §13.7 — the three polish defects the verification found on
 * this screen, each checked on the packaged application.
 */
test("the Run toolbar keeps its buttons on one line, however long the title", async () => {
  await expect(page.getByRole("heading", { name: /^Run / })).toBeVisible({ timeout: 60_000 });

  const measured = await page.evaluate(() => {
    const toolbar = document.querySelector(".sv-toolbar") as HTMLElement | null;
    if (toolbar === null) return null;
    // A title long enough to push the buttons off the end of any window.
    const title = toolbar.querySelector(".sv-toolbar-title") as HTMLElement | null;
    const sub = toolbar.querySelector(".sv-toolbar-sub") as HTMLElement | null;
    const restore = { title: title?.textContent ?? "", sub: sub?.textContent ?? "" };
    if (title !== null) title.textContent = `Run ${"01k4h9m2ptw3xyz".repeat(12)}`;
    if (sub !== null) sub.textContent = `${"test behavior · invoker user via cli · 0.74 s ".repeat(8)}`;

    const buttons = [...toolbar.querySelectorAll("button")] as HTMLElement[];
    const answer = {
      toolbarHeight: toolbar.getBoundingClientRect().height,
      toolbarWidth: toolbar.getBoundingClientRect().width,
      buttons: buttons.map((one) => ({
        label: (one.textContent ?? "").trim(),
        height: one.getBoundingClientRect().height,
        right: one.getBoundingClientRect().right,
      })),
      titleFits:
        title === null ? true : title.getBoundingClientRect().right <= toolbar.getBoundingClientRect().right + 1,
    };
    if (title !== null) title.textContent = restore.title;
    if (sub !== null) sub.textContent = restore.sub;
    return answer;
  });

  expect(measured, "the Run screen has no toolbar").not.toBeNull();
  // The bar is one row: 40px, and it stays 40px (LLD §13.7's 28px controls).
  expect(measured!.toolbarHeight).toBeLessThanOrEqual(41);
  expect(measured!.buttons.length).toBeGreaterThan(0);
  for (const button of measured!.buttons) {
    // A wrapped label makes a 28px control about 44px tall.
    expect(button.height, `"${button.label}" wrapped onto two lines`).toBeLessThanOrEqual(30);
    // And no button is pushed out of the bar.
    expect(button.right, `"${button.label}" is off the end of the toolbar`).toBeLessThanOrEqual(
      measured!.toolbarWidth + 1,
    );
  }
  // What gives is the title, which truncates.
  expect(measured!.titleFits).toBe(true);
});

test("the inspector says each of its headings once", async () => {
  await page.locator(".sv-step").first().click();
  await expect(page.locator("#inspector-step")).toBeVisible();

  const repeated = await page.evaluate(() => {
    const inspector = document.querySelector(".sv-inspector");
    if (inspector === null) return ["no inspector"];
    /*
     * A `<table>`'s `<caption>` is its accessible name and is visible
     * (LLD §13.7), so a caption that repeats the section heading above it puts
     * the same words on the screen twice — which is what "the 'Candidates
     * tried' heading renders twice" was (P9-F5).
     */
    const said = [...inspector.querySelectorAll("h2, h3, h4, caption")].map((one) =>
      (one.textContent ?? "").trim().toLowerCase(),
    );
    return said.filter((one, at) => one !== "" && said.indexOf(one) !== at);
  });
  expect(repeated, `the inspector says these twice: ${repeated.join(", ")}`).toEqual([]);
});

test("the audit pane renders the call detail the model carries", async () => {
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll(".sv-audit li")].map((one) => ({
      kind: (one.querySelector(".sv-audit-kind")?.textContent ?? "").trim(),
      text: (one.lastElementChild?.textContent ?? "").trim(),
    })),
  );
  expect(rows.length).toBeGreaterThan(5);

  // The kind column is the call, not "surface" on every line (P9-F5).
  expect(rows.every((one) => one.kind !== "surface")).toBe(true);

  const locate = rows.find((one) => one.kind === "locate");
  expect(locate, JSON.stringify(rows.slice(0, 10), null, 2)).toBeDefined();
  // `locate · booking.book-now-button · testid "book-now" · matched 1 · ok`
  expect(locate!.text).toMatch(/^[a-z]+\.[a-z-]+ · /);
  expect(locate!.text).toMatch(/matched (nothing|\d+)/);
  expect(locate!.text).toContain("ok");
});

test("Run again is a button on the Run screen, and it starts another run", async () => {
  const again = page.locator("#action-run-again");
  await expect(again).toBeVisible();
  await expect(again).toContainText("Run again");

  await again.click();
  await expect(page.locator("#status-context")).toContainText(/Started run/, { timeout: 180_000 });
  await expect(page.locator(".sv-step").first()).toBeVisible({ timeout: 180_000 });
});

test("the command palette opens on ⌘K and lists the registry's actions", async () => {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();

  // The rows are the registry's: a label, and the CLI command beside it.
  await expect(palette.getByText("Verify all bindings")).toBeVisible();
  await expect(palette.getByText("svatah bindings verify")).toBeVisible();

  // It filters, and it closes.
  await palette.getByLabel("Search or run a command").fill("heal");
  await expect(palette.getByText("svatah heal --run <id>")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("the Legacy rail item still reaches the eleven screens (T9.4's scope)", async () => {
  await page.locator("#rail-legacy").click();
  for (const id of [
    "screen-project",
    "screen-flows",
    "screen-plan",
    "screen-run",
    "screen-results",
    "screen-api",
    "screen-data",
    "screen-record",
    "screen-bindings",
    "screen-explorer",
    "screen-tools",
  ]) {
    await expect(page.locator(`#${id}`), `${id} is not reachable behind Legacy`).toBeVisible();
  }
  await page.locator("#rail-flows").click();
  await expect(page.getByRole("heading", { name: "Flows" })).toBeVisible();
});
