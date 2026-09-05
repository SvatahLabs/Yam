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

if (!existsSync(cli)) die(2, "Run `pnpm -r build` first.");

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

const app =
  process.platform === "darwin"
    ? join(ROOT, "apps", "ade", "out", "Svatah ADE-darwin-arm64", "Svatah ADE.app", "Contents", "MacOS", "Svatah ADE")
    : join(ROOT, "apps", "ade", "out", `Svatah ADE-win32-x64`, "Svatah ADE.exe");

if (!existsSync(app)) {
  die(
    2,
    `The ADE is not packaged (${app}).\n` +
      "Run: pnpm --filter @svatah/ade exec electron-forge package",
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

/** Launch the ADE at one variant and wait for its window; answer with the child. */
async function launch(variant) {
  const child = spawn(app, [], {
    stdio: "ignore",
    detached: false,
    env: {
      ...process.env,
      SVATAH_A11Y: "1",
      ...(variant === 0 ? {} : { SVATAH_A11Y_VARIANT: String(variant) }),
      SVATAH_CLI: cli,
      SVATAH_ADE_SMOKE: "",
    },
  });
  const startedAt = Date.now();
  while (Date.now() - startedAt < WINDOW_TIMEOUT_MS) {
    await sleep(1_000);
    if (hasWindow()) {
      process.stderr.write(
        `variant ${variant}: the ADE's window appeared after ${Date.now() - startedAt} ms\n`,
      );
      return { child, waitedMs: Date.now() - startedAt };
    }
  }
  return { child, waitedMs: Date.now() - startedAt, timedOut: true };
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
        `The ADE was launched at variant ${variant} but showed no window within ` +
          `${WINDOW_TIMEOUT_MS} ms. That is a launch failure, not an adapter failure, and it is ` +
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
        `${bridge.appleEvents === undefined ? "" : `, ${bridge.appleEvents} Apple events`}, ` +
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
