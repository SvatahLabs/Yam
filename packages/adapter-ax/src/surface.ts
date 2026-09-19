/**
 * The macOS Accessibility adapter: `AgentSurface` on a desktop application
 * (T6.2, LLD §7.5, REQ-ADP-7, REQ-ADE-6).
 *
 * > AX: `AXUIElement` via a small native module; `AXRole` → role map;
 * > `AXIdentifier` → `automationId`; actions via `AXPress`, `AXSetValue`,
 * > keyboard events; documents the accessibility permission prompt and provides
 * > a `yam surface doctor` check. Both: `state()` returns the focused window
 * > and title; `restore` activates the window; screenshots via OS APIs; masks by
 * > box.
 *
 * ## References are indices into the last snapshot
 *
 * The same rule the Appium adapter follows, and for the same reason: an
 * AppleScript object specifier does not survive between `osascript` processes,
 * so there is nothing to hold on to between calls. `rN` is a position in the
 * picture that was taken, and a window that changed invalidates every one of
 * them — which is honest, because on a desktop it genuinely does.
 *
 * ## What acting on a desktop element is
 *
 * > `act` via UIA patterns (Invoke, Value, Toggle, Selection, Scroll) with a
 * > mouse/keyboard fallback at the element's box centre.
 *
 * macOS's equivalent of a UIA pattern is an **action**: an element declares
 * `AXPress`, `AXIncrement`, `AXShowMenu`, and performing one is a first-class
 * accessibility call that does not move the mouse or steal focus. That is the
 * first choice for every action that has one. Where the element declares none —
 * a canvas, a custom control, a Chromium node that Chromium did not give an
 * action — the fallback is a click at the centre of the element's box, which is
 * what a person would do and is why the box is in the snapshot.
 */
import type {
  ActArgs,
  ActResult,
  Candidate,
  Capabilities,
  CheckResult,
  CheckSubject,
  ElementDescription,
  Predicate,
  ReadKind,
  Ref,
  SessionInit,
  SessionState,
  Snapshot,
  SurfaceAction,
  SurfaceKind,
} from "@svatah/yam-schema";
import type { AgentSurface } from "@svatah/yam-surface";
import {
  ActionabilityError,
  buildSnapshot,
  DataError,
  executableOf,
  launchApplication,
  locateDeadline,
  LocateError,
  PermissionError,
  quitApplication,
  ScriptError,
  SessionError,
  stableClassesOf,
  structuralHash,
  TimeoutError,
  UnsupportedError,
  waitFor,
  waitForPage,
  type LaunchConfig,
  type QuitConfig,
  type SnapshotNode,
} from "@svatah/yam-surface";
import {
  osascriptBridge,
  AxBridgeError,
  type AxBridge,
  type AxSnapshotCost,
  type AxWindow,
} from "./bridge.js";
import { screenRecordingGranted } from "./grant.js";
import { matchNodes, synthesise } from "./locate.js";
import { evaluateAxPredicate, pageTextOf } from "./predicates.js";
import { convertTree, nameOf, saidBy, type AxSnapshotNode } from "./tree.js";

const DEFAULT_MAX_NODES = 1_500;

/**
 * What `screencapture` prints when the program running it has no Screen
 * Recording grant — the same words `yam surface doctor`'s check is written
 * around.
 */
const SCREEN_RECORDING_REFUSED = /could not create image from display/i;

/**
 * How far a window's measured size may sit from the one asked for and still
 * count as obeyed.
 *
 * A point, because `AXSize` is written in points and read back through a frame
 * that a scaled display rounds. Anything wider than rounding is the window
 * declining, which is the thing worth reporting.
 */
const SIZE_TOLERANCE = 1;

/**
 * What this adapter can do (LLD §2.4).
 *
 * `dialogs` is false because a macOS sheet is an element of the window's own
 * tree rather than something the driver hands over separately; `frames` is
 * false because a desktop window has no frames — a Chromium `<iframe>` appears
 * as more of the same `AXWebArea`. `windows` is true: switching between an
 * application's windows is `AXRaise` and is what `switchWindow` means here.
 * `webmcp` is false: a declared site tool is a browser idea and belongs to the
 * Playwright adapter (LLD §6.3).
 */
export const AX_CAPABILITIES: Capabilities = {
  dialogs: false,
  frames: false,
  windows: true,
  upload: false,
  drag: false,
  trace: false,
  webmcp: false,
  pick: false,
  observe: false,
  screenshot: true,
  restore: true,
};

export interface AxAdapterOptions {
  /**
   * The application process to drive.
   *
   * `config.app.processName`, and for the desktop conformance suite it is the
   * app's own process name (LLD §16). There is no default: driving "whatever is
   * frontmost" would make a run depend on what the person at the machine last
   * clicked.
   */
  readonly processName?: string;
  /** `config.app.appPath` — launched by `open` when the process is not running. */
  readonly appPath?: string;
  /**
   * `config.run.candidateTimeoutMs` — how long a `locate` may keep re-reading
   * the window before it answers "nothing" (T11.2).
   *
   * Zero is one read, which is what every caller had before and what a
   * `snapshot()` still is.
   */
  readonly candidateTimeoutMs?: number;
  /** `config.app.launch` — how to start it when nothing of that name has a window. */
  readonly launch?: LaunchConfig;
  /** `config.app.quit` — the graceful route, then a signal. */
  readonly quit?: QuitConfig;
  readonly maxNodes?: number;
  readonly timeoutMs?: number;
  /** Injected by the tests, so the whole adapter runs against a recorded tree. */
  readonly bridge?: AxBridge;
  /**
   * Whether Screen Recording is granted: `screenRecordingGranted` from
   * `grant.ts` unless given, which asks macOS without a prompt. `undefined` is
   * "could not ask". Injected by the tests.
   */
  readonly screenRecordingGranted?: () => boolean | undefined;
}

export class AxSurface implements AgentSurface {
  readonly kind: SurfaceKind = "desktop";

  private bridge: AxBridge | undefined;
  private processName: string | undefined;
  /** The nodes of the most recent snapshot; `rN` indexes this. */
  private nodes: AxSnapshotNode[] = [];
  private windowTitle = "";
  /**
   * What this session launched, and so what it is responsible for quitting
   * (T11.2). Undefined when it attached to an application that was already
   * running: an adapter that quit a person's own window because a flow finished
   * would be a very poor guest.
   */
  private launched: LaunchConfig | undefined;
  /**
   * The costliest window read of this session (Draft 2.8 §7.5).
   *
   * The *costliest*, not the last: the claim §7.5 asks the conformance report
   * to publish is about the largest window the suite touched — "the app's
   * project screen with every tab present, at least 400 nodes, snapshots
   * within the surface's default deadline of 10 s". A mean over a session that
   * spent most of its reads on the welcome window would hide exactly the read
   * the budget is about.
   */
  private worstCost: AxSnapshotCost | undefined;
  /**
   * How the tree was last read, so a wait re-reads it the same way: a
   * controls-only tree and a whole one index their elements differently, and a
   * wait compares the tree its reference came from with the tree as it is now.
   */
  private lastRead: { interactiveOnly?: boolean; maxNodes?: number } = {};

  constructor(private readonly options: AxAdapterOptions = {}) {}

  capabilities(): Capabilities {
    return { ...AX_CAPABILITIES };
  }

  async open(session: SessionInit): Promise<void> {
    const name = session.processName ?? this.options.processName;
    this.bridge =
      this.options.bridge ??
      osascriptBridge({
        process: name ?? "System Events",
        ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
      });

    /*
     * The permission first — before the configuration, and before the first
     * snapshot (REQ-ADP-7).
     *
     * Before the snapshot, because a session that opened and then failed on its
     * first `locate` would report a `locator` failure for an element that was
     * there all along. Before the *configuration*, because telling someone on
     * Windows to set `app.processName` is the wrong advice: the host is the
     * problem, and the process name would not fix it.
     */
    const permission = await this.bridge.permission();
    /*
     * Three answers that are not "granted", and only one of them is a
     * permission to go and grant (SF-14).
     *
     * `unsupported` is a host that is not macOS: it was a `PermissionError`
     * that sent a person on Linux to look for System Settings. It is refused as
     * unsupported, in the bridge's words about which adapter to use instead.
     * `unknown` is a check that did not answer — System Events timed out, or
     * failed without a refusal code, while macOS's own trust check did not say
     * the permission is missing — and is a `SessionError` that says what
     * failed. `denied` and a genuinely unanswered prompt stay `PermissionError`.
     */
    if (permission.state === "unsupported") {
      throw new UnsupportedError(permission.advice, { adapter: "ax" });
    }
    if (permission.state === "unknown") {
      throw new SessionError(
        "The macOS Accessibility permission could not be checked, so the session was not " +
          `opened: ${permission.detail ?? "the check did not answer"}. ${permission.advice}`,
        { adapter: "ax" },
      );
    }
    if (permission.state !== "granted") {
      /*
       * Name the program the grant is actually about (T18, SF-17).
       *
       * macOS gives the Accessibility permission to a *program*, and the
       * program asking here is whichever one started the session — which, for
       * a `yam surface` command, is the **broker**, and the broker is started
       * by the first client that needs one. On a machine where the desktop
       * application got there first, that program is the copy of the CLI staged
       * inside `Yam.app`, and the grant a person gave their terminal does not
       * apply to it.
       *
       * Measured while writing T18: `yam surface doctor` in a terminal said
       * **granted** and `yam surface connect --adapter ax` said **denied**, on
       * the same machine, a second apart. Both were true. Without the path
       * below there is no way to tell that from a bug, and nothing a person can
       * usefully do about it.
       *
       * A `PermissionError` rather than the plain `SessionError` it was (SF-14):
       * the broker told the caller `CONNECT_FAILED`, which sends a person to the
       * application, and the application is fine. `PERMISSION_REQUIRED` sends
       * them to System Settings, which is the only place the fix is.
       */
      const program = process.argv[1] ?? process.execPath;
      throw new PermissionError(
        `The macOS Accessibility permission is not granted (${permission.state}) to the ` +
          `program that is driving: ${program}. ${permission.advice} ` +
          "Grant it to that program — `yam surface doctor` reports the permission of whatever " +
          "program *it* runs as, which is not always this one.",
        { adapter: "ax" },
      );
    }

    if (name === undefined || name.trim() === "") {
      throw new SessionError(
        "The AX adapter needs the name of the application process to drive. Set " +
          "`app.processName` in `yam.config.yaml` (the app is \"Yam\"). Driving " +
          "whatever happens to be frontmost would make a run depend on what was last clicked.",
        { adapter: "ax" },
      );
    }
    this.processName = name;

    /*
     * Launch it, if nothing of that name owns a window yet (T11.2, LLD §13.9).
     *
     * > the session opens by launching when no process of that name owns a
     * > window and closes by quitting.
     *
     * "Owns a window", not "is running": a process that is still exiting and a
     * helper that shares its application's name are both running and neither
     * can be driven (P8-F1). The question is the one the bridge answers, which
     * is why this is here and the *how* is `@svatah/yam-surface`'s.
     *
     * A session that found the application already up does not remember a
     * launch, and so will not quit it: an adapter that closed a person's own
     * window because a flow finished would be a very poor guest.
     */
    const launch = session.launch ?? this.options.launch;
    if (launch !== undefined && !(await this.hasWindow())) {
      const started = launchApplication(launch);
      if (!started.ok) {
        throw new SessionError(
          `Could not launch the application: ${started.command}` +
            `${started.detail === undefined ? "" : ` — ${started.detail}`}`,
          { adapter: "ax" },
        );
      }
      const appeared = await waitFor(() => this.hasWindow(), {
        ...(launch.timeoutMs === undefined ? {} : { timeoutMs: launch.timeoutMs }),
      });
      if (!appeared.ready) {
        const session_ = await this.bridge.session();
        throw new SessionError(
          `"${name}" was launched and showed no window within ${appeared.ms} ms. ` +
            `The login session says: ${session_.detail}. ${session_.advice}`,
          { adapter: "ax" },
        );
      }
      this.launched = launch;
    }

    // Bring the window forward, so the tree is the one a person would see.
    await this.bridge.perform({ kind: "activate" }).catch(() => undefined);

    /*
     * `app.launch.size`, applied to whatever window is now in front (T12.7).
     *
     * Applied on every open, not only after a launch: a session that attached
     * to an application somebody left running is reading a window whose size is
     * whatever that person left it at, and a suite that measures a toolbar at
     * 1440 points would then be measuring their preference. Best effort, and
     * deliberately so — an application whose window refuses a size is not a
     * session that failed to open.
     */
    const size = launch?.size;
    if (size !== undefined) {
      await this.bridge
        .perform({ kind: "setSize", size: [size[0], size[1]] })
        .catch(() => undefined);
    }
    await this.refresh();
  }

  /**
   * Does a process of this name own a window an accessibility client can read?
   *
   * The role is the test and not the count: a locked screen answers `AXWindows`
   * with a one-element list holding the *application* (P10-F1), so "the list is
   * not empty" was true of every application on a machine where nothing could
   * be read. `window()` already refuses that list, so asking it is asking the
   * question this session is actually about.
   */
  private async hasWindow(): Promise<boolean> {
    if (this.bridge === undefined || this.processName === undefined) return false;
    try {
      await this.bridge.window({ process: this.processName, maxNodes: 1, deadlineMs: 8_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The graceful route, then a signal — and a failure when it survives both
   * (T11.2, LLD §13.9's pattern 31).
   */
  private async quitTheApplication(): Promise<string> {
    const launch = this.launched ?? this.options.launch;
    let executable = launch === undefined ? undefined : executableOf(launch, process.platform);
    let quit = this.options.quit ?? {};

    /*
     * A session that attached by process name asks the process who it is
     * (native-feedback D4).
     *
     * The refusal below is about *ambiguity* — "a quit addressed by process
     * name alone would reach somebody else's copy" — and it used to be
     * unanswerable at runtime, because the only place a bundle could be named
     * was `yam.config.yaml` before the session opened. So an application Yam
     * had attached to, was driving, and could read the whole tree of, could
     * never be quit. System Events knows which bundle that process was started
     * from; asking it resolves the ambiguity from the running process itself
     * rather than dissolving it by guessing, and the identity used is the one
     * belonging to the process this session is actually driving.
     */
    if (executable === undefined && this.processName !== undefined) {
      const identity = await this.bridge?.identify?.(this.processName);
      const bundlePath = identity?.bundlePath;
      if (bundlePath !== undefined) {
        // `.app` goes in as a bundle, so `executableOf` builds the same
        // `Contents/MacOS/…` command line `pgrep -f` matches; anything else is
        // already the executable.
        executable = bundlePath.endsWith(".app")
          ? executableOf({ bundle: bundlePath }, process.platform)
          : bundlePath;
      }
      if (quit.bundleId === undefined && identity?.bundleId !== undefined) {
        quit = { ...quit, bundleId: identity.bundleId };
      }
    }

    if (executable === undefined) {
      throw new SessionError(
        `"${this.processName ?? "the application"}" could not be identified: System Events ` +
          "does not say which bundle it was started from, so there is nothing to address a " +
          "quit to. Set `app.launch.bundle` (macOS) or `app.launch.path` in " +
          "`yam.config.yaml`: a quit addressed by process name alone would reach somebody " +
          "else's copy of the same application.",
        { adapter: "ax" },
      );
    }

    const outcome = await quitApplication(executable, quit);
    /*
     * The session is over whether or not the process went: every ref points
     * into a tree that is gone, and a step after this one must fail as a step
     * against an application that is not there rather than against a stale
     * snapshot.
     */
    this.nodes = [];
    this.launched = undefined;
    if (!outcome.gone) {
      throw new SessionError(
        `"${this.processName ?? executable}" was asked to quit and did not: ` +
          `${outcome.steps.map((one) => one.what).join(" → ")} over ${outcome.ms} ms.`,
        { adapter: "ax" },
      );
    }
    return `quit in ${outcome.ms} ms (${outcome.steps.map((one) => one.what).join(" → ")})`;
  }

  async close(): Promise<void> {
    /*
     * A session that launched the application quits it (T11.2, LLD §13.9:
     * "closes by quitting"). One that attached to a running one leaves it
     * exactly as it found it.
     */
    if (this.launched !== undefined) {
      await this.quitTheApplication().catch(() => undefined);
    }
    this.bridge = undefined;
    this.nodes = [];
  }

  /**
   * What the biggest snapshot of this session cost.
   *
   * Duck-typed rather than part of `AgentSurface`: the conformance runner asks
   * every adapter for it and publishes it when there is one, the same way it
   * asks the BiDi adapter which browser answered (LLD §7.3). A surface with no
   * process boundary has no such number and does not pretend to.
   */
  bridgeCost(): AxSnapshotCost | undefined {
    return this.worstCost;
  }

  private live(): AxBridge {
    if (this.bridge === undefined || this.processName === undefined) {
      throw new SessionError("The AX session is not open.", { adapter: "ax" });
    }
    return this.bridge;
  }

  /* ── snapshot, locate, describe ─────────────────────────────────────────── */

  private async readWindow(maxNodes: number): Promise<AxWindow> {
    try {
      return await this.live().window({ process: this.processName!, maxNodes });
    } catch (error) {
      if (error instanceof AxBridgeError) {
        throw new SessionError(
          `${error.message}${error.detail === undefined ? "" : ` (${error.detail})`}`,
          { adapter: "ax", cause: error },
        );
      }
      throw error;
    }
  }

  /** Re-read the window and rebuild every reference. */
  private async refresh(options: { interactiveOnly?: boolean; maxNodes?: number } = {}): Promise<void> {
    const window = await this.readWindow(options.maxNodes ?? this.options.maxNodes ?? DEFAULT_MAX_NODES);
    this.lastRead = options;
    if (
      this.worstCost === undefined ||
      window.cost.nodes > this.worstCost.nodes ||
      (window.cost.nodes === this.worstCost.nodes && window.cost.wallMs > this.worstCost.wallMs)
    ) {
      this.worstCost = window.cost;
    }
    this.windowTitle = window.title;
    this.nodes = convertTree(window.nodes, {
      maxNodes: options.maxNodes ?? this.options.maxNodes ?? DEFAULT_MAX_NODES,
      interactiveOnly: options.interactiveOnly === true,
      windowTitle: window.title,
    });
  }

  async snapshot(
    opts: { root?: Ref; maxNodes?: number; interactiveOnly?: boolean } = {},
  ): Promise<Snapshot> {
    await this.refresh({
      ...(opts.maxNodes === undefined ? {} : { maxNodes: opts.maxNodes }),
      ...(opts.interactiveOnly === undefined ? {} : { interactiveOnly: opts.interactiveOnly }),
    });

    const visible =
      opts.root === undefined ? this.nodes : this.subtree(this.nodeFor(opts.root));
    const nodes = visible.map(
      ({ path: _path, source: _source, controlPath: _controlPath, ...node }) => node,
    ) as SnapshotNode[];
    return buildSnapshot(opts.root ?? nodes[0]?.ref ?? "r0", nodes, structuralHash(nodes));
  }

  /** A node and everything under it, by reference chain. */
  private subtree(root: AxSnapshotNode): AxSnapshotNode[] {
    const kept = new Set<string>([root.ref]);
    const out: AxSnapshotNode[] = [];
    for (const node of this.nodes) {
      if (node.ref === root.ref || (node.parent !== undefined && kept.has(node.parent))) {
        kept.add(node.ref);
        out.push(node);
      }
    }
    return out;
  }

  async locate(candidate: Candidate): Promise<Ref[]> {
    /*
     * Against the *current* window, not the last snapshot. A resolver calls
     * `locate` to find out what is on screen now, and answering from a snapshot
     * taken before the last click would report an element that is gone.
     *
     * ## And it waits, because a desktop tree has no auto-wait (T11.2)
     *
     * A web adapter's locator retries inside Playwright until its timeout: a
     * click is a request the page answers, and the next `locate` is expected to
     * find something that was not there when the click was sent. A desktop
     * snapshot is a *moment*, so the same flow — click a project, then look for
     * the rail — failed whenever the screen took longer to arrive than one
     * read, which is intermittently, which is the worst way to fail. Measured:
     * one run in three on this host.
     *
     * So a locate that finds nothing is re-read until it does, or until just
     * short of the candidate timeout — short of it, because the resolver races
     * the same budget and a tie makes it publish "candidate timed out" where
     * the truth is "matched nothing" (`locateDeadline`). A locate that finds
     * *something* returns at once, so nothing pays for this but the case that
     * was going to fail anyway.
     */
    const deadline = locateDeadline(this.options.candidateTimeoutMs);
    for (;;) {
      await this.refresh();
      const found = matchNodes(candidate, this.nodes);
      const chosen =
        candidate.nth === undefined ? found : found.slice(candidate.nth, candidate.nth + 1);
      if (chosen.length > 0 || Date.now() >= deadline) return chosen.map((node) => node.ref);
      await new Promise((done) => setTimeout(done, 250));
    }
  }

  async describe(ref: Ref): Promise<ElementDescription> {
    const node = this.nodeFor(ref);
    const siblings = this.nodes.filter((one) => one.parent === node.parent);
    const at = siblings.indexOf(node);
    const textOf = (one: AxSnapshotNode): string => one.name ?? one.value ?? "";

    const attrs: Record<string, string> = { ...node.native };
    if (node.source.subrole !== undefined) attrs["AXSubrole"] = node.source.subrole;
    if (node.source.identifier !== undefined) attrs["AXIdentifier"] = node.source.identifier;
    if (node.source.help !== undefined) attrs["AXHelp"] = node.source.help;
    if (node.source.placeholder !== undefined) {
      attrs["AXPlaceholderValue"] = node.source.placeholder;
    }

    return {
      ref,
      role: node.role,
      ...(node.name === undefined ? {} : { name: node.name }),
      ...(node.value === undefined ? {} : { value: node.value }),
      // The `tag` of a desktop element is its native role, which is what the
      // fingerprint's `tag` compares (LLD §3.3).
      tag: node.source.role,
      attrs,
      text: nameOf(node.source),
      neighbours: {
        before: siblings.slice(Math.max(0, at - 3), at).map(textOf).filter((t) => t !== ""),
        after: siblings.slice(at + 1, at + 4).map(textOf).filter((t) => t !== ""),
      },
      rolePath: this.rolePathOf(node),
      box: node.box ?? [0, 0, 0, 0],
      index: Math.max(0, at),
      states: [...node.states],
      native: {
        ...node.native,
        controlPath: node.controlPath,
        /*
         * The element's classes, for the fingerprint's `class` (LLD §6.4), by
         * the web adapters' rule. In `describe` and not in the snapshot, because
         * the fingerprint is the only reader and a snapshot's shape is recorded.
         */
        ...(stableClassesOf(node.source.domClassList) === undefined
          ? {}
          : { stableClasses: stableClassesOf(node.source.domClassList)! }),
      },
    };
  }

  private rolePathOf(node: AxSnapshotNode): string[] {
    const byRef = new Map(this.nodes.map((one) => [one.ref, one]));
    const out: string[] = [];
    let cursor: AxSnapshotNode | undefined = node;
    while (cursor !== undefined) {
      out.unshift(cursor.role);
      cursor = cursor.parent === undefined ? undefined : byRef.get(cursor.parent);
    }
    return out;
  }

  /** The candidate bundle for one element, for the recorder (REQ-REC-3). */
  candidatesFor(ref: Ref): Candidate[] {
    return synthesise(this.nodeFor(ref), this.nodes);
  }

  private nodeFor(ref: Ref): AxSnapshotNode {
    const node = this.nodes.find((one) => one.ref === ref);
    if (node === undefined) {
      throw new LocateError(
        `Reference ${ref} is not in the current snapshot. A desktop window that changed ` +
          "invalidates every reference (LLD §2.2); take a new snapshot.",
        { adapter: "ax" },
      );
    }
    return node;
  }

  /* ── act ────────────────────────────────────────────────────────────────── */

  async act(action: SurfaceAction, ref?: Ref, args: ActArgs = {}, ref2?: Ref): Promise<ActResult> {
    const bridge = this.live();
    const need = (which: Ref | undefined): AxSnapshotNode => {
      if (which === undefined) {
        throw new LocateError(`The "${action}" action needs a reference.`, { adapter: "ax" });
      }
      return this.nodeFor(which);
    };
    const str = (name: string, fallback?: string): string => {
      const value = args[name];
      if (value === undefined) {
        if (fallback !== undefined) return fallback;
        throw new ScriptError(`The "${action}" action needs an argument "${name}".`, {
          adapter: "ax",
        });
      }
      return Array.isArray(value) ? value.join(",") : String(value);
    };

    switch (action) {
      /*
       * Refused as unsupported, not as a navigation that failed (SF-11). A
       * `NavigationError` is told to a caller as `CONNECT_FAILED`, which reads
       * as "the application went away"; nothing was sent to it, and no amount
       * of waiting gives a desktop window an address bar.
       */
      case "navigate":
      case "back":
      case "forward":
      case "refresh":
        throw new UnsupportedError(
          `A desktop application has no "${action}". Drive its own controls instead: the ` +
            "AX adapter has no address bar to type into.",
          { adapter: "ax" },
        );

      /**
       * `Quit the app` (pattern 31, T11.2, LLD §13.9).
       *
       * > which ends the session through the graceful route and fails if the
       * > process survives it.
       *
       * The graceful route and the escalation are `@svatah/yam-surface`'s
       * `quitApplication`, because they are the same three decisions on every
       * platform; what belongs here is only that a quit *ends this session* —
       * the tree is gone and every ref with it, so a step after this one is a
       * step against an application that is not there.
       */
      case "quit": {
        // `value`, not a field of its own: `ActResult` carries what an action
        // produced, and what a quit produced is how it went.
        const outcome = await this.quitTheApplication();
        return { ok: true, value: outcome };
      }

      /**
       * `Resize the window to <w> by <h>` (pattern 33, T12.7, LLD §13.9).
       *
       * Through the window's `AXSize`, which is the same route `app.launch.size`
       * takes when the session opens — one mechanism, so an initial size and a
       * mid-flow resize cannot disagree. The tree is re-read afterwards because
       * a resize is a relayout: every box in the snapshot has moved, and the
       * toolbar rules these sentences exist for are about boxes.
       */
      case "resizeWindow": {
        const width = Number(args["width"]);
        const height = Number(args["height"]);
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          throw new ScriptError(
            `"resizeWindow" needs a width and a height; it was given ` +
              `${JSON.stringify(args["width"])} by ${JSON.stringify(args["height"])}.`,
            { adapter: "ax" },
          );
        }
        /*
         * Read back, because writing `AXSize` is a *request* (native-feedback D2).
         *
         * A window declares a minimum and a maximum size, a full-screen or
         * zoomed window declines to be sized at all, and a window that is not
         * resizable — Calculator's is the everyday one — takes the write
         * without error and stays exactly as it was. System Events reports none
         * of that: the assignment succeeds, so `perform` returns, so this said
         * `{ok: true}` about a window whose box the very next snapshot showed
         * unchanged. The write is not the evidence; the size afterwards is.
         */
        const before = this.windowSize();
        await bridge.perform({ kind: "setSize", size: [width, height] });
        await this.refresh();
        const after = this.windowSize();

        if (after === undefined) {
          throw new ActionabilityError(
            `The window of "${this.processName ?? "the application"}" publishes no size, so a ` +
              "resize to " +
              `${width} by ${height} cannot be confirmed. Nothing here can tell a window that ` +
              "refused from one that obeyed.",
            { adapter: "ax" },
          );
        }
        if (Math.abs(after[0] - width) > SIZE_TOLERANCE || Math.abs(after[1] - height) > SIZE_TOLERANCE) {
          const stayed =
            before !== undefined && before[0] === after[0] && before[1] === after[1];
          throw new ActionabilityError(
            `The window would not take that size: it was asked for ${width} by ${height} and ` +
              `is ${after[0]} by ${after[1]}` +
              (stayed
                ? ", unchanged — the window is not resizable, or it is zoomed or full-screen."
                : ` (it was ${before?.[0] ?? "?"} by ${before?.[1] ?? "?"}) — the window clamped ` +
                  "the request to its own minimum or maximum."),
            { adapter: "ax" },
          );
        }
        // The size that was actually taken, so the record shows a measurement
        // rather than the request echoed back at whoever made it.
        return { ok: true, value: { width: after[0], height: after[1] } };
      }

      case "click":
      case "submit":
        await this.press(need(ref));
        await this.refresh();
        return { ok: true };

      case "doubleClick": {
        const node = need(ref);
        await this.press(node);
        await this.press(node);
        await this.refresh();
        return { ok: true };
      }

      case "rightClick": {
        const node = need(ref);
        // `AXShowMenu` is the accessible right-click, and it is what a control
        // with a context menu declares.
        if (node.source.actions?.includes("AXShowMenu") === true) {
          await bridge.perform({ kind: "action", path: node.path, action: "AXShowMenu" });
        } else {
          await bridge.perform({ kind: "click", at: this.centreOf(node) });
        }
        await this.refresh();
        return { ok: true };
      }

      case "hover":
        /*
         * Refused, where it answered `{ok: true}` and did nothing (SF-11).
         *
         * A hover is a pointer resting over an element, and this bridge has no
         * pointer move: System Events clicks at a point, and a click is not a
         * hover — it presses whatever is there. So a "hover to open the menu"
         * step passed with the menu shut, and the failure surfaced one step
         * later as a missing menu item. Refused before the reference is
         * resolved, because no element makes it possible.
         */
        throw new UnsupportedError(
          "The AX adapter cannot hover: System Events can click at a point but cannot move the " +
            "pointer without pressing, and an accessibility call has no hover. Click the element " +
            "if pressing it is what is meant.",
          { adapter: "ax" },
        );

      case "scrollIntoView": {
        const node = need(ref);
        /*
         * Performed when the element can be scrolled to, and confirmed when it
         * cannot (SF-11).
         *
         * This answered `{ok: true}` for every element, on the grounds that an
         * element in the tree is reachable — which says nothing about whether
         * it is on screen, and a click at the centre of an off-screen box lands
         * on something else. `AXScrollToVisible` is an ordinary AX action: an
         * element that lists it is performed on by name, as `AXPress` is. One
         * that does not is only "in view" if its box is inside the window's;
         * outside it, there is nothing this bridge can do, and it says so.
         */
        if (node.source.actions?.includes("AXScrollToVisible") === true) {
          await bridge.perform({ kind: "action", path: node.path, action: "AXScrollToVisible" });
          await this.refresh();
          return { ok: true };
        }
        const window = this.nodes.find((one) => one.depth === 0)?.box;
        if (node.box !== undefined && window !== undefined && boxInside(node.box, window)) {
          return { ok: true };
        }
        throw new UnsupportedError(
          `${node.role}${node.name === undefined ? "" : ` "${node.name}"`} declares no ` +
            "`AXScrollToVisible` and " +
            (node.box === undefined || window === undefined
              ? "publishes no box to show it is inside the window"
              : `is outside the window (its box is ${node.box.join(", ")}; the window's is ` +
                `${window.join(", ")})`) +
            ". System Events has no scroll gesture to bring it into view.",
          { adapter: "ax" },
        );
      }

      case "type": {
        const node = need(ref);
        const value = str("value", "");
        await bridge.perform({ kind: "focus", path: node.path });
        /*
         * Web content is typed into, never assigned to (P-W2-F13).
         *
         * `AXSetValue` puts the text in the element and tells nobody. A native
         * control is fine with that — it reads its own value when asked. A
         * framework-rendered one is not: React, Vue and Angular all keep the
         * value in their own state and update it from *events*, so an assigned
         * value leaves the page showing "ada" and the application still holding
         * "". The adapter then reports success, which is the worst of both.
         *
         * This is not hypothetical. Yam drives the packaged Yam in
         * `evals/self/yam-on-yam`, typed into that application's own fill form
         * over AX, and the application dispatched with no value at all: "The
         * `type` action needs `value`. Nothing was dispatched." The browser
         * passes, which type through CDP and therefore produce real key events,
         * did the same journey without trouble.
         *
         * So inside an `AXWebArea` the keys are pressed, which is what a person
         * does and what every framework is listening for. Select-all first, so
         * typing replaces rather than appends — `setValue` replaced, and this
         * has to mean the same thing.
         */
        const webContent = node.controlPath.includes("AXWebArea");
        const assignable =
          node.source.actions?.includes("AXSetValue") === true || node.value !== undefined;
        if (assignable && !webContent) {
          await bridge.perform({ kind: "setValue", path: node.path, value });
        } else {
          /*
           * Frontmost first. `keystroke` is System Events typing into whatever
           * application is active — focusing a node inside a background window
           * does not make that window the one receiving keys, and the text goes
           * wherever the person was last. `setValue` needed no such thing, which
           * is half of why it was reached for.
           */
          await bridge.perform({ kind: "activate" });
          await bridge.perform({ kind: "focus", path: node.path });
          /* ⌘A, then the text: replace, as assignment would have. */
          await bridge.perform({ kind: "keystroke", text: "a", using: ["command down"] });
          await bridge.perform({ kind: "keystroke", text: value });
        }
        await this.refresh();
        return { ok: true };
      }

      case "clear": {
        const node = need(ref);
        await bridge.perform({ kind: "focus", path: node.path });
        await bridge.perform({ kind: "setValue", path: node.path, value: "" });
        await this.refresh();
        return { ok: true };
      }

      case "keyDown":
      case "keyUp":
        /*
         * Refused, where both sent a whole key press (SF-11). `key code` and
         * `keystroke` press and release in one Apple event; System Events has
         * no way to hold a key down, so a `keyDown` of Shift followed by a click
         * clicked unshifted — and typed nothing a `keyUp` could end. Refused
         * before anything is focused, because nothing was going to be sent.
         */
        throw new UnsupportedError(
          `The AX adapter has no "${action}": System Events sends a key as one press and ` +
            "release and cannot hold a key down. Press the chord in one step instead " +
            '(`press "Shift+Tab"`).',
          { adapter: "ax" },
        );

      case "press": {
        if (ref !== undefined) await bridge.perform({ kind: "focus", path: need(ref).path });
        const key = str("key");
        const chord = keyChord(key);
        if (chord.code !== undefined) {
          await bridge.perform({
            kind: "keycode",
            code: chord.code,
            ...(chord.using.length === 0 ? {} : { using: chord.using }),
          });
        } else {
          await bridge.perform({
            kind: "keystroke",
            text: chord.text,
            ...(chord.using.length === 0 ? {} : { using: chord.using }),
          });
        }
        await this.refresh();
        return { ok: true };
      }

      case "setChecked": {
        const node = need(ref);
        const wanted = String(args["checked"] ?? "true") === "true";
        const isChecked = node.states.includes("checked");
        if (isChecked !== wanted) {
          await this.press(node);
          await this.refresh();
        }
        return { ok: true };
      }

      case "deselectOption":
        /*
         * Refused, where it used to share `selectOption`'s code and therefore
         * *select* the option it was asked to deselect (SF-11).
         *
         * The control `selectOption` drives here is a pop-up button, and a
         * pop-up menu has no deselected state: choosing an item replaces the
         * previous choice, and there is no item-less choice to go back to. The
         * one macOS control that does hold several selections — a list's
         * `AXSelectedChildren` — is not something System Events will write, so
         * there is no accessible call to make either way. Doing the opposite of
         * what was asked and answering `{ok: true}` is the worst of the three
         * outcomes; saying so before touching the window is the honest one.
         */
        throw new UnsupportedError(
          "The AX adapter cannot deselect an option: a macOS pop-up menu has no deselected " +
            "state — choosing an item replaces the last choice — and System Events cannot " +
            "write a list's `AXSelectedChildren`. Select the option that should be chosen instead.",
          { adapter: "ax" },
        );

      case "selectOption": {
        /*
         * A macOS pop-up button opens a menu and the option is a menu item, so
         * "select the option named X" is: press the control, then press the
         * item. The re-read between the two is what finds the item, because
         * the menu did not exist before the press.
         */
        const node = need(ref);
        /*
         * `value`, `values` or `label` — the three names this action has always
         * answered to (T20).
         *
         * The Playwright adapter reads all three; this one read `value` alone,
         * and the flow language's `Select "<label>" in the <target>` compiles
         * to `label`. So pattern 15 worked on the web and was refused on the
         * desktop with *"the selectOption action needs an argument value"* — a
         * sentence about an argument the caller had supplied under its other
         * documented name.
         */
        const wanted = str(
          args["value"] !== undefined ? "value" : args["values"] !== undefined ? "values" : "label",
        );
        await this.press(node);
        await this.refresh();
        const option = this.nodes.find(
          (one) => (one.role === "menuitem" || one.role === "option") && one.name === wanted,
        );
        if (option === undefined) {
          throw new ActionabilityError(
            `No option named "${wanted}" appeared after opening ${ref}. The AX adapter selects ` +
              "by pressing the control and then the item it opens.",
            { adapter: "ax" },
          );
        }
        await this.press(option);
        await this.refresh();
        return { ok: true };
      }

      case "switchWindow": {
        await bridge.perform({ kind: "activate" });
        await this.refresh();
        return { ok: true };
      }

      case "sleep": {
        const ms = Number(args["ms"] ?? 0);
        await new Promise((done) => setTimeout(done, Number.isFinite(ms) ? ms : 0));
        return { ok: true };
      }

      case "waitFor": {
        /*
         * No reference is a wait for the window rather than for an element
         * (SF-16): its text, or its title. This loop used to run for those too,
         * and it could only ever succeed when given a reference — so `wait for
         * "Saved"` re-read the window for five seconds and then timed out on a
         * window that had said "Saved" from the first read. With neither a
         * reference nor anything to wait for, `waitForPage` refuses at once as
         * a missing argument, rather than timing out on a question never asked.
         */
        if (ref === undefined) return await this.waitForWindow(args);
        return await this.waitForElement(ref, args);
      }

      case "screenshot": {
        await this.screenshot(str("path"));
        return { ok: true };
      }

      case "dragTo":
        /*
         * Refused before either reference is resolved (SF-11): a drag is
         * impossible here whatever the two elements are, so a stale reference
         * must not turn "this adapter cannot drag" into "the element is gone".
         * It was an `ActionabilityError`, which a caller is told as `TIMEOUT` —
         * an invitation to try again that could never succeed.
         */
        void ref2;
        throw new UnsupportedError(
          "The AX adapter cannot drag: `capabilities().drag` is false, because a drag is a " +
            "sequence of pointer events and System Events has no press-move-release (LLD §2.4).",
          { adapter: "ax" },
        );

      default:
        throw new UnsupportedError(
          `The AX adapter has no "${action}". See \`capabilities()\` for what a desktop window ` +
            "supports (LLD §2.4).",
          { adapter: "ax" },
        );
    }
  }

  /**
   * `waitFor` with no reference: the window's text or its title (SF-16).
   *
   * Through `waitForPage`, so "wait for the text" means on a desktop what it
   * means on every other adapter. Two things are this adapter's own. The text
   * is `pageTextOf` over a fresh read — the words a `textContains` on the page
   * answers from — rather than the rendered snapshot, whose lines truncate a
   * long name and quote every one. And a URL is refused before anything waits:
   * `read("url")` throws, `waitForPage` treats a read that throws as "not yet",
   * and a wait for an address a window will never have would otherwise spend
   * its whole timeout finding that out.
   */
  private async waitForWindow(args: ActArgs): Promise<ActResult> {
    if (typeof args["url"] === "string") {
      throw new UnsupportedError(
        "A desktop window has no URL to wait for. Wait for its title or its text instead.",
        { adapter: "ax" },
      );
    }
    return await waitForPage(this, args, {
      adapter: "ax",
      textOf: async () => {
        await this.refresh();
        return pageTextOf(this.nodes);
      },
      // The step timeout this session was configured with, when the step does not say.
      ...(this.options.timeoutMs === undefined ? {} : { defaultTimeoutMs: this.options.timeoutMs }),
    });
  }

  /**
   * `waitFor` with a reference: the element in the state `args.state` names
   * (pattern 19).
   *
   * This ignored the state. It re-read the window until *some* node sat at the
   * reference's index — which, a reference being an index, is almost always at
   * once — so `Wait for the toast to be hidden` returned while the toast was on
   * screen, `to be enabled` returned on a disabled button, and `to be detached`
   * could only succeed on a window that had shrunk. The executor now sends the
   * step's predicate as `args.state`, and each of the six means here what it
   * means on every adapter: `attached` is in a fresh read, `detached` is not,
   * `visible` is there and not `hidden`, `hidden` is gone or `hidden`, and
   * `enabled` and `disabled` are there with or without the `disabled` state.
   *
   * The element is found again by what identifies it (`findWaitedElement`),
   * not by its index, because the index is exactly what a deletion moves. The
   * wait's budget is `args.timeoutMs`, else the session's configured timeout;
   * running out is a `TimeoutError` that says where the element is.
   */
  private async waitForElement(ref: Ref, args: ActArgs): Promise<ActResult> {
    const state = waitStateOf(args, "ax");
    const was = this.nodeFor(ref);
    const then = { nodes: this.nodes, title: this.windowTitle };
    const read = this.lastRead;
    const fallback = this.options.timeoutMs ?? 5_000;
    const asked = Number(args["timeoutMs"] ?? fallback);
    const timeoutMs = Number.isFinite(asked) && asked >= 0 ? asked : fallback;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await this.refresh(read);
      const found = findWaitedElement(ref, was, then, { nodes: this.nodes, title: this.windowTitle });
      if (waitStateHolds(state, found?.states)) return { ok: true };
      if (Date.now() >= deadline) {
        throw new TimeoutError(
          `Waited ${timeoutMs} ms for ${was.role}${was.name === undefined ? "" : ` "${was.name}"`} ` +
            `(${ref}) to be ${state}, and it ${whereItIs(found?.states)}.`,
          { adapter: "ax", timeoutMs },
        );
      }
      await new Promise((done) => setTimeout(done, 200));
    }
  }

  /**
   * How long a control is given to stop moving (T20).
   *
   * Opening a project starts a service and redraws the shell, which takes
   * seconds — a couple of retries a quarter-second apart is not a window, it is
   * a flinch. This is the same order as `candidateTimeoutMs`: long enough for a
   * screen to settle, short enough that a control which is genuinely gone still
   * fails while somebody is watching.
   */
  private static readonly STALE_PATH_BUDGET_MS = 6_000;

  /**
   * `AXPress` if the element declares it, a click at the box centre if not
   * (LLD §7.5's "with a mouse/keyboard fallback at the element's box centre").
   */
  private async press(node: AxSnapshotNode): Promise<void> {
    if (node.states.includes("disabled")) {
      throw new ActionabilityError(
        `${node.role}${node.name === undefined ? "" : ` "${node.name}"`} is disabled.`,
        { adapter: "ax" },
      );
    }
    /*
     * A path is an address in a tree that can move under it (T20).
     *
     * `path` is the child index at each level from the window down, and the
     * bridge answers `stale-path` when a level has fewer children than it did.
     * Between locating an element and pressing it, a window that is re-rendering
     * — opening a project starts a service and redraws the shell — changes
     * exactly that. Measured: `Click the Flows rail item`, one step after the
     * project was opened, failed with *"The accessibility action failed:
     * stale-path"* while the element was on screen the whole time.
     *
     * The design already says what to do about it: "pre-dispatch revalidation
     * remains mandatory". So a stale path is re-read rather than reported —
     * refresh the tree, find the same control again by what identifies it, and
     * press that. Bounded, because a control that is genuinely gone must still
     * fail.
     */
    let target = node;
    const until = Date.now() + AxSurface.STALE_PATH_BUDGET_MS;
    for (;;) {
      try {
        if (target.source.actions?.includes("AXPress") === true) {
          await this.live().perform({ kind: "action", path: target.path, action: "AXPress" });
        } else {
          await this.live().perform({ kind: "click", at: this.centreOf(target) });
        }
        return;
      } catch (error) {
        const stale = error instanceof Error && /stale-path/.test(error.message);
        if (!stale || Date.now() >= until) throw error;
        await new Promise((done) => setTimeout(done, 250));
        await this.refresh();
        const again = this.sameControl(target);
        if (again === undefined) throw error;
        target = again;
      }
    }
  }

  /**
   * The same control in the tree as it is now, by what identifies it rather
   * than by where it was (T20).
   *
   * `automationId` first, because it is the thing the application put there on
   * purpose; then role and name, which is what a person would use.
   */
  private sameControl(node: AxSnapshotNode): AxSnapshotNode | undefined {
    const id = node.native?.["automationId"];
    if (typeof id === "string" && id !== "") {
      const byId = this.nodes.find((one) => one.native?.["automationId"] === id);
      if (byId !== undefined) return byId;
    }
    return this.nodes.find((one) => one.role === node.role && one.name === node.name);
  }

  /**
   * The window's own size, as the tree it was just read from publishes it.
   *
   * The root of an AX window tree *is* the window, so its box is the window's
   * frame — no second bridge call is needed to learn what a resize achieved.
   * `undefined` when the root carries no box, which is a window that cannot be
   * measured rather than one of size zero, and the two must not be confused.
   */
  private windowSize(): readonly [number, number] | undefined {
    const root = this.nodes.find((one) => one.depth === 0);
    if (root?.box === undefined) return undefined;
    return [root.box[2], root.box[3]];
  }

  private centreOf(node: AxSnapshotNode): [number, number] {
    if (node.box === undefined) {
      throw new ActionabilityError(
        `${node.role} declares no AXPress action and has no box, so there is nowhere to click.`,
        { adapter: "ax" },
      );
    }
    const [x, y, width, height] = node.box;
    return [Math.round(x + width / 2), Math.round(y + height / 2)];
  }

  /* ── read, check, state ─────────────────────────────────────────────────── */

  async read(kind: ReadKind, ref?: Ref, name?: string): Promise<unknown> {
    switch (kind) {
      case "title": {
        /*
         * The title *now*, not the one the last snapshot saw (SF-16).
         *
         * `check` re-reads before answering a title predicate, and `read` gave
         * whatever the last refresh left behind — so a wait for a title, which
         * asks `read("title")` until it matches, could never see the window
         * change. One node is enough to learn it: the title comes with the
         * window, and the snapshot the references belong to is left alone.
         */
        /*
         * An application with every window closed is still a live session
         * (SF-16). A macOS application does not quit when its last window
         * closes, and reading the title live turned that into a `SessionError`
         * where the cached read used to answer. So `no-window` — the process
         * is running and owns no window — answers with the last title this
         * session saw; a wait for a new title keeps waiting, and the next
         * window's title is read when it opens. `no-process` is an application
         * that has quit, and that still throws.
         */
        try {
          const window = await this.readWindow(1);
          this.windowTitle = window.title;
        } catch (error) {
          const said = error instanceof SessionError ? error.cause : undefined;
          if (!(said instanceof AxBridgeError && said.reason === "no-window")) throw error;
        }
        return this.windowTitle;
      }
      /*
       * Unsupported, not a navigation or a script that failed (SF-11): the
       * broker told the first as `CONNECT_FAILED` and the second as
       * `OUTCOME_UNKNOWN`, and neither is about something that happened.
       */
      case "url":
        throw new UnsupportedError(
          "A desktop window has no URL. Read its title instead.",
          { adapter: "ax" },
        );
      case "result":
        throw new UnsupportedError("The AX adapter runs no scripts, so there is no result to read.", {
          adapter: "ax",
        });
      default: {
        if (ref === undefined) {
          throw new LocateError(`Reading "${kind}" needs a reference.`, { adapter: "ax" });
        }
        const node = this.nodeFor(ref);
        // `saidBy`, not the name: on a text field the words on the screen are
        // the value and the name is its label (see `saidBy`).
        if (kind === "text") return saidBy(node);
        if (kind === "value") return node.value ?? "";
        // `attribute`: the native attributes, which is what a desktop element has.
        if (name === undefined) {
          throw new ScriptError('Reading an attribute needs its name.', { adapter: "ax" });
        }
        return node.native?.[name] ?? "";
      }
    }
  }

  async check(predicate: Predicate, subject: CheckSubject, ref?: Ref): Promise<CheckResult> {
    // Re-read first: a predicate is a question about now, and answering it from
    // the snapshot taken before the last click would answer about then.
    await this.refresh();
    return evaluateAxPredicate(predicate, subject, ref, {
      nodes: this.nodes,
      windowTitle: this.windowTitle,
      node: (which) => this.nodes.find((one) => one.ref === which),
    });
  }

  async state(): Promise<SessionState> {
    return {
      kind: "desktop",
      ...(this.windowTitle === "" ? {} : { windowTitle: this.windowTitle }),
      // The front window, which is the only one this adapter reads. A desktop
      // session that switched windows takes a new snapshot rather than an index.
      windowIndex: 0,
    };
  }

  async restore(state: SessionState): Promise<void> {
    /*
     * "`restore` activates the window" (LLD §7.5). There is no more than that
     * to restore on a desktop: an application's state is its own, and Yam
     * has no storage state to re-apply. A resumed run therefore continues in
     * whatever state the application is in, which the checkpoint's window title
     * is the check on.
     */
    await this.live().perform({ kind: "activate" });
    await this.refresh();
    const wanted = state.windowTitle;
    if (wanted !== undefined && wanted !== "" && wanted !== this.windowTitle) {
      throw new SessionError(
        `The window is "${this.windowTitle}" and the checkpoint was taken on "${wanted}". ` +
          "A desktop application's state is its own; put it back where the checkpoint was " +
          "before resuming.",
        { adapter: "ax" },
      );
    }
  }

  async screenshot(path: string, mask?: Ref[]): Promise<void> {
    void mask;
    /*
     * Whole-screen, and unmasked. `screencapture` writes a file and the process
     * that asked has no chance to paint over it before it lands, so a mask
     * would have to be applied after the fact by decoding the PNG — which this
     * adapter does not do, and would be a false promise if it half-did.
     * REQ-NFR-6's masking is honoured by not screenshotting a secret-injecting
     * step at all, which the executor decides.
     *
     * A failure is raised, not swallowed. The bridge now proves the file was
     * written before it returns, and the caller is told in the same typed
     * vocabulary the rest of the adapter speaks — a screenshot that did not
     * happen is an infrastructure failure of this session, not a step that
     * passed.
     */
    try {
      await this.live().screenshot(path);
    } catch (error) {
      if (error instanceof AxBridgeError) {
        const said = `${error.message}${error.detail === undefined ? "" : ` (${error.detail})`}`;
        /*
         * A missing Screen Recording grant is a `PermissionError` (SF-14).
         *
         * `screencapture` says so in its own words — "could not create image
         * from display", exit 1, nothing written — and that is the only failure
         * here whose fix is in System Settings. A timeout, a spawn failure or an
         * unwritable path stays a `SessionError`: telling someone to grant a
         * permission they already have would be the wrong advice twice over.
         */
        /*
         * But only when macOS agrees the grant is missing (SF-14). The same
         * words come from a host with no display to capture — a locked screen,
         * an SSH login, a session with no WindowServer — where Screen Recording
         * may be granted and System Settings is the wrong place to send anyone.
         * So the grant is asked for directly: missing is a `PermissionError`;
         * granted, or not askable, is a `SessionError` that says which.
         */
        if (SCREEN_RECORDING_REFUSED.test(said)) {
          const granted = (this.options.screenRecordingGranted ?? (() => screenRecordingGranted()))();
          if (granted === false) {
            throw new PermissionError(said, { adapter: "ax", cause: error });
          }
          throw new SessionError(
            `${said}. ` +
              (granted === true
                ? "Screen Recording is granted to this program, so this is the display: a locked " +
                  "screen, an SSH login or a session with no WindowServer answers the same way — " +
                  "`yam surface doctor --adapter ax` reports `ax/session`."
                : "Whether Screen Recording is granted could not be asked, so this is not " +
                  "reported as a missing permission — `yam surface doctor --adapter ax` checks both."),
            { adapter: "ax", cause: error },
          );
        }
        throw new SessionError(said, { adapter: "ax", cause: error });
      }
      throw error;
    }
  }

  /** Whether the accessibility permission is granted, for `surface doctor`. */
  async permission(): ReturnType<AxBridge["permission"]> {
    const bridge =
      this.bridge ??
      osascriptBridge({
        process: this.processName ?? this.options.processName ?? "System Events",
        ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
      });
    return await bridge.permission();
  }

  /** The `controlPath` of a node, for a report. */
  controlPathFor(ref: Ref): string {
    return this.nodeFor(ref).controlPath;
  }
}

/** The six states a reference `waitFor` waits for (pattern 19). */
const WAIT_STATES = ["attached", "detached", "visible", "hidden", "enabled", "disabled"] as const;
type WaitState = (typeof WAIT_STATES)[number];

/** `args.state`, `visible` when there is none; anything else is a caller's mistake. */
function waitStateOf(args: ActArgs, adapter: string): WaitState {
  const asked = args["state"] ?? "visible";
  if (typeof asked === "string" && (WAIT_STATES as readonly string[]).includes(asked)) {
    return asked as WaitState;
  }
  throw new DataError(
    `waitFor cannot wait for ${JSON.stringify(asked)}; it waits for attached, detached, visible, ` +
      "hidden, enabled or disabled.",
    { adapter },
  );
}

/** Whether an element found in a fresh read (its states), or not found, is in the state. */
function waitStateHolds(state: WaitState, states: readonly string[] | undefined): boolean {
  const present = states !== undefined;
  const has = (one: string): boolean => states?.includes(one) === true;
  switch (state) {
    case "attached":
      return present;
    case "detached":
      return !present;
    case "visible":
      return present && !has("hidden");
    case "hidden":
      return !present || has("hidden");
    case "enabled":
      return present && !has("disabled");
    case "disabled":
      return present && has("disabled");
  }
}

/** Where a waited-for element is, for the timeout's message. */
function whereItIs(states: readonly string[] | undefined): string {
  if (states === undefined) return "is not in the window";
  const said = [states.includes("hidden") ? "hidden" : "showing"];
  said.push(states.includes("disabled") ? "disabled" : "enabled");
  return `is ${said.join(" and ")}`;
}

/** A `controlPath` without its window segment, so a retitled window does not move every element. */
function withinWindow(node: AxSnapshotNode, title: string): string {
  const root = `Window[${title}]`;
  return node.controlPath.startsWith(root) ? node.controlPath.slice(root.length) : node.controlPath;
}

/**
 * The element a reference named, in a fresh read of the window (pattern 19).
 *
 * What it is like: its automation id and role when it has an id, its role and
 * name when it has a name, and otherwise its role among the same-role siblings
 * under the same parent. Then:
 *
 * - nothing like it now: it has gone;
 * - one element like it then and now, with an id or a name: that one, wherever
 *   it moved;
 * - otherwise only the one at the same `controlPath`, and only if as many
 *   elements are like it as were — a deletion ahead of it moves a look-alike
 *   into its place, and an answer about that neighbour is worse than none.
 *
 * Anything else is a `LocateError`: the element cannot be told apart from the
 * elements that look like it, which a flow fixes by giving it a name or an id.
 */
function findWaitedElement(
  ref: Ref,
  was: AxSnapshotNode,
  then: { readonly nodes: readonly AxSnapshotNode[]; readonly title: string },
  now: { readonly nodes: readonly AxSnapshotNode[]; readonly title: string },
): AxSnapshotNode | undefined {
  const idOf = (node: AxSnapshotNode): string | undefined => {
    const id = node.native?.["automationId"];
    return typeof id === "string" && id !== "" ? id : undefined;
  };
  const id = idOf(was);
  const name = was.name ?? "";
  const place = withinWindow(was, then.title);
  const parent = `${place.slice(0, place.lastIndexOf("/"))}/`;
  const alike = (title: string) => (one: AxSnapshotNode): boolean =>
    one.role === was.role &&
    (id !== undefined
      ? idOf(one) === id
      : name !== ""
        ? (one.name ?? "") === name
        : one.depth === was.depth && withinWindow(one, title).startsWith(parent));
  const before = then.nodes.filter(alike(then.title));
  const after = now.nodes.filter(alike(now.title));
  if (after.length === 0) return undefined;
  if ((id !== undefined || name !== "") && before.length === 1 && after.length === 1) return after[0];
  const inPlace = after.filter((one) => withinWindow(one, now.title) === place);
  if (before.length === after.length && inPlace.length === 1) return inPlace[0];
  throw new LocateError(
    `${ref} (${was.role}${name === "" ? "" : ` "${name}"`}) cannot be told apart from the ` +
      `${after.length} element(s) like it in the window now (${before.length} when the reference ` +
      "was issued). Give it an automation id or a name, or wait on something that has one.",
    { adapter: "ax" },
  );
}

/** Whether a box lies wholly inside another: `[x, y, width, height]` each. */
function boxInside(
  inner: readonly [number, number, number, number],
  outer: readonly [number, number, number, number],
): boolean {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[0] + inner[2] <= outer[0] + outer[2] &&
    inner[1] + inner[3] <= outer[1] + outer[3]
  );
}

/**
 * A key name → what System Events sends.
 *
 * Named keys are key *codes* because `keystroke "Enter"` types the word; the
 * codes are macOS's virtual key codes, which are layout-independent for the
 * keys that matter here. Modifiers are the `using` list.
 */
export function keyChord(key: string): { text: string; code?: number; using: string[] } {
  const parts = key.split("+").map((part) => part.trim());
  const last = parts.pop() ?? "";
  const using: string[] = [];
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier !== undefined) using.push(modifier);
  }
  const code = KEY_CODES[last.toLowerCase()];
  return code === undefined ? { text: last, using } : { text: last, code, using };
}

const MODIFIERS: Readonly<Record<string, string>> = {
  cmd: "command down",
  command: "command down",
  meta: "command down",
  ctrl: "control down",
  control: "control down",
  alt: "option down",
  option: "option down",
  shift: "shift down",
};

/** macOS virtual key codes for the named keys the IR uses. */
const KEY_CODES: Readonly<Record<string, number>> = {
  enter: 36,
  return: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  arrowleft: 123,
  arrowright: 124,
  arrowdown: 125,
  arrowup: 126,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
};

/** The factory the registry calls (LLD §2.4). */
export function createAxSurface(config: {
  app?: { appPath?: string; processName?: string; launch?: LaunchConfig; quit?: QuitConfig };
  run?: { stepTimeoutMs?: number; candidateTimeoutMs?: number };
}): AgentSurface {
  return new AxSurface({
    ...(config.app?.processName === undefined ? {} : { processName: config.app.processName }),
    ...(config.app?.appPath === undefined ? {} : { appPath: config.app.appPath }),
    // `app.launch` and `app.quit` (T11.2, LLD §13.9).
    ...(config.app?.launch === undefined ? {} : { launch: config.app.launch }),
    ...(config.app?.quit === undefined ? {} : { quit: config.app.quit }),
    ...(config.run?.stepTimeoutMs === undefined ? {} : { timeoutMs: config.run.stepTimeoutMs }),
    ...(config.run?.candidateTimeoutMs === undefined
      ? {}
      : { candidateTimeoutMs: config.run.candidateTimeoutMs }),
  });
}

