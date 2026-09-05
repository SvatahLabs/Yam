/**
 * The one part of this adapter that touches macOS (T6.2, LLD §7.5, REQ-ADP-7).
 *
 * > AX: `AXUIElement` via a small native module; `AXRole` → role map;
 * > `AXIdentifier` → `automationId`; actions via `AXPress`, `AXSetValue`,
 * > keyboard events; documents the accessibility permission prompt and provides
 * > a `svatah surface doctor` check.
 *
 * ## Why `osascript`, and not a native module
 *
 * A native N-API module would call `AXUIElementCopyAttributeValue` directly.
 * It would also need a compiler on every machine that installs this package,
 * which is what `node-gyp` means in practice — and REQ-PKG-3 keeps the
 * dependency tree permissive, not merely licensed. macOS already ships a client
 * of exactly that API: **System Events**, whose `UI elements` and
 * `attributes` are `AXUIElement` under a scripting name. Driving it through
 * `osascript -l JavaScript` needs nothing installed, needs the same
 * Accessibility permission a native module would, and reads the same tree.
 *
 * The cost is real and is stated rather than hidden: every attribute is an
 * Apple event, so a large tree is measured in seconds where a native module
 * would be measured in milliseconds. `entire contents` is used to fetch a
 * window's elements in one event, and each element's attributes are then read
 * in a bounded set. See the deviation in `docs/spec/progress/phase-6.md`.
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

/** What the bridge was asked to do, and what came back. */
export interface AxWindow {
  /** The application process the tree was read from. */
  readonly process: string;
  /** The front window's `AXTitle`, which is what `state()` reports. */
  readonly title: string;
  readonly nodes: readonly AxNode[];
  /** True when the walk stopped at `maxNodes` rather than at the leaves. */
  readonly truncated: boolean;
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

/** An action the bridge performs on one element, addressed by its path. */
export type AxCommand =
  | { readonly kind: "action"; readonly path: readonly number[]; readonly action: string }
  | { readonly kind: "setValue"; readonly path: readonly number[]; readonly value: string }
  | { readonly kind: "focus"; readonly path: readonly number[] }
  | { readonly kind: "keystroke"; readonly text: string; readonly using?: readonly string[] }
  | { readonly kind: "keycode"; readonly code: number; readonly using?: readonly string[] }
  | { readonly kind: "click"; readonly at: readonly [number, number] }
  | { readonly kind: "activate" };

/**
 * What the adapter needs from macOS. Everything else is a pure function.
 */
export interface AxBridge {
  /** Is the Accessibility permission granted to whatever is running this? */
  permission(): Promise<AxPermission>;
  /** The accessibility tree of a process's front window. */
  window(request: { process: string; maxNodes: number }): Promise<AxWindow>;
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
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return await new Promise((resolve) => {
    const child = spawn("osascript", ["-l", "JavaScript", "-e", script, JSON.stringify(argument)], {
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
 * The smallest call that needs the Accessibility permission and nothing else.
 *
 * Counting processes touches no application and asks for no attribute, so a
 * failure here is about the permission rather than about the target.
 */
const PERMISSION_SCRIPT = `function run(argv) {
  const se = Application("System Events");
  return JSON.stringify({ ok: true, processes: se.applicationProcesses.length });
}`;

/**
 * One window's accessibility tree.
 *
 * The walk is breadth-first with a node budget, so a truncated tree is the top
 * of the window rather than one deep branch of it — a snapshot that stopped
 * after the first sidebar would be worse than useless for grounding.
 *
 * Every attribute read is wrapped, because asking a macOS element for an
 * attribute it does not have throws rather than answering null, and one missing
 * `AXIdentifier` must not lose the whole tree.
 */
const WINDOW_SCRIPT = `function run(argv) {
  const request = JSON.parse(argv[0]);
  const se = Application("System Events");
  const proc = se.applicationProcesses.byName(request.process);

  function attr(element, name) {
    try { const v = element.attributes.byName(name).value(); return v === null ? undefined : v; }
    catch (e) { return undefined; }
  }
  function str(v) {
    if (v === undefined || v === null) return undefined;
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return undefined;
  }
  function bool(v) { return typeof v === "boolean" ? v : undefined; }

  const windows = proc.windows();
  if (windows.length === 0) {
    return JSON.stringify({ ok: false, error: "no-window", process: request.process });
  }
  const win = windows[0];

  const nodes = [];
  const queue = [{ element: win, parent: -1 }];
  let truncated = false;

  while (queue.length > 0) {
    if (nodes.length >= request.maxNodes) { truncated = true; break; }
    const { element, parent } = queue.shift();
    const index = nodes.length;

    let actions = [];
    try { actions = element.actions.name(); } catch (e) { actions = []; }

    let box = undefined;
    const position = attr(element, "AXPosition");
    const size = attr(element, "AXSize");
    if (Array.isArray(position) && Array.isArray(size)) {
      box = [position[0], position[1], size[0], size[1]];
    }

    const value = attr(element, "AXValue");
    const node = {
      parent: parent,
      role: str(attr(element, "AXRole")) || "AXUnknown",
      subrole: str(attr(element, "AXSubrole")),
      title: str(attr(element, "AXTitle")),
      description: str(attr(element, "AXDescription")),
      value: str(value),
      identifier: str(attr(element, "AXIdentifier")),
      domIdentifier: str(attr(element, "AXDOMIdentifier")),
      help: str(attr(element, "AXHelp")),
      placeholder: str(attr(element, "AXPlaceholderValue")),
      enabled: bool(attr(element, "AXEnabled")),
      focused: bool(attr(element, "AXFocused")),
      selected: bool(attr(element, "AXSelected")),
      expanded: bool(attr(element, "AXExpanded")),
      checked: typeof value === "boolean" ? value : (value === 1 ? true : (value === 0 ? false : undefined)),
      box: box,
      actions: actions
    };
    for (const key of Object.keys(node)) if (node[key] === undefined) delete node[key];
    nodes.push(node);

    let children = [];
    try { children = element.uiElements(); } catch (e) { children = []; }
    for (const child of children) queue.push({ element: child, parent: index });
  }

  return JSON.stringify({
    ok: true,
    process: request.process,
    title: str(attr(win, "AXTitle")) || "",
    nodes: nodes,
    truncated: truncated
  });
}`;

/**
 * One command.
 *
 * An element is addressed by its **path** — the child index at each level from
 * the window down — rather than by a handle, because AppleScript object
 * specifiers do not survive between `osascript` processes. The path is what the
 * snapshot's walk already produced, so it costs nothing to carry.
 */
const PERFORM_SCRIPT = `function run(argv) {
  const command = JSON.parse(argv[0]);
  const se = Application("System Events");

  if (command.kind === "activate") {
    se.applicationProcesses.byName(command.process).frontmost = true;
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

  const proc = se.applicationProcesses.byName(command.process);
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
  /** For tests: run a script without spawning anything. */
  readonly run?: typeof runOsascript;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const PERMISSION_TIMEOUT_MS = 5_000;

/** The real bridge: `osascript`, System Events, and this machine. */
export function osascriptBridge(options: OsascriptBridgeOptions): AxBridge {
  const run = options.run ?? runOsascript;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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

  return {
    async permission(): Promise<AxPermission> {
      if (process.platform !== "darwin") {
        return {
          state: "unsupported",
          advice:
            "The macOS Accessibility adapter runs on macOS only. Use `--adapter uia` on " +
            "Windows, or `--adapter playwright` for a web application.",
        };
      }
      const result = await run(PERMISSION_SCRIPT, {}, PERMISSION_TIMEOUT_MS);
      if (result.timedOut) return { state: "prompt-pending", advice: PROMPT_ADVICE };
      if (result.code === 0 && result.stdout.includes('"ok":true')) {
        return { state: "granted", advice: "The Accessibility permission is granted." };
      }
      const detail = (result.stderr || result.stdout).trim();
      /*
       * `-1743` is "Not authorised to send Apple events"; `-25211` is the
       * accessibility API's own refusal. Anything else that fails here is
       * treated as the prompt, because a first run on a clean machine produces
       * a timeout rather than either code and telling someone "denied" when
       * they have simply not been asked yet sends them to the wrong screen.
       */
      const denied = detail.includes("-1743") || detail.includes("-25211");
      return {
        state: denied ? "denied" : "prompt-pending",
        advice: denied ? DENIED_ADVICE : PROMPT_ADVICE,
        ...(detail === "" ? {} : { detail }),
      };
    },

    async window(request): Promise<AxWindow> {
      const answer = (await call(WINDOW_SCRIPT, request, timeoutMs)) as {
        ok: boolean;
        error?: string;
        process?: string;
        title?: string;
        nodes?: AxNode[];
        truncated?: boolean;
      };
      if (!answer.ok) {
        throw new AxBridgeError(
          answer.error === "no-window"
            ? `The process "${request.process}" has no window. Is it running, and not minimised?`
            : `The accessibility call failed: ${answer.error ?? "unknown"}.`,
        );
      }
      return {
        process: answer.process ?? request.process,
        title: answer.title ?? "",
        nodes: answer.nodes ?? [],
        truncated: answer.truncated === true,
      };
    },

    async perform(command): Promise<void> {
      const answer = (await call(
        PERFORM_SCRIPT,
        { ...command, process: options.process },
        timeoutMs,
      )) as { ok: boolean; error?: string };
      if (!answer.ok) {
        throw new AxBridgeError(`The accessibility action failed: ${answer.error ?? "unknown"}.`);
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
