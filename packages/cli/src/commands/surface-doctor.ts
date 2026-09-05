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

export interface SurfaceCheck {
  readonly adapter: string;
  readonly name: string;
  readonly ok: boolean;
  /** `true` when this platform cannot run the adapter at all. */
  readonly skipped?: boolean;
  readonly detail: string;
  /** What to do about it, written for whoever ran the command. */
  readonly fix?: string;
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

  if (only === undefined || only === "ax") checks.push(...(await axChecks()));

  if (boolOption(args, "json")) {
    io.out(JSON.stringify({ checks }, null, 2));
  } else {
    for (const check of checks) {
      const mark = check.skipped === true ? "skip" : check.ok ? "ok  " : "FAIL";
      io.out(`${mark}  ${`${check.adapter}/${check.name}`.padEnd(22)} ${check.detail}`);
      if (!check.ok && check.skipped !== true && check.fix !== undefined) {
        for (const line of wrap(check.fix)) io.out(`      → ${line}`);
      }
    }
  }

  return checks.every((check) => check.ok || check.skipped === true) ? EXIT.ok : EXIT.failed;
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
  const permission = await osascriptBridge({ process: "System Events" }).permission();
  return [
    {
      adapter: "ax",
      name: "accessibility",
      ok: permission.state === "granted",
      detail: permission.state + (permission.detail === undefined ? "" : ` — ${permission.detail}`),
      fix: permission.advice,
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
