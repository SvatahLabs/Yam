/**
 * The one part of this adapter that touches macOS (T6.2, LLD §7.5, REQ-ADP-7).
 *
 * > AX: `AXUIElement` via a small native module; `AXRole` → role map;
 * > `AXIdentifier` → `automationId`; actions via `AXPress`, `AXSetValue`,
 * > keyboard events; documents the accessibility permission prompt and provides
 * > a `svatah surface doctor` check.
 *
 * ## Two halves: a native helper for reading, System Events for acting
 *
 * Draft 2.9 §7.5 permits exactly this split — "a native helper that reads
 * `AXUIElement` directly when the process-based bridge cannot reach 10 s" — and
 * the project screen is the measurement that forced it.
 *
 * **Reading** goes through `AXUIElementCopyAttributeValue` from inside an
 * `osascript -l JavaScript` process, which reaches the accessibility API through
 * JXA's Objective-C bridge and macOS's own BridgeSupport metadata. Nothing is
 * installed, nothing is compiled, no `node-gyp`, no licence that is not Apple's
 * own: it is a *native* read in the sense that matters — no Apple events — while
 * staying a script this repository can ship as a string (REQ-PKG-3).
 *
 * **Acting** stays on System Events (`PERFORM_SCRIPT`), because `AXUIElementPerformAction`
 * on a path is no cheaper than the Apple event and the Apple event is already
 * tested. "The desktop bridges stay process-based unless the project screen
 * cannot be read within 10 s that way, in which case a native helper is
 * permitted for the window read only, with the process bridge kept for actions."
 *
 * ## The cost, twice measured and twice wrong before this
 *
 * Phase 6 walked the tree element by element, seventeen Apple events per
 * element: **650 ms per node**, and the ADE's smallest window took ten seconds.
 *
 * Phase 7 replaced that with bulk reads over System Events — `properties of
 * every UI element of C` and one event per optional attribute — and measured
 * **10.4 ms per node** on the ADE's 199-node menu-bar tree. That number was
 * honest and it was about the wrong tree. On the ADE's *project screen*, which
 * is what §7.5's budget is about, the same bridge reads **51–55 ms per node**
 * and needs about 25 s for 488 nodes: a Chromium tree is mostly nested
 * containers, the walk costs per container, and containers are what it is made
 * of (Phase 7 verification, F2).
 *
 * Draft 2.9 offers `properties of every UI element of entire contents of window 1`
 * as the whole-window form. It does not work: System Events answers `-1700`,
 * "Can't make every UI element of entire contents…", to that and to every
 * variant of it (`properties of entire contents`, `role of entire contents`).
 * `entire contents` yields specifiers one at a time and nothing else, which is
 * the per-element read again. So the section's other option is the one taken.
 *
 * Measured here on the packaged ADE's project screen with the fixtures project
 * open: **587 nodes in 696 ms — 1.19 ms per node**, one `osascript` invocation,
 * no Apple events. Forty times cheaper than the read it replaces, and inside
 * §7.5's ten seconds with a factor of fourteen to spare.
 *
 * ## Why the bridge is an interface
 *
 * Everything above this file — role mapping, candidate synthesis, the snapshot
 * shape, the predicates — is a pure function of an `AxNode[]`. Making the
 * bridge injectable is what lets all of it be tested against recorded trees on
 * a machine with no Accessibility permission, which is the situation this was
 * written in and the situation CI is in.
 */
import { spawn } from "node:child_process";
import { availableParallelism, loadavg } from "node:os";

/**
 * One accessibility element, flattened (LLD §7.5).
 *
 * A flat array with parent indices rather than a nested tree, because that is
 * what the walk produces and what a snapshot's `depth`/`parent` need. Index 0
 * is the root; `parent: -1` marks it.
 *
 * Field names are the `AX*` attribute names with the prefix dropped, so a tree
 * recorded from a real application can be read against Apple's documentation
 * without a translation table.
 */
export interface AxNode {
  /** Index of this node's parent in the same array; `-1` for the root. */
  readonly parent: number;
  /** `AXRole`, e.g. `AXButton`. Mapped to an ARIA role by `tree.ts`. */
  readonly role: string;
  /** `AXSubrole`, e.g. `AXSearchField`. Refines the role when present. */
  readonly subrole?: string;
  /** `AXTitle`. */
  readonly title?: string;
  /** `AXDescription` — what Chromium puts an `aria-label` in. */
  readonly description?: string;
  /** `AXValue`, rendered as a string. */
  readonly value?: string;
  /** `AXIdentifier` — a native application's own id for the element (LLD §3.3). */
  readonly identifier?: string;
  /**
   * `AXDOMIdentifier` — the DOM `id` attribute, which Chromium publishes.
   *
   * Not named in LLD §7.5, which says the macOS `automationId` comes "from
   * `aria-label` or `AXIdentifier`". It is read anyway because the conformance
   * target is an Electron application (REQ-ADE-6): a `<select id="record-gateway">`
   * has an `id` and no `AXIdentifier`, and an aria-label is a *label* — it
   * changes when the wording changes, which is the thing an `automationId` is
   * supposed to survive. The precedence in `tree.ts` keeps §7.5's two sources
   * and puts this between them.
   */
  readonly domIdentifier?: string;
  /** `AXHelp`, which is a `title` attribute on the web. */
  readonly help?: string;
  /** `AXPlaceholderValue`. */
  readonly placeholder?: string;
  readonly enabled?: boolean;
  readonly focused?: boolean;
  readonly selected?: boolean;
  /** `AXExpanded`, when the element has the attribute at all. */
  readonly expanded?: boolean;
  /** `AXValue` of a checkbox or radio, as a tri-state. */
  readonly checked?: boolean;
  /** `AXPosition` and `AXSize` together: `[x, y, width, height]`. */
  readonly box?: readonly [number, number, number, number];
  /** The names of the actions the element declares: `AXPress`, `AXShowMenu`. */
  readonly actions?: readonly string[];
}

/**
 * What one `snapshot()` cost, which Draft 2.8 §7.5 requires the desktop
 * conformance report to publish: "The desktop conformance report records nodes
 * read, wall time, and milliseconds per node."
 *
 * It is measured on this side of the process boundary, so `wallMs` includes
 * spawning `osascript`. That is the number a caller waits for, and the number
 * the ten-second surface deadline is spent against.
 */
export interface AxSnapshotCost {
  readonly nodes: number;
  readonly wallMs: number;
  readonly msPerNode: number;
  /** How many `osascript` processes the read took. One, by design. */
  readonly invocations: number;
  /**
   * How many accessibility API calls the read made (Draft 2.9 §7.5).
   *
   * Draft 2.8 counted *Apple events*, because the bridge talked to System
   * Events and an Apple event's fixed ~20 ms was the whole cost. The window
   * read is a native helper now — `AXUIElementCopyAttributeValue` in process —
   * so the number that describes it is the count of AX calls, which cost about
   * seventy microseconds each. The field is renamed rather than reused: a
   * report that said "Apple events: 9,400" would be false.
   */
  readonly axCalls: number;
  /**
   * The one-minute load average when the read finished (Draft 2.10 §7.5, P8-F2).
   *
   * The budget is wall-clock, and wall-clock on a shared machine is a statement
   * about the machine as much as about the bridge: the same window read here
   * cost 1.6 ms per node at load average seven and 29.6 ms per node beside a
   * full test run. "1.6 ms per node" alone is honest and useless. §7.5: "The
   * cost line therefore records the one-minute load average and the CPU count
   * beside nodes, wall time and ms per node."
   */
  readonly loadAverage1m: number;
  /** How many logical CPUs that load is spread over. */
  readonly cpus: number;
}

/** What the bridge was asked to do, and what came back. */
export interface AxWindow {
  /** The application process the tree was read from. */
  readonly process: string;
  /** The front window's `AXTitle`, which is what `state()` reports. */
  readonly title: string;
  readonly nodes: readonly AxNode[];
  /** True when the walk stopped at `maxNodes` rather than at the leaves. */
  readonly truncated: boolean;
  readonly cost: AxSnapshotCost;
}

/** Why an accessibility call could not be made. */
export type AxPermissionState =
  | "granted"
  /** The permission has never been asked for, or the prompt is unanswered. */
  | "prompt-pending"
  /** The permission was asked for and refused. */
  | "denied"
  /** Not macOS. */
  | "unsupported";

export interface AxPermission {
  readonly state: AxPermissionState;
  /** What to do about it, written for whoever runs `svatah surface doctor`. */
  readonly advice: string;
  /** The raw `osascript` diagnostic, when there was one. */
  readonly detail?: string;
}

/**
 * Whether anything in this login session owns a window (Draft 2.12 §7.5, P9-F7).
 *
 * > `svatah surface doctor --adapter ax` also reports `ax/session`: whether any
 * > process in the login session owns an on-screen window; when only
 * > `loginwindow` does, the display is locked or the session has no
 * > WindowServer, and the gate names that as the cause of its exit 2 rather than
 * > a launch failure.
 *
 * The desktop gate launches the ADE and polls for its window for sixty seconds.
 * On a locked display no application gets one — `loginwindow` owns the screen —
 * so the gate reported "showed no window within 60000 ms" and a reader had to
 * guess whether the ADE was broken or the machine was asleep. It happened to
 * both the Phase 9 implementer and its verifier, on different hosts, and cost
 * the live measurement twice.
 */
export interface AxSession {
  /** False when no application in this session can be read through the AX API. */
  readonly usable: boolean;
  /**
   * Which of the four answers this is (Draft 2.13 §7.5, P10-F1, P10-F5).
   *
   * `usable` alone conflates two things a reader needs apart, and Phase 10 was
   * lost between them: a gate that could not run because the display is locked,
   * and a gate that could not run because the *check itself* did not answer.
   * F5: "a session probe that did not answer in time is `could not tell`, never
   * a cause."
   *
   * - `usable` — an application in this session owns a real window and the
   *   accessibility API hands it over.
   * - `locked` — the screen is locked. macOS keeps every application's windows
   *   and refuses them all to an accessibility client, so a desktop gate here
   *   reads "no window" for an application whose window is on screen.
   * - `no-session` — nothing owns a window: no WindowServer, or an SSH login.
   * - `unknown` — the probe did not answer. Not a cause; a missing answer.
   */
  readonly state: "usable" | "locked" | "no-session" | "unknown";
  /** The processes that own at least one on-screen window, by name. */
  readonly owners: readonly string[];
  /** One sentence for `svatah surface doctor` and for the gate's exit message. */
  readonly detail: string;
  /** What to do about it. */
  readonly advice: string;
}

/** An action the bridge performs on one element, addressed by its path. */
export type AxCommand =
  | { readonly kind: "action"; readonly path: readonly number[]; readonly action: string }
  | { readonly kind: "setValue"; readonly path: readonly number[]; readonly value: string }
  | { readonly kind: "focus"; readonly path: readonly number[] }
  | { readonly kind: "keystroke"; readonly text: string; readonly using?: readonly string[] }
  | { readonly kind: "keycode"; readonly code: number; readonly using?: readonly string[] }
  | { readonly kind: "click"; readonly at: readonly [number, number] }
  /**
   * Give the front window a size (pattern 33, T12.7, LLD §13.9 Draft 2.15).
   *
   * > performed through the window's size attribute.
   *
   * `AXSize` on the window element, which is what a person's drag of a corner
   * ends up doing. It is not a `path` command: the window *is* the target, and
   * a path would address something inside it.
   */
  | { readonly kind: "setSize"; readonly size: readonly [number, number] }
  | { readonly kind: "activate" };

/**
 * What the adapter needs from macOS. Everything else is a pure function.
 */
export interface AxBridge {
  /** Is the Accessibility permission granted to whatever is running this? */
  permission(): Promise<AxPermission>;
  /**
   * Does anything in this login session own an on-screen window
   * (Draft 2.12 §7.5, P9-F7)?
   *
   * Separate from `permission()` because the two fail for different reasons and
   * want different sentences: a refused permission is a setting, a locked
   * display is a machine nobody is sitting at.
   */
  session(): Promise<AxSession>;
  /**
   * The accessibility tree of a process's front window.
   *
   * `deadlineMs` is the *caller's* deadline (Draft 2.9 §7.5, P7-F5): "the
   * bridge honours the caller's deadline; a script deadline shorter than the
   * caller's is a defect." Phase 7's bridge stopped at ten seconds whatever it
   * was asked for, because the only deadline it had was its own.
   */
  window(request: {
    process: string;
    maxNodes: number;
    deadlineMs?: number;
  }): Promise<AxWindow>;
  /** Perform one command; throws `AxBridgeError` when macOS refuses. */
  perform(command: AxCommand): Promise<void>;
  /** A PNG of the screen (or of one rectangle), written to `path`. */
  screenshot(path: string, box?: readonly [number, number, number, number]): Promise<void>;
}

export class AxBridgeError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AxBridgeError";
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The osascript runner.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Which `osascript` dialect a script is written in. */
export type OsascriptLanguage = "JavaScript" | "AppleScript";

/**
 * Run one JXA script, with a hard deadline.
 *
 * The deadline is not a nicety. An `osascript` that trips the Accessibility
 * prompt blocks on a dialog nobody may be there to answer and then fails with
 * `-1712` after roughly two minutes; a `svatah surface doctor` that inherited
 * that wait would be useless exactly when it is needed. Killing the child and
 * reporting the timeout as a *permission* answer is the honest reading: an
 * accessibility call that cannot complete is an accessibility call you do not
 * have.
 */
export async function runOsascript(
  script: string,
  argument: unknown,
  timeoutMs: number,
  language: OsascriptLanguage = "JavaScript",
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  /*
   * Two languages, one runner.
   *
   * Every script this bridge ships is JXA now: the permission check and the
   * action script for their JSON, and the window read because JXA is what can
   * reach `AXUIElementCopyAttributeValue` through the Objective-C bridge
   * (Draft 2.9 §7.5's native helper). `AppleScript` stays as a mode because the
   * runner is the tested seam and a future script may want it; nothing in this
   * package passes it today.
   */
  const args =
    language === "AppleScript"
      ? ["-e", script, ...(argument as readonly string[])]
      : ["-l", "JavaScript", "-e", script, JSON.stringify(argument)];
  return await new Promise((resolve) => {
    const child = spawn("osascript", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: String(error), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * The scripts.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The smallest call that needs **assistive access**, and nothing else.
 *
 * The distinction matters and cost a wrong answer to get right. Counting
 * `applicationProcesses` needs only Automation permission for System Events —
 * it succeeds on a machine where the accessibility API is refused — so a
 * `doctor` built on it reported `granted` while every `snapshot` failed with
 * `-25211`, which is the worst kind of diagnostic: confidently wrong, and it
 * sends the reader to look at the adapter.
 *
 * Reading a process's `UI elements` is the thing the adapter actually does, so
 * it is the thing the check does. `System Events` itself is the target: it is
 * always running, it belongs to the OS, and asking it about its own interface
 * touches no application under test.
 */
const PERMISSION_SCRIPT = `function run(argv) {
  const se = Application("System Events");
  const procs = se.applicationProcesses.length;
  // The assistive-access call. Any process would do; the one guaranteed to be
  // running is System Events itself.
  const self = se.applicationProcesses.byName("System Events");
  let windows = 0;
  try { windows = self.windows().length; } catch (e) { windows = 0; }
  // A window list is not enough on its own — a process with no windows answers
  // 0 either way — so a UI-element read is what the check turns on.
  const elements = se.applicationProcesses.byName("Finder").uiElements().length;
  return JSON.stringify({ ok: true, processes: procs, windows: windows, elements: elements });
}`;

/**
 * Which processes in this login session own an on-screen window
 * (Draft 2.12 §7.5, P9-F7).
 *
 * `NSWorkspace.runningApplications` and one `AXWindows` read each, in one
 * `osascript` invocation — the same shape as the window read, for the same
 * reason. Only applications with a regular or accessory activation policy are
 * asked: a background agent has no user interface and answering "no window" for
 * it says nothing.
 *
 * `loginwindow` is the one that matters. It owns the screen when the display is
 * locked, at the login screen, and when a session has no WindowServer at all
 * (a headless CI runner, an SSH session) — so "the only owner is `loginwindow`"
 * is the same answer to all three, and the same answer the gate needs.
 */
const SESSION_SCRIPT = `ObjC.import('ApplicationServices');
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
ObjC.bindFunction('CGSessionCopyCurrentDictionary', ['id', []]);

/**
 * Is the screen locked (Draft 2.13 §7.5, P10-F1)?
 *
 * The window-owner count below cannot tell: macOS keeps every application's
 * windows while the screen is locked and simply refuses them to an
 * accessibility client, so a locked machine looks exactly like a busy one that
 * is running a dozen applications. \`CGSessionCopyCurrentDictionary\` is the
 * question actually being asked — \`CGSSessionScreenIsLocked\`, and
 * \`kCGSSessionOnConsoleKey\` for a login that is not at the console at all.
 */
function sessionState() {
  try {
    var dictionary = $.CGSessionCopyCurrentDictionary();
    if (dictionary === undefined || dictionary.isNil()) return { known: false };
    var plain = ObjC.deepUnwrap(dictionary);
    return {
      known: true,
      locked: plain.CGSSessionScreenIsLocked === true || plain.CGSSessionScreenIsLocked === 1,
      onConsole: plain.kCGSSessionOnConsoleKey === true || plain.kCGSSessionOnConsoleKey === 1
    };
  } catch (e) {
    return { known: false };
  }
}

function attribute(element, name) {
  var out = Ref();
  if ($.AXUIElementCopyAttributeValue(element, $(name), out) !== 0) return undefined;
  return out[0];
}

/**
 * Does this application own a window the accessibility API will hand over?
 *
 * The role is the test, not the count (P10-F1). A locked screen answers
 * \`AXWindows\` with a one-element list whose element is *the application
 * itself* — the same cycle LLD §7.5's front-window search already refuses — so
 * a count of one meant "owns a window" for every application on a machine
 * nobody could read a window on. Measured on this defect: TextEdit, Notes,
 * System Settings and the ADE all answered one; none of them answered
 * \`AXWindow\`.
 */
function ownsRealWindow(pid) {
  var application = $.AXUIElementCreateApplication(pid);
  var windows = attribute(application, 'AXWindows');
  if (windows === undefined) return false;
  var list;
  try { list = ObjC.castRefToObject(windows); } catch (e) { return false; }
  for (var w = 0; w < list.count && w < 8; w++) {
    var role = attribute(list.objectAtIndex(w), 'AXRole');
    if (role === undefined) continue;
    try {
      if (ObjC.unwrap(ObjC.castRefToObject(role)) === 'AXWindow') return true;
    } catch (e) {
      // Not a role this client can read; not a window it can drive either.
    }
  }
  return false;
}

function run(argv) {
  /*
   * The lock first, and then nothing else (Draft 2.13 §7.5, P10-F1).
   *
   * Not only because it is the authoritative answer: on a locked screen every
   * \`AXUIElementCopyAttributeValue\` in the scan below is answered by a
   * WindowServer that has nothing to hand over, and the scan took longer than
   * this check's five-second budget — so the one host that most needs a real
   * answer was the one that got "could not tell".
   */
  var session = sessionState();
  if (session.known === true && session.locked === true) {
    return JSON.stringify({
      ok: true,
      asked: 0,
      owners: [],
      claimed: [],
      lockKnown: true,
      locked: true,
      onConsole: session.onConsole === true
    });
  }

  var running = $.NSWorkspace.sharedWorkspace.runningApplications;
  var owners = [];
  var claimed = [];
  var asked = 0;
  for (var i = 0; i < running.count; i++) {
    var one = running.objectAtIndex(i);
    // 0 regular (a Dock icon), 1 accessory (a menu-bar item that may have a
    // window). 2 is prohibited: no user interface at all.
    var policy = parseInt(String(one.activationPolicy), 10);
    if (policy !== 0 && policy !== 1) continue;
    var pid = parseInt(String(one.processIdentifier), 10);
    if (!(pid > 0)) continue;
    asked += 1;
    var application = $.AXUIElementCreateApplication(pid);
    var out = Ref();
    if ($.AXUIElementCopyAttributeValue(application, $('AXWindows'), out) !== 0) continue;
    var count = 0;
    try { count = ObjC.castRefToObject(out[0]).count; } catch (e) { count = 0; }
    if (count === 0) continue;
    var name = String(ObjC.unwrap(one.localizedName));
    claimed.push(name);
    if (ownsRealWindow(pid)) owners.push(name);
  }
  return JSON.stringify({
    ok: true,
    asked: asked,
    owners: owners,
    claimed: claimed,
    lockKnown: session.known === true,
    locked: false,
    onConsole: session.onConsole === true
  });
}`;

/**
 * One window's accessibility tree, in one `osascript` invocation (Draft 2.9 §7.5).
 *
 * ## The shape of the walk
 *
 * Breadth-first over every node, carrying each node's index so the answer is a
 * flat array with parent pointers. Sixteen `AXUIElementCopyAttributeValue`
 * calls per node and one `AXUIElementCopyActionNames`, at roughly seventy
 * microseconds each — the arithmetic that made a per-attribute walk unthinkable
 * over Apple events is unremarkable over the API those events were carrying.
 *
 * ## Why it carries its own deadline
 *
 * §7.5: "A deadline exceeded after `doctor` reported `granted` is reported as a
 * bridge timeout with those numbers, never as a permission prompt." A killed
 * `osascript` has no numbers to report, so the script stops itself inside the
 * caller's deadline and answers with what it has: the `D` flag, the node count
 * and the call count.
 *
 * ## Finding the process
 *
 * `NSWorkspace.runningApplications`, filtered by `localizedName` and then by
 * *having a window*. An Electron application registers several processes under
 * one name — helpers among them — and "the first one called Svatah ADE" is
 * sometimes a helper with no window, which read as a window that had not
 * appeared yet. Asking for the one with a window removes a whole class of
 * flake from the gate's launch poll.
 */
const WINDOW_SCRIPT = `ObjC.import('ApplicationServices');
ObjC.import('AppKit');
ObjC.import('Foundation');
ObjC.bindFunction('AXValueGetValue', ['bool', ['void*', 'int', 'void*']]);
ObjC.bindFunction('malloc', ['void*', ['int']]);
ObjC.bindFunction('free', ['void', ['void*']]);

var US = String.fromCharCode(31);
var RS = String.fromCharCode(30);
var calls = 0;

function attr(element, name) {
  calls += 1;
  var out = Ref();
  if ($.AXUIElementCopyAttributeValue(element, $(name), out) !== 0) return undefined;
  return out[0];
}

function clean(value) {
  return String(value).split(US).join(' ').split(RS).join(' ');
}

/** An element-valued attribute as an object the API will take back. */
function element(value) {
  if (value === undefined) return undefined;
  try { return ObjC.castRefToObject(value); } catch (e) { return undefined; }
}

function text(value) {
  if (value === undefined) return '';
  var unwrapped;
  try { unwrapped = ObjC.unwrap(ObjC.castRefToObject(value)); } catch (e) { return ''; }
  if (unwrapped === undefined || unwrapped === null) return '';
  var kind = typeof unwrapped;
  if (kind === 'string') return clean(unwrapped);
  if (kind === 'number') return String(unwrapped);
  if (kind === 'boolean') return unwrapped ? '1' : '0';
  return '';
}

function flag(value) {
  var one = text(value);
  if (one === '1' || one === 'true') return '1';
  if (one === '0' || one === 'false') return '0';
  return '';
}

function frame(element, buffer) {
  var value = attr(element, 'AXFrame');
  if (value === undefined) return '';
  try {
    if (!$.AXValueGetValue(value, 3, buffer)) return '';
    return ObjC.unwrap($.NSData.dataWithBytesLength(buffer, 32).base64EncodedStringWithOptions(0));
  } catch (e) {
    return '';
  }
}

function actions(element) {
  calls += 1;
  var out = Ref();
  if ($.AXUIElementCopyActionNames(element, out) !== 0) return '';
  try {
    var list = ObjC.deepUnwrap(ObjC.castRefToObject(out[0]));
    return list === undefined || list === null ? '' : clean(list.join(','));
  } catch (e) {
    return '';
  }
}

function children(element) {
  var value = attr(element, 'AXChildren');
  if (value === undefined) return [];
  try {
    var array = ObjC.castRefToObject(value);
    var out = [];
    for (var i = 0; i < array.count; i++) out.push(array.objectAtIndex(i));
    return out;
  } catch (e) {
    return [];
  }
}

/**
 * The front window of the named application, or why there is not one.
 *
 * The *element* comes back, not a pid to re-derive it from. An earlier version
 * found the pid here and rebuilt the application element in \`run\`, and once in
 * a while that second element answered \`AXWindows\` with a list whose first
 * entry was the application itself — an \`AXChildren\` cycle that filled the
 * budget with six thousand menu items and no window. Carrying the element the
 * check actually looked at removes the second derivation and the class of bug
 * with it; the role assertion below catches whatever is left.
 */
function frontWindowOf(name) {
  var running = $.NSWorkspace.sharedWorkspace.runningApplications;
  var seen = false;
  for (var i = 0; i < running.count; i++) {
    var one = running.objectAtIndex(i);
    if (ObjC.unwrap(one.localizedName) !== name) continue;
    var pid = parseInt(String(one.processIdentifier), 10);
    if (!(pid > 0)) continue;
    seen = true;
    var application = $.AXUIElementCreateApplication(pid);
    // Focused, then main, then the first of the list: what a person is looking
    // at, what the application says it is, and what is left.
    var candidates = [];
    /*
     * \`castRefToObject\`, because an element that came out of a \`Ref\` is a raw
     * pointer and \`AXUIElementCopyAttributeValue\` refuses one as its first
     * argument ("Ref has incompatible type"). The elements that come out of an
     * \`NSArray\` are already objects, which is why the walk below needs no cast.
     */
    var focused = element(attr(application, 'AXFocusedWindow'));
    if (focused !== undefined) candidates.push(focused);
    var main = element(attr(application, 'AXMainWindow'));
    if (main !== undefined) candidates.push(main);
    var windows = attr(application, 'AXWindows');
    if (windows !== undefined) {
      try {
        var array = ObjC.castRefToObject(windows);
        for (var w = 0; w < array.count && w < 8; w++) candidates.push(array.objectAtIndex(w));
      } catch (e) { /* fall through to the next process */ }
    }
    for (var c = 0; c < candidates.length; c++) {
      // A window, and nothing that merely answered the question. An
      // \`AXApplication\` here is the cycle above, and it is refused rather than
      // walked.
      if (text(attr(candidates[c], 'AXRole')) === 'AXWindow') {
        return { window: candidates[c], found: true };
      }
    }
  }
  return { found: false, process: seen };
}

function run(argv) {
  var request = JSON.parse(argv[0]);
  var found = frontWindowOf(request.process);
  if (!found.found) return 'ERR' + US + (found.process ? 'no-window' : 'no-process');

  var window = found.window;
  var title = text(attr(window, 'AXTitle'));

  var buffer = $.malloc(64);
  var startedAt = $.NSDate.date;
  var records = [];
  var truncated = false;
  var deadlineHit = false;

  // Breadth-first, carrying each node's index so the answer is a flat array
  // with parent pointers — the shape \`AxNode[]\` and the snapshot's depth need.
  var queue = [{ element: window, parent: -1, depth: 0 }];
  while (queue.length > 0) {
    if (-startedAt.timeIntervalSinceNow * 1000 >= request.deadlineMs) { deadlineHit = true; break; }
    if (records.length >= request.maxNodes) { truncated = true; break; }
    var job = queue.shift();
    var element = job.element;
    var index = records.length;

    var fields = new Array(19);
    fields[0] = String(job.parent);
    fields[1] = text(attr(element, 'AXRole')) || 'AXUnknown';
    fields[2] = text(attr(element, 'AXSubrole'));
    fields[3] = text(attr(element, 'AXTitle'));
    fields[4] = text(attr(element, 'AXDescription'));
    fields[5] = text(attr(element, 'AXValue'));
    fields[6] = '';
    fields[7] = text(attr(element, 'AXHelp'));
    fields[8] = flag(attr(element, 'AXEnabled'));
    fields[9] = flag(attr(element, 'AXFocused'));
    fields[10] = flag(attr(element, 'AXSelected'));
    fields[11] = '';
    fields[12] = '';
    fields[13] = text(attr(element, 'AXIdentifier'));
    fields[14] = text(attr(element, 'AXDOMIdentifier'));
    fields[15] = text(attr(element, 'AXPlaceholderValue'));
    fields[16] = flag(attr(element, 'AXExpanded'));
    fields[17] = actions(element);
    fields[18] = frame(element, buffer);
    records.push(fields.join(US));

    /*
     * A depth cap, because \`AXChildren\` is not guaranteed acyclic. A Chromium
     * window is about fifteen deep and a native one less; anything past sixty
     * is a loop, and a loop that filled \`maxNodes\` would be reported as a
     * truncated read of a window rather than as the defect it is.
     */
    if (job.depth >= 60) continue;
    var kids = children(element);
    for (var i = 0; i < kids.length; i++) {
      queue.push({ element: kids[i], parent: index, depth: job.depth + 1 });
    }
  }

  $.free(buffer);
  var flags = (truncated ? 'T' : '') + (deadlineHit ? 'D' : '');
  var header = ['OK', clean(title), flags, String(calls), String(records.length)].join(US);
  return header + RS + records.join(RS);
}
`;

/** Field order of one node record, as `WINDOW_SCRIPT` writes it. */
const enum Field {
  Parent = 0,
  Role = 1,
  Subrole = 2,
  Title = 3,
  Description = 4,
  Value = 5,
  Name = 6,
  Help = 7,
  Enabled = 8,
  Focused = 9,
  Selected = 10,
  Position = 11,
  Size = 12,
  Identifier = 13,
  DomIdentifier = 14,
  Placeholder = 15,
  Expanded = 16,
  Actions = 17,
  /** `AXFrame` as base64 of four little-endian doubles: x, y, width, height. */
  Frame = 18,
}

/** Record and field separators: ASCII 30 and 31, which no AX string carries. */
const RECORD_SEPARATOR = "\u001e";
const UNIT_SEPARATOR = "\u001f";

const text = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

const flag = (value: string | undefined): boolean | undefined =>
  value === "1" ? true : value === "0" ? false : undefined;

const pair = (value: string | undefined): [number, number] | undefined => {
  if (value === undefined || value === "") return undefined;
  const parts = value.split(",").map((one) => Number(one));
  if (parts.length !== 2 || parts.some((one) => !Number.isFinite(one))) return undefined;
  return [parts[0]!, parts[1]!];
};

/** Roles whose `AXValue` is a tick rather than a string (LLD §3.2 `checked`). */
const CHECKABLE = new Set(["AXCheckBox", "AXRadioButton", "AXMenuItem", "AXToggle"]);

/**
 * Read `WINDOW_SCRIPT`'s answer.
 *
 * Delimiter-separated rather than JSON: a five-hundred-node tree is a megabyte
 * of JSON through a pipe and about a fifth of that as records, and the parse is
 * a `split` either way. ASCII 30 and 31 are the separators the format was
 * invented for, an AX string never contains one, and the script replaces them
 * with spaces if one ever does.
 */
export function parseWindow(stdout: string): {
  ok: boolean;
  error?: string;
  title: string;
  truncated: boolean;
  deadlineHit: boolean;
  axCalls: number;
  nodes: AxNode[];
} {
  const records = stdout.split(RECORD_SEPARATOR);
  const header = (records[0] ?? "").split(UNIT_SEPARATOR);
  if (header[0] !== "OK") {
    return {
      ok: false,
      ...(header[1] === undefined ? {} : { error: header[1] }),
      title: "",
      truncated: false,
      deadlineHit: false,
      axCalls: 0,
      nodes: [],
    };
  }
  const flags = header[2] ?? "";
  const nodes: AxNode[] = [];
  for (const record of records.slice(1)) {
    if (record === "") continue;
    const fields = record.split(UNIT_SEPARATOR);
    const role = fields[Field.Role] ?? "AXUnknown";
    const value = text(fields[Field.Value]);
    const box = ((): readonly [number, number, number, number] | undefined => {
      /*
       * `AXFrame` is an `AXValue` wrapping a `CGRect`, and JXA cannot take a
       * struct out of one: every typed `Ref` the bridge accepts is refused
       * ("Ref has no type"). So the script copies the 32 bytes into an
       * `NSData` and sends their base64, and the four doubles are read here —
       * which is where a wire format belongs anyway.
       */
      const encoded = text(fields[Field.Frame]);
      if (encoded !== undefined) {
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.length >= 32) {
          const numbers = [0, 8, 16, 24].map((at) => bytes.readDoubleLE(at));
          if (numbers.every((one) => Number.isFinite(one))) {
            return [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!];
          }
        }
      }
      const position = pair(fields[Field.Position]);
      const size = pair(fields[Field.Size]);
      if (position === undefined || size === undefined) return undefined;
      return [position[0], position[1], size[0], size[1]];
    })();
    const actions = text(fields[Field.Actions])?.split(",").filter((one) => one !== "");
    const checked = CHECKABLE.has(role)
      ? value === "1" || value === "true"
        ? true
        : value === "0" || value === "false"
          ? false
          : undefined
      : undefined;
    nodes.push({
      parent: Number(fields[Field.Parent] ?? "-1"),
      role: role === "" ? "AXUnknown" : role,
      ...(text(fields[Field.Subrole]) === undefined ? {} : { subrole: fields[Field.Subrole]! }),
      ...(text(fields[Field.Title]) === undefined ? {} : { title: fields[Field.Title]! }),
      ...(text(fields[Field.Description]) === undefined
        ? {}
        : { description: fields[Field.Description]! }),
      ...(value === undefined ? {} : { value }),
      ...(text(fields[Field.Identifier]) === undefined
        ? {}
        : { identifier: fields[Field.Identifier]! }),
      ...(text(fields[Field.DomIdentifier]) === undefined
        ? {}
        : { domIdentifier: fields[Field.DomIdentifier]! }),
      ...(text(fields[Field.Help]) === undefined ? {} : { help: fields[Field.Help]! }),
      ...(text(fields[Field.Placeholder]) === undefined
        ? {}
        : { placeholder: fields[Field.Placeholder]! }),
      ...(flag(fields[Field.Enabled]) === undefined ? {} : { enabled: flag(fields[Field.Enabled])! }),
      ...(flag(fields[Field.Focused]) === undefined ? {} : { focused: flag(fields[Field.Focused])! }),
      ...(flag(fields[Field.Selected]) === undefined
        ? {}
        : { selected: flag(fields[Field.Selected])! }),
      ...(flag(fields[Field.Expanded]) === undefined
        ? {}
        : { expanded: flag(fields[Field.Expanded])! }),
      ...(checked === undefined ? {} : { checked }),
      ...(box === undefined ? {} : { box }),
      ...(actions === undefined || actions.length === 0 ? {} : { actions }),
    });
  }
  return {
    ok: true,
    title: header[1] ?? "",
    truncated: flags.includes("T"),
    deadlineHit: flags.includes("D"),
    axCalls: Number(header[3] ?? "0"),
    nodes,
  };
}

/**
 * How many times the action script asks System Events for the window before an
 * empty answer is a cause, and how long it waits between two asks. Two seconds
 * in the worst case, and nothing at all when the first answer is the truth.
 */
export const PERFORM_WINDOW_TRIES = 10;
export const PERFORM_WINDOW_PAUSE_S = 0.2;

/**
 * How long the bridge keeps re-sending an action that System Events refused for
 * "no window" *while the accessibility API can see one*, and how long it waits
 * between two tries. Nothing is spent unless the two oracles disagree.
 */
export const PERFORM_ADJUDICATION_MS = 10_000;
export const PERFORM_ADJUDICATION_PAUSE_MS = 500;

/**
 * One command.
 *
 * An element is addressed by its **path** — the child index at each level from
 * the window down — rather than by a handle, because AppleScript object
 * specifiers do not survive between `osascript` processes. The path is what the
 * snapshot's walk already produced, so it costs nothing to carry.
 *
 * Exported so `processWithWindow` can be *executed* in a test with a fake
 * System Events rather than read as a string (P8-F1). A macOS-only script that
 * only ever runs on a machine with a granted permission is otherwise tested
 * nowhere.
 */
export const PERFORM_SCRIPT = `/**
 * The application process that owns a window, when several share the name
 * (Draft 2.10 §7.5, P8-F1).
 *
 * applicationProcesses.byName answers the *first* process with that name, and
 * an Electron application registers several — helpers among them, and, for the
 * few seconds after a pkill, the instance that is still exiting. Both have no
 * window, so the first match was sometimes the one this script drove, and every
 * command against it answered no-window. The window is the thing that makes a
 * process the right one, so it is what the choice is made on.
 */
function processWithWindow(se, name) {
  var matches = [];
  // System Events answers this under *its* accessibility permission and its own
  // load, and a busy answer is an empty list rather than an error: a click
  // against a window the ADE's own log shows open answered no-window once in
  // roughly fifty (P11). An application does not lose its window between two
  // reads a fifth of a second apart, so an empty answer is asked again before
  // it is believed — and only a run of them is reported as a cause.
  for (var attempt = 0; attempt < ${PERFORM_WINDOW_TRIES}; attempt++) {
    if (attempt > 0) pause(${PERFORM_WINDOW_PAUSE_S});
    matches = se.applicationProcesses.whose({ name: name })();
    for (var i = 0; i < matches.length; i++) {
      try {
        if (matches[i].windows().length > 0) return matches[i];
      } catch (e) {
        // A process that refuses the question is not the one with a window.
      }
    }
  }
  // None has one, ${PERFORM_WINDOW_TRIES} times over: hand back the first so the
  // caller reports "no-window" rather than an index error, which says something
  // different.
  return matches.length > 0 ? matches[0] : se.applicationProcesses.byName(name);
}

/**
 * Wait, where there is something to wait with. JXA carries Foundation on the
 * dollar object; the unit test that *executes* this function carries a fake
 * System Events and nothing else, and has nothing to wait for.
 */
function pause(seconds) {
  if (typeof $ !== 'undefined' && $.NSThread !== undefined) {
    $.NSThread.sleepForTimeInterval(seconds);
  }
}

function run(argv) {
  const command = JSON.parse(argv[0]);
  const se = Application("System Events");

  if (command.kind === "activate") {
    processWithWindow(se, command.process).frontmost = true;
    return JSON.stringify({ ok: true });
  }
  if (command.kind === "keystroke") {
    se.keystroke(command.text, command.using === undefined ? {} : { using: command.using });
    return JSON.stringify({ ok: true });
  }
  if (command.kind === "keycode") {
    se.keyCode(command.code, command.using === undefined ? {} : { using: command.using });
    return JSON.stringify({ ok: true });
  }
  if (command.kind === "click") {
    se.click({ at: command.at });
    return JSON.stringify({ ok: true });
  }
  if (command.kind === "setSize") {
    const window = processWithWindow(se, command.process).windows()[0];
    if (window === undefined) return JSON.stringify({ ok: false, error: "no-window" });
    try {
      window.attributes.byName("AXSize").value = command.size;
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e) });
    }
    return JSON.stringify({ ok: true });
  }

  const proc = processWithWindow(se, command.process);
  let element = proc.windows()[0];
  if (element === undefined) return JSON.stringify({ ok: false, error: "no-window" });
  for (const step of command.path) {
    const children = element.uiElements();
    if (step >= children.length) return JSON.stringify({ ok: false, error: "stale-path" });
    element = children[step];
  }

  try {
    if (command.kind === "action") element.actions.byName(command.action).perform();
    else if (command.kind === "setValue") element.attributes.byName("AXValue").value = command.value;
    else if (command.kind === "focus") element.attributes.byName("AXFocused").value = true;
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) });
  }
  return JSON.stringify({ ok: true });
}`;

export interface OsascriptBridgeOptions {
  /** The application process to drive: the ADE is `Svatah ADE` (LLD §16). */
  readonly process: string;
  /** How long one Apple event may take. Default 20 s; `permission()` uses 5 s. */
  readonly timeoutMs?: number;
  /**
   * The budget for one `window()` read, which §7.5 sets at the surface's
   * default deadline of 10 s for a 400-node window. The script stops itself a
   * second inside it so the answer carries numbers rather than being a killed
   * process.
   */
  readonly windowDeadlineMs?: number;
  /** For tests: run a script without spawning anything. */
  readonly run?: typeof runOsascript;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const PERMISSION_TIMEOUT_MS = 5_000;
/**
 * The session check's own budget (Draft 2.13 §7.5, P10-F5).
 *
 * It is not the permission check's. The permission check asks one question and
 * five seconds is generous for it; the session check reads every regular
 * application's window list and one role per window, which on a machine with a
 * dozen applications open and a *usable* display is real work — measured at
 * around six seconds here, so the five it inherited turned "the display is
 * fine" into "could not tell" exactly when the answer was most useful. Fifteen
 * seconds is long enough to be an answer and short enough that a `doctor` still
 * comes back while a person is looking at it.
 */
const SESSION_TIMEOUT_MS = 15_000;
/** LLD §7.5: "the surface's default deadline of 10 s". */
const WINDOW_DEADLINE_MS = 10_000;
/**
 * What `osascript` costs before and after the script's own clock runs.
 *
 * Spawning it, loading the Objective-C bridge metadata for three frameworks,
 * and writing a few hundred kilobytes back. The script's budget is the caller's
 * less this, so the usual way to exceed a deadline is the script answering with
 * the `D` flag and its numbers rather than the runner killing a process that
 * has none.
 */
const PROCESS_OVERHEAD_MS = 1_000;

/**
 * The process that owns the screen when nobody is at it.
 *
 * macOS's `loginwindow` draws the login screen and the lock screen, so it is
 * the one thing that owns a window on a machine no application can show one on
 * (Draft 2.12 §7.5).
 */
export const LOGIN_WINDOW = "loginwindow";

/**
 * What the machine was doing when a read finished (Draft 2.10 §7.5, P8-F2).
 *
 * Read *after* the read rather than before it, because the one-minute average
 * that matters is the one the read was competing with. `availableParallelism`
 * rather than `cpus().length`: it is what the process is actually allowed to
 * use, which on a container-limited CI runner is the smaller and truer number.
 */
export function machineLoad(): { loadAverage1m: number; cpus: number } {
  const [oneMinute = 0] = loadavg();
  return {
    loadAverage1m: Math.round(oneMinute * 100) / 100,
    cpus: availableParallelism(),
  };
}

/** The real bridge: `osascript`, System Events, and this machine. */
export function osascriptBridge(options: OsascriptBridgeOptions): AxBridge {
  const run = options.run ?? runOsascript;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /*
   * What the last `permission()` answered, so a slow window read can say which
   * of the two things it is. `AxSurface.open` checks the permission before it
   * takes a snapshot, so by the time a `window()` is slow this is known.
   */
  let lastPermission: AxPermissionState | undefined;

  const bridgeTimeout = (
    processName: string,
    wallMs: number,
    deadlineMs: number,
    cost: AxSnapshotCost | undefined,
  ): AxBridgeError => {
    const measured =
      cost === undefined
        ? "no nodes came back"
        : `${cost.nodes} nodes in ${cost.wallMs} ms (${cost.msPerNode} ms per node, ` +
          `${cost.axCalls} accessibility calls, ${cost.invocations} osascript invocation, ` +
          `load average ${cost.loadAverage1m} over ${cost.cpus} CPUs)`;
    if (lastPermission === "granted") {
      return new AxBridgeError(
        `The accessibility bridge did not finish reading the window of "${processName}" within ` +
          `${deadlineMs} ms: ${measured}. The Accessibility permission is granted, so this is ` +
          "the bridge's own budget (LLD §7.5), not a permission prompt.",
      );
    }
    return new AxBridgeError(
      `The accessibility call did not answer within ${deadlineMs} ms (${measured}). The ` +
        "Accessibility permission has not been confirmed for this program, and an unanswered " +
        "prompt looks exactly like this: run `svatah surface doctor`.",
    );
  };

  const call = async (script: string, argument: unknown, ms: number): Promise<unknown> => {
    const result = await run(script, argument, ms);
    if (result.timedOut) {
      throw new AxBridgeError(
        `The accessibility call did not answer within ${ms} ms. On macOS that is what an ` +
          "unanswered Accessibility permission prompt looks like: run `svatah surface doctor`.",
      );
    }
    if (result.code !== 0) {
      throw new AxBridgeError(
        "osascript refused the accessibility call.",
        result.stderr.trim() || result.stdout.trim(),
      );
    }
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      throw new AxBridgeError("osascript answered something that is not JSON.", result.stdout);
    }
  };

  /**
   * Does the accessibility API — not System Events — see a window for this
   * application right now? One node is enough: `window()` throws when there is
   * none, and answers when there is.
   */
  const apiSeesAWindow = async (): Promise<boolean> => {
    try {
      await bridge.window({ process: options.process, maxNodes: 1, deadlineMs: 8000 });
      return true;
    } catch {
      return false;
    }
  };

  const bridge: AxBridge = {
    async permission(): Promise<AxPermission> {
      if (process.platform !== "darwin") {
        lastPermission = "unsupported";
        return {
          state: "unsupported",
          advice:
            "The macOS Accessibility adapter runs on macOS only. Use `--adapter uia` on " +
            "Windows, or `--adapter playwright` for a web application.",
        };
      }
      const result = await run(PERMISSION_SCRIPT, {}, PERMISSION_TIMEOUT_MS);
      if (result.timedOut) {
        lastPermission = "prompt-pending";
        return { state: "prompt-pending", advice: PROMPT_ADVICE };
      }
      if (result.code === 0 && result.stdout.includes('"ok":true')) {
        lastPermission = "granted";
        return { state: "granted", advice: "The Accessibility permission is granted." };
      }
      const detail = (result.stderr || result.stdout).trim();
      /*
       * `-1743` is "Not authorised to send Apple events"; `-25211` is
       * "not allowed assistive access", which is the accessibility API's own
       * refusal and the one this adapter runs into. Anything else that fails
       * here is treated as the prompt, because a first run on a clean machine
       * produces a timeout rather than either code, and telling someone
       * "denied" when they have simply not been asked yet sends them to the
       * wrong screen.
       */
      const denied =
        detail.includes("-1743") ||
        detail.includes("-25211") ||
        detail.includes("assistive access");
      lastPermission = denied ? "denied" : "prompt-pending";
      return {
        state: lastPermission,
        advice: denied ? DENIED_ADVICE : PROMPT_ADVICE,
        ...(detail === "" ? {} : { detail }),
      };
    },

    /**
     * Does anything own a window (Draft 2.12 §7.5, P9-F7)?
     *
     * Never throws: this check exists to explain an exit code, and a check that
     * threw would replace one unexplained failure with another. A refusal is
     * reported as "could not tell", not as "locked".
     */
    async session(): Promise<AxSession> {
      if (process.platform !== "darwin") {
        return {
          usable: false,
          state: "no-session",
          owners: [],
          detail: "not macOS",
          advice: "The login-session check is about macOS's WindowServer.",
        };
      }
      let answer: {
        ok?: boolean;
        asked?: number;
        owners?: string[];
        claimed?: string[];
        lockKnown?: boolean;
        locked?: boolean;
        onConsole?: boolean;
      };
      try {
        answer = (await call(SESSION_SCRIPT, {}, SESSION_TIMEOUT_MS)) as typeof answer;
      } catch (error) {
        /*
         * A probe that did not answer is "could not tell" (P10-F5).
         *
         * Under load the five-second budget here expired and the gate printed
         * "this login session cannot show one" beside a doctor line naming nine
         * applications that did. The state says `unknown` and nothing that
         * reads it may turn that into a cause.
         */
        return {
          usable: false,
          state: "unknown",
          owners: [],
          detail: `could not tell — ${error instanceof AxBridgeError ? error.message : String(error)}`,
          advice:
            "The session check needs the same Accessibility permission the adapter does; run " +
            "`svatah surface doctor --adapter ax` and grant it. Until it answers, this says " +
            "nothing about the display either way.",
        };
      }

      const raw = answer.owners ?? [];
      const owners = raw.filter((one) => one !== LOGIN_WINDOW);
      const claimed = (answer.claimed ?? []).filter((one) => one !== LOGIN_WINDOW);

      /*
       * The lock first (Draft 2.13 §7.5, P10-F1).
       *
       * It is the authoritative answer and it is the one Phase 10 did not have.
       * A locked screen keeps every application's windows and refuses them all
       * to an accessibility client, so the owner count says "eleven
       * applications own a window" on a machine where nothing can be read —
       * which is how a launch that had worked was reported as an ADE with no
       * window, four times, over two sessions.
       */
      if (answer.lockKnown === true && answer.locked === true) {
        return {
          usable: false,
          state: "locked",
          owners,
          detail:
            "the screen is locked (CGSSessionScreenIsLocked) — macOS keeps every application's " +
            "windows and shows none of them to an accessibility client",
          advice:
            "Unlock the display and run this again. Nothing launched here will be readable " +
            "until you do: the window is created and on screen, and the accessibility API " +
            "answers every application's window list with the application itself.",
        };
      }

      if (owners.length > 0) {
        return {
          usable: true,
          state: "usable",
          owners,
          detail: `${owners.length} application(s) own a window: ${owners.slice(0, 6).join(", ")}`,
          advice: "This session has a WindowServer and applications can show windows.",
        };
      }

      if (raw.includes(LOGIN_WINDOW)) {
        return {
          usable: false,
          state: "locked",
          owners,
          detail: `only ${LOGIN_WINDOW} owns a window — the display is locked`,
          advice:
            "Nothing launched here will get a window, so the desktop conformance gate cannot " +
            "read one and will exit 2. Unlock the display and run it again.",
        };
      }

      /*
       * Windows are claimed and not one of them answers `AXWindow`. That is
       * what a locked display looks like from the accessibility API — but the
       * session dictionary could not be read, so this says the shape it saw
       * rather than naming a cause (P10-F5).
       */
      if (claimed.length > 0) {
        return {
          usable: false,
          state: "unknown",
          owners,
          detail:
            `${claimed.length} application(s) claim a window and none of them answers ` +
            "`AXWindow` — which is what a locked display looks like from the accessibility " +
            "API, and what a withdrawn Accessibility grant looks like too",
          advice:
            "Unlock the display, or check that the program running Svatah still has the " +
            "Accessibility permission: `svatah surface doctor --adapter ax`.",
        };
      }

      return {
        usable: false,
        state: "no-session",
        owners,
        detail: `no process in this login session owns a window (${answer.asked ?? 0} asked)`,
        advice:
          "Nothing launched here will get a window, so the desktop conformance gate cannot " +
          "read one and will exit 2. Unlock the display — or log in at the console rather than " +
          "over SSH — and run it again.",
      };
    },

    async window(request): Promise<AxWindow> {
      /*
       * The caller's deadline first (P7-F5, Draft 2.9 §7.5).
       *
       * `osascriptBridge({ timeoutMs: 180000 }).window(…)` used to stop at ten
       * seconds: `window` read only `windowDeadlineMs`, so the caller's number
       * reached the perform script and nothing else. The order is per-call,
       * then the window-specific option, then the session's timeout, then
       * §7.5's default of 10 s — every one of them a thing someone asked for,
       * ahead of the thing nobody did.
       */
      const deadlineMs =
        request.deadlineMs ?? options.windowDeadlineMs ?? options.timeoutMs ?? WINDOW_DEADLINE_MS;
      const startedAt = Date.now();
      /*
       * The script's own budget is a little inside the caller's, so the normal
       * way to exceed it is the script answering with the `D` flag and its
       * numbers — not the runner killing a process that has nothing to say.
       * The hard kill stays as the backstop for an `osascript` that blocks
       * before it starts (an unanswered permission prompt does exactly that).
       */
      const scriptDeadlineMs = Math.max(
        200,
        Math.max(Math.round(deadlineMs * 0.4), deadlineMs - PROCESS_OVERHEAD_MS),
      );
      const result = await run(
        WINDOW_SCRIPT,
        { process: request.process, maxNodes: request.maxNodes, deadlineMs: scriptDeadlineMs },
        deadlineMs,
        "JavaScript",
      );
      const wallMs = Date.now() - startedAt;

      if (result.timedOut) throw bridgeTimeout(request.process, wallMs, deadlineMs, undefined);
      if (result.code !== 0) {
        throw new AxBridgeError(
          "osascript refused the accessibility call.",
          result.stderr.trim() || result.stdout.trim(),
        );
      }

      const answer = parseWindow(result.stdout);
      if (!answer.ok) {
        throw new AxBridgeError(
          answer.error === "no-window"
            ? `The process "${request.process}" has no window. Is it running, and not minimised?`
            : answer.error === "no-process"
              ? `No application process is named "${request.process}". Is it running?`
              : `The accessibility call failed: ${answer.error ?? "unknown"}.`,
        );
      }

      const cost: AxSnapshotCost = {
        nodes: answer.nodes.length,
        wallMs,
        msPerNode:
          answer.nodes.length === 0
            ? wallMs
            : Math.round((wallMs / answer.nodes.length) * 100) / 100,
        invocations: 1,
        axCalls: answer.axCalls,
        ...machineLoad(),
      };

      /*
       * §7.5, the sentence this exists for: a deadline exceeded after `doctor`
       * said `granted` is a *bridge* timeout, with the numbers, and never the
       * permission prompt. Phase 6's message said the opposite and sent the
       * verifier to System Settings for a defect that was in this file.
       */
      if (answer.deadlineHit) throw bridgeTimeout(request.process, wallMs, deadlineMs, cost);

      return {
        process: request.process,
        title: answer.title,
        nodes: answer.nodes,
        truncated: answer.truncated,
        cost,
      };
    },

    async perform(command): Promise<void> {
      const once = async (): Promise<{ ok: boolean; error?: string }> =>
        (await call(PERFORM_SCRIPT, { ...command, process: options.process }, timeoutMs)) as {
          ok: boolean;
          error?: string;
        };

      let answer = await once();

      /*
       * System Events said there is no window. The accessibility API decides
       * whether that is true, and a hidden application is shown (P11).
       *
       * The *read* path goes at `AXUIElement` directly and the action path asks
       * System Events, and the two do not answer the same question. A **hidden**
       * application keeps its windows in `AXWindows` — a read of the tree
       * succeeds — and `System Events`' `windows()` is empty, because a hidden
       * window is not one a user could click. Measured: the ADE's own log has
       * `window.hide` 4.1 s before a click that came back `no-window`, and
       * `window.show` between the two, with the assertion one step earlier
       * passing off the very tree the click could not reach.
       *
       * So the two oracles are asked in turn: while the API can see a window,
       * the application is *activated* — which is what un-hides it — and the
       * action re-sent. Only a no from both, for ten seconds, is a cause. It
       * costs nothing when the action worked, which is almost always.
       */
      if (!answer.ok && answer.error === "no-window") {
        const until = Date.now() + PERFORM_ADJUDICATION_MS;
        while (!answer.ok && answer.error === "no-window" && Date.now() < until) {
          if (!(await apiSeesAWindow())) break;
          await call(PERFORM_SCRIPT, { kind: "activate", process: options.process }, timeoutMs);
          await new Promise((done) => setTimeout(done, PERFORM_ADJUDICATION_PAUSE_MS));
          answer = await once();
        }
      }

      if (!answer.ok) {
        throw new AxBridgeError(
          answer.error === "no-window"
            ? `The action found no window for "${options.process}": System Events answered an ` +
              `empty list ${PERFORM_WINDOW_TRIES} times over ` +
              `${Math.round(PERFORM_WINDOW_TRIES * PERFORM_WINDOW_PAUSE_S)} s, and the ` +
              "accessibility API agreed for another " +
              `${Math.round(PERFORM_ADJUDICATION_MS / 1000)} s. Either the application has ` +
              "gone, or nothing has a window on this display — " +
              "`svatah surface doctor --adapter ax` says which."
            : `The accessibility action failed: ${answer.error ?? "unknown"}.`,
        );
      }
    },

    async screenshot(path, box): Promise<void> {
      /*
       * `screencapture` rather than an accessibility call: AX has no way to
       * render an element, and the Screen Recording permission is a separate
       * grant from the Accessibility one, so a failure here must not be read as
       * an accessibility failure.
       */
      const args = ["-x", ...(box === undefined ? [] : ["-R", box.join(",")]), path];
      await new Promise<void>((resolve) => {
        const child = spawn("screencapture", args, { stdio: "ignore" });
        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
        child.on("error", () => {
          clearTimeout(timer);
          resolve();
        });
        child.on("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };

  return bridge;
}

const PROMPT_ADVICE =
  "The Accessibility permission has not been granted to the program running Svatah. " +
  "Open System Settings → Privacy & Security → Accessibility, add the terminal (or the " +
  "test runner) you are running from, and switch it on. macOS asks once and remembers " +
  "the answer per program, so a permission granted to Terminal does not carry to iTerm, " +
  "to VS Code, or to a CI agent.";

const DENIED_ADVICE =
  "The Accessibility permission was refused for the program running Svatah. Open System " +
  "Settings → Privacy & Security → Accessibility, switch it on for that program, and " +
  "restart it — macOS does not re-read the setting for a process that is already running.";
