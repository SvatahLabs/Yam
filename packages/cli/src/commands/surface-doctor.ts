/**
 * `svatah surface doctor` (T6.1, T6.2, LLD §7.5, REQ-ADP-6, 7, REQ-NFR-7).
 *
 * > AX: […] documents the accessibility permission prompt and provides a
 * > `svatah surface doctor` check.
 *
 * The desktop adapters are the only ones with a **host requirement that is not
 * a dependency**. A browser is installed by `pnpm browsers`; an Appium server is
 * a URL. macOS's Accessibility permission and Windows's UI Automation are
 * granted, or present, on the machine — and when they are not, everything above
 * them fails as a `locator` failure for an element that was there all along.
 * This is the command that says so before a run does.
 *
 * It lives in `@svatah/cli` rather than in `@svatah/bindings-cli`, where the
 * rest of `surface` lives, because it has to reach the desktop adapters and
 * module (a)'s command line has neither in its dependency tree (LLD §1).
 *
 * Exit 0 when every check on this platform passes, 1 when one does not — so a CI
 * job can gate a desktop conformance run on it rather than discovering the
 * permission is missing halfway through a suite.
 */
import { boolOption, stringOption, EXIT, type CommandIo, type ExitCode, type ParsedArgs } from "@svatah/bindings-cli";
import { describeRuntime, resolveNodeRuntime, SUPPORTED_NODE_MAJOR } from "@svatah/service/runtime";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SurfaceCheck {
  readonly adapter: string;
  readonly name: string;
  readonly ok: boolean;
  /** `true` when this platform cannot run the adapter at all. */
  readonly skipped?: boolean;
  /**
   * `true` when failing this does not stop a run (T8.2).
   *
   * Screen Recording is the case it exists for: without it `screencapture`
   * refuses and a run has no screenshots, but the accessibility tree — which is
   * what the adapter drives — reads perfectly. Making it fatal would stop a
   * conformance gate that would have passed; leaving it out means whoever finds
   * an empty screenshot directory has nothing to look at.
   */
  readonly advisory?: boolean;
  readonly detail: string;
  /** What to do about it, written for whoever ran the command. */
  readonly fix?: string;
  /**
   * A machine-readable answer for the checks that have more than two (P10-F5).
   *
   * `ax/session` is the one: `usable`, `locked`, `no-session` and `unknown` are
   * four different things and `ok: false` is the same word for the last three.
   * The desktop gate reads this to decide whether it may name a cause at all —
   * "the probe did not answer" is not one.
   */
  readonly state?: string;
}

export async function surfaceDoctorCommand(
  args: ParsedArgs,
  io: CommandIo,
): Promise<ExitCode> {
  const only = stringOption(args, "adapter");
  const checks: SurfaceCheck[] = [];

  checks.push({
    adapter: "-",
    name: "platform",
    ok: true,
    detail: `${process.platform} ${process.arch}, Node v${process.versions.node}`,
  });

  checks.push(runtimeCheck());

  if (only === undefined || only === "ax") checks.push(...(await axChecks()));
  if (only === undefined || only === "uia") checks.push(...(await uiaChecks()));

  if (boolOption(args, "json")) {
    io.out(JSON.stringify({ checks }, null, 2));
  } else {
    for (const check of checks) {
      const mark =
        check.skipped === true ? "skip" : check.ok ? "ok  " : check.advisory === true ? "warn" : "FAIL";
      io.out(`${mark}  ${`${check.adapter}/${check.name}`.padEnd(22)} ${check.detail}`);
      if (!check.ok && check.skipped !== true && check.fix !== undefined) {
        for (const line of wrap(check.fix)) io.out(`      → ${line}`);
      }
    }
  }

  return checks.every((check) => check.ok || check.skipped === true || check.advisory === true)
    ? EXIT.ok
    : EXIT.failed;
}

/**
 * Which Node the ADE would run `svatah serve` with (Draft 2.9 §13.6, T8.1).
 *
 * "`svatah surface doctor` and the ADE's own smoke check report which runtime
 * was chosen." It is a desktop-gate check like the other two: the gate drives
 * the ADE's project screen, and an ADE that cannot resolve a runtime never has
 * one. Asking here means the answer is available without launching an
 * application and watching it fail to open anything.
 *
 * The CLI passed to the resolver is *this* CLI, which is where a packaged ADE
 * looks for a Node beside it.
 */
function runtimeCheck(): SurfaceCheck {
  const resolution = resolveNodeRuntime({ cli: fileURLToPath(import.meta.url) });
  return {
    adapter: "ade",
    name: "node-runtime",
    ok: resolution.runtime !== undefined,
    detail: describeRuntime(resolution),
    fix:
      `The ADE spawns \`svatah serve\` with a resolved Node, never with its own binary. ` +
      `Install Node ${SUPPORTED_NODE_MAJOR} LTS or newer so that \`node\` is on PATH, or set ` +
      "SVATAH_NODE to the interpreter to use. Looked in: " +
      resolution.attempts
        .map((one) => `${one.where}${one.rejected === undefined ? "" : ` (${one.rejected})`}`)
        .join("; ") +
      ".",
  };
}

/** The macOS Accessibility permission (REQ-ADP-7). */
async function axChecks(): Promise<SurfaceCheck[]> {
  if (process.platform !== "darwin") {
    return [
      {
        adapter: "ax",
        name: "platform",
        ok: false,
        skipped: true,
        detail: "not macOS",
      },
    ];
  }

  const { osascriptBridge } = await import("@svatah/adapter-ax");
  const bridge = osascriptBridge({ process: "System Events" });
  const permission = await bridge.permission();
  /*
   * The login session (Draft 2.12 §7.5, P9-F7).
   *
   * > `svatah surface doctor --adapter ax` also reports `ax/session`: whether
   * > any process in the login session owns an on-screen window; when only
   * > `loginwindow` does, the display is locked or the session has no
   * > WindowServer, and the gate names that as the cause of its exit 2 rather
   * > than a launch failure.
   *
   * Advisory, like Screen Recording (LLD §15's severities: `warn`, exit
   * unchanged). A locked display is not a *setting that is wrong* — nothing has
   * to be granted or installed — it is a machine nobody is sitting at, and the
   * adapter itself is perfectly ready. What it changes is what the desktop gate
   * can do, and `scripts/desktop-conformance.mjs` is what reads this line.
   */
  const session = await bridge.session();
  return [
    {
      adapter: "ax",
      name: "accessibility",
      ok: permission.state === "granted",
      detail: permission.state + (permission.detail === undefined ? "" : ` — ${permission.detail}`),
      fix: permission.advice,
    },
    {
      adapter: "ax",
      name: "session",
      ok: session.usable,
      advisory: true,
      state: session.state,
      detail: session.detail,
      fix: session.advice,
    },
    screenRecordingCheck(),
  ];
}

/**
 * Screen Recording, which is a *different* grant from Accessibility (T8.2).
 *
 * LLD §7.5: "screenshots via OS APIs". On macOS that is `screencapture`, and it
 * answers `could not create image from display` — exit 1, nothing written —
 * when the program running Svatah has not been granted Screen Recording. The
 * accessibility tree is unaffected, so this is advisory: a run keeps its
 * results and loses its pictures, and this is the line that says which.
 */
function screenRecordingCheck(): SurfaceCheck {
  const probe = spawnSync("screencapture", ["-x", "-R", "0,0,1,1", devNull()], {
    encoding: "utf8",
    timeout: 20_000,
  });
  const ok = probe.status === 0;
  const detail = (probe.stderr ?? "").trim();
  return {
    adapter: "ax",
    name: "screen-recording",
    ok,
    advisory: true,
    detail: ok ? "granted" : `refused — ${detail === "" ? "screencapture exited non-zero" : detail}`,
    fix:
      "Screenshots come from `screencapture`, which needs Screen Recording — a different grant " +
      "from Accessibility. Open System Settings → Privacy & Security → Screen & System Audio " +
      "Recording, switch it on for the program running Svatah, and restart it. Without it the " +
      "adapter still reads the accessibility tree; a run simply has no screenshots.",
  };
}

/** A path `screencapture` can write to and nobody has to clean up. */
function devNull(): string {
  return join(tmpdir(), `svatah-screencapture-probe-${process.pid}.png`);
}

/** Windows UI Automation (REQ-ADP-6). */
async function uiaChecks(): Promise<SurfaceCheck[]> {
  if (process.platform !== "win32") {
    return [{ adapter: "uia", name: "platform", ok: false, skipped: true, detail: "not Windows" }];
  }

  const { powershellBridge } = await import("@svatah/adapter-uia");
  const availability = await powershellBridge({ process: "" }).availability();
  return [
    {
      adapter: "uia",
      name: "ui-automation",
      ok: availability.state === "available",
      detail:
        availability.state + (availability.detail === undefined ? "" : ` — ${availability.detail}`),
      fix: availability.advice,
    },
  ];
}

/** Wrap advice at a width a terminal can read, without a dependency. */
function wrap(text: string, width = 88): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line === "") line = word;
    else if (line.length + word.length + 1 <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}
