/**
 * `yam surface doctor` (T6.1, T6.2, LLD §7.5, REQ-ADP-6, 7, REQ-NFR-7).
 *
 * > AX: […] documents the accessibility permission prompt and provides a
 * > `yam surface doctor` check.
 *
 * Every adapter has a **host requirement that is not a dependency**: installing
 * Yam installs all eight drivers and none of what they drive. A browser binary
 * is `npx playwright install`; an Appium server is a URL that has to answer; a
 * pseudo-terminal is `expect` or a `python3` with its `pty` module; macOS's
 * Accessibility permission and Windows's UI Automation are granted, or present,
 * on the machine. When any of them is missing, everything above it fails as a
 * `locator` failure for an element that was there all along. This is the
 * command that says so before a run does.
 *
 * It asks about **all eight**, not the two desktop ones. Readiness for the
 * other six lived only in `probeAdapter` — which `surface targets` and the
 * support matrix read — so there were two readiness reporters with different
 * coverage, and the diagnostics pointed a stuck reader at the narrower one. The
 * probe is still the single source of "can this host reach it": this command
 * asks it, and adds the permission and session checks that only the desktop
 * adapters have.
 *
 * It lives in `@svatah/yam` rather than in `@svatah/yam-bindings-cli`, where the
 * rest of `surface` lives, because it has to reach the desktop adapters and
 * module (a)'s command line has neither in its dependency tree (LLD §1).
 *
 * Exit 0 when every check on this platform passes, 1 when one does not — so a CI
 * job can gate a desktop conformance run on it rather than discovering the
 * permission is missing halfway through a suite.
 */
import { boolOption, stringOption, EXIT, type CommandIo, type ExitCode, type ParsedArgs } from "@svatah/yam-bindings-cli";
import { describeRuntime, resolveNodeRuntime, SUPPORTED_NODE_MAJOR } from "@svatah/yam-service/runtime";
import { fileURLToPath } from "node:url";
import { probeAdapter } from "@svatah/yam-surface-control";

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

/**
 * Every adapter Yam ships, in the order `surface targets` lists them.
 *
 * Named here rather than derived from `listAdapters()` so that `--adapter foo`
 * can be refused with the list, and so the order a person reads is stable.
 */
export const ADAPTERS = ["playwright", "bidi", "ax", "uia", "atspi", "process", "http", "appium"] as const;

/** The adapters whose own checks follow their `reachable` line. */
const DEEPER_CHECKS = new Set(["ax", "uia"]);

/** Whether an adapter is simply for another operating system. */
function forAnotherPlatform(adapter: string): boolean {
  if (adapter === "ax") return process.platform !== "darwin";
  if (adapter === "uia") return process.platform !== "win32";
  if (adapter === "atspi") return process.platform !== "linux";
  if (adapter === "process") return process.platform === "win32";
  return false;
}

export async function surfaceDoctorCommand(
  args: ParsedArgs,
  io: CommandIo,
): Promise<ExitCode> {
  const only = stringOption(args, "adapter");
  const checks: SurfaceCheck[] = [];

  if (only !== undefined && !(ADAPTERS as readonly string[]).includes(only)) {
    io.err(`"${only}" is not an adapter. Yam ships: ${ADAPTERS.join(", ")}.`);
    return EXIT.usage;
  }

  checks.push({
    adapter: "-",
    name: "platform",
    ok: true,
    detail: `${process.platform} ${process.arch}, Node v${process.versions.node}`,
  });

  checks.push(runtimeCheck());

  /*
   * One `reachable` line per adapter, then that adapter's own checks — grouped,
   * so everything about `ax` is read in one place rather than in two halves at
   * opposite ends of the output.
   *
   * `skipped` when the adapter is for another operating system: a macOS host is
   * not misconfigured for having no UI Automation, and an exit code that said
   * so would fail every CI job on every platform.
   *
   * **Advisory unless it was asked for by name.** Installing Yam installs all
   * eight drivers and none of what they drive, so "no Appium server answered"
   * is the ordinary state of a laptop and not a fault: a bare `yam surface
   * doctor` that exited 1 on a perfectly good machine would teach everyone to
   * ignore its exit code. `--adapter appium` is a declaration of intent, and
   * there it is fatal — which is what `scripts/desktop-conformance.mjs` gates
   * on.
   */
  for (const adapter of ADAPTERS) {
    if (only !== undefined && only !== adapter) continue;
    const probe = await probeAdapter(adapter);
    checks.push({
      adapter,
      name: "reachable",
      ok: probe.present,
      ...(probe.present ? {} : { skipped: forAnotherPlatform(adapter) }),
      ...(probe.present || only !== undefined ? {} : { advisory: true }),
      /*
       * The probe's `reason` is dropped for an adapter whose own checks follow:
       * `ax`'s says the permission is asked about separately, and the next line
       * is that answer. The `fix` carries the driven range and not the reason
       * again — the reason is already the detail two lines up.
       */
      detail: probe.present
        ? `${probe.version ?? "present"}${
            probe.reason === undefined || DEEPER_CHECKS.has(adapter) ? "" : ` — ${probe.reason}`
          }`
        : (probe.reason ?? "not reachable on this host"),
      /*
       * The command that fixes it comes before the range it is driven against
       * (PK-03, PK-10). "Not installed" is a third answer — distinct from "not
       * this host", which no command fixes, and from "not configured", which a
       * different one does — and it is the only one where `doctor` can hand
       * somebody the line to run.
       */
      ...(probe.present
        ? {}
        : probe.install !== undefined
          ? { fix: `Not installed. Run \`${probe.install}\`.` }
          : probe.range === undefined
            ? {}
            : { fix: `Driven here against ${probe.range}.` }),
    });
    if (adapter === "ax" && probe.present) checks.push(...(await axChecks()));
    if (adapter === "uia" && probe.present) checks.push(...(await uiaChecks()));
  }

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
 * Which Node the app would run `yam serve` with (Draft 2.9 §13.6, T8.1).
 *
 * "`yam surface doctor` and the app's own smoke check report which runtime
 * was chosen." It is a desktop-gate check like the other two: the gate drives
 * the app's project screen, and an app that cannot resolve a runtime never has
 * one. Asking here means the answer is available without launching an
 * application and watching it fail to open anything.
 *
 * The CLI passed to the resolver is *this* CLI, which is where a packaged app
 * looks for a Node beside it.
 */
function runtimeCheck(): SurfaceCheck {
  const resolution = resolveNodeRuntime({ cli: fileURLToPath(import.meta.url) });
  return {
    adapter: "app",
    name: "node-runtime",
    ok: resolution.runtime !== undefined,
    detail: describeRuntime(resolution),
    fix:
      `The app spawns \`yam serve\` with a resolved Node, never with its own binary. ` +
      `Install Node ${SUPPORTED_NODE_MAJOR} LTS or newer so that \`node\` is on PATH, or set ` +
      "YAM_NODE to the interpreter to use. Looked in: " +
      resolution.attempts
        .map((one) => `${one.where}${one.rejected === undefined ? "" : ` (${one.rejected})`}`)
        .join("; ") +
      ".",
  };
}

/** The macOS Accessibility permission (REQ-ADP-7). */
async function axChecks(): Promise<SurfaceCheck[]> {
  // Only reached when `ax/reachable` said this is macOS and the API answered,
  // so there is no platform row here: it would repeat the line above it.
  const { osascriptBridge } = await import("@svatah/yam-adapter-ax");
  const bridge = osascriptBridge({ process: "System Events" });
  const permission = await bridge.permission();
  /*
   * The login session (Draft 2.12 §7.5, P9-F7).
   *
   * > `yam surface doctor --adapter ax` also reports `ax/session`: whether
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
    await screenRecordingCheck(),
  ];
}

/**
 * Screen Recording, which is a *different* grant from Accessibility (T8.2).
 *
 * LLD §7.5: "screenshots via OS APIs". On macOS that is `screencapture`, and it
 * answers `could not create image from display` — exit 1, nothing written —
 * when the program running Yam has not been granted Screen Recording. The
 * accessibility tree is unaffected, so this is advisory: a run keeps its
 * results and loses its pictures, and this is the line that says which.
 */
async function screenRecordingCheck(): Promise<SurfaceCheck> {
  const { screenRecordingGranted, responsibleProgram, nameFor } = await import(
    "@svatah/yam-adapter-ax"
  );
  const granted = screenRecordingGranted();
  const who = responsibleProgram();
  return {
    adapter: "ax",
    name: "screen-recording",
    // `undefined` is "could not ask", which is not the same as "refused" and
    // must not be reported as one.
    ok: granted === true,
    advisory: true,
    detail:
      granted === true ? "granted" : granted === false ? "not granted" : "could not be asked",
    fix:
      `Screenshots come from \`screencapture\`, which needs Screen Recording — a different ` +
      `grant from Accessibility, and one macOS attaches to ${nameFor(who)} rather than to Yam. ` +
      "Run `yam surface grant` to be asked for it, or open System Settings → Privacy & Security " +
      `→ Screen & System Audio Recording, switch it on for ` +
      `${who.isApplication ? who.name : "the program running Yam"}, and restart it. Without it ` +
      "the adapter still reads the accessibility tree; a run simply has no screenshots, and " +
      "`surface screenshot` refuses rather than reporting one it did not take."
  };
}

/** Windows UI Automation (REQ-ADP-6). */
async function uiaChecks(): Promise<SurfaceCheck[]> {
  // As with `ax`: `uia/reachable` has already said whether this is Windows.
  const { powershellBridge } = await import("@svatah/yam-adapter-uia");
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
