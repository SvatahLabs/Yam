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
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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

/**
 * Any ADE this checkout left running, gone before this one starts.
 *
 * The same defect the desktop gate has (P8-F1): a build from a previous run that
 * is still up holds `DEBUG_PORT`, so the new one cannot bind its DevTools
 * endpoint and `connectOverCDP` attaches to the *old* application — which then
 * fails tests about code it does not have. Matching on this checkout's own
 * `apps/ade/out` path means a Svatah ADE somebody has open from elsewhere is
 * left alone.
 */
function stopLeftovers(): void {
  if (executable === undefined || process.platform === "win32") return;
  const listed = spawnSync("pgrep", ["-f", executable], { encoding: "utf8" });
  const pids = (listed.stdout ?? "")
    .split("\n")
    .map((one) => Number(one.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // It went on its own between the list and the signal, which is the
      // outcome this wanted.
    }
  }
}

test.beforeAll(async () => {
  if (executable === undefined) return;
  if (!existsSync(CLI)) throw new Error("Run `pnpm -r build` first.");

  stopLeftovers();
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
  // SIGTERM asks; this checks. An Electron main that is mid-quit outlives the
  // signal, and the next run of this file is what pays for it.
  stopLeftovers();
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
  const until = Date.now() + 60_000;
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
        `The ADE never settled on a window: ${last instanceof Error ? last.message : String(last)}`,
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

  // And the eleven tabs are not anywhere: T10.3 deleted them.
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
   * `record.start` goes to the Record review, which T10.1 built — so the shell
   * shows it rather than falling back to anything. Back to Flows for the run.
   */
  page = await livePage();
  await expect(page.getByRole("heading", { name: "Record review" })).toBeVisible({
    timeout: 60_000,
  });
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
  // different `selected` — the same thing `svatah ui` does with Enter.
  await steps.first().click();
  await expect(page.locator("#inspector-step")).toBeVisible();
});

/*
 * P9-F5, Draft 2.12 §13.7 — the three polish defects the verification found on
 * this screen, each checked on the packaged application.
 */
test("the Run toolbar keeps its buttons on one line, however long the title", async () => {
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
  await showRunScreen();
  await expect(page.locator(".sv-audit li").first()).toBeVisible({ timeout: 60_000 });
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
  page = await livePage();

  // Start one from the Flows screen, as a person does.
  await page.locator("#rail-flows").click();
  await page.locator("#flows-list").getByText("guards-and-compensation.flow").click();
  await page.locator("#action-run-flow").click();
  await expect(page.getByRole("heading", { name: /^Run / })).toBeVisible({ timeout: 180_000 });

  const stop = page.locator("#action-run-stop");
  await expect(stop).toBeVisible();
  await expect(stop).toContainText("Stop");

  /*
   * Pressed as soon as the button is live. `run.stop`'s `availableWhen` is the
   * model's `live`, so an enabled Stop *is* the screen saying there is a run to
   * stop — which is a better signal to wait for than a step row, and is the
   * thing the button's contract is about.
   */
  await expect(stop).toBeEnabled({ timeout: 180_000 });
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
  await expect(palette.getByText("svatah bindings verify")).toBeVisible();

  // It filters, and it closes.
  await palette.getByLabel("Search or run a command").fill("heal");
  await expect(palette.getByText("svatah heal --run <id>")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

/**
 * T10.1 and T10.2's Validate — "each screen driven end to end through its own
 * controls in the ADE under Playwright … every control named and id'd".
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
    await palette.getByLabel("Search or run a command").fill(`Go to ${label}`);
    await palette.getByText(`Go to ${label}`, { exact: true }).first().click();
    await expect(palette).toBeHidden();
  }
  await expect(page.getByRole("heading", { name: label, exact: false })).toBeVisible({
    timeout: 60_000,
  });
}

test.describe("every screen (T10.1, T10.2)", () => {
  const SCREENS: ReadonlyArray<[string, string]> = [
    ["flows", "Flows"],
    ["runs", "Runs"],
    ["bindings", "Bindings"],
    ["agents", "Agents and tools"],
    ["api", "API"],
    ["data", "Data"],
    ["import", "Import prototype database"],
    ["settings", "Settings"],
    ["record", "Record review"],
    ["run", "Run"],
    ["heal", "Heal review"],
    ["explorer", "Surface explorer"],
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
  const behavior = page.locator("#runs-filter-behavior");
  await expect(behavior).toContainText("behavior: all");
  await behavior.click();
  await expect(behavior).not.toContainText("behavior: all");
  // And back, so the rest of this file sees the screen it expects.
  await behavior.click();
  await expect(behavior).toContainText("behavior: all");

  // Choosing a run fills the inspector with what that run wrote.
  await page.locator("#runs-table tbody tr").first().click();
  await expect(page.locator("#inspector-run")).toBeVisible();
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
  await goTo("record", "Record review");
  const gateway = page.locator("#record-gateway");
  await expect(gateway).toBeVisible();
  // No credential on this service, so the screen offers what it can do.
  await expect(page.locator("#record-fake-gateway")).toContainText("evals/grounding/cases");
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
  await expect(page.locator("#data-table")).toContainText("SVATAH_SAMPLE_PASSWORD");
  await page.locator("#data-table tbody tr").first().click();
  await expect(page.locator("#inspector-value")).toBeVisible();
});

test("the Surface explorer refuses a call with no intent", async () => {
  await goTo("explorer", "Surface explorer");
  // The alert is on the screen while the intent is empty (REQ-BEH-4).
  await expect(page.locator("#explorer-intent-required")).toBeVisible();
  await page.getByLabel("Intent").fill("look at the booking page");
  await expect(page.locator("#explorer-intent-required")).toHaveCount(0);
  await expect(page.locator("#explorer-adapter")).toBeVisible();
});

test("the Import screen previews into the open project and nowhere else", async () => {
  await goTo("import", "Import prototype database");
  await expect(page.locator("#import-source")).toBeVisible();
  await expect(page.locator("#inspector-confinement")).toContainText("anything outside it");
  await expect(page.locator("#inspector-cli")).toContainText("svatah migrate");
});

test("the Settings screen shows the project and never a credential", async () => {
  await goTo("settings", "Settings");
  await expect(page.locator("#settings-project")).toContainText("svatah-fixtures");
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
