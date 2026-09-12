/**
 * T9.4 Validate — "a record and a run driven through the new Run screen's
 * buttons under Playwright" (REQ-ADE-11, REQ-ADE-12, LLD §13.7).
 *
 * The **packaged** APP_DIR, launched by Playwright's Electron support, opened on the
 * fixtures project through `YAM_APP_PROJECT`, against a real
 * `apps/sample-web`. Every click is a click on a control the desktop adapters
 * would find by the same name and the same id.
 *
 * What is driven, in order:
 *
 *   1. the app opens **into the new Flows screen** — the rail, the toolbar, the
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
 * REQ-ADE-6: the conformance target is the packaged app, and Phase 8 found the
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
 * It **skips with the reason** when `apps/desktop/out/` has no packaged build:
 * packaging is `pnpm --filter @svatah/yam-desktop package` and takes about fifteen
 * seconds, and a test that packaged silently would make every run of the suite
 * a build.
 */
import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/*
 * `process.cwd()`, not `import.meta.url`: `apps/desktop` is not `"type": "module"`
 * — its main and preload bundles are CommonJS because a sandboxed preload has
 * no ES module loader (LLD §13.6) — and Playwright transpiles a spec to CJS,
 * where `import.meta` is a syntax error. Playwright runs from the directory
 * holding `playwright.config.ts`, which is this package.
 */
const APP_DIR = resolve(process.cwd());
const ROOT = join(APP_DIR, "..", "..");
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
      if (process.env["YAM_APP_SPEC_VERBOSE"] === "1") {
      process.stderr.write(
        `[pages] ${context
          .pages()
          .map((one) => `${one.isClosed() ? "closed" : "open"} ${one.url().slice(-50)}`)
          .join(" | ")}\n`,
      );
    }
    const open = context.pages().filter((one) => !one.isClosed());
    if (open.length > 0) return open[open.length - 1]!;
    if (Date.now() > until) throw new Error("The app has no open window.");
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
          `The packaged app published no DevTools endpoint on ${DEBUG_PORT} within 120 s: ` +
            `${last instanceof Error ? last.message : String(last)}`,
        );
      }
      await new Promise((done) => setTimeout(done, 500));
    }
  }
}

/** The packaged application, whatever the platform called its directory. */
/**
 * The build this suite drives (P10-F7).
 *
 * `out-test` first — the suite's own build, product name "Yam Test",
 * bundle id `com.electron.yam-test`, made by
 * `node scripts/package-app.mjs --test`. It exists so these cases and the
 * desktop gate can run at the same time: both stop leftovers by executable path
 * and both used to package into `out/`, so each stopped the other's application
 * mid-case, and a person's own app was in the line of fire as well.
 *
 * `out/` is still accepted, because a checkout that has only packaged the
 * product should still be able to run the suite — it simply cannot then run it
 * *beside* a gate, which the contract in `apps/desktop/README.md` says.
 */
function packagedApp(): string | undefined {
  for (const [directory, product] of [
    ["out-test", "Yam Test"],
    ["out", "Yam"],
  ] as const) {
    const out = join(APP_DIR, directory);
    if (!existsSync(out)) continue;
    for (const entry of readdirSync(out)) {
      const mac = join(out, entry, `${product}.app`, "Contents", "MacOS", product);
      if (existsSync(mac)) return mac;
      for (const name of [`${product}.exe`, product.toLowerCase().replace(/ /g, "-"), product]) {
        const other = join(out, entry, name);
        if (existsSync(other)) return other;
      }
    }
  }
  return undefined;
}

let app: { origin: string; child: ChildProcess };
let project: string;
let desktopApp: ChildProcess;
let browser: Browser;
let page: Page;

/** A port nobody else in this repository's test suite uses. */
/**
 * The DevTools port this suite's build listens on (P10-F7).
 *
 * Different from anything else in the repository, and it has to be: the port is
 * how `connectOverCDP` finds the application, so two callers sharing one would
 * attach to each other's. 9411 here, 9412 for `scripts/shoot-app.mjs`, 9300–9700
 * for `scripts/record-desktop-tree.mjs`; the desktop gate opens no debugging
 * port at all.
 */
const DEBUG_PORT = 9411;

const executable = packagedApp();

test.skip(
  executable === undefined,
  "No packaged app under apps/desktop/out. Run `pnpm --filter @svatah/yam-desktop package` first: " +
    "REQ-ADE-6's conformance target is the packaged application, and a development " +
    "Electron cannot fail the way the product failed in Phase 8.",
);

/**
 * Any APP_DIR this checkout left running, gone before this one starts.
 *
 * The same defect the desktop gate has (P8-F1): a build from a previous run that
 * is still up holds `DEBUG_PORT`, so the new one cannot bind its DevTools
 * endpoint and `connectOverCDP` attaches to the *old* application — which then
 * fails tests about code it does not have. Matching on this checkout's own
 * `apps/desktop/out` path means a Yam somebody has open from elsewhere is
 * left alone.
 */
async function stopLeftovers(): Promise<void> {
  if (executable === undefined || process.platform === "win32") return;
  const living = (): number[] => {
    const listed = spawnSync("pgrep", ["-f", executable], { encoding: "utf8" });
    return (listed.stdout ?? "")
      .split("\n")
      .map((one) => Number(one.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  };

  /*
   * Kill, then *wait for them to be gone*.
   *
   * A signal is a request. An Electron main mid-shutdown still holds
   * `DEBUG_PORT`, and the next launch then fails to bind it while
   * `connectOverCDP` cheerfully attaches to the dying one — a test against code
   * that is on its way out. The desktop gate learned the same thing (P8-F1).
   */
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const pids = living();
    if (pids.length === 0) return;
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // It went between the list and the signal, which is the outcome wanted.
      }
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`an app from a previous run would not go: ${living().join(", ")}`);
}

test.beforeAll(async () => {
  if (executable === undefined) return;
  if (!existsSync(CLI)) throw new Error("Run `pnpm -r build` first.");

  await stopLeftovers();
  app = await startSampleWeb();

  /*
   * A copy of the fixtures project: a run writes `runs/`, and a test that
   * dirtied the repository would be one nobody could run twice.
   */
  project = mkdtempSync(join(tmpdir(), "yam-shell-"));
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

  desktopApp = spawn(executable, [`--remote-debugging-port=${DEBUG_PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // §13.6: the gate and this test open the project without a dialog.
      YAM_APP_PROJECT: project,
      YAM_A11Y: "1",
      // The packaged application carries its own CLI; this points at the
      // workspace's so a rebuild is picked up without repackaging.
      YAM_CLI: CLI,
      YAM_BASE_URL: app.origin,
      YAM_APP_SMOKE: "",
    },
  });

  /*
   * Read the application's own output, and keep reading it.
   *
   * A piped stdio that nobody drains fills its 64 KB buffer and then *blocks the
   * writer* — the app spawns `yam serve`, whose logs are chatty, so the
   * window froze part-way through this file and Playwright reported a closed
   * page. Draining is the whole fix; printing it is what makes a failure here
   * legible.
   */
  const say = (prefix: string) => (chunk: Buffer) => {
    if (process.env["YAM_APP_SPEC_VERBOSE"] === "1") {
      process.stderr.write(`[${prefix}] ${String(chunk)}`);
    }
  };
  desktopApp.stdout?.on("data", say("app"));
  desktopApp.stderr?.on("data", say("app!"));

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
  desktopApp.on("exit", (code, signal) =>
    process.stderr.write(`[desktopApp] exited code=${code ?? "null"} signal=${signal ?? "null"}\n`),
  );
  browser.contexts()[0]?.on("page", (one) =>
    process.stderr.write(`[renderer] a new window: ${one.url().slice(-60)}\n`),
  );
  // The project opens after `ready`, so the shell arrives a moment later.
  await page.locator("#rail-flows").waitFor({ state: "visible", timeout: 120_000 });
});

test.afterAll(async () => {
  await browser?.close().catch(() => undefined);
  desktopApp?.kill("SIGTERM");
  // SIGTERM asks; this checks. An Electron main that is mid-quit outlives the
  // signal, and the next run of this file is what pays for it.
  await stopLeftovers();
  app?.child.kill("SIGTERM");
  if (project !== undefined) rmSync(project, { recursive: true, force: true });
});

/**
 * The window that is open *and still open a moment later*.
 *
 * Electron recreates a `BrowserWindow` on `activate` when none is left, and a
 * CDP connection sees a target list that momentarily holds two — so a page
 * acquired at the top of a test could be closed by its first statement. Asking
 * again until one answers is what a person looking at the application does.
 */
async function livePage(): Promise<Page> {
  /*
   * Ten seconds, not sixty (P-W2-F3).
   *
   * This runs in `beforeEach`, and a hook's time comes out of the test's — so a
   * sixty-second ceiling here forced the global timeout above it whatever the
   * tests themselves needed. It polls every 250 ms and the app settles in well
   * under a second in practice; forty attempts is a retry policy, not a wait.
   */
  const until = Date.now() + 10_000;
  let last: unknown;
  for (;;) {
    try {
      const candidate = await currentPage();
      await candidate.locator("#rail-flows, #screen-project").first().waitFor({ timeout: 5_000 });
      if (!candidate.isClosed()) return candidate;
    } catch (cause) {
      last = cause;
    }
    if (Date.now() > until) {
      throw new Error(
        `The app never settled on a window: ${last instanceof Error ? last.message : String(last)}`,
      );
    }
    await new Promise((done) => setTimeout(done, 250));
  }
}

/**
 * Put the Run screen on the screen, starting a run if there is not one.
 *
 * The tests below run in order against one application, which is how a person
 * does it — but a test that *assumed* the previous one left the Run screen
 * showing failed whenever the window had been recreated in between. This makes
 * each of them able to reach its own subject.
 */
async function showRunScreen(): Promise<void> {
  page = await livePage();
  const heading = page.getByRole("heading", { name: /^Run / });
  if (await heading.isVisible().catch(() => false)) return;

  await page.locator("#rail-flows").click();
  await page.locator("#flows-list").getByText("guards-and-compensation.flow").click();
  await page.locator("#action-run-flow").click();
  await expect(heading).toBeVisible({ timeout: 180_000 });
  await expect(page.locator(".sv-step").first()).toBeVisible({ timeout: 180_000 });
}

test.beforeEach(async () => {
  page = await livePage();
});

test("opens into Session by default, with the four-section rail (T14, SF-02, SF-16, REQ-ADE-14)", async () => {
  /*
   * Surface-first navigation (T14), after Draft 2.27 merged Surfaces and Record.
   *
   * The section and its screen are both `session` now; this asked for
   * `section-surfaces` and `rail-surfaces` for a wave, while the suite skipped
   * itself for want of a packaged build.
   */
  for (const id of [
    "section-session",
    "section-automations",
    "section-activity",
    "section-settings",
    "rail-session",
    "rail-flows",
    "rail-runs",
    "rail-bindings",
    "rail-agents",
    "rail-api",
    "rail-data",
    "rail-import",
    "rail-settings",
  ]) {
    await expect(page.locator(`#${id}`), `${id} is missing from the rail`).toBeVisible();
  }

  /*
   * Session is the default, and it opens in `do` — the mode that draws what
   * Surfaces drew. The connect bar is on the screen with no project (SF-02).
   */
  await expect(page.locator("#toolbar-title")).toHaveText("Session");
  await expect(page.locator("#session-mode-do")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#surfaces-url")).toBeVisible();
  await expect(page.locator("#action-surface-connect")).toBeVisible();
  await expect(page.locator("#surfaces-discovery")).toBeVisible();

  // And the eleven tabs are not anywhere: T10.3 deleted them.
  await expect(page.locator("#screen-project")).toHaveCount(0);

  // Flows still exists, one click away under Automations.
  await page.locator("#rail-flows").click();
  await expect(page.getByRole("heading", { name: "Flows" })).toBeVisible();
  await expect(page.locator("#flows-list")).toBeVisible();
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
   * This one executes a flow in the packaged app — a spawned `yam serve`, a real
   * browser, steps arriving — so it is minutes rather than milliseconds, and
   * says so here rather than making every other test pay for it.
   */
  test.setTimeout(240_000);
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
  /*
   * The button's label is the registry's, and the registry calls this action
   * **Bind targets** — recording is what binding a flow's targets *is*, and the
   * word a person reads should say what happens rather than name the mechanism.
   * The assertion used to be the literal "Record" and had not been re-run since
   * the rename, because this whole suite skips without a packaged build (T18's
   * first defect).
   */
  await expect(record).toContainText("Bind targets");

  await record.click();

  // The button started a session: the status bar carries the model's message.
  await expect(page.locator("#status-context")).toContainText(/Recording session .* started\./, {
    timeout: 120_000,
  });

  /*
   * `record.start` goes to Session in `record` mode (Draft 2.27), which is where
   * the Record review went — so the shell shows it rather than falling back to
   * anything. This asked for a "Record review" heading, which stopped existing
   * with the merge. Back to Flows for the run.
   */
  page = await livePage();
  await expect(page.locator("#session-mode-record")).toHaveAttribute("aria-selected", "true", {
    timeout: 60_000,
  });
  await expect(page.getByRole("heading", { name: "Session" })).toBeVisible({
    timeout: 60_000,
  });
  await page.locator("#rail-flows").click();
  await expect(page.getByRole("heading", { name: "Flows" })).toBeVisible();
});

test("Run on the Flows screen starts a run and opens the Run screen", async () => {
  /*
   * This one executes a flow in the packaged app — a spawned `yam serve`, a real
   * browser, steps arriving — so it is minutes rather than milliseconds, and
   * says so here rather than making every other test pay for it.
   */
  test.setTimeout(240_000);
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
   * `showRunScreen` starts a run when one is not already showing — usually it is,
   * left by the test before, and this finishes in milliseconds. The slow path is
   * real though, and a conditional minutes-long path under a thirty-second
   * global is a flake waiting for the order to change.
   */
  test.setTimeout(240_000);
  /*
   * Still on the Run screen the previous test navigated to, or back on it. The
   * rail's `Runs` item goes to the *Legacy* screens in Phase 9 — `runs` is one
   * of the ten this phase models and does not render (T9.4's scope) — so
   * clicking it here would leave the screen under test.
   */
  await showRunScreen();

  // Steps, with the candidate that resolved each.
  const steps = page.locator(".sv-step");
  await expect(steps.first()).toBeVisible({ timeout: 60_000 });
  expect(await steps.count()).toBeGreaterThan(0);

  // The audit beside them, stamped from the run's start.
  await expect(page.locator(".sv-audit li").first()).toBeVisible();
  await expect(page.locator(".sv-audit-at").first()).toHaveText(/^\d\d\.\d\d\d$/);

  // Choosing a step fills the inspector, which is the model re-loading with a
  // different `selected` — the same thing `yam ui` does with Enter.
  await steps.first().click();
  await expect(page.locator("#inspector-step")).toBeVisible();
});

/*
 * P9-F5, Draft 2.12 §13.7 — the three polish defects the verification found on
 * this screen, each checked on the packaged application.
 */
test("the Run toolbar keeps its buttons on one line, however long the title", async () => {
  /*
   * `showRunScreen` starts a run when one is not already showing — usually it is,
   * left by the test before, and this finishes in milliseconds. The slow path is
   * real though, and a conditional minutes-long path under a thirty-second
   * global is a flake waiting for the order to change.
   */
  test.setTimeout(240_000);
  await showRunScreen();

  /*
   * The toolbar is crowded with a stylesheet rather than by rewriting the
   * title's text.
   *
   * React owns the text nodes in there; assigning to `textContent` under it
   * takes the renderer down on the next reconcile, which is a test that breaks
   * the application to look at it. A `<style>` appended to `<head>` is
   * something React never reconciles, and a 420-pixel toolbar is the same
   * crowding a long run id and a long subtitle produce — which is the condition
   * P9-F5 is about.
   */
  const measured = await page.evaluate(() => {
    const read = (): Record<string, unknown> | null => {
      const toolbar = document.querySelector(".sv-toolbar") as HTMLElement | null;
      if (toolbar === null) return null;
      const box = toolbar.getBoundingClientRect();
      const title = toolbar.querySelector(".sv-toolbar-title") as HTMLElement | null;
      const buttons = [...toolbar.querySelectorAll("button")] as HTMLElement[];
      return {
        height: box.height,
        right: box.right,
        wrap: getComputedStyle(toolbar).flexWrap,
        buttons: buttons.map((one) => ({
          label: (one.textContent ?? "").trim(),
          height: one.getBoundingClientRect().height,
          right: one.getBoundingClientRect().right,
          whiteSpace: getComputedStyle(one).whiteSpace,
          flexShrink: getComputedStyle(one).flexShrink,
        })),
        title:
          title === null
            ? undefined
            : {
                ellipsis: getComputedStyle(title).textOverflow,
                nowrap: getComputedStyle(title).whiteSpace,
                clipped: title.scrollWidth > title.clientWidth,
              },
      };
    };

    const roomy = read();
    const style = document.createElement("style");
    style.textContent = ".sv-toolbar { width: 420px !important; }";
    document.head.append(style);
    try {
      return { roomy, cramped: read() };
    } finally {
      style.remove();
    }
  });

  expect(measured.roomy, "the Run screen has no toolbar").not.toBeNull();
  const roomy = measured.roomy as {
    height: number;
    right: number;
    buttons: Array<{ label: string; right: number }>;
  };
  const cramped = measured.cramped as {
    height: number;
    wrap: string;
    buttons: Array<{ label: string; height: number; whiteSpace: string; flexShrink: string }>;
    title?: { ellipsis: string; nowrap: string; clipped: boolean };
  };

  // At the window's own width every button is inside the bar.
  expect(roomy.buttons.length).toBeGreaterThan(0);
  for (const button of roomy.buttons) {
    expect(button.right, `"${button.label}" is off the end of the toolbar`).toBeLessThanOrEqual(
      roomy.right + 1,
    );
  }

  // And when there is not enough room, the bar is still one 40px row of
  // one-line buttons: what gives is the title.
  expect(cramped.wrap).toBe("nowrap");
  expect(roomy.height).toBeLessThanOrEqual(41);
  expect(cramped.height, "the toolbar grew a second row").toBeLessThanOrEqual(41);
  for (const button of cramped.buttons) {
    // A wrapped label turns a 28px control into a 44px one.
    expect(button.height, `"${button.label}" wrapped onto two lines`).toBeLessThanOrEqual(30);
    expect(button.whiteSpace, `"${button.label}" may wrap`).toBe("nowrap");
    expect(button.flexShrink, `"${button.label}" may be squeezed`).toBe("0");
  }
  expect(cramped.title?.nowrap).toBe("nowrap");
  expect(cramped.title?.ellipsis).toBe("ellipsis");
  expect(cramped.title?.clipped, "the title was not the thing that gave").toBe(true);
});

test("the inspector says each of its headings once", async () => {
  /*
   * `showRunScreen` starts a run when one is not already showing — usually it is,
   * left by the test before, and this finishes in milliseconds. The slow path is
   * real though, and a conditional minutes-long path under a thirty-second
   * global is a flake waiting for the order to change.
   */
  test.setTimeout(240_000);
  await showRunScreen();
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
  /*
   * `showRunScreen` starts a run when one is not already showing — usually it is,
   * left by the test before, and this finishes in milliseconds. The slow path is
   * real though, and a conditional minutes-long path under a thirty-second
   * global is a flake waiting for the order to change.
   */
  test.setTimeout(240_000);
  await showRunScreen();
  /*
   * Polled until the audit has filled, not until its first row appears (T11.1).
   *
   * The audit arrives as the run makes calls, and the first `<li>` is visible
   * long before the run has made six. Asserting on the count right after the
   * first row was a test that passed alone — where the run is started by this
   * case — and failed in the suite, where an earlier case had left a Run screen
   * open and this one read its audit mid-run. The same defect as P10-F9's fixed
   * wait, in a different renderer.
   */
  const rowsIn = ".sv-audit li";
  await expect
    .poll(async () => await page.locator(rowsIn).count(), { timeout: 120_000 })
    .toBeGreaterThan(5);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll(".sv-audit li")].map((one) => ({
      kind: (one.querySelector(".sv-audit-kind")?.textContent ?? "").trim(),
      text: (one.lastElementChild?.textContent ?? "").trim(),
    })),
  );
  expect(rows.length, JSON.stringify(rows, null, 1)).toBeGreaterThan(5);

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
  /*
   * This one executes a flow in the packaged app — a spawned `yam serve`, a real
   * browser, steps arriving — so it is minutes rather than milliseconds, and
   * says so here rather than making every other test pay for it.
   */
  test.setTimeout(240_000);
  await showRunScreen();
  const again = page.locator("#action-run-again");
  await expect(again).toBeVisible();
  await expect(again).toContainText("Run again");

  await again.click();
  await expect(page.locator("#status-context")).toContainText(/Started run/, { timeout: 180_000 });
  await expect(page.locator(".sv-step").first()).toBeVisible({ timeout: 180_000 });
});

/**
 * T10.4 Validate — "a run started from the Run screen is stopped from it and its
 * summary says `stopped`" (Draft 2.12 §13.5).
 *
 * Through the screen's own buttons, on the packaged application, against a real
 * browser run — which is the only way to press Stop while there is something to
 * stop. `guards-and-compensation.flow` takes about a second, so the Stop is
 * pressed the moment the first step's row appears rather than after a sleep.
 */
test("a run started from the Run screen can be stopped from it (T10.4)", async () => {
  /*
   * The longest flow the project has that needs no input.
   *
   * `execution.flow` is thirty-one steps; `guards-and-compensation.flow` is
   * seven and takes about a second, which is not a window anyone — a person or
   * a test — can reliably press a button in. Running *every* flow would be
   * longer still and is not available: several of the project's stories declare
   * inputs, and `POST /run` refuses the whole run with a 400 before it starts
   * (REQ-AUTO-5), which is the right answer to a run nobody supplied arguments
   * for.
   */
  await goTo("flows", "Flows");
  await page.locator("#flows-list").getByText("execution.flow", { exact: true }).click();
  await page.locator("#action-run-flow").click();

  // The workspace's own title, not any heading: the Runs screen's inspector
  // has an `<h3>Run …</h3>` in it, which a role query happily matches.
  await expect(page.locator(".sv-toolbar-title")).toContainText(/^Run /, { timeout: 180_000 });

  /*
   * `run.stop`'s `availableWhen` is the model's `live`, so an enabled Stop *is*
   * the screen saying there is a run to stop — a better signal to wait for than
   * a step row, and the thing the button's contract is about.
   */
  const stop = page.locator("#action-run-stop");
  await expect(stop).toBeVisible();
  await expect(stop).toContainText("Stop");
  await expect(stop).toBeEnabled({ timeout: 120_000 });
  await stop.click();

  await expect(page.locator("#status-context")).toContainText(/Stopping run/, {
    timeout: 60_000,
  });

  // And when it has stopped, the screen says so rather than leaving a reader to
  // infer it from a pile of skipped steps.
  await expect(page.locator(".sv-toolbar .sv-pill").first()).toContainText("stopped", {
    timeout: 180_000,
  });
  await expect(stop).toBeDisabled();

  const skipped = await page.evaluate(
    () => document.querySelectorAll(".sv-step-glyph.sv-tone-skip").length,
  );
  expect(skipped, "a stopped run should have skipped what it never started").toBeGreaterThan(0);
});

test("the command palette opens on ⌘K and lists the registry's actions", async () => {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();

  // The rows are the registry's: a label, and the CLI command beside it.
  await expect(palette.getByText("Verify all bindings")).toBeVisible();
  await expect(palette.getByText("yam bindings verify")).toBeVisible();

  // It filters, and it closes.
  await palette.getByLabel("Search or run a command").fill("heal");
  await expect(palette.getByText("yam heal --run <id>")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

/**
 * T10.1 and T10.2's Validate — "each screen driven end to end through its own
 * controls in the app under Playwright … every control named and id'd".
 *
 * Every one of the twelve, reached the way a person reaches it: the rail for the
 * eight that are on it, and the palette's Go-to rows for the four that are
 * reached from another screen. Each is then *used* — a filter cycled, a row
 * chosen, a field typed into — and checked for an unnamed control.
 */

/** Every interactive control on screen that has no accessible name or no id. */
async function unnamedControls(): Promise<string[]> {
  return await page.evaluate(() => {
    const interactive = [
      ...document.querySelectorAll(
        "button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='combobox']",
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
}

/**
 * Reach one of Session's three modes (REQ-ADE-14).
 *
 * Draft 2.27 merged Surfaces and Record into one screen with a mode strip, so
 * `goTo("surfaces", …)` and `goTo("record", …)` stopped naming anything. They
 * stayed in this file for a wave, because the whole suite skips without a
 * packaged build and nobody had packaged one — a case that cannot run is a case
 * that cannot fail.
 */
async function goToMode(mode: "record" | "say" | "do"): Promise<void> {
  await goTo("session", "Session");
  await page.locator(`#session-mode-${mode}`).click();
  await expect(page.locator(`#session-mode-${mode}`)).toHaveAttribute("aria-selected", "true");
}

/** Reach a screen the way a person does: the rail, or the palette's Go-to row. */
async function goTo(screen: string, label: string): Promise<void> {
  page = await livePage();
  const rail = page.locator(`#rail-${screen}`);
  if ((await rail.count()) > 0) {
    await rail.click();
  } else {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    /*
     * By id, not by text. A palette row's accessible name is its whole
     * contents, and "Go to Run" is a substring of "Go to Runs" — a text search
     * picks the wrong row and opens the wrong screen.
     */
    await page.locator(`#palette-go-${screen}`).click();
    await expect(palette).toBeHidden();
  }
  /*
   * The *workspace's* title, not any heading with that name: the Runs screen's
   * inspector has an `<h3>Run 00mt…</h3>` in it, and a role query happily
   * matches that while the workspace is still showing something else.
   *
   * And the click is *repeated* until the title is the one asked for (P11). A
   * run started by an earlier case can still be in flight, and a run that
   * finishes opens the Run screen — so a single click on the rail is a request
   * the application may answer and then navigate away from. Under a loaded
   * `pnpm -r test` this waited sixty seconds while the title moved between two
   * run ids and never became "Flows". Clicking again is what a person does.
   */
  const title = page.locator(".sv-toolbar-title");
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await expect(title).toContainText(label, { timeout: 5_000 });
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      if ((await rail.count()) > 0) await rail.click();
    }
  }
}

test.describe("every screen (T10.1, T10.2)", () => {
  const SCREENS: ReadonlyArray<[string, string]> = [
    ["session", "Session"],
    ["flows", "Flows"],
    ["runs", "Runs"],
    ["bindings", "Bindings"],
    ["agents", "Agents and tools"],
    ["api", "API"],
    ["data", "Data"],
    ["import", "Import prototype database"],
    ["settings", "Settings"],
    ["run", "Run"],
    ["heal", "Heal review"],
  ];

  for (const [screen, label] of SCREENS) {
    test(`${screen} opens and every control on it is named and id'd`, async () => {
      await goTo(screen, label);
      const unnamed = await unnamedControls();
      expect(unnamed, `${screen}: ${unnamed.join("\n")}`).toEqual([]);
    });
  }
});

test("the Runs screen filters, and its inspector shows the failing step's evidence", async () => {
  await goTo("runs", "Runs");
  await expect(page.locator("#runs-table")).toBeVisible();

  // Its own controls: the three chips the artboard shows, each a real button.
  for (const id of ["runs-filter-behavior", "runs-filter-invoker", "runs-filter-status"]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  /*
   * The chip cycles through the values the *runs* have, which is `all` plus
   * whatever behaviours are in the project — so a project with no run has one
   * choice and cycling is a no-op. The chip's title names the next value, which
   * is what makes this checkable either way.
   */
  const behavior = page.locator("#runs-filter-behavior");
  await expect(behavior).toContainText("behavior: all");

  /*
   * One click, and the chip reads what its title said it would.
   *
   * The title names the *next* value, which is what makes this checkable
   * whatever the project holds: a project with one behaviour has one choice and
   * cycling is a no-op, and the assertion is still exact.
   */
  const nextOf = async (): Promise<string> =>
    /next: (.+)\)$/.exec((await behavior.getAttribute("title")) ?? "")?.[1] ?? "all";

  const after = await nextOf();
  await behavior.click();
  await expect(behavior).toContainText(`behavior: ${after}`);

  /*
   * And back to `all`, so the rest of this file sees the screen it expects.
   * Bounded: an unbounded loop that re-read the label between clicks raced the
   * re-render and cycled for ever.
   */
  for (let press = 0; press < 6; press += 1) {
    if (((await behavior.textContent()) ?? "").includes("behavior: all")) break;
    const target = await nextOf();
    await behavior.click();
    await expect(behavior).toContainText(`behavior: ${target}`);
  }
  await expect(behavior).toContainText("behavior: all");

  /*
   * Choosing a run fills the inspector with what that run wrote — and the click
   * is repeated until it does (P11). The table re-reads the project, so a run
   * finishing while this case is in it replaces the row under the pointer, and
   * a click that landed on a row that is no longer there selects nothing. Under
   * a loaded `pnpm -r test` that is what happened.
   */
  const inspector = page.locator("#inspector-run");
  const untilSelected = Date.now() + 30_000;
  for (;;) {
    await page.locator("#runs-table tbody tr").first().click();
    try {
      await expect(inspector).toBeVisible({ timeout: 5_000 });
      break;
    } catch (error) {
      if (Date.now() >= untilSelected) throw error;
    }
  }
  await expect(page.locator("#inspector-artifacts")).toBeVisible();
});

test("the Bindings screen shows the store and one element's resolver order", async () => {
  await goTo("bindings", "Bindings");
  await expect(page.locator("#bindings-table")).toBeVisible();
  expect(await page.locator("#bindings-table tbody tr").count()).toBeGreaterThan(5);

  await page.locator("#bindings-table tbody tr").first().click();
  await expect(page.locator("#inspector-binding")).toBeVisible();
  await expect(page.locator("#inspector-candidate-table")).toBeVisible();
  await expect(page.locator("#inspector-fingerprint")).toBeVisible();

  // Its own control: Verify, from the registry, with the key the model gives it.
  const verify = page.locator("#action-bindings-verify");
  await expect(verify).toBeVisible();
  await expect(verify).toContainText("Verify");
});

test("the Heal review offers the runs worth healing", async () => {
  await goTo("heal", "Heal review");
  await expect(page.locator("#heal-candidates")).toBeVisible();
  await expect(page.locator("#heal-proposals")).toBeVisible();
  // Nothing is written until a proposal is applied, and the screen says so.
  await expect(page.locator("#heal-proposals")).toContainText("Nothing is written");
});

test("the Record review chooses its gateway and says what a fake session is", async () => {
  await goToMode("record");
  const gateway = page.locator("#record-gateway");
  await expect(gateway).toBeVisible();

  /*
   * The gateway is *chosen*, and the note belongs to the choice (T18).
   *
   * This case used to assert `#record-fake-gateway` unconditionally, on the
   * reasoning that a service with no model credential falls back to the fake
   * gateway. It does not: the order is credential → `anthropic`, else a display
   * → `human`, else `fake`, and a machine with a display lands on `human`. So
   * the note was absent and the case failed — and had failed silently since,
   * because the packaged build this suite needs could not be produced (T18's
   * first defect) and every case here skipped.
   *
   * What is asserted now is the rule rather than one machine's default: every
   * gateway says whether it is available and why, and *choosing* the fake one
   * makes the screen say what a fake session is.
   */
  await expect(gateway).toContainText(/human|anthropic|fake/);

  /*
   * Chosen by keyboard, which is how `Chooser` is chosen from.
   *
   * It is Radix's select: the options live in a portal above the screen, so a
   * click on one is intercepted by whatever the trigger happens to be under.
   * Focus the trigger, open it, walk to the option by its words, take it — the
   * same gesture `surfaces-dogfood.mjs` uses, and the same one SF-18 requires
   * to work.
   */
  await gateway.focus();
  await page.keyboard.press("Enter");
  const listbox = page.locator('[role="listbox"]');
  await listbox.waitFor({ timeout: 10_000 });
  /*
   * The listbox existing is not the listbox listening (wave 5).
   *
   * This walked straight from `waitFor` into `ArrowDown`, and the keys pressed
   * while Radix was still mounting the portal went nowhere: the highlight never
   * moved, `Enter` took whatever was under it — `human`, the current value —
   * and the case then failed on the *note*, three lines later, saying only that
   * `#record-fake-gateway` was not found. It passed run on its own and failed
   * run after another, which is the shape of every flake worth removing.
   *
   * It had never been seen because this whole suite skips without a packaged
   * build (T18's first defect), and a tree with no packaged build is what
   * `pnpm -r test` runs in. Wave 5 packages the application for the Yam-on-Yam
   * suite, so these thirty-eight cases run — and this one failed on master too,
   * once packaged.
   *
   * So: wait for something to be highlighted, which is Radix saying the listbox
   * is ready; walk by re-reading the highlight after each press; and assert
   * what was *chosen* before asserting what the choice makes the screen say.
   */
  const highlighted = page.locator('[role="option"][data-highlighted]').first();
  await highlighted.waitFor({ timeout: 10_000 });
  for (let step = 0; step < 12; step += 1) {
    const said = ((await highlighted.textContent().catch(() => "")) ?? "").trim();
    if (said.startsWith("fake")) break;
    await page.keyboard.press("ArrowDown");
    await expect(highlighted).not.toHaveText(said, { timeout: 5_000 });
  }
  await expect(highlighted, "the walk never reached the fake gateway").toContainText("fake");
  await page.keyboard.press("Enter");

  await expect(gateway, "the gateway that was chosen").toContainText("fake");
  await expect(page.locator("#record-fake-gateway")).toContainText("committed with Yam");
  await expect(page.locator("#record-flows")).toBeVisible();
});

test("the API screen shows a saved request and its headers", async () => {
  await goTo("api", "API");
  await expect(page.locator("#api-requests")).toBeVisible();
  await expect(page.locator("#api-requests")).toContainText("active count");
  await page.locator("#api-requests tbody tr").first().click();
  await expect(page.locator("#api-headers")).toBeVisible();
  await expect(page.locator("#inspector-request")).toBeVisible();
});

test("the Data screen names every secret and shows none of them", async () => {
  await goTo("data", "Data");
  await expect(page.locator("#data-table")).toBeVisible();
  // The variable, never the value (REQ-NFR-6).
  await expect(page.locator("#data-table")).toContainText("YAM_SAMPLE_PASSWORD");
  await page.locator("#data-table tbody tr").first().click();
  await expect(page.locator("#inspector-value")).toBeVisible();
});

/**
 * T15 — the action inspector, in place of the Explorer.
 *
 * The Explorer asked for an adapter and a prose intent before it would do
 * anything, and its Act button refused every press with "Choose an action".
 * Surfaces asks for neither: it opens on the connect flow with no project, and
 * once a surface is connected the form comes from the catalogue.
 */
test("Surfaces offers a connect form and no prose intent (T15, SF-12)", async () => {
  await goToMode("do");
  await expect(page.locator("#surfaces-url")).toBeVisible();
  await expect(page.locator("#action-surface-connect")).toBeVisible();
  await expect(page.locator("#surfaces-discovery")).toBeVisible();
  // Nothing anywhere asks for an intent before it will look at something.
  await expect(page.locator("#explorer-intent-required")).toHaveCount(0);
  await expect(page.locator("#explorer-adapter")).toHaveCount(0);
});

test("the Import screen previews into the open project and nowhere else", async () => {
  await goTo("import", "Import prototype database");
  await expect(page.locator("#import-source")).toBeVisible();
  await expect(page.locator("#inspector-confinement")).toContainText("anything outside it");
  await expect(page.locator("#inspector-cli")).toContainText("yam migrate");
});

test("the Settings screen shows the project and never a credential", async () => {
  await goTo("settings", "Settings");
  await expect(page.locator("#settings-project")).toContainText("yam-fixtures");
  await expect(page.locator("#settings-run")).toContainText("playwright");
  // A boolean, never the key (REQ-NFR-6, REQ-ADE-4).
  await expect(page.locator("#settings-service")).toContainText(/available|none/);
  await expect(page.locator("#inspector-diagnostics")).toBeVisible();
});

test("the Agents screen lists what an agent may call", async () => {
  await goTo("agents", "Agents and tools");
  await expect(page.locator("#agents-tools")).toBeVisible();
  await expect(page.locator("#agents-invocations")).toBeVisible();
  await expect(page.locator("#inspector-refused")).toBeVisible();
});

test("the legacy screens are gone (T10.3)", async () => {
  await goTo("flows", "Flows");
  // The eleven tabs, and the rail item that reached them.
  for (const id of [
    "rail-legacy",
    "screen-project",
    "screen-plan",
    "screen-results",
    "screen-tools",
  ]) {
    await expect(page.locator(`#${id}`), `${id} is still in the application`).toHaveCount(0);
  }
  // And the rail is the eight of LLD §13.7's information architecture.
  for (const id of [
    "rail-flows",
    "rail-runs",
    "rail-bindings",
    "rail-agents",
    "rail-api",
    "rail-data",
    "rail-import",
    "rail-settings",
  ]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
});

/**
 * The Record screen's toolbar (T11.1, P10-F3, Draft 2.13 §13.7).
 *
 * The Phase 10 verification found it failing the toolbar rule three ways: the
 * title truncated to two letters, the gateway select overflowed its box onto
 * two clipped lines, and Accept, Re-pick and Reject were enabled with no
 * session open although `availableWhen` says otherwise. Draft 2.13's answer:
 *
 * > a toolbar title keeps at least twelve characters and the toolbar sheds
 * > secondary controls into the palette before that; a select never exceeds one
 * > line; buttons render the model's `availableWhen`.
 *
 * Measured at two widths, because the rule is about what happens when the bar
 * runs out of room: 1440 px is the window the artboards are drawn at, and
 * 1100 px is a laptop with the app not maximised — the width the Phase 10
 * screenshots were taken at, and the one the title was two letters at.
 *
 * The width is applied with a `<style>` on `.sv-app` rather than by resizing
 * the window: the renderer is attached over CDP and has no control of the
 * Electron window, and the layout is the same either way — every pane inside
 * the shell is sized from its container.
 */
async function atWidth<T>(px: number, read: () => Promise<T>): Promise<T> {
  /*
   * The renderer's own viewport, through the DevTools protocol.
   *
   * Not a `<style>` on `.sv-app`: forcing the application wider than the window
   * it is in makes `scrollWidth` a measure of the *window's* overflow rather
   * than the toolbar's, and the numbers then say nothing about the rule. This
   * is what a person dragging the window's corner does, as far as the layout is
   * concerned — and `Emulation.setDeviceMetricsOverride` is available over the
   * same CDP session the whole of this file drives the app through.
   */
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: px,
    height: 860,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // One frame, so the `ResizeObserver` in `Toolbar` has run.
  await page.waitForTimeout(300);
  try {
    return await read();
  } finally {
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await cdp.detach();
    await page.waitForTimeout(200);
  }
}

test("the Record screen's toolbar keeps its title, its select and availableWhen (P10-F3)", async () => {
  await goToMode("record");
  await expect(page.locator("#record-gateway")).toBeVisible({ timeout: 60_000 });

  for (const width of [1440, 1100]) {
    const measured = await atWidth(width, async () =>
      page.evaluate(() => {
        const bar = document.querySelector(".sv-toolbar") as HTMLElement;
        const title = bar.querySelector(".sv-toolbar-title") as HTMLElement;
        const select = document.querySelector("#record-gateway") as HTMLElement | null;
        const shed = bar.querySelector(".sv-toolbar-shed") as HTMLElement | null;
        const line = parseFloat(getComputedStyle(bar).fontSize) * 1.6;
        return {
          barHeight: bar.getBoundingClientRect().height,
          overflow: bar.scrollWidth - bar.clientWidth,
          titleText: (title.textContent ?? "").trim(),
          // How many characters actually fit, from the width the box has.
          titleFits: Math.floor(
            title.clientWidth / (title.scrollWidth / Math.max(1, (title.textContent ?? "").length)),
          ),
          select:
            select === null
              ? null
              : {
                  height: select.getBoundingClientRect().height,
                  lines: Math.round(select.getBoundingClientRect().height / line),
                  right: select.getBoundingClientRect().right,
                  inside: select.getBoundingClientRect().right <= bar.getBoundingClientRect().right + 1,
                },
          shedText: (shed?.textContent ?? "").trim(),
          buttons: [...bar.querySelectorAll("button")]
            .filter((one) => !(one as HTMLElement).hidden)
            .map((one) => ({
              id: one.id,
              label: (one.textContent ?? "").trim(),
              disabled: (one as HTMLButtonElement).disabled,
              right: one.getBoundingClientRect().right,
              inside:
                one.getBoundingClientRect().right <= bar.getBoundingClientRect().right + 1,
            })),
        };
      }),
    );

    // 1. The bar is one row and nothing is off its end.
    expect(measured.barHeight, `${width}px: the toolbar is ${measured.barHeight}px tall`)
      .toBeLessThanOrEqual(48);
    expect(measured.overflow, `${width}px: the toolbar overflows by ${measured.overflow}px`)
      .toBeLessThanOrEqual(1);
    for (const button of measured.buttons) {
      expect(button.inside, `${width}px: "${button.label}" is off the end of the toolbar`).toBe(
        true,
      );
    }

    // 2. Twelve characters of title, at least.
    expect(
      measured.titleFits,
      `${width}px: the title "${measured.titleText}" has room for ${measured.titleFits} characters`,
    ).toBeGreaterThanOrEqual(12);

    // 3. The gateway select is one line, inside the bar.
    expect(measured.select, `${width}px: the Record toolbar has no gateway select`).not.toBeNull();
    expect(measured.select!.lines, `${width}px: the select is ${measured.select!.height}px tall`)
      .toBe(1);
    expect(measured.select!.inside, `${width}px: the select runs past the toolbar`).toBe(true);

    /*
     * 4. `availableWhen`, rendered. No session is open on this screen, so the
     *    three decision actions are unavailable and the buttons say so — which
     *    is the difference between a control a person can press to no effect
     *    and a control that tells them why not.
     */
    for (const id of ["action-record-accept", "action-record-repick", "action-record-reject"]) {
      const button = measured.buttons.find((one) => one.id === id);
      if (button === undefined) {
        // Shed into the palette at this width, which is the other half of the
        // rule and is checked below.
        continue;
      }
      expect(button.disabled, `${width}px: ${id} is enabled with no session open`).toBe(true);
    }
  }
});

test("a toolbar that runs out of room sheds into the palette, and says so (P10-F3)", async () => {
  await goToMode("record");
  await expect(page.locator("#record-gateway")).toBeVisible({ timeout: 60_000 });

  const read = async () =>
    await page.evaluate(() => {
      const bar = document.querySelector(".sv-toolbar") as HTMLElement;
      const title = bar.querySelector(".sv-toolbar-title") as HTMLElement;
      const buttons = [...bar.querySelectorAll<HTMLElement>("[data-toolbar-action]")];
      return {
        barWidth: bar.clientWidth,
        height: bar.getBoundingClientRect().height,
        overflow: bar.scrollWidth - bar.clientWidth,
        hidden: buttons.filter((one) => one.hidden).map((one) => one.id),
        secondary: buttons
          .filter((one) => one.dataset["toolbarSecondary"] === "true")
          .map((one) => one.id),
        shedText: (bar.querySelector(".sv-toolbar-shed")?.textContent ?? "").trim(),
        titleWidth: title.clientWidth,
        titleFloor: parseFloat(getComputedStyle(title).minWidth),
      };
    });

  /*
   * Swept rather than asserted at a width somebody guessed.
   *
   * How wide the window has to be before a bar runs out of room depends on the
   * rail, the inspector and the length of the screen's own labels, and a test
   * that hard-coded one number would be a test of this month's wording. What is
   * *invariant* is stated below, at every width: the bar never overflows, the
   * title never goes under its floor, the hint counts what went, and a primary
   * is never shed while a secondary is still on the bar.
   */
  const widths = [1900, 1700, 1500, 1300, 1100, 900, 760];
  const seen: Array<Awaited<ReturnType<typeof read>> & { width: number }> = [];
  for (const width of widths) {
    seen.push({ width, ...(await atWidth(width, read)) });
  }

  for (const one of seen) {
    /*
     * The bar fits at every width the rule is about (F3 names 1440 and 1100).
     * Below that the workspace column is narrower than a twelve-character title
     * and a usable control put together, and `overflow: hidden` clips — which
     * is the Draft 2.12 rule ("a toolbar never wraps its buttons: a long title
     * truncates") reaching its own floor. What must hold at *every* width is
     * that it is still one row and the title still has its twelve characters.
     */
    if (one.width >= 1100) {
      expect(one.overflow, `${one.width}px: the toolbar overflows by ${one.overflow}px`)
        .toBeLessThanOrEqual(1);
    }
    /*
     * One row above the responsive breakpoint; below it, wrapping is the fix
     * and not the failure (T18, SF-18).
     *
     * Wave 3's eighth defect was that at 200% zoom — 1440×1000 and 1280×800
     * have 720 and 640 CSS pixels there — the rail, the inspector and the
     * toolbar's own controls sat on top of each other and **Recheck targets**
     * was clipped off the right. The fix was `@media (max-width: 960px)` in
     * `shell.css`: below that width the toolbar wraps instead of clipping.
     *
     * This assertion is older than that fix and said "one row at every width",
     * which is the Draft 2.12 rule reaching past its own floor. It was never
     * re-run against the change, because the packaged build the suite needs
     * could not be produced (see T18's first defect) and every case here
     * skipped. So it is stated as the rule now is: one row while there is room
     * for one, and a bar that grows rather than one that hides its controls.
     */
    if (one.width > 960) {
      expect(one.height, `${one.width}px: the toolbar wrapped to ${one.height}px`)
        .toBeLessThanOrEqual(48);
    } else {
      expect(
        one.overflow,
        `${one.width}px: the toolbar clipped by ${one.overflow}px instead of wrapping`,
      ).toBeLessThanOrEqual(1);
    }
    expect(one.titleWidth, `${one.width}px: the title is under its floor`)
      .toBeGreaterThanOrEqual(one.titleFloor - 1);
    expect(one.shedText, `${one.width}px: the hint does not count what went`).toBe(
      one.hidden.length === 0 ? "⌘K +0" : `⌘K +${one.hidden.length}`,
    );
    // Secondary before primary, always.
    const shedAPrimary = one.hidden.some((id) => !one.secondary.includes(id));
    if (shedAPrimary) {
      for (const id of one.secondary) {
        expect(one.hidden, `${one.width}px: ${id} is on a bar that shed a primary`).toContain(id);
      }
    }
  }

  /*
   * The sweep has to actually bite, or it says nothing — and it bites *where
   * the bar is one row* (T18, SF-18).
   *
   * Shedding is what a bar does when it runs out of room. Below 960px it no
   * longer runs out: `shell.css` wraps it, which is wave 3's fix for the
   * controls that sat on top of each other at 200% zoom. So the narrowest width
   * in this sweep now sheds *nothing*, and that is the better behaviour — every
   * control is on the bar and reachable. The claim that has to hold is the one
   * P10-F3 makes: somewhere in the range where the bar is a single row, it runs
   * out of room, sheds, and says how many went.
   */
  const oneRow = seen.filter((one) => one.width > 960);
  const roomy = oneRow.find((one) => one.hidden.length === 0);
  expect(
    roomy,
    `every one-row width shed something: ${JSON.stringify(seen.map((o) => [o.width, o.barWidth, o.hidden.length]))}`,
  ).toBeDefined();
  const tightest = oneRow.at(-1)!;
  expect(
    tightest.hidden.length,
    `nothing was ever shed while the bar was one row: ${JSON.stringify(oneRow.map((o) => [o.width, o.hidden.length]))}`,
  ).toBeGreaterThan(0);

  // And what went is in the palette, which is where the bar said it was.
  await atWidth(tightest.width, async () => undefined);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  for (const id of tightest.hidden) {
    await expect(palette.locator(`#palette-${id.replace(/^action-/, "")}`)).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
});

/**
 * K6 — the flow editor edits and saves, and the save is re-linted (T11.1).
 *
 * The Phase 10 verification: "a release cannot ship an 'editor' that does not
 * edit." Phase 9 and Phase 10 shipped this read-only with a reason, and the
 * reason has run out.
 *
 * Driven through the screen's own controls on the packaged application, against
 * a real service and a real project: Edit, type, Save, and then the *lint pane*
 * — which is the point of "with lint on save". A flow with a line the compiler
 * refuses has to come back with a diagnostic on that line, not with a silent
 * write; and undoing it has to make the diagnostic go away.
 */
test("a flow is edited and saved through the app, and re-linted (K6)", async () => {
  page = await livePage();

  /*
   * The row whose *name* is exactly `simple.flow`, and then a wait for the
   * editor to be showing it.
   *
   * `getByText("simple.flow")` matches a row whose secondary line mentions it,
   * and clicking a row is a request the screen answers with a load — so a test
   * that typed into the editor straight afterwards could type into the file it
   * had just navigated away from.
   */
  const open = async (name: string): Promise<void> => {
    await page.locator("#rail-flows").click();
    await page
      .locator("#flows-list .sv-flow-name")
      .filter({ hasText: new RegExp(`^${name}$`) })
      .first()
      .click();
    await expect(page.locator("#flows-tabs")).toContainText(name, { timeout: 60_000 });
  };

  await open("simple.flow");
  await expect(page.locator("#flows-editor")).toBeVisible({ timeout: 60_000 });

  // Read is what opens: the annotated view, with the gutter and the notes.
  await expect(page.locator("#flows-editor-text")).toHaveCount(0);
  await page.locator("#flows-edit").click();
  const editor = page.locator("#flows-editor-text");
  await expect(editor).toBeVisible();

  const before = await editor.inputValue();
  expect(before, "the editor opened on an empty file").not.toBe("");
  // The text is the *file*, not a round trip through the annotated lines: a
  // line count that disagrees would be an editor that silently reformats.
  const lines = await page.locator("#flows-editor .sv-code-line").count();
  expect(before.split("\n").length).toBeGreaterThanOrEqual(lines - 1);

  /*
   * A step no compiler can bind, appended to the first story. The lint pane has
   * to say so, on that line, after the save — which is the difference between
   * "the file was written" and "the project was re-read".
   */
  const broken = `${before.trimEnd()}\n  Frobnicate the widget\n`;
  await editor.fill(broken);
  await expect(page.locator(".sv-toolbar").getByText("unsaved")).toBeVisible();

  await page.locator("#action-flows-save").click();
  await expect(page.locator("#status-context")).toContainText(/Saved/, { timeout: 60_000 });

  // Re-linted: the diagnostic is in the pane, and it is about the new line.
  await expect
    .poll(async () => await page.locator("#flows-lint li").allTextContents(), { timeout: 60_000 })
    .toEqual(expect.arrayContaining([expect.stringContaining("Frobnicate")]));

  // On disk, which is what `PUT /flows/:file` is for: re-opened from the
  // service, the file has the line.
  await page.locator("#rail-runs").click();
  await open("simple.flow");
  await page.locator("#flows-edit").click();
  await expect(page.locator("#flows-editor-text")).toHaveValue(broken);

  // And put back, so the fixtures project this suite copied is as it was.
  await page.locator("#flows-editor-text").fill(before);
  await page.locator("#action-flows-save").click();
  await expect(page.locator("#status-context")).toContainText(/Saved/, { timeout: 60_000 });
  await expect
    .poll(async () => await page.locator("#flows-lint li").allTextContents(), { timeout: 60_000 })
    .not.toEqual(expect.arrayContaining([expect.stringContaining("Frobnicate")]));
});

/**
 * K7 — the API screen edits a saved request and saves it (T11.1).
 *
 * Same finding, other screen: the API client could *send* a saved request and
 * not change one, so the only way to fix a header was a text editor outside the
 * APP_DIR. `PUT /api/:name` writes `api/<name>.yaml`, which is the file an `api`
 * step reads — so what is edited here is what a run will send.
 */
test("a saved API request is edited and saved through the app (K7)", async () => {
  page = await livePage();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await page.locator("#palette-go-api").click();
  await expect(page.locator("#api-requests")).toBeVisible({ timeout: 60_000 });

  const first = page.locator("#api-requests tbody tr").first();
  await first.click();
  await expect(page.locator("#api-url")).toBeVisible();

  const url = await page.locator("#api-url").inputValue();
  expect(url, "the API screen opened on a request with no URL").not.toBe("");

  // A header the request did not have: the blank last row is how one is added.
  const rows = await page.locator("#api-headers .sv-header-row").count();
  await page.locator(`#api-header-key-${rows - 1}`).fill("X-Yam-Test");
  await page.locator(`#api-header-value-${rows - 1}`).fill("k7");
  await expect(page.locator(".sv-toolbar").getByText("unsaved")).toBeVisible();

  await page.locator("#action-api-save").click();
  await expect(page.locator("#status-context")).toContainText(/Saved/, { timeout: 60_000 });

  // Re-read from the service: it is on disk, in `api/<name>.yaml`.
  await page.locator("#rail-flows").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await page.locator("#palette-go-api").click();
  await page.locator("#api-requests tbody tr").first().click();
  await expect
    .poll(
      async () =>
        await page.locator("#api-headers .sv-header-row input[value='X-Yam-Test']").count(),
      { timeout: 60_000 },
    )
    .toBe(1);
});
