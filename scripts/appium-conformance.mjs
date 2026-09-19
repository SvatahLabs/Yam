#!/usr/bin/env node
/**
 * The emulator gate: Android Chrome through the Appium adapter, against the
 * sample application (T4.2, REQ-ADP-5, LLD §7.4, §14).
 *
 *   node scripts/appium-conformance.mjs [--report reports/adapter-appium.md] [--only <ids>]
 *
 * `packages/adapter-appium/README.md` ("The emulator gate") has always said how
 * to run this by hand, one command at a time, and nobody had run it: the
 * adapter's conversion, candidate mapping, action table and predicates are unit
 * tested against recorded page sources and a fake device, and what no fake can
 * say is that a real driver accepts these selectors and a real screen looks like
 * the fixtures. This is that README's step 4 as one command, so CI's nightly
 * `appium-emulator` job can run it and a person with an emulator runs the same
 * thing.
 *
 * It does not start Appium or the emulator — both are far slower to start than
 * anything here, and CI's emulator action owns the emulator's life. It asks for
 * each, starts the sample application itself, runs the README's subset through
 * `yam surface conform --adapter appium`, and writes one report.
 *
 * Exit 0 when every case in the subset passed, 1 when one did not (or the suite
 * produced no report), 2 when the host is not ready — the same three answers as
 * `scripts/desktop-conformance.mjs`, for the same reason: "no emulator" and
 * "the adapter is wrong" send whoever reads it to different places. Nothing is
 * written on a 2.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};

/** Against the current directory, as `desktop-conformance.mjs` resolves its own (F6). */
const report = resolve(option("report", join(ROOT, "reports", "adapter-appium.md")));

/**
 * The README's subset: the cases that need no windows, dialogs, frames or file
 * picker, which a phone does not have. The whole suite would also be correct —
 * a case whose capability `APPIUM_CAPABILITIES` declares false is skipped, not
 * failed (LLD §14) — but these are the ones that say something about a phone.
 */
const SUBSET = [
  "home.snapshot",
  "home.click-navigates",
  "login.snapshot-states",
  "login.type-changes-value",
  "login.checkbox-state",
  "login.describe",
  "login.locate-cardinality",
  "dashboard.read-kinds",
  "dashboard.state",
  "widgets.select",
  "errors.typed",
  "capabilities.descriptor",
];
const only = option("only", SUBSET.join(","))
  .split(",")
  .map((one) => one.trim())
  .filter((one) => one !== "");

/**
 * The sample application's port on this machine, and the address the emulator
 * reaches it at. `10.0.2.2` is the Android emulator's alias for the host's
 * loopback interface, which is where `startSampleApp` listens.
 */
const PORT = 4173;
const BASE_URL = option("base-url", `http://10.0.2.2:${PORT}`);
const APPIUM_URL = (process.env["YAM_APPIUM_URL"] ?? "http://127.0.0.1:4723").replace(/\/+$/, "");
const APPIUM_TIMEOUT_MS = Number(option("appium-timeout-ms", "120000"));
/** The whole suite, as an outer bound: twelve cases open twelve Chrome sessions. */
const SUITE_TIMEOUT_MS = Number(option("suite-timeout-ms", String(35 * 60_000)));

const die = (code, message) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

/* ── 1. this checkout ─────────────────────────────────────────────────────── */

if (!existsSync(CLI)) die(2, "Run `pnpm -r build` first: there is no packages/cli/dist/bin.js.");

/*
 * WebdriverIO, resolved from where the adapter resolves it (PK-03).
 *
 * It is an optional peer of `@svatah/yam-adapter-appium` and a devDependency of
 * it in this workspace, so `pnpm install` links it into the adapter's own
 * `node_modules`. Asked from the adapter's directory because that is where its
 * `import("webdriverio")` runs: a probe from anywhere else asks a different
 * question under pnpm's strict layout.
 */
try {
  createRequire(join(ROOT, "packages", "adapter-appium", "package.json")).resolve("webdriverio");
} catch (error) {
  die(
    2,
    "`webdriverio` does not resolve from packages/adapter-appium, and the Appium adapter " +
      "cannot open a session without it. Run `pnpm install` in the workspace.\n" +
      `(${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
  );
}

/* ── 2. the device ────────────────────────────────────────────────────────── */

/**
 * `adb`, from the PATH or from the SDK the environment names. CI's emulator
 * action installs platform-tools under `ANDROID_HOME`; a person's SDK may not be
 * on their PATH at all.
 */
function findAdb() {
  const onPath = spawnSync("adb", ["version"], { encoding: "utf8", timeout: 15_000 });
  if (onPath.error === undefined && onPath.status === 0) return "adb";
  for (const sdk of [process.env["ANDROID_HOME"], process.env["ANDROID_SDK_ROOT"]]) {
    if (sdk === undefined || sdk === "") continue;
    const candidate = join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const adb = findAdb();
if (adb === undefined) {
  die(
    2,
    "There is no `adb` on the PATH or under ANDROID_HOME/ANDROID_SDK_ROOT, so there is no " +
      "device to ask. Install the Android SDK's platform-tools and start an emulator.",
  );
}

const shell = (serial, command, timeout = 30_000) => {
  const ran = spawnSync(adb, ["-s", serial, "shell", ...command], { encoding: "utf8", timeout });
  return ran.status === 0 ? (ran.stdout ?? "").trim() : undefined;
};

/*
 * One device, in the `device` state. `ANDROID_SERIAL` picks one when there are
 * several, which is what `adb` itself honours.
 */
const listed = spawnSync(adb, ["devices"], { encoding: "utf8", timeout: 30_000 });
const devices = (listed.stdout ?? "")
  .split("\n")
  .slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter((parts) => parts.length >= 2 && parts[1] === "device")
  .map((parts) => parts[0]);
const serial = process.env["ANDROID_SERIAL"] || devices[0];
if (serial === undefined || !devices.includes(serial)) {
  die(
    2,
    `No Android device is attached and ready (\`adb devices\` said: ${(listed.stdout ?? "").trim() || "nothing"}).\n` +
      "Start an emulator (`emulator -avd <name> -no-window`) and wait for `adb wait-for-device`.",
  );
}

/* Booted, not merely attached: `adb` sees an emulator long before it can run Chrome. */
{
  const until = Date.now() + 180_000;
  while (shell(serial, ["getprop", "sys.boot_completed"]) !== "1") {
    if (Date.now() > until) die(2, `${serial} is attached but did not finish booting within 180 s.`);
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 2000)"]);
  }
}

/*
 * Chrome itself (T4.2). An emulator image without it — the AOSP `default`
 * images and the ATD ones — can run every other part of this and never this, so
 * it is a host that is not ready, said as such, rather than twelve failed cases
 * whose every error is "no such browser".
 */
if (!(shell(serial, ["pm", "path", "com.android.chrome"]) ?? "").startsWith("package:")) {
  die(
    2,
    `${serial} has no Chrome (\`pm path com.android.chrome\` found nothing). Use a system image ` +
      "that ships it: a `google_apis` or `google_apis_playstore` target, not `default` or an ATD one.",
  );
}
const apiLevel = shell(serial, ["getprop", "ro.build.version.sdk"]) ?? "unknown";
const chromeVersion =
  /versionName=(\S+)/u.exec(shell(serial, ["dumpsys", "package", "com.android.chrome"]) ?? "")?.[1] ??
  "unknown";

/*
 * Chrome's first-run screens.
 *
 * ChromeDriver starts Chrome on Android with `--disable-fre` by writing
 * `/data/local/tmp/chrome-command-line`, and Chrome reads that file only on a
 * debuggable build or for the app named as the debug app. `google_apis` images
 * are debuggable; a Play Store image is not, and there the welcome screens
 * would sit in front of every page. Naming Chrome the debug app is harmless on
 * the first and is what makes the second behave like it.
 */
shell(serial, ["am", "set-debug-app", "--persistent", "com.android.chrome"]);

/* ── 3. Appium ────────────────────────────────────────────────────────────── */

/** Poll `/status` until the server says it is ready, and answer with what it said. */
async function waitForAppium() {
  const until = Date.now() + APPIUM_TIMEOUT_MS;
  let last = "nothing answered";
  while (Date.now() < until) {
    try {
      const response = await fetch(`${APPIUM_URL}/status`, { signal: AbortSignal.timeout(5_000) });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body?.value?.ready !== false) return body?.value ?? {};
      last = `HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((done) => setTimeout(done, 2_000));
  }
  die(
    2,
    `No Appium server answered ready at ${APPIUM_URL}/status within ${APPIUM_TIMEOUT_MS} ms (${last}).\n` +
      "Start one: `appium --port 4723 --allow-insecure chromedriver_autodownload`, with the " +
      "UiAutomator2 driver installed (`appium driver install uiautomator2`). Set YAM_APPIUM_URL " +
      "if it listens elsewhere.",
  );
  return undefined;
}

const appium = await waitForAppium();
const appiumVersion = appium?.build?.version ?? "unknown";

/* ── 4. the sample application ────────────────────────────────────────────── */

/*
 * Served from this process on the port the emulator's `10.0.2.2` reaches. A
 * port that is already taken is fine when what holds it is the sample
 * application — a person's own `pnpm sample-web` — and a host that is not ready
 * when it is anything else, because every case would navigate to it.
 */
let sampleWeb;
try {
  const { startSampleApp } = await import("sample-web");
  sampleWeb = await startSampleApp(PORT).catch(async (error) => {
    if (error?.code !== "EADDRINUSE") throw error;
    const answered = await fetch(`http://127.0.0.1:${PORT}/api/variants`, {
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
    if (answered?.ok !== true) {
      die(2, `Port ${PORT} is taken by something that is not the sample application.`);
    }
    process.stderr.write(`sample-web: port ${PORT} is already served by the sample application; using it\n`);
    return undefined;
  });
} catch (error) {
  die(
    2,
    "The sample application could not be started; run `pnpm -r build` first.\n" +
      `(${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
  );
}

/* ── 5. the suite ─────────────────────────────────────────────────────────── */

/*
 * The capabilities the README names, and three timeouts a CI emulator needs:
 * the first session installs the UiAutomator2 server's two APKs, which on a
 * software-rendered emulator takes longer than the driver's defaults allow.
 * `YAM_APPIUM_CAPS` from the environment is merged over these, so a person can
 * point the gate at a different device or browser without editing this file.
 */
const fromEnvironment = (() => {
  const raw = process.env["YAM_APPIUM_CAPS"];
  if (raw === undefined || raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return die(2, "YAM_APPIUM_CAPS is set and is not JSON.");
  }
})();
const capabilities = {
  platformName: "Android",
  "appium:automationName": "UiAutomator2",
  "appium:udid": serial,
  browserName: "Chrome",
  "appium:newCommandTimeout": 300,
  "appium:adbExecTimeout": 120_000,
  "appium:uiautomator2ServerInstallTimeout": 120_000,
  "appium:uiautomator2ServerLaunchTimeout": 120_000,
  ...fromEnvironment,
};

process.stderr.write(
  `appium gate: ${serial} (API ${apiLevel}, Chrome ${chromeVersion}), Appium ${appiumVersion} at ` +
    `${APPIUM_URL}, sample application at ${BASE_URL}, ${only.length} case(s)\n`,
);

/*
 * Asynchronously, not with `spawnSync`: the sample application is served from
 * *this* event loop, and a synchronous child would leave every request Chrome
 * makes waiting until the suite had finished.
 */
const conform = await new Promise((done) => {
  let stdout = "";
  const child = spawn(
    process.execPath,
    [CLI, "surface", "conform", "--adapter", "appium", "--base-url", BASE_URL, "--only", only.join(","), "--json"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        YAM_APPIUM_URL: APPIUM_URL,
        YAM_APPIUM_CAPS: JSON.stringify(capabilities),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const timer = setTimeout(() => {
    process.stderr.write(`the suite did not finish within ${SUITE_TIMEOUT_MS} ms; stopping it\n`);
    child.kill("SIGTERM");
  }, SUITE_TIMEOUT_MS);
  child.stdout.on("data", (chunk) => (stdout += String(chunk)));
  // Streamed, so a twelve-session run shows its progress rather than a silence.
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("close", (code) => {
    clearTimeout(timer);
    done({ code, stdout });
  });
});

await sampleWeb?.close().catch(() => undefined);

let parsed;
try {
  parsed = JSON.parse(conform.stdout.slice(conform.stdout.indexOf("{")));
} catch {
  die(
    1,
    `The suite produced no report (exit ${conform.code ?? "none"}). Nothing was written to ${report}.\n` +
      conform.stdout.slice(-2_000),
  );
}

/*
 * Every case that was asked for, ran. `--only` filters the suite by id and says
 * nothing about an id it does not have, so a case renamed in
 * `packages/conformance` would drop out of this subset silently and the gate
 * would stay green over one case fewer.
 */
const ran = new Set((parsed.cases ?? []).map((one) => one.id));
const missing = only.filter((id) => !ran.has(id));
const failed = (parsed.cases ?? []).filter((one) => one.status === "failed");
const skipped = (parsed.cases ?? []).filter((one) => one.status === "skipped");
const conformant = parsed.conformant === true && missing.length === 0;

/* ── 6. the report ────────────────────────────────────────────────────────── */

const { renderMarkdown } = await import(
  pathToFileURL(join(ROOT, "packages", "conformance", "dist", "index.js")).href
);

const lines = [
  "# Appium conformance — Android Chrome on an emulator",
  "",
  `Run at ${new Date().toISOString()} on ${process.platform} ${process.arch}, Node ${process.version}.`,
  "",
  `Device \`${serial}\`, API level ${apiLevel}, Chrome ${chromeVersion}. Appium ${appiumVersion} at ` +
    `\`${APPIUM_URL}\`. The sample application at \`${BASE_URL}\`, which is this machine's loopback ` +
    "as the emulator reaches it.",
  "",
  conformant
    ? `**Conformant over the subset.** ${parsed.totals.passed} of ${only.length} case(s) passed` +
      `${skipped.length === 0 ? "" : `, ${skipped.length} skipped`} (REQ-ADP-5, REQ-SURF-3).`
    : `**Not conformant.** ${failed.length} case(s) failed` +
      `${missing.length === 0 ? "" : `; ${missing.length} asked for and not in the suite: ${missing.map((id) => `\`${id}\``).join(", ")}`}.`,
  "",
  "The subset is `packages/adapter-appium/README.md`'s: the cases that need no windows, dialogs, " +
    "frames or file picker. The rest of the suite skips on a phone rather than failing.",
  "",
  "Capabilities:",
  "",
  "```json",
  JSON.stringify(capabilities, null, 2),
  "```",
  "",
  renderMarkdown(parsed)
    .split("\n")
    .map((line) => (line.startsWith("#") ? `#${line}` : line))
    .join("\n"),
];

mkdirSync(dirname(report), { recursive: true });
writeFileSync(report, `${lines.join("\n")}\n`, "utf8");
process.stderr.write(`wrote ${report}\n`);

process.stdout.write(
  conformant
    ? `"appium" is conformant over the subset — ${parsed.totals.passed} case(s) → ${report}\n`
    : `"appium" is NOT conformant — ${[...failed.map((one) => one.id), ...missing.map((id) => `${id} (missing)`)].join(", ")} → ${report}\n`,
);
process.exit(conformant ? 0 : 1);
