#!/usr/bin/env node
/**
 * The desktop conformance run: launch the ADE, drive it, write the report
 * (T6.1, T6.2, T7.1, LLD §7.5, §14, §16, REQ-ADE-6).
 *
 *   node scripts/desktop-conformance.mjs --adapter ax   [--report reports/adapter-ax.md]
 *   node scripts/desktop-conformance.mjs --adapter uia  [--report reports/adapter-uia.md]
 *
 * One command, because the gate has three parts that are easy to get wrong
 * separately: the ADE has to be *packaged*, it has to be launched with
 * `YAM_A11Y=1` so Chromium publishes its accessibility tree, and the host
 * permission has to be in place. This checks all three, says which one is
 * missing, and only then runs the suite.
 *
 * Exit 0 when the adapter is conformant, 1 when it is not, 2 when the host is
 * not ready — three answers, because "the permission is not granted" and "the
 * adapter is wrong" send whoever reads it to different places.
 *
 * ## Three passes, because a healing case needs a before and an after
 *
 * Draft 2.8 LLD §16 makes T6.1's "healing variant subset" concrete: the ADE
 * gains `YAM_A11Y_VARIANT=1|2`, and a binding recorded at variant 0 must
 * relocalize at both. The variant is fixed when the window is created, so this
 * launches the ADE three times — variant 0 records, variants 1 and 2 heal —
 * carrying the recorded fingerprints between the passes in a state file, and
 * writes one report with every case's outcome at every variant it ran at.
 *
 * ## Two defects Phase 6 shipped here (F6)
 *
 * `--report` was resolved against the *project* directory the suite runs in, so
 * `--report ../adapter-ax.md` wrote inside `evals/`. It is resolved against the
 * current directory now, which is what LLD §15's command table says and what
 * anyone typing a relative path means.
 *
 * And the wait for the ADE's window was a fixed eight-second sleep, which is
 * shorter than the fifteen seconds this machine has taken twice. It is a poll
 * for an actual window now, up to sixty seconds (§15), and a launch that never
 * shows one is reported as that rather than as seven failing cases.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};

const adapter = option("adapter", process.platform === "darwin" ? "ax" : "uia");
/*
 * Against the current directory (F6, LLD §15). `resolve` with one argument is
 * exactly that, and it leaves an absolute path alone.
 */
const report = resolve(option("report", join(ROOT, "reports", `adapter-${adapter}.md`)));
const project = option("project", join(ROOT, "evals", "fixtures"));
const cli = join(ROOT, "packages", "cli", "dist", "bin.js");
const PROCESS_NAME = "Yam ADE";
/** What LaunchServices calls this build; the graceful quit route addresses it. */
const BUNDLE_ID = process.env["YAM_ADE_BUNDLE_ID"] ?? "com.electron.yam-ade";
/** LLD §15: "polls for the ADE window up to 60 s". */
const WINDOW_TIMEOUT_MS = Number(option("window-timeout-ms", "60000"));

const die = (code, message) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

/*
 * `--print-report-path` resolves the report path and stops (F6).
 *
 * The defect was that a relative `--report` landed somewhere nobody asked for,
 * and the only way it could be *seen* was by completing a run — which needs a
 * packaged ADE, a granted permission and a window, none of which a CI runner
 * on Linux has. One flag makes the resolution testable anywhere, in one line,
 * and it is the line `tools/repo-checks` runs.
 */
if (args.includes("--print-report-path")) {
  process.stdout.write(`${report}\n`);
  process.exit(0);
}

if (!existsSync(cli)) die(2, "Run `pnpm -r build` first.");

/*
 * The adapter's own platform, before anything is launched (T8.6).
 *
 * `yam surface doctor --adapter uia` on macOS answers `skip  uia/platform
 * not Windows` and exits 0 — correctly, because a skipped check is not a failed
 * one — so the gate went on to launch an ADE and wait sixty seconds for a
 * window it was never going to read. "The host cannot run this adapter" and
 * "the ADE would not start" are different answers and sent a reader to
 * different places.
 */
const HOST_FOR = { ax: "darwin", uia: "win32" };
if (HOST_FOR[adapter] !== undefined && HOST_FOR[adapter] !== process.platform) {
  die(
    2,
    `The "${adapter}" adapter runs on ${HOST_FOR[adapter]} and this host is ${process.platform}, ` +
      "so the conformance suite was not run and nothing was written to " +
      `${report}.\nRun this on a ${HOST_FOR[adapter]} host, or attach one as a runner ` +
      "(`.github/workflows/ci.yml`, the `desktop-conformance` job on a self-hosted runner).",
  );
}

/* ── 1. the host ──────────────────────────────────────────────────────────── */

const doctor = spawnSync(process.execPath, [cli, "surface", "doctor", "--adapter", adapter], {
  encoding: "utf8",
});
const doctorOutput = doctor.stdout ?? "";
process.stderr.write(doctorOutput);
if (doctor.status !== 0) {
  die(
    2,
    `\nThe host is not ready for the "${adapter}" adapter, so the conformance suite was not run.\n` +
      "Grant the permission above and run this again. Nothing was written to " +
      `${report}: a report from a run that could not start would be a result nobody took.`,
  );
}

/**
 * Does anything in this login session own a window (Draft 2.12 §7.5, P9-F7)?
 *
 * > when only `loginwindow` does, the display is locked or the session has no
 * > WindowServer, and the gate names that as the cause of its exit 2 rather than
 * > a launch failure.
 *
 * Asked again at the moment of a launch failure rather than only at the start,
 * because a display can lock while a gate is running — which is exactly how it
 * would happen to someone who started the gate and walked away, and is what
 * happened to both the Phase 9 implementer and its verifier.
 *
 * `undefined` when there is nothing to say: another adapter, or a `doctor` that
 * did not answer. A gate that guessed "locked" would replace one wrong
 * explanation with another.
 */
function sessionCheck() {
  if (adapter !== "ax") return undefined;
  const asked = spawnSync(
    process.execPath,
    [cli, "surface", "doctor", "--adapter", adapter, "--json"],
    { encoding: "utf8" },
  );
  try {
    const parsed = JSON.parse(asked.stdout ?? "{}");
    return (parsed.checks ?? []).find((one) => one.adapter === "ax" && one.name === "session");
  } catch {
    return undefined;
  }
}

/**
 * Why there was no window — but only when this can actually say (P10-F5).
 *
 * > a session probe that did not answer in time is "could not tell", never a
 * > cause.
 *
 * The Phase 10 gate printed "this login session cannot show one" beside a
 * doctor line naming nine applications that did, because the probe had timed
 * out at five seconds under load and `ok: false` was read as "locked". A cause
 * is named for `locked` and `no-session` and for nothing else; `unknown` is
 * reported as an unanswered probe, which sends a reader to run the probe again
 * rather than to unlock a display that was never locked.
 */
function lockedDisplay() {
  const session = sessionCheck();
  if (session === undefined) return undefined;
  return session.state === "locked" || session.state === "no-session" ? session : undefined;
}

/* ── 2. the ADE ───────────────────────────────────────────────────────────── */

/** The macOS application bundle, which is what LaunchServices opens. */
const bundle = join(ROOT, "apps", "ade", "out", "Yam ADE-darwin-arm64", "Yam ADE.app");
const app =
  process.platform === "darwin"
    ? join(bundle, "Contents", "MacOS", "Yam ADE")
    : join(ROOT, "apps", "ade", "out", `Yam ADE-win32-x64`, "Yam ADE.exe");

if (!existsSync(app)) {
  die(
    2,
    `The ADE is not packaged (${app}).\n` +
      "Run: pnpm --filter @svatah/yam-ade exec electron-forge package\n" +
      `Nothing was written to ${report}.`,
  );
}

/**
 * "Does this application own a window an accessibility client can read?"
 *
 * One JXA expression, no System Events and no Apple events: `NSWorkspace` for
 * the processes with that name, `AXUIElementCopyAttributeValue` for their
 * window lists, and `AXRole === 'AXWindow'` for the answer. An application
 * whose list holds *itself* — which is what macOS returns while the screen is
 * locked — answers `no`, and `lockedDisplay()` is then what says why.
 */
const REAL_WINDOW_SCRIPT = [
  "ObjC.import('ApplicationServices');ObjC.import('AppKit');",
  "function attr(e,n){var o=Ref();",
  "if($.AXUIElementCopyAttributeValue(e,$(n),o)!==0)return undefined;return o[0];}",
  "function run(argv){",
  "var apps=$.NSWorkspace.sharedWorkspace.runningApplications;",
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

/**
 * Does the application have a window yet?
 *
 * Asked of the OS rather than of Yam, and deliberately not through the
 * adapter: a poll that used the adapter would fold "the bridge is slow" into
 * "the window is not there yet", which are the two things this gate has to keep
 * apart. The call is the cheapest one each platform has.
 */
function hasWindow() {
  if (process.platform === "darwin") {
    /*
     * The accessibility API directly, not System Events (P10-F1).
     *
     * `count windows` over an Apple event asks System Events to do the same
     * accessibility read this does, one process away, under a second
     * permission — and it answers `0` for *every* application on a host where
     * the read is refused, which is indistinguishable from "the ADE has no
     * window yet". The role is the test, because a locked screen answers
     * `AXWindows` with a one-element list holding the application itself.
     */
    const probe = spawnSync(
      "osascript",
      ["-l", "JavaScript", "-e", REAL_WINDOW_SCRIPT, PROCESS_NAME],
      { encoding: "utf8", timeout: 15_000 },
    );
    return probe.status === 0 && (probe.stdout ?? "").trim() === "yes";
  }
  const probe = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `@(Get-Process -Name '${PROCESS_NAME}' -ErrorAction SilentlyContinue | ` +
        "Where-Object { $_.MainWindowHandle -ne 0 }).Count",
    ],
    { encoding: "utf8", timeout: 20_000 },
  );
  return probe.status === 0 && Number((probe.stdout ?? "0").trim()) > 0;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Is a project open on the ADE's window yet (T8.1)?
 *
 * The window appearing is not enough: `YAM_ADE_PROJECT` opens the project
 * *after* ready, and every case is about a control that exists only once one is
 * open. Phase 7's gate asked for those controls on the welcome screen and
 * reported five adapter failures for a launch that had not finished (P7-F1).
 *
 * The **rail** is the cheapest proof (T10.3): it renders only with a project
 * open — a window without one draws the welcome screen and nothing else — and
 * `rail-flows` is its first row. It replaces `screen-project`, which was one of
 * the eleven tabs this phase deleted.
 */
function hasProject() {
  if (process.platform !== "darwin") {
    const probe = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `@(Get-Process -Name '${PROCESS_NAME}' -ErrorAction SilentlyContinue | ` +
          "Where-Object { $_.MainWindowTitle -ne '' }).Count",
      ],
      { encoding: "utf8", timeout: 20_000 },
    );
    return probe.status === 0 && Number((probe.stdout ?? "0").trim()) > 0;
  }
  const probe = spawnSync(
    "osascript",
    [
      "-l",
      "JavaScript",
      "-e",
      "ObjC.import('ApplicationServices');ObjC.import('AppKit');" +
        "function attr(e,n){const o=Ref();" +
        "if($.AXUIElementCopyAttributeValue(e,$(n),o)!==0)return undefined;return o[0];}" +
        "function role(e){const r=attr(e,'AXRole');if(r===undefined)return '';" +
        "try{return ObjC.unwrap(ObjC.castRefToObject(r));}catch(x){return '';}}" +
        /*
         * The window is the one whose role is `AXWindow` (P10-F1). Taking
         * `AXWindows[0]` walked the *application* element on a locked screen —
         * six thousand menu items, no `rail-flows`, and a report that said the
         * project had not opened.
         */
        "function run(argv){const apps=$.NSWorkspace.sharedWorkspace.runningApplications;" +
        "let win=undefined;for(let i=0;i<apps.count&&win===undefined;i++){" +
        "const a=apps.objectAtIndex(i);" +
        "if(ObjC.unwrap(a.localizedName)!==argv[0]||!(a.processIdentifier>0))continue;" +
        "const el=$.AXUIElementCreateApplication(a.processIdentifier);" +
        "const w=attr(el,'AXWindows');if(w===undefined)continue;" +
        "let list;try{list=ObjC.castRefToObject(w);}catch(x){continue;}" +
        "for(let k=0;k<list.count&&k<8;k++){const c=list.objectAtIndex(k);" +
        "if(role(c)==='AXWindow'){win=c;break;}}}" +
        "if(win===undefined)return 'no';" +
        "let found='no';const stack=[win];let seen=0;" +
        "while(stack.length>0&&seen<4000){const e=stack.pop();seen++;" +
        "const id=attr(e,'AXDOMIdentifier');" +
        "if(id!==undefined&&ObjC.unwrap(ObjC.castRefToObject(id))==='rail-flows'){found='yes';break;}" +
        "const k=attr(e,'AXChildren');if(k===undefined)continue;" +
        "const arr=ObjC.castRefToObject(k);for(let i=0;i<arr.count;i++)stack.push(arr.objectAtIndex(i));}" +
        "return found;}",
      PROCESS_NAME,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  return probe.status === 0 && (probe.stdout ?? "").trim() === "yes";
}

/**
 * The environment every launch gets.
 *
 * `YAM_ADE_PROJECT` is Draft 2.9 §13.6: "the desktop conformance gate passes
 * the fixtures project this way, so its cases read a project screen rather than
 * the welcome screen."
 */
function launchEnvironment(variant) {
  return {
    YAM_A11Y: "1",
    ...(variant === 0 ? {} : { YAM_A11Y_VARIANT: String(variant) }),
    YAM_CLI: cli,
    YAM_ADE_SMOKE: "",
    YAM_ADE_PROJECT: project,
    /*
     * The window-lifecycle log (Draft 2.13 §13.6, P10-F1).
     *
     * Always on for a gate launch. The gate is the one caller that regularly
     * has to tell "Electron never made a window" apart from "Electron made one
     * and this host will not show it", and the log is the only thing that can:
     * every probe the gate has is outside the application.
     */
    YAM_ADE_DEBUG: "1",
  };
}

/**
 * The ADE's graceful quit route on this platform (Draft 2.13 §13.6, §13.9).
 *
 * > the gate stops an instance through a graceful quit route before it signals
 *
 * On macOS an Apple-event `quit`, which Electron delivers as `before-quit`, so
 * the ADE stops the `yam serve` it spawned and writes its preferences. On
 * Windows, `CloseMainWindow`. Both are best-effort and neither is waited on
 * here: `stop()` polls for the process to be gone and escalates on its own
 * clock, which is what makes the route an *addition* to the signal rather than
 * a new way for teardown to hang.
 */
function requestQuit() {
  if (process.platform === "darwin") {
    return spawnSync(
      "osascript",
      ["-e", `tell application id "${BUNDLE_ID}" to quit`],
      { encoding: "utf8", timeout: 10_000 },
    );
  }
  return spawnSync(
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

/**
 * Start the ADE so that it has a window (T8.2).
 *
 * On macOS through `open`, not by executing the binary. A GUI application
 * forked from a process that is not in the user's Aqua session never attaches
 * to the WindowServer: it runs, its renderer runs, and it has no window that
 * either the accessibility API or System Events can see, for ever. Measured
 * here — a direct `spawn` polled for 37 s and answered `windows=0` at every
 * step, while the same build opened with `open -n` answered `1`. `open` hands
 * the launch to LaunchServices, which places it in the session a person is
 * looking at, which is the session this gate is about.
 *
 * `-F` so a restored window from a previous run cannot stand in for this one.
 */
function start(variant) {
  const environment = launchEnvironment(variant);
  if (process.platform !== "darwin") {
    return spawn(app, [], { stdio: "ignore", detached: false, env: { ...process.env, ...environment } });
  }
  const args = ["-n", "-F"];
  for (const [name, value] of Object.entries(environment)) args.push("--env", `${name}=${value}`);
  args.push("-a", bundle);
  const opened = spawnSync("open", args, { encoding: "utf8" });
  if (opened.status !== 0) {
    die(2, `\`open\` refused to launch ${bundle}: ${opened.stderr ?? ""}`);
  }
  // Nothing to hold: LaunchServices owns the process. `stop()` finds it by the
  // executable path, which no other application on the machine shares.
  return undefined;
}

/** Launch the ADE at one variant and wait for its project screen. */
async function launch(variant) {
  const child = start(variant);
  const startedAt = Date.now();
  let windowAt;
  while (Date.now() - startedAt < WINDOW_TIMEOUT_MS) {
    await sleep(1_000);
    if (windowAt === undefined && hasWindow()) {
      windowAt = Date.now() - startedAt;
      process.stderr.write(
        `variant ${variant}: the ADE's window appeared after ${windowAt} ms\n`,
      );
    }
    if (windowAt !== undefined && hasProject()) {
      const waitedMs = Date.now() - startedAt;
      process.stderr.write(
        `variant ${variant}: the project screen was open after ${waitedMs} ms ` +
          `(${project})\n`,
      );
      return { child, waitedMs, windowAt };
    }
  }
  return { child, waitedMs: Date.now() - startedAt, windowAt, timedOut: true };
}

/* ── 3. the three passes ──────────────────────────────────────────────────── */

const workspace = mkdtempSync(join(tmpdir(), "yam-desktop-"));
const healState = join(workspace, "heal-state.json");
const passes = [];
let running;

/**
 * The process ids of this checkout's packaged ADE, right now (P8-F1).
 *
 * The executable path is what identifies them: it is unique to this checkout's
 * build, so a second Yam ADE installed elsewhere on the machine is not
 * counted and not killed.
 */
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

/** How long `stop()` waits for the previous launch to finish exiting. */
const TEARDOWN_TIMEOUT_MS = Number(option("teardown-timeout-ms", "30000"));
/** How long the graceful quit route is given before a signal (Draft 2.13). */
const GRACEFUL_QUIT_MS = Number(option("graceful-quit-ms", "10000"));

/**
 * Stop the ADE, and do not come back until it is gone (P8-F1, Draft 2.10 §7.5).
 *
 * > the gate does not launch the next variant until no process of the previous
 * > launch remains.
 *
 * The defect this closes: `pkill` returns as soon as the signal is *delivered*,
 * and an Electron application takes a second or two to unwind. The gate then
 * opened the next variant, the bridge asked macOS for "Yam ADE", and the
 * answer was sometimes the instance that was still exiting — which owns no
 * window, so every case at the new variant threw `no-window`. One of the
 * verifier's three runs did exactly that, under load.
 *
 * Synchronous on purpose: this also runs from `process.on("exit")`, where a
 * promise would never be awaited.
 */
const stop = () => {
  try {
    running?.kill("SIGTERM");
  } catch {
    // Already gone.
  }
  running = undefined;

  /*
   * The graceful route first (Draft 2.13 §13.6, P10-F1).
   *
   * A `pkill` is a `SIGTERM`, and Node's default handling of one ends the main
   * process where it stands: `before-quit` never ran, so the `yam serve` the
   * ADE had spawned was left with no parent to stop it and went on holding the
   * project's `runs/` directory for the next variant. The ADE runs its own quit
   * on a signal now, and this asks it to quit before sending one at all.
   */
  const startedAt = Date.now();
  if (processIds().length > 0) requestQuit();

  let remaining = processIds();
  const graceUntil = Date.now() + GRACEFUL_QUIT_MS;
  while (remaining.length > 0 && Date.now() < graceUntil) {
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 250)"], { encoding: "utf8" });
    remaining = processIds();
  }
  if (remaining.length === 0) {
    process.stderr.write(
      `the previous launch quit gracefully after ${Date.now() - startedAt} ms\n`,
    );
    return;
  }

  if (process.platform === "darwin") {
    // Started by LaunchServices, so there is no child to signal. The executable
    // path is unique to this checkout's packaged build.
    spawnSync("pkill", ["-f", app], { encoding: "utf8" });
  }

  // The signal's own clock: the graceful route's ten seconds are not the
  // signal's thirty, and folding them together escalated to SIGKILL five
  // seconds after SIGTERM was sent.
  const signalledAt = Date.now();
  remaining = processIds();
  let escalated = false;
  while (remaining.length > 0 && Date.now() - signalledAt < TEARDOWN_TIMEOUT_MS) {
    // 250 ms, spent in another process rather than in a busy loop.
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 250)"], { encoding: "utf8" });
    remaining = processIds();
    if (!escalated && remaining.length > 0 && Date.now() - signalledAt > TEARDOWN_TIMEOUT_MS / 2) {
      escalated = true;
      if (process.platform === "darwin") spawnSync("pkill", ["-9", "-f", app], { encoding: "utf8" });
      else for (const pid of remaining) spawnSync("taskkill", ["/PID", String(pid), "/F"]);
    }
  }
  if (remaining.length > 0) {
    process.stderr.write(
      `warning: ${remaining.length} process(es) of the previous launch (${remaining.join(", ")}) ` +
        `were still running after ${Date.now() - startedAt} ms. The next variant is launched ` +
        "anyway, and the bridge addresses the process that owns a window (LLD §7.5).\n",
    );
    return;
  }
  process.stderr.write(`the previous launch was gone after ${Date.now() - startedAt} ms\n`);
};
process.on("exit", stop);

/** The variants whose first read exceeded the deadline and were run again. */
const retries = [];

/** Run the conformance suite once against the ADE that is up, and parse it. */
function runSuite(variant, statePath) {
  const conform = spawnSync(
    process.execPath,
    [
      cli,
      "surface",
      "conform",
      "--adapter",
      adapter,
      "--process",
      PROCESS_NAME,
      "--variant",
      String(variant),
      "--heal-state",
      statePath,
      "--json",
    ],
    { encoding: "utf8", cwd: project, maxBuffer: 64 * 1024 * 1024 },
  );
  process.stderr.write(conform.stderr ?? "");
  try {
    return JSON.parse(conform.stdout ?? "");
  } catch {
    die(
      1,
      `The suite produced no report at variant ${variant}.\n${conform.stdout ?? ""}\n${conform.stderr ?? ""}`,
    );
  }
}

/**
 * Did the bridge run out of time, rather than the adapter being wrong (P8-F2)?
 *
 * The bridge says so in its own words — LLD §7.5 requires a timeout after
 * `doctor` reported `granted` to be reported as a bridge timeout with the
 * numbers, never as a permission prompt — so this looks for that sentence and
 * for the `no-window` a launch race leaves (P8-F1), and for nothing else. A
 * failed assertion about a control is not retried: it would be the same failure
 * twice and twice as slow.
 */
function exceededDeadline(report) {
  const text = JSON.stringify(report ?? {});
  return (
    text.includes("did not finish reading the window") ||
    text.includes("did not answer within") ||
    text.includes("has no window. Is it running")
  );
}

/*
 * The application the fixtures project drives (T12.3, K6).
 *
 * `ade.result` presses Run on the Flows screen so that the branch of the case
 * which reads a table of runs is the branch the live gate takes, and the
 * fixtures flow drives `apps/sample-web` at the base URL its config names. The
 * gate starts one; if the port is taken — by a person's own `pnpm sample-web`,
 * most likely — that is fine and the existing one serves.
 *
 * The run's *verdict* is not what the case asserts, so a sample application
 * that refuses to start is not a reason to refuse to run the gate: the Runs
 * screen fills either way, and the case says so.
 */
let sampleWeb;
function startSampleWeb() {
  const cli = join(ROOT, "apps", "sample-web", "dist", "cli.js");
  if (!existsSync(cli)) {
    process.stderr.write(`no ${cli}; run \`pnpm -r build\` first. Running without it.\n`);
    return undefined;
  }
  const child = spawn(process.execPath, [cli], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: "4173" },
  });
  child.stdout.on("data", (chunk) => process.stderr.write(`sample-web: ${String(chunk)}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`sample-web: ${String(chunk)}`));
  return child;
}

/*
 * A leftover from an earlier gate run is the same defect as a leftover from the
 * previous variant (P8-F1), so the first launch gets the same clean slate the
 * other two do.
 */
stop();
sampleWeb = startSampleWeb();

try {
  for (const variant of [0, 1, 2]) {
    const launched = await launch(variant);
    running = launched.child;
    if (launched.timedOut) {
      stop();
      /*
       * Why there was no window (Draft 2.12 §7.5, P9-F7).
       *
       * On a locked display nothing an application does will produce one, so
       * "showed no window within 60000 ms" is true and useless: it sends the
       * reader to look at the ADE. When the session check says the display is
       * locked, that is the cause and it is what this says.
       */
      const locked = lockedDisplay();
      die(
        2,
        locked === undefined
          ? `The ADE was launched at variant ${variant} but ` +
              (launched.windowAt === undefined
                ? `showed no window within ${WINDOW_TIMEOUT_MS} ms`
                : `showed no open project within ${WINDOW_TIMEOUT_MS} ms ` +
                  `(its window appeared after ${launched.windowAt} ms; YAM_ADE_PROJECT=${project})`) +
              ". That is a launch failure, not an adapter failure, and it is " +
              "reported as one so the report is not a list of cases that never had anything to " +
              `read.\nNothing was written to ${report}.\n` +
              `\`yam surface doctor --adapter ${adapter}\` said:\n${doctorOutput}`
          : `The ADE showed no window at variant ${variant} because this login session cannot ` +
              `show one: ${locked.detail}.\n` +
              "That is the cause, not a launch failure and not an adapter failure — nothing " +
              "launched here would get a window.\n" +
              `${locked.fix ?? ""}\n` +
              `Nothing was written to ${report}.\n` +
              `\`yam surface doctor --adapter ${adapter}\` said:\n${doctorOutput}`,
      );
    }

    const jsonPath = join(workspace, `variant-${variant}.json`);
    let parsed = runSuite(variant, healState);
    stop();

    /*
     * One retry when the bridge ran out of time (P8-F2, Draft 2.10 §7.5).
     *
     * > a read that exceeds the deadline is retried once by the gate, and the
     * > report says it was.
     *
     * The budget is wall-clock, so a machine that was busy for ten seconds is
     * the difference between a conformant adapter and a failed gate — and the
     * answer to "was the machine busy?" is to ask it again rather than to
     * publish a failure nobody can reproduce. Exactly once: a gate that kept
     * retrying would report the best of N reads, which is not what §7.5's
     * budget means.
     */
    if (exceededDeadline(parsed)) {
      process.stderr.write(
        `variant ${variant}: a window read exceeded the bridge's deadline; ` +
          "retrying this variant once (LLD §7.5, P8-F2)\n",
      );
      const relaunched = await launch(variant);
      running = relaunched.child;
      if (!relaunched.timedOut) {
        const again = runSuite(variant, healState);
        stop();
        parsed = { ...again, ...(again.bridge === undefined ? {} : { bridge: { ...again.bridge, retried: true } }) };
        retries.push(variant);
      } else {
        process.stderr.write(
          `variant ${variant}: the retry's launch showed no project screen; ` +
            "the first run's report stands.\n",
        );
        stop();
      }
    }

    writeFileSync(jsonPath, JSON.stringify(parsed, null, 2), "utf8");
    passes.push({ variant, report: parsed });
  }

  /* ── 4. one report ──────────────────────────────────────────────────────── */

  const { renderMarkdown } = await import(
    join(ROOT, "packages", "conformance", "dist", "index.js")
  );

  const failed = passes.flatMap((pass) =>
    pass.report.cases.filter((one) => one.status === "failed").map((one) => ({ ...one, variant: pass.variant })),
  );
  const passedCount = passes.reduce((n, pass) => n + pass.report.totals.passed, 0);
  const conformant = failed.length === 0 && passedCount > 0;
  const bridge = passes
    .map((pass) => pass.report.bridge)
    .filter((one) => one !== undefined)
    .sort((a, b) => b.nodes - a.nodes)[0];

  const lines = [
    `# Desktop conformance — \`${adapter}\``,
    "",
    `Run at ${new Date().toISOString()} on ${process.platform} ${process.arch}, Node ${process.version}.`,
    "",
    conformant
      ? `**Conformant.** ${passedCount} cases passed across ADE variants 0, 1 and 2 ` +
        "(REQ-SURF-3, REQ-ADE-6)."
      : `**Not conformant.** ${failed.length} case(s) failed (REQ-SURF-3).`,
    "",
    bridge === undefined || bridge.invocations === 0
      ? "The bridge cost was not measured on this run."
      : `Bridge (LLD §7.5): the largest window read was **${bridge.nodes} nodes in ` +
        `${bridge.wallMs} ms — ${bridge.msPerNode} ms per node**` +
        `${
          bridge.axCalls !== undefined
            ? `, ${bridge.axCalls} accessibility calls`
            : bridge.appleEvents === undefined
              ? ""
              : `, ${bridge.appleEvents} Apple events`
        }, ` +
        `${bridge.invocations} process invocation per snapshot, ` +
        /*
         * The load beside the cost (P8-F2, Draft 2.10 §7.5). Without it the
         * number is honest and not comparable: the same read cost 1.6 ms per
         * node at load average seven here and 29.6 beside a full test run.
         */
        `at **load average ${bridge.loadAverage1m ?? "unrecorded"}` +
        `${bridge.cpus === undefined ? "" : ` over ${bridge.cpus} CPUs`}**.`,
    "",
    retries.length === 0
      ? "No variant's window read exceeded the bridge's deadline, so nothing was retried."
      : `Retried once (LLD §7.5): variant${retries.length === 1 ? "" : "s"} ` +
        `${retries.join(", ")} — the first read exceeded the bridge's deadline and the ` +
        "variant was run again. The numbers above are the retry's.",
    "",
    "## Healing (LLD §16)",
    "",
    "| Case | Variant | Outcome |",
    "|---|---|---|",
    ...passes.flatMap((pass) =>
      pass.report.cases
        .filter((one) => one.id.startsWith("ade.heal.") && one.status !== "skipped")
        .map(
          (one) =>
            `| \`${one.id}\` | ${pass.variant} | ${one.status === "passed" ? (pass.variant === 0 ? "recorded" : "relocalized") : one.status} |`,
        ),
    ),
    "",
    ...passes.flatMap((pass) => [
      `## ADE variant ${pass.variant}`,
      "",
      renderMarkdown(pass.report)
        .split("\n")
        .slice(1)
        .join("\n")
        .replace(/^# /gm, "### "),
    ]),
  ];

  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, `${lines.join("\n")}\n`, "utf8");
  process.stderr.write(`wrote ${report}\n`);

  process.stdout.write(
    conformant
      ? `"${adapter}" is conformant — ${passedCount} cases across variants 0, 1 and 2 → ${report}\n`
      : `"${adapter}" is NOT conformant — ${failed.map((one) => `${one.id}@v${one.variant}`).join(", ")} → ${report}\n`,
  );
  process.exit(conformant ? 0 : 1);
} finally {
  stop();
  sampleWeb?.kill("SIGTERM");
  if (process.env["YAM_KEEP_WORKSPACE"] !== "1") {
    rmSync(workspace, { recursive: true, force: true });
  } else {
    process.stderr.write(`kept ${workspace}\n`);
  }
}
