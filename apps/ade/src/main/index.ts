/**
 * The ADE's main process (T3.6, REQ-ADE-2, 6, 7, LLD §13.6).
 *
 * A window, a project chooser, the service's lifecycle, and the accessibility
 * flag. Four things, and the shortness is the design: everything a person does
 * in the ADE happens over HTTP to the local service, so the main process is the
 * part that makes that connection exist and then gets out of the way.
 *
 * ## Security (Electron's checklist)
 *
 * `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a
 * preload that exposes four functions. The renderer is a browser: it has no
 * `require`, no `process`, no filesystem, and its `connect-src` is loopback
 * (index.html's CSP). `test/renderer-isolation.test.ts` asserts the flags and
 * `test/security.test.ts` asserts nothing here re-opens one of the doors.
 *
 * Navigation and window opening are both refused. An ADE that could be navigated
 * to a URL would be a browser with the app's privileges, and nothing it shows
 * needs one: every screen renders a service response or a project file.
 *
 * ## Accessibility (REQ-ADE-6, ADR-17)
 *
 * `app.setAccessibilitySupportEnabled(true)` under `SVATAH_A11Y=1` or in
 * development. The ADE is the conformance target for the UIA and AX adapters
 * (REQ-ADP-6, 7), and an Electron app that has not been told to expose its
 * accessibility tree exposes almost nothing to either.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_PREFERENCES,
  preferencesPath,
  readPreferences,
  withRecentProject,
  writePreferences,
  type Preferences,
} from "./preferences.js";
import { startOrAdopt, type RunningService, type ServiceConnection } from "./service.js";
import {
  describeRuntime,
  resolveNodeRuntime,
  runtimeNotFoundMessage,
  type NodeRuntime,
} from "@svatah/service/runtime";

/** Injected by Electron Forge's Vite plugin. */
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let window_: BrowserWindow | undefined;
let service: RunningService | undefined;
let preferences: Preferences = DEFAULT_PREFERENCES;
/** The runtime the last `openProject` chose, for the smoke check's line. */
let runtime_: NodeRuntime | undefined;

/**
 * Where `svatah` is.
 *
 * In development it is the workspace's built CLI. In a packaged build it is
 * bundled beside the app. `SVATAH_CLI` overrides both, which is what the tests
 * and a developer with a checkout elsewhere use.
 */
function cliPath(): string {
  const configured = process.env["SVATAH_CLI"];
  if (configured !== undefined && configured !== "") return configured;

  const candidates = app.isPackaged
    ? [
        // Where `scripts/stage-ade-cli.mjs` puts the deployed CLI, which Forge
        // copies into `Resources/svatah` as an `extraResource` (T8.1).
        join(process.resourcesPath, "svatah", "dist", "bin.js"),
        join(process.resourcesPath, "svatah", "bin.js"),
      ]
    : [resolve(app.getAppPath(), "..", "..", "packages", "cli", "dist", "bin.js")];

  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error(
    `Could not find the svatah CLI. Looked in:\n  ${candidates.join("\n  ")}\n` +
      "Set SVATAH_CLI to its `bin.js`, or run `pnpm -r build` in the workspace.",
  );
}

/**
 * Which Node runs the CLI (Draft 2.9 LLD §13.6, T8.1).
 *
 * Never `process.execPath`. Packaged, that is this application with the
 * `RunAsNode` fuse off, and spawning it produced a second ADE that printed no
 * handshake — the defect the whole of T8.1 is about. The three places §13.6
 * names are tried in order and the failure names all three, because the person
 * who sees it is looking at an application and has no terminal to read.
 */
function nodeRuntime(cli: string): NodeRuntime {
  const resolution = resolveNodeRuntime({ cli });
  if (resolution.runtime === undefined) throw new Error(runtimeNotFoundMessage(resolution.attempts));
  return resolution.runtime;
}

async function openProject(directory: string): Promise<ServiceConnection> {
  await closeProject();

  const cli = cliPath();
  const runtime = nodeRuntime(cli);
  runtime_ = runtime;
  window_?.webContents.send("service:log", describeRuntime({ runtime, attempts: [] }));

  const started = await startOrAdopt({
    project: resolve(directory),
    userDataDir: app.getPath("userData"),
    cli,
    runtime: runtime.path,
    onLog: (line) => window_?.webContents.send("service:log", line),
  });

  service = started;
  preferences = withRecentProject(preferences, resolve(directory));
  writePreferences(preferencesPath(app.getPath("userData")), preferences);

  return started.connection;
}

async function closeProject(): Promise<void> {
  const current = service;
  service = undefined;
  await current?.stop();
}

function createWindow(): void {
  window_ = new BrowserWindow({
    width: preferences.window.width,
    height: preferences.window.height,
    title: "Svatah ADE",
    backgroundColor: "#101418",
    webPreferences: {
      // Beside the main bundle. A sandboxed preload has no ES module loader,
      // so both are CommonJS — see `vite.preload.config.ts`.
      preload: join(__dirname, "preload.js"),
      // The Electron security checklist, in three lines.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  /*
   * The renderer is not a browser tab.
   *
   * Refusing navigation and window opening means a screen cannot be turned into
   * a view of somewhere else — by a link in a flow file, a name in a project, or
   * anything else that arrives as data. An external link opens in the person's
   * own browser, where it belongs.
   */
  window_.webContents.on("will-navigate", (event, url) => {
    if (url !== window_?.webContents.getURL()) event.preventDefault();
  });
  window_.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  window_.on("resize", () => {
    const [width, height] = window_?.getSize() ?? [];
    if (width === undefined || height === undefined) return;
    preferences = { ...preferences, window: { width, height } };
  });

  /*
   * `SVATAH_A11Y_VARIANT=1|2` (Draft 2.8 LLD §16, T7.1).
   *
   * The desktop healing cases need the same window with one thing changed —
   * variant 1 renames a tab and a button, variant 2 moves the Record screen's
   * gateway control into another panel — so a binding recorded at variant 0 can
   * be *measured* against them through the desktop adapter.
   *
   * It reaches the renderer on the URL rather than through the preload bridge,
   * because LLD §13.6 says that bridge exposes four functions and only those
   * four; widening the ADE's narrowest surface for a test fixture would be the
   * wrong trade.
   */
  const variant = process.env["SVATAH_A11Y_VARIANT"];
  const query = variant === "1" || variant === "2" ? { a11yVariant: variant } : undefined;

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL !== undefined) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    if (query !== undefined) url.searchParams.set("a11yVariant", query.a11yVariant);
    void window_.loadURL(url.toString());
  } else {
    void window_.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
      ...(query === undefined ? {} : { query }),
    });
  }
}

/* ── the bridge's four functions, answered here (LLD §13.6) ───────────────── */

ipcMain.handle("ade:openProject", async (_event, directory: unknown) => {
  if (typeof directory !== "string" || directory === "") {
    throw new Error("openProject needs a directory.");
  }
  return await openProject(directory);
});

ipcMain.handle("ade:serviceInfo", () => service?.connection ?? null);

ipcMain.handle("ade:pickFile", async (_event, kind: unknown) => {
  const directory = kind === "directory";
  const result = await dialog.showOpenDialog(window_!, {
    title: directory ? "Open a Svatah project" : "Choose a file",
    properties: [directory ? "openDirectory" : "openFile"],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle("ade:preferences", (_event, next: unknown) => {
  if (next !== undefined && next !== null) {
    preferences = { ...preferences, ...(next as Partial<Preferences>) };
    writePreferences(preferencesPath(app.getPath("userData")), preferences);
  }
  return preferences;
});

/**
 * The smoke check (`SVATAH_ADE_SMOKE=<project>`).
 *
 * Open the window, open the project, ask the service what is in it, print one
 * line, and quit. It is the T3.6 Validate item — "the app opens a fixture project
 * and shows `GET /project` data; killing the app stops the service" — as a thing
 * that can be *run*, in CI, on all three platforms, without anyone watching a
 * screen.
 *
 * It exercises what a test outside Electron cannot: that the window is created
 * with the preload the build produced, that the renderer's HTML loads, and that
 * the service lifecycle survives a real quit. What it does not do is click
 * anything — that is `test/parity.test.ts`'s job, at the layer where clicking
 * would only be a proxy for a request.
 */
async function smoke(project: string): Promise<void> {
  const connection = await openProject(project);

  const response = await fetch(`${connection.url}/project`, {
    headers: { authorization: `Bearer ${connection.token}` },
  });
  if (!response.ok) throw new Error(`GET /project answered ${response.status}`);

  const summary = (await response.json()) as { root: string; flows: string[]; stories: unknown[] };
  process.stdout.write(
    `svatah-ade smoke ok project=${summary.root} flows=${summary.flows.length} ` +
      `stories=${summary.stories.length} window=${window_ === undefined ? "none" : "open"} ` +
      // §13.6: "`svatah surface doctor` and the ADE's own smoke check report
      // which runtime was chosen." Without it the check passes identically
      // whether the ADE ran the CLI with a Node or with itself, which is the
      // one thing P7-F1 was about.
      `packaged=${app.isPackaged ? "yes" : "no"} ` +
      `${describeRuntime({ ...(runtime_ === undefined ? {} : { runtime: runtime_ }), attempts: [] })}\n`,
  );

  await closeProject();
  // `app.exit` rather than `app.quit`: quit runs `before-quit`, which would try
  // to close a project that is already closed and then quit again.
  app.exit(0);
}

/* ── lifecycle ────────────────────────────────────────────────────────────── */

void app.whenReady().then(() => {
  preferences = readPreferences(preferencesPath(app.getPath("userData")));

  // REQ-ADE-6: the ADE is the desktop conformance target, and an Electron app
  // has to be told to publish its accessibility tree before UIA or AX can see it.
  if (process.env["SVATAH_A11Y"] === "1" || !app.isPackaged) {
    app.setAccessibilitySupportEnabled(true);
  }

  createWindow();

  const project = process.env["SVATAH_ADE_SMOKE"];
  if (project !== undefined && project !== "") {
    void smoke(project).catch((error: unknown) => {
      process.stderr.write(`svatah-ade smoke failed: ${String(error)}\n`);
      app.exit(1);
    });
    return;
  }

  /*
   * `SVATAH_ADE_PROJECT=<dir>` opens a project on ready (Draft 2.9 §13.6, T8.1).
   *
   * "The desktop conformance gate passes the fixtures project this way, so its
   * cases read a project screen rather than the welcome screen." Phase 7's gate
   * launched the ADE and then asked for controls that only exist once a project
   * is open, and every flow case failed on a screen that could not have them.
   *
   * It goes through the same `openProject` the Recent list does — not a second
   * path — and its answer reaches the renderer on `service:opened`, because the
   * window is created before this resolves and the renderer's own
   * `serviceInfo()` would otherwise race it.
   */
  const startup = process.env["SVATAH_ADE_PROJECT"];
  if (startup !== undefined && startup !== "") {
    /*
     * Held until the renderer has loaded. A `send` to a page that is still
     * loading is dropped, and the project usually opens faster than the window
     * paints — which would have made this work on a slow host and silently not
     * on a fast one, the worst of the two.
     */
    const announce = (payload: { connection?: ServiceConnection; error?: string }): void => {
      const target = window_;
      if (target === undefined) return;
      if (target.webContents.isLoading()) {
        target.webContents.once("did-finish-load", () =>
          target.webContents.send("service:opened", payload),
        );
      } else {
        target.webContents.send("service:opened", payload);
      }
    };
    void openProject(startup).then(
      (connection) => announce({ connection }),
      (error: unknown) => announce({ error: error instanceof Error ? error.message : String(error) }),
    );
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Quitting stops the service (T3.6: "killing the app stops the service").
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (service === undefined) return;
  event.preventDefault();
  void closeProject().then(() => {
    writePreferences(preferencesPath(app.getPath("userData")), preferences);
    app.quit();
  });
});

export { cliPath, openProject, closeProject };
