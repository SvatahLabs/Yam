#!/usr/bin/env node
/**
 * Launch and quit the packaged app, N times, and say what happened each time
 * (T11.1, T11.2, Draft 2.13 §13.6, P10-F1).
 *
 *   node scripts/app-launch-loop.mjs [--times 10] [--project evals/fixtures]
 *
 * The Phase 10 verification's F1 is "the packaged app runs without a window
 * after its first launches in a session", and its Validate is "the app launched
 * and stopped ten times in a row with a window every time". This is that, as a
 * command, so the claim is a thing a verifier re-runs rather than a paragraph.
 *
 * ## Three questions, three sources, deliberately
 *
 * 1. **Did Electron make a window?** The app's own window-lifecycle log
 *    (`YAM_APP_DEBUG=1` → `<userData>/app-debug.log`, Draft 2.13). This is
 *    the source Phase 10 did not have: every probe it used was outside the
 *    application, and none of them can tell "Electron never made a window" from
 *    "Electron made one and this host will not show it".
 * 2. **Is the window on screen?** `CGWindowList`, which is the WindowServer's
 *    own list and is not the accessibility API. A window at layer 0 is on
 *    screen whatever an accessibility client can see.
 * 3. **Can an accessibility client read it?** The same `AXRole === 'AXWindow'`
 *    test the desktop gate polls with. On a locked screen this is `no` for
 *    every application on the machine, Apple's own included, and
 *    `yam surface doctor --adapter ax` says so — which is the whole of F1.
 *
 * Keeping the three apart is the point. A run where 1 and 2 are yes and 3 is no
 * is a locked display; a run where 1 is no is the app.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};

const times = Number(option("times", "10"));
const project = resolve(option("project", join(ROOT, "evals", "fixtures")));
const cli = join(ROOT, "packages", "cli", "dist", "bin.js");
const PROCESS_NAME = "Yam";
const BUNDLE_ID = process.env["YAM_APP_BUNDLE_ID"] ?? "com.electron.yam";

const bundle = join(ROOT, "apps", "desktop", "out", "Yam-darwin-arm64", "Yam.app");
const app =
  process.platform === "darwin"
    ? join(bundle, "Contents", "MacOS", "Yam")
    : join(ROOT, "apps", "desktop", "out", "Yam-win32-x64", "Yam.exe");

/** Where Electron puts the app's user data, and so its debug log. */
const userData =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "Yam")
    : join(process.env["APPDATA"] ?? homedir(), "Yam");
const debugLog = join(userData, "app-debug.log");

if (!existsSync(app)) {
  process.stderr.write(
    `The app is not packaged (${app}).\nRun: pnpm --filter @svatah/yam-desktop package\n`,
  );
  process.exit(2);
}
if (!existsSync(cli)) {
  process.stderr.write("Run `pnpm -r build` first.\n");
  process.exit(2);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** This checkout's app processes, by executable path, so nobody else's count. */
function processIds() {
  if (process.platform === "darwin") {
    const found = spawnSync("pgrep", ["-f", app], { encoding: "utf8" });
    return (found.stdout ?? "")
      .split("\n")
      .map((one) => Number(one.trim()))
      .filter((one) => Number.isInteger(one) && one > 0);
  }
  const found = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-Process -Name '${PROCESS_NAME}' -ErrorAction SilentlyContinue | ` +
        "Select-Object -ExpandProperty Id",
    ],
    { encoding: "utf8", timeout: 20_000 },
  );
  return (found.stdout ?? "")
    .split("\n")
    .map((one) => Number(one.trim()))
    .filter((one) => Number.isInteger(one) && one > 0);
}

/** The `yam serve` processes this checkout's CLI is running, if any. */
function serviceIds() {
  if (process.platform !== "darwin") return [];
  const found = spawnSync("pgrep", ["-f", `${cli} serve`], { encoding: "utf8" });
  return (found.stdout ?? "")
    .split("\n")
    .map((one) => Number(one.trim()))
    .filter((one) => Number.isInteger(one) && one > 0);
}

/** Question 2: the WindowServer's own list, which no permission gates. */
const CG_SCRIPT = [
  "ObjC.import('CoreGraphics');ObjC.import('AppKit');",
  "function run(argv){",
  "var info=$.CGWindowListCopyWindowInfo(",
  "$.kCGWindowListOptionOnScreenOnly|$.kCGWindowListExcludeDesktopElements,$.kCGNullWindowID);",
  "var arr=ObjC.castRefToObject(info);var n=0;",
  "for(var i=0;i<arr.count;i++){var w=arr.objectAtIndex(i);",
  "if(ObjC.unwrap(w.objectForKey('kCGWindowOwnerName'))!==argv[0])continue;",
  "if(ObjC.unwrap(w.objectForKey('kCGWindowLayer'))!==0)continue;n++;}",
  "return String(n);}",
].join("");

function onScreenWindows() {
  if (process.platform !== "darwin") return undefined;
  const probe = spawnSync("osascript", ["-l", "JavaScript", "-e", CG_SCRIPT, PROCESS_NAME], {
    encoding: "utf8",
    timeout: 15_000,
  });
  return probe.status === 0 ? Number((probe.stdout ?? "0").trim()) : undefined;
}

/** Question 3: the same test the desktop gate polls with. */
const AX_SCRIPT = [
  "ObjC.import('ApplicationServices');ObjC.import('AppKit');",
  "function attr(e,n){var o=Ref();",
  "if($.AXUIElementCopyAttributeValue(e,$(n),o)!==0)return undefined;return o[0];}",
  "function run(argv){var apps=$.NSWorkspace.sharedWorkspace.runningApplications;",
  "for(var i=0;i<apps.count;i++){var a=apps.objectAtIndex(i);",
  "if(ObjC.unwrap(a.localizedName)!==argv[0])continue;",
  "var pid=parseInt(String(a.processIdentifier),10);if(!(pid>0))continue;",
  "var el=$.AXUIElementCreateApplication(pid);var w=attr(el,'AXWindows');",
  "if(w===undefined)continue;var list;",
  "try{list=ObjC.castRefToObject(w);}catch(e){continue;}",
  "for(var k=0;k<list.count&&k<8;k++){var r=attr(list.objectAtIndex(k),'AXRole');",
  "if(r===undefined)continue;",
  "try{if(ObjC.unwrap(ObjC.castRefToObject(r))==='AXWindow')return 'yes';}catch(e){}}}",
  "return 'no';}",
].join("");

function axReadableWindow() {
  if (process.platform !== "darwin") return undefined;
  const probe = spawnSync("osascript", ["-l", "JavaScript", "-e", AX_SCRIPT, PROCESS_NAME], {
    encoding: "utf8",
    timeout: 15_000,
  });
  return probe.status === 0 ? (probe.stdout ?? "").trim() === "yes" : undefined;
}

/** Question 1: what the application itself said, since this launch began. */
function loggedSince(mark) {
  if (!existsSync(debugLog)) return [];
  return readFileSync(debugLog, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .filter((line) => {
      const at = Date.parse(line.slice(0, 24));
      return Number.isFinite(at) && at >= mark;
    });
}

function launch() {
  const environment = {
    YAM_A11Y: "1",
    YAM_APP_DEBUG: "1",
    YAM_CLI: cli,
    YAM_APP_SMOKE: "",
    YAM_APP_PROJECT: project,
  };
  if (process.platform !== "darwin") {
    return spawn(app, [], { stdio: "ignore", env: { ...process.env, ...environment } });
  }
  // Through LaunchServices, so the process lands in the Aqua session a person
  // is looking at (LLD §7.5): a GUI application forked from a process that is
  // not in one never attaches to the WindowServer.
  const open = ["-n", "-F"];
  for (const [name, value] of Object.entries(environment)) open.push("--env", `${name}=${value}`);
  open.push("-a", bundle);
  const opened = spawnSync("open", open, { encoding: "utf8" });
  if (opened.status !== 0) {
    process.stderr.write(`\`open\` refused to launch ${bundle}: ${opened.stderr ?? ""}\n`);
    process.exit(2);
  }
  return undefined;
}

/** The graceful route, then a signal, then a harder one (Draft 2.13 §13.9). */
async function quit() {
  const startedAt = Date.now();
  if (processIds().length === 0) return { ms: 0, route: "already gone" };

  if (process.platform === "darwin") {
    spawnSync("osascript", ["-e", `tell application id "${BUNDLE_ID}" to quit`], {
      encoding: "utf8",
      timeout: 10_000,
    });
  } else {
    spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-Process -Name '${PROCESS_NAME}' -ErrorAction SilentlyContinue | ` +
          "ForEach-Object { $_.CloseMainWindow() | Out-Null }",
      ],
      { encoding: "utf8", timeout: 20_000 },
    );
  }
  for (let waited = 0; waited < 10_000; waited += 250) {
    if (processIds().length === 0) return { ms: Date.now() - startedAt, route: "graceful" };
    await sleep(250);
  }

  if (process.platform === "darwin") spawnSync("pkill", ["-f", app], { encoding: "utf8" });
  for (let waited = 0; waited < 15_000; waited += 250) {
    if (processIds().length === 0) return { ms: Date.now() - startedAt, route: "signal" };
    await sleep(250);
  }

  if (process.platform === "darwin") spawnSync("pkill", ["-9", "-f", app], { encoding: "utf8" });
  await sleep(1_000);
  return { ms: Date.now() - startedAt, route: "SIGKILL" };
}

/* ── the loop ─────────────────────────────────────────────────────────────── */

process.stderr.write(
  `Launching ${PROCESS_NAME} ${times} time(s) with ${project} open.\n` +
    `  bundle: ${bundle}\n  log:    ${debugLog}\n\n`,
);

// A leftover from an earlier run is the same defect as a leftover from the
// previous round (P8-F1), so the first round gets the clean slate the rest do.
await quit();
rmSync(debugLog, { force: true });

/*
 * The services that were already running before any of this.
 *
 * Counted out, not killed: a person may have a `yam serve` open on a project
 * of their own, and a check that stopped it would be the P10-F7 defect in a new
 * place. What this loop is about is whether *it* leaves one behind.
 */
const before = new Set(serviceIds());

const rounds = [];
for (let round = 1; round <= times; round += 1) {
  const mark = Date.now();
  launch();

  let created = false;
  let shown = false;
  let loaded = false;
  for (let waited = 0; waited < 60_000; waited += 500) {
    await sleep(500);
    const lines = loggedSince(mark);
    created = created || lines.some((one) => one.includes(" window.creating"));
    loaded = loaded || lines.some((one) => one.includes(" renderer.did-finish-load"));
    shown =
      shown ||
      lines.some((one) => one.includes(" window.ready-to-show") && one.includes("visible=true"));
    if (created && loaded && shown) break;
  }

  const onScreen = onScreenWindows();
  const readable = axReadableWindow();
  const stopped = await quit();
  const leftoverApp = processIds();

  /*
   * The service the app spawned, given a moment to finish exiting.
   *
   * `closeProject` resolves when the child's `exit` event fires, and the
   * process table catches up a beat later; asking immediately reported a
   * leftover for a service that was already gone.
   */
  const mine = () => serviceIds().filter((pid) => !before.has(pid));
  let leftoverService = mine();
  for (let waited = 0; waited < 5_000 && leftoverService.length > 0; waited += 250) {
    await sleep(250);
    leftoverService = mine();
  }

  rounds.push({
    round,
    created: created === true,
    shown: shown === true,
    loaded: loaded === true,
    onScreen,
    readable,
    quitMs: stopped.ms,
    route: stopped.route,
    leftoverApp: leftoverApp.length,
    leftoverService: leftoverService.length,
  });

  process.stderr.write(
    `round ${String(round).padStart(2)}: window ${created === true ? "created" : "NOT CREATED"}` +
      `, ${shown === true ? "shown" : "not shown"}` +
      `, renderer ${loaded === true ? "loaded" : "did not load"}` +
      `, on screen ${onScreen ?? "?"}` +
      `, accessibility ${readable === undefined ? "?" : readable ? "readable" : "unreadable"}` +
      `, quit ${stopped.route} in ${stopped.ms} ms` +
      `, leftovers desktopApp=${leftoverApp.length} service=${leftoverService.length}\n`,
  );
}

const windows = rounds.filter((one) => one.created && one.shown && one.loaded).length;
const onScreenAll = rounds.every((one) => (one.onScreen ?? 0) > 0);
const readableAll = rounds.every((one) => one.readable === true);
const leftovers = rounds.filter((one) => one.leftoverApp > 0 || one.leftoverService > 0).length;

process.stdout.write(
  `${windows}/${times} launches created, showed and loaded a window; ` +
    `${onScreenAll ? "every" : "not every"} launch had one on screen; ` +
    `${readableAll ? "every" : "not every"} launch was readable through the accessibility API; ` +
    `${leftovers === 0 ? "no" : String(leftovers)} round(s) left a process behind.\n`,
);

if (windows < times || !onScreenAll || leftovers > 0) {
  process.stderr.write("\nThe APP_DIR did not launch cleanly every time; see the rounds above.\n");
  process.exit(1);
}
if (!readableAll) {
  const doctor = spawnSync(process.execPath, [cli, "surface", "doctor", "--adapter", "ax"], {
    encoding: "utf8",
  });
  process.stderr.write(
    "\nEvery launch made a window and put it on screen, and the accessibility API would not " +
      "hand it over. That is a property of the host, not of the app, and this is what it " +
      `says:\n\n${doctor.stdout ?? ""}\n`,
  );
  process.exit(3);
}
process.exit(0);
