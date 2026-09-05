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

/** Injected by Electron Forge's Vite plugin. */
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let window_: BrowserWindow | undefined;
let service: RunningService | undefined;
let preferences: Preferences = DEFAULT_PREFERENCES;

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
    ? [join(process.resourcesPath, "svatah", "bin.js")]
    : [resolve(app.getAppPath(), "..", "..", "packages", "cli", "dist", "bin.js")];

  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error(
    `Could not find the svatah CLI. Looked in:\n  ${candidates.join("\n  ")}\n` +
      "Set SVATAH_CLI to its `bin.js`, or run `pnpm -r build` in the workspace.",
  );
}

async function openProject(directory: string): Promise<ServiceConnection> {
  await closeProject();

  const started = await startOrAdopt({
    project: resolve(directory),
    userDataDir: app.getPath("userData"),
    cli: cliPath(),
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

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL !== undefined) {
    void window_.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window_.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
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
      `stories=${summary.stories.length} window=${window_ === undefined ? "none" : "open"}\n`,
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
