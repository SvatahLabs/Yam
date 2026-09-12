/**
 * Who macOS is actually being asked to trust, and how to ask it (native-feedback D6).
 *
 * ## The thing everybody gets wrong
 *
 * macOS attaches Accessibility and Screen Recording to the **responsible
 * process** — the application that owns the process tree — and not to the
 * program that calls the API. `yam` is a Node script; nothing is ever granted
 * to it. What gets granted is the terminal, the editor or the MCP client that
 * spawned it, which is why a permission granted to Terminal does not carry to
 * iTerm, to VS Code, or to Claude Desktop.
 *
 * The old advice said "add the terminal (or the test runner) you are running
 * from", which is correct and useless: a reader who did not already know this
 * has no way to tell which of the six programs on their screen that is. This
 * module answers it by name, so the sentence becomes "add **iTerm**
 * (`/Applications/iTerm.app`)".
 *
 * ## Why the outermost bundle
 *
 * The ancestry of a `yam` run reaches launchd through anything: a shell, a
 * Python harness whose interpreter lives inside a `Python.app` stub in a
 * Homebrew cellar, an `iTermServer` helper. The *nearest* application ancestor
 * is therefore often the wrong one — `Python.app` is not what a person adds to
 * a settings pane. Responsibility flows from the top-level application the user
 * launched, so the outermost bundle before launchd is the answer, and on a host
 * with none (ssh, CI) the honest answer is that no application owns this at
 * all.
 */
import { spawnSync } from "node:child_process";

/** The application a macOS permission would be attached to. */
export interface ResponsibleProgram {
  /** `iTerm`, `Claude`, `Terminal` — what the settings pane calls it. */
  readonly name: string;
  /** `/Applications/iTerm.app`, when an application owns this process. */
  readonly bundlePath?: string;
  /** False on a host where no application does: ssh, cron, a CI runner. */
  readonly isApplication: boolean;
}

/** How this module reaches the host; replaced in tests. */
export interface GrantRunner {
  run(command: string, args: readonly string[]): { status: number | null; stdout: string };
}

const systemGrantRunner: GrantRunner = {
  run(command, args) {
    const ran = spawnSync(command, [...args], { encoding: "utf8", timeout: 20_000 });
    return { status: ran.status, stdout: `${ran.stdout ?? ""}` };
  },
};

/**
 * The application that owns this process, by walking `ps` to launchd.
 *
 * One `ps`, not one per level: the walk is over a map built from a single
 * listing, because a probe a person is waiting on may not spawn a process per
 * ancestor.
 */
export function responsibleProgram(
  options: { runner?: GrantRunner; pid?: number; platform?: string } = {},
): ResponsibleProgram {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    return { name: "this program", isApplication: false };
  }
  const runner = options.runner ?? systemGrantRunner;
  const listing = runner.run("ps", ["-eo", "pid=,ppid=,comm="]);
  if (listing.status !== 0) return { name: "this program", isApplication: false };

  const parents = new Map<number, { parent: number; command: string }>();
  for (const line of listing.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match === null) continue;
    parents.set(Number(match[1]), { parent: Number(match[2]), command: match[3]!.trim() });
  }

  /*
   * Every application ancestor, nearest first, and the last one wins. A bounded
   * walk: a cycle in a process table would otherwise hang a doctor.
   */
  const bundles: string[] = [];
  let at = options.pid ?? process.pid;
  for (let step = 0; step < 64; step += 1) {
    const entry = parents.get(at);
    if (entry === undefined || entry.parent === at) break;
    const bundle = bundleOf(entry.command);
    if (bundle !== undefined) bundles.push(bundle);
    if (entry.parent <= 1) break;
    at = entry.parent;
  }

  const outermost = bundles[bundles.length - 1];
  if (outermost === undefined) return { name: "this program", isApplication: false };
  return {
    name: (outermost.split("/").pop() ?? outermost).replace(/\.app$/, ""),
    bundlePath: outermost,
    isApplication: true,
  };
}

/** `/Applications/iTerm.app/Contents/MacOS/iTerm2` → `/Applications/iTerm.app`. */
function bundleOf(command: string): string | undefined {
  const at = command.indexOf(".app/Contents/MacOS/");
  return at === -1 ? undefined : command.slice(0, at + 4);
}

/** How to say "add this program" when the program has a name. */
export function nameFor(who: ResponsibleProgram): string {
  if (!who.isApplication) return "the program running Yam";
  return who.bundlePath === undefined ? who.name : `${who.name} (\`${who.bundlePath}\`)`;
}

/**
 * Is Screen Recording granted?
 *
 * `CGPreflightScreenCaptureAccess` asks TCC directly and never prompts, which
 * is what a probe wants. The old check ran `screencapture` against a file in
 * `tmpdir` and read its exit code — a spawn, a write, and an answer that
 * conflated "not granted" with "the disk is full".
 */
export function screenRecordingGranted(options: { runner?: GrantRunner; platform?: string } = {}):
  | boolean
  | undefined {
  return askTcc(SCREEN_PREFLIGHT_SCRIPT, options);
}

/**
 * Ask macOS to show the Accessibility prompt, and answer whether it is granted.
 *
 * The prompt is shown **once per application per service**. A program that was
 * refused, or that dismissed the dialog, will never see it again however often
 * this is called — so a caller must treat `false` as "send them to System
 * Settings" rather than "ask again".
 */
export function requestAccessibility(options: { runner?: GrantRunner; platform?: string } = {}):
  | boolean
  | undefined {
  return askTcc(ACCESSIBILITY_REQUEST_SCRIPT, options);
}

/** The same, for Screen Recording. Also once per application, forever. */
export function requestScreenRecording(options: { runner?: GrantRunner; platform?: string } = {}):
  | boolean
  | undefined {
  return askTcc(SCREEN_REQUEST_SCRIPT, options);
}

/** Whether Accessibility is granted, without showing anything. */
export function accessibilityGranted(options: { runner?: GrantRunner; platform?: string } = {}):
  | boolean
  | undefined {
  return askTcc(ACCESSIBILITY_PREFLIGHT_SCRIPT, options);
}

/** Run one TCC script; `undefined` is "could not ask", never "no". */
function askTcc(
  script: string,
  options: { runner?: GrantRunner; platform?: string },
): boolean | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") return undefined;
  const runner = options.runner ?? systemGrantRunner;
  const ran = runner.run("osascript", ["-l", "JavaScript", "-e", script]);
  if (ran.status !== 0) return undefined;
  const said = ran.stdout.trim();
  if (said === "true") return true;
  if (said === "false") return false;
  return undefined;
}

/*
 * The TCC calls, through the ObjC bridge `bridge.ts` already uses for
 * `CGSessionCopyCurrentDictionary`. No native module: these are two C
 * functions, and `osascript -l JavaScript` can reach both.
 *
 * `AXIsProcessTrustedWithOptions` is auto-bridged from ApplicationServices;
 * `CGPreflightScreenCaptureAccess` and `CGRequestScreenCaptureAccess` are not,
 * and are bound by hand.
 */
const ACCESSIBILITY_PREFLIGHT_SCRIPT = `ObjC.import('ApplicationServices');
const options = $.NSDictionary.dictionaryWithObjectForKey(
  $.NSNumber.numberWithBool(false), $.kAXTrustedCheckOptionPrompt);
String($.AXIsProcessTrustedWithOptions(options));`;

const ACCESSIBILITY_REQUEST_SCRIPT = `ObjC.import('ApplicationServices');
const options = $.NSDictionary.dictionaryWithObjectForKey(
  $.NSNumber.numberWithBool(true), $.kAXTrustedCheckOptionPrompt);
String($.AXIsProcessTrustedWithOptions(options));`;

const SCREEN_PREFLIGHT_SCRIPT = `ObjC.import('CoreGraphics');
ObjC.bindFunction('CGPreflightScreenCaptureAccess', ['bool', []]);
String($.CGPreflightScreenCaptureAccess());`;

const SCREEN_REQUEST_SCRIPT = `ObjC.import('CoreGraphics');
ObjC.bindFunction('CGRequestScreenCaptureAccess', ['bool', []]);
String($.CGRequestScreenCaptureAccess());`;
