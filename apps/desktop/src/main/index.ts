/**
 * The app's main process (T3.6, REQ-ADE-2, 6, 7, LLD §13.6).
 *
 * A window, a project chooser, the service's lifecycle, and the accessibility
 * flag. Four things, and the shortness is the design: everything a person does
 * in the app happens over HTTP to the local service, so the main process is the
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
 * Navigation and window opening are both refused. An app that could be navigated
 * to a URL would be a browser with the app's privileges, and nothing it shows
 * needs one: every screen renders a service response or a project file.
 *
 * ## Accessibility (REQ-ADE-6, ADR-17)
 *
 * `app.setAccessibilitySupportEnabled(true)` under `YAM_A11Y=1` or in
 * development. The app is the conformance target for the UIA and AX adapters
 * (REQ-ADP-6, 7), and an Electron app that has not been told to expose its
 * accessibility tree exposes almost nothing to either.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_PREFERENCES,
  preferencesPath,
  readPreferences,
  withRecentProject,
  writePreferences,
  type Preferences,
} from "./preferences.js";
import { openDebugLog, type DebugLog } from "./debug.js";
import { startOrAdopt, type RunningService, type ServiceConnection } from "./service.js";
import {
  describeRuntime,
  resolveNodeRuntime,
  runtimeNotFoundMessage,
  type NodeRuntime,
} from "@svatah/yam-service/runtime";

/** Injected by Electron Forge's Vite plugin. */
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let window_: BrowserWindow | undefined;
let service: RunningService | undefined;
let preferences: Preferences = DEFAULT_PREFERENCES;
/** The runtime the last `openProject` chose, for the smoke check's line. */
let runtime_: NodeRuntime | undefined;
/**
 * Whether what is open is the private surfaces workspace rather than a project
 * (T14, T17). Kept beside the service so `serviceInfo` answers with it too — a
 * renderer that had to infer it from the path would be guessing.
 */
let projectless_ = false;
/**
 * The window-lifecycle log (Draft 2.13 §13.6, P10-F1).
 *
 * Off until `whenReady` has a user-data directory to put it in, and off
 * entirely without `YAM_APP_DEBUG=1`.
 */
let debug: DebugLog = Object.assign((): void => undefined, { enabled: false as const });

/**
 * Where `yam` is.
 *
 * In development it is the workspace's built CLI. In a packaged build it is
 * bundled beside the app. `YAM_CLI` overrides both, which is what the tests
 * and a developer with a checkout elsewhere use.
 */
function cliPath(): string {
  const configured = process.env["YAM_CLI"];
  if (configured !== undefined && configured !== "") return configured;

  const candidates = app.isPackaged
    ? [
        // Where `scripts/stage-app-cli.mjs` puts the deployed CLI, which Forge
        // copies into `Resources/yam` as an `extraResource` (T8.1).
        join(process.resourcesPath, "yam", "dist", "bin.js"),
        join(process.resourcesPath, "yam", "bin.js"),
      ]
    : [resolve(app.getAppPath(), "..", "..", "packages", "cli", "dist", "bin.js")];

  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error(
    `Could not find the yam CLI. Looked in:\n  ${candidates.join("\n  ")}\n` +
      "Set YAM_CLI to its `bin.js`, or run `pnpm -r build` in the workspace.",
  );
}

/**
 * Which Node runs the CLI (Draft 2.9 LLD §13.6, T8.1).
 *
 * Never `process.execPath`. Packaged, that is this application with the
 * `RunAsNode` fuse off, and spawning it produced a second APP_DIR that printed no
 * handshake — the defect the whole of T8.1 is about. The three places §13.6
 * names are tried in order and the failure names all three, because the person
 * who sees it is looking at an application and has no terminal to read.
 */
function nodeRuntime(cli: string): NodeRuntime {
  const resolution = resolveNodeRuntime({ cli });
  if (resolution.runtime === undefined) throw new Error(runtimeNotFoundMessage(resolution.attempts));
  return resolution.runtime;
}

/**
 * The `openProject` that has not finished yet (P10-F1).
 *
 * A quit while a project is opening used to leave the `yam serve` behind:
 * `before-quit` looked at `service`, which is only assigned once the handshake
 * has come back, saw `undefined`, and let the application go. The desktop gate
 * quits the app as soon as its window is up — about a second after ready, and
 * two seconds before the service is listening — so that was one orphaned
 * service per launch, each holding the project's `runs/` directory.
 */
let opening: Promise<unknown> | undefined;

async function openProject(directory: string, remember = true): Promise<ServiceConnection> {
  const attempt = openProjectNow(directory, remember);
  opening = attempt;
  try {
    return await attempt;
  } finally {
    if (opening === attempt) opening = undefined;
  }
}

async function openProjectNow(directory: string, remember = true): Promise<ServiceConnection> {
  debug("project.opening", { directory, replacing: service !== undefined });
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
  debug("project.opened", {
    directory,
    adopted: started.connection.adopted,
    // Never the URL: it is the token's other half (REQ-NFR-6).
    port: new URL(started.connection.url).port,
  });
  /*
   * The private surfaces workspace is not a project (T14): it is where the
   * service listens so Surfaces can reach the broker with no project open, and
   * it must not land in the Recent list beside the projects a person chose.
   */
  if (remember) {
    preferences = withRecentProject(preferences, resolve(directory));
    writePreferences(preferencesPath(app.getPath("userData")), preferences);
  }

  // `remember` is false exactly for the private surfaces workspace, which is
  // what makes it not a project (T17).
  projectless_ = !remember;
  return { ...started.connection, projectless: projectless_ };
}

/**
 * Where the projectless service listens (T14, SF-01, SF-02).
 *
 * Surfaces opens with no project. The service still needs a working directory —
 * it is where a project *would* be loaded from if one were opened — so it gets a
 * private, empty one under the user-data directory. Surfaces reaches the broker
 * through the catalogue routes only, so nothing is ever written here: an
 * empty-directory connect leaves no project files behind (SF-01).
 */
function surfacesWorkspace(): string {
  const dir = join(app.getPath("userData"), "workspace");
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function closeProject(): Promise<void> {
  const current = service;
  service = undefined;
  if (current === undefined) return;
  debug("project.closing", { port: new URL(current.connection.url).port });
  await current.stop();
  debug("project.closed");
}

function createWindow(): void {
  debug("window.creating", {
    width: preferences.window.width,
    height: preferences.window.height,
    packaged: app.isPackaged,
    a11y: process.env["YAM_A11Y"] ?? "",
    variant: process.env["YAM_A11Y_VARIANT"] ?? "0",
  });
  window_ = new BrowserWindow({
    width: preferences.window.width,
    height: preferences.window.height,
    title: "Yam",
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
   * What the window did, in the application's own words (Draft 2.13 §13.6,
   * P10-F1).
   *
   * The finding this answers was "the packaged app runs without a window", and
   * every probe that produced it was outside the application — a System Events
   * count, an `AXWindows` read. Neither can tell "Electron never made a window"
   * apart from "Electron made one and this host will not show it to an
   * accessibility client", and those two send a reader to opposite ends of the
   * system. From here on the application says which it was.
   */
  const say = (event: string, extra: Record<string, unknown> = {}): void => {
    const target = window_;
    debug(event, {
      ...(target === undefined || target.isDestroyed()
        ? { window: "gone" }
        : {
            id: target.id,
            visible: target.isVisible(),
            minimized: target.isMinimized(),
            bounds: target.getBounds(),
          }),
      ...extra,
    });
  };

  window_.once("ready-to-show", () => say("window.ready-to-show"));
  window_.on("show", () => say("window.show"));
  window_.on("hide", () => say("window.hide"));
  window_.on("focus", () => say("window.focus"));
  window_.on("closed", () => debug("window.closed"));
  window_.webContents.on("did-finish-load", () => say("renderer.did-finish-load"));
  window_.webContents.on("did-fail-load", (_event, code, description, url) =>
    say("renderer.did-fail-load", { code, description, url }),
  );
  window_.webContents.on("render-process-gone", (_event, details) =>
    say("renderer.gone", { reason: details.reason, exitCode: details.exitCode }),
  );
  window_.on("unresponsive", () => say("window.unresponsive"));

  /*
   * `YAM_A11Y_VARIANT=1|2` (Draft 2.8 LLD §16, T7.1).
   *
   * The desktop healing cases need the same window with one thing changed —
   * variant 1 renames a tab and a button, variant 2 moves the Record screen's
   * gateway control into another panel — so a binding recorded at variant 0 can
   * be *measured* against them through the desktop adapter.
   *
   * It reaches the renderer on the URL rather than through the preload bridge,
   * because LLD §13.6 says that bridge exposes four functions and only those
   * four; widening the app's narrowest surface for a test fixture would be the
   * wrong trade.
   */
  const variant = process.env["YAM_A11Y_VARIANT"];
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

ipcMain.handle("app:openProject", async (_event, directory: unknown) => {
  if (typeof directory !== "string" || directory === "") {
    throw new Error("openProject needs a directory.");
  }
  return await openProject(directory);
});

ipcMain.handle("app:serviceInfo", () =>
  service === undefined ? null : { ...service.connection, projectless: projectless_ },
);

ipcMain.handle("app:pickFile", async (_event, kind: unknown) => {
  const directory = kind === "directory";
  const result = await dialog.showOpenDialog(window_!, {
    title: directory ? "Open a Yam project" : "Choose a file",
    properties: [directory ? "openDirectory" : "openFile"],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle("app:preferences", (_event, next: unknown) => {
  if (next !== undefined && next !== null) {
    preferences = { ...preferences, ...(next as Partial<Preferences>) };
    writePreferences(preferencesPath(app.getPath("userData")), preferences);
  }
  return preferences;
});

/**
 * The smoke check (`YAM_APP_SMOKE=<project>`).
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
    `yam smoke ok project=${summary.root} flows=${summary.flows.length} ` +
      `stories=${summary.stories.length} window=${window_ === undefined ? "none" : "open"} ` +
      // §13.6: "`yam surface doctor` and the app's own smoke check report
      // which runtime was chosen." Without it the check passes identically
      // whether the app ran the CLI with a Node or with itself, which is the
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
  debug = openDebugLog(app.getPath("userData"));
  debug("app.ready", {
    packaged: app.isPackaged,
    version: process.versions["electron"] ?? "",
    userData: app.getPath("userData"),
    execPath: process.execPath,
  });

  preferences = readPreferences(preferencesPath(app.getPath("userData")));

  // REQ-ADE-6: the app is the desktop conformance target, and an Electron app
  // has to be told to publish its accessibility tree before UIA or AX can see it.
  if (process.env["YAM_A11Y"] === "1" || !app.isPackaged) {
    app.setAccessibilitySupportEnabled(true);
    debug("app.accessibility-enabled");
  }

  createWindow();

  const project = process.env["YAM_APP_SMOKE"];
  if (project !== undefined && project !== "") {
    void smoke(project).catch((error: unknown) => {
      process.stderr.write(`yam smoke failed: ${String(error)}\n`);
      app.exit(1);
    });
    return;
  }

  /*
   * `YAM_APP_PROJECT=<dir>` opens a project on ready (Draft 2.9 §13.6, T8.1).
   *
   * "The desktop conformance gate passes the fixtures project this way, so its
   * cases read a project screen rather than the welcome screen." Phase 7's gate
   * launched the app and then asked for controls that only exist once a project
   * is open, and every flow case failed on a screen that could not have them.
   *
   * It goes through the same `openProject` the Recent list does — not a second
   * path — and its answer reaches the renderer on `service:opened`, because the
   * window is created before this resolves and the renderer's own
   * `serviceInfo()` would otherwise race it.
   */
  /*
   * Held until the renderer has loaded. A `send` to a page that is still
   * loading is dropped, and the service usually opens faster than the window
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

  const startup = process.env["YAM_APP_PROJECT"];
  if (startup !== undefined && startup !== "") {
    /*
     * `YAM_APP_PROJECT=<dir>` opens a project on ready (§13.6, T8.1): the
     * desktop gate passes the fixtures project this way so its cases read a
     * project screen rather than the welcome screen.
     */
    void openProject(startup).then(
      (connection) => announce({ connection }),
      (error: unknown) => announce({ error: error instanceof Error ? error.message : String(error) }),
    );
  } else {
    /*
     * No project named: open Surfaces on a projectless service (T14, SF-02).
     * Yam's first screen is "connect to something", not a project chooser — so
     * the app comes up on the private surfaces workspace, and a person opens a
     * project only when they go to Automations. The workspace is not remembered.
     */
    void openProject(surfacesWorkspace(), false).then(
      (connection) => announce({ connection }),
      (error: unknown) => announce({ error: error instanceof Error ? error.message : String(error) }),
    );
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  debug("app.window-all-closed");
  // Quitting stops the service (T3.6: "killing the app stops the service").
  if (process.platform !== "darwin") app.quit();
});

/* ── the graceful quit route (Draft 2.13 §13.6, §13.9, P10-F1) ───────────── */

/**
 * How long the app spends putting the project down before it goes anyway.
 *
 * `before-quit` refuses the quit, stops the service and quits again. A service
 * that will not stop used to make that a quit that never happened: the
 * application stayed up, the caller escalated to a signal, and the point of a
 * graceful route — that the service is stopped and the preferences are written —
 * was lost exactly when it mattered.
 */
const QUIT_GRACE_MS = 8_000;

let quitting = false;

app.on("before-quit", (event) => {
  debug("app.before-quit", {
    service: service !== undefined,
    opening: opening !== undefined,
    quitting,
  });
  if ((service === undefined && opening === undefined) || quitting) return;
  quitting = true;
  event.preventDefault();

  const finish = (why: string): void => {
    debug("app.quit-finishing", { why });
    writePreferences(preferencesPath(app.getPath("userData")), preferences);
    app.quit();
  };

  const timer = setTimeout(() => finish("grace-expired"), QUIT_GRACE_MS);
  timer.unref?.();
  /*
   * A project that is still opening is waited for and then closed. Not
   * abandoned: the service it is starting has no lock file yet, so nothing
   * that came afterwards could have found it to stop it.
   */
  void Promise.resolve(opening)
    .catch(() => undefined)
    .then(() => closeProject())
    .then(
      () => {
        clearTimeout(timer);
        finish("service-stopped");
      },
      (error: unknown) => {
        clearTimeout(timer);
        debug("app.quit-service-error", { error: String(error) });
        finish("service-error");
      },
    );
});

app.on("will-quit", () => debug("app.will-quit"));

/**
 * A signal is a quit request, not a kill (Draft 2.13 §13.9's `app.quit`:
 * "a graceful route, then a signal").
 *
 * Node's default `SIGTERM` handling ends the process where it stands, so
 * `before-quit` never ran, the preferences were never written, and the
 * `yam serve` the app had spawned was left with no parent to stop it — a
 * `pkill` of the app left a service holding a project's `runs/` directory. The
 * signal runs the same route the menu's Quit does; a caller that means "die
 * now" still has `SIGKILL`, which nothing can catch and nothing should.
 */
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(signal, () => {
    debug("app.signal", { signal });
    app.quit();
  });
}

export { cliPath, openProject, closeProject };
