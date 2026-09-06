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
 * `SVATAH_A11Y=1` so Chromium publishes its accessibility tree, and the host
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
 * gains `SVATAH_A11Y_VARIANT=1|2`, and a binding recorded at variant 0 must
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
const PROCESS_NAME = "Svatah ADE";
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
 * `svatah surface doctor --adapter uia` on macOS answers `skip  uia/platform
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
      "(`bitbucket-pipelines.yml`, the `desktop-gates` pipeline).",
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

/* ── 2. the ADE ───────────────────────────────────────────────────────────── */

/** The macOS application bundle, which is what LaunchServices opens. */
const bundle = join(ROOT, "apps", "ade", "out", "Svatah ADE-darwin-arm64", "Svatah ADE.app");
const app =
  process.platform === "darwin"
    ? join(bundle, "Contents", "MacOS", "Svatah ADE")
    : join(ROOT, "apps", "ade", "out", `Svatah ADE-win32-x64`, "Svatah ADE.exe");

if (!existsSync(app)) {
  die(
    2,
    `The ADE is not packaged (${app}).\n` +
      "Run: pnpm --filter @svatah/ade exec electron-forge package\n" +
      `Nothing was written to ${report}.`,
  );
}

/**
 * Does the application have a window yet?
 *
 * Asked of the OS rather than of Svatah, and deliberately not through the
 * adapter: a poll that used the adapter would fold "the bridge is slow" into
 * "the window is not there yet", which are the two things this gate has to keep
 * apart. The call is the cheapest one each platform has.
 */
function hasWindow() {
  if (process.platform === "darwin") {
    const probe = spawnSync(
      "osascript",
      ["-e", `tell application "System Events" to tell process "${PROCESS_NAME}" to count windows`],
      { encoding: "utf8", timeout: 10_000 },
    );
    return probe.status === 0 && Number((probe.stdout ?? "0").trim()) > 0;
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
 * The window appearing is not enough: `SVATAH_ADE_PROJECT` opens the project
 * *after* ready, and every flow case is about a control that exists only on a
 * project screen. Phase 7's gate asked for those controls on the welcome
 * screen and reported five adapter failures for a launch that had not finished
 * (P7-F1). The tabs are the cheapest proof — they render only with a project
 * open — and `screen-project` is one of them.
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
        "function run(argv){const apps=$.NSWorkspace.sharedWorkspace.runningApplications;" +
        "let pid=-1;for(let i=0;i<apps.count;i++){const a=apps.objectAtIndex(i);" +
        "if(ObjC.unwrap(a.localizedName)===argv[0]&&a.processIdentifier>0){" +
        "const el=$.AXUIElementCreateApplication(a.processIdentifier);" +
        "const w=attr(el,'AXWindows');if(w===undefined)continue;" +
        "if(ObjC.castRefToObject(w).count>0){pid=a.processIdentifier;break;}}}" +
        "if(pid<0)return 'no';const el=$.AXUIElementCreateApplication(pid);" +
        "const w=ObjC.castRefToObject(attr(el,'AXWindows')).objectAtIndex(0);" +
        "let found='no';const stack=[w];let seen=0;" +
        "while(stack.length>0&&seen<4000){const e=stack.pop();seen++;" +
        "const id=attr(e,'AXDOMIdentifier');" +
        "if(id!==undefined&&ObjC.unwrap(ObjC.castRefToObject(id))==='screen-project'){found='yes';break;}" +
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
 * `SVATAH_ADE_PROJECT` is Draft 2.9 §13.6: "the desktop conformance gate passes
 * the fixtures project this way, so its cases read a project screen rather than
 * the welcome screen."
 */
function launchEnvironment(variant) {
  return {
    SVATAH_A11Y: "1",
    ...(variant === 0 ? {} : { SVATAH_A11Y_VARIANT: String(variant) }),
    SVATAH_CLI: cli,
    SVATAH_ADE_SMOKE: "",
    SVATAH_ADE_PROJECT: project,
  };
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

const workspace = mkdtempSync(join(tmpdir(), "svatah-desktop-"));
const healState = join(workspace, "heal-state.json");
const passes = [];
let running;

const stop = () => {
  try {
    running?.kill("SIGTERM");
  } catch {
    // Already gone.
  }
  running = undefined;
  if (process.platform === "darwin") {
    // Started by LaunchServices, so there is no child to signal. The executable
    // path is unique to this checkout's packaged build.
    spawnSync("pkill", ["-f", app], { encoding: "utf8" });
  }
};
process.on("exit", stop);

try {
  for (const variant of [0, 1, 2]) {
    const launched = await launch(variant);
    running = launched.child;
    if (launched.timedOut) {
      stop();
      die(
        2,
        `The ADE was launched at variant ${variant} but ` +
          (launched.windowAt === undefined
            ? `showed no window within ${WINDOW_TIMEOUT_MS} ms`
            : `showed no open project within ${WINDOW_TIMEOUT_MS} ms ` +
              `(its window appeared after ${launched.windowAt} ms; SVATAH_ADE_PROJECT=${project})`) +
          ". That is a launch failure, not an adapter failure, and it is " +
          "reported as one so the report is not a list of cases that never had anything to read.\n" +
          `Nothing was written to ${report}.\n` +
          `\`svatah surface doctor --adapter ${adapter}\` said:\n${doctorOutput}`,
      );
    }

    const jsonPath = join(workspace, `variant-${variant}.json`);
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
        healState,
        "--json",
      ],
      { encoding: "utf8", cwd: project, maxBuffer: 64 * 1024 * 1024 },
    );
    process.stderr.write(conform.stderr ?? "");
    stop();

    let parsed;
    try {
      parsed = JSON.parse(conform.stdout ?? "");
    } catch {
      die(
        1,
        `The suite produced no report at variant ${variant}.\n${conform.stdout ?? ""}\n${conform.stderr ?? ""}`,
      );
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
        `${bridge.invocations} process invocation per snapshot.`,
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
  if (process.env["SVATAH_KEEP_WORKSPACE"] !== "1") {
    rmSync(workspace, { recursive: true, force: true });
  } else {
    process.stderr.write(`kept ${workspace}\n`);
  }
}
