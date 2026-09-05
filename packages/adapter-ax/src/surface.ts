/**
 * The macOS Accessibility adapter: `AgentSurface` on a desktop application
 * (T6.2, LLD §7.5, REQ-ADP-7, REQ-ADE-6).
 *
 * > AX: `AXUIElement` via a small native module; `AXRole` → role map;
 * > `AXIdentifier` → `automationId`; actions via `AXPress`, `AXSetValue`,
 * > keyboard events; documents the accessibility permission prompt and provides
 * > a `svatah surface doctor` check. Both: `state()` returns the focused window
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
} from "@svatah/schema";
import type { AgentSurface } from "@svatah/surface";
import {
  ActionabilityError,
  buildSnapshot,
  LocateError,
  NavigationError,
  ScriptError,
  SessionError,
  structuralHash,
  type SnapshotNode,
} from "@svatah/surface";
import {
  osascriptBridge,
  AxBridgeError,
  type AxBridge,
  type AxWindow,
} from "./bridge.js";
import { matchNodes, synthesise } from "./locate.js";
import { evaluateAxPredicate } from "./predicates.js";
import { convertTree, nameOf, type AxSnapshotNode } from "./tree.js";

const DEFAULT_MAX_NODES = 1_500;

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
  screenshot: true,
  restore: true,
};

export interface AxAdapterOptions {
  /**
   * The application process to drive.
   *
   * `config.app.processName`, and for the desktop conformance suite it is the
   * ADE's own process name (LLD §16). There is no default: driving "whatever is
   * frontmost" would make a run depend on what the person at the machine last
   * clicked.
   */
  readonly processName?: string;
  /** `config.app.appPath` — launched by `open` when the process is not running. */
  readonly appPath?: string;
  readonly maxNodes?: number;
  readonly timeoutMs?: number;
  /** Injected by the tests, so the whole adapter runs against a recorded tree. */
  readonly bridge?: AxBridge;
}

export class AxSurface implements AgentSurface {
  readonly kind: SurfaceKind = "desktop";

  private bridge: AxBridge | undefined;
  private processName: string | undefined;
  /** The nodes of the most recent snapshot; `rN` indexes this. */
  private nodes: AxSnapshotNode[] = [];
  private windowTitle = "";

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
    if (permission.state !== "granted") {
      throw new SessionError(
        `The macOS Accessibility permission is not granted (${permission.state}). ` +
          `${permission.advice} Run \`svatah surface doctor\` to check it.`,
        { adapter: "ax" },
      );
    }

    if (name === undefined || name.trim() === "") {
      throw new SessionError(
        "The AX adapter needs the name of the application process to drive. Set " +
          "`app.processName` in `svatah.config.yaml` (the ADE is \"Svatah ADE\"). Driving " +
          "whatever happens to be frontmost would make a run depend on what was last clicked.",
        { adapter: "ax" },
      );
    }
    this.processName = name;

    // Bring the window forward, so the tree is the one a person would see.
    await this.bridge.perform({ kind: "activate" }).catch(() => undefined);
    await this.refresh();
  }

  async close(): Promise<void> {
    this.bridge = undefined;
    this.nodes = [];
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
          { adapter: "ax" },
        );
      }
      throw error;
    }
  }

  /** Re-read the window and rebuild every reference. */
  private async refresh(options: { interactiveOnly?: boolean; maxNodes?: number } = {}): Promise<void> {
    const window = await this.readWindow(options.maxNodes ?? this.options.maxNodes ?? DEFAULT_MAX_NODES);
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
     */
    await this.refresh();
    const found = matchNodes(candidate, this.nodes);
    const chosen =
      candidate.nth === undefined ? found : found.slice(candidate.nth, candidate.nth + 1);
    return chosen.map((node) => node.ref);
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
      native: { ...node.native, controlPath: node.controlPath },
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
      case "navigate":
      case "back":
      case "forward":
      case "refresh":
        throw new NavigationError(
          `A desktop application has no "${action}". Drive its own controls instead: the ` +
            "AX adapter has no address bar to type into.",
          { adapter: "ax" },
        );

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
      case "scrollIntoView":
        /*
         * There is no accessible hover and no accessible scroll-to on macOS:
         * `AXScrollToVisible` exists but System Events does not expose it, and
         * a pointer move is not an accessibility call. Both are treated as
         * satisfied — the element is in the tree, so it is reachable — rather
         * than failing a step over a gesture the surface cannot make.
         */
        need(ref);
        return { ok: true };

      case "type": {
        const node = need(ref);
        const value = str("value", "");
        await bridge.perform({ kind: "focus", path: node.path });
        if (node.source.actions?.includes("AXSetValue") === true || node.value !== undefined) {
          await bridge.perform({ kind: "setValue", path: node.path, value });
        } else {
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

      case "press":
      case "keyDown":
      case "keyUp": {
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

      case "selectOption":
      case "deselectOption": {
        /*
         * A macOS pop-up button opens a menu and the option is a menu item, so
         * "select the option named X" is: press the control, then press the
         * item. The re-read between the two is what finds the item, because
         * the menu did not exist before the press.
         */
        const node = need(ref);
        const wanted = str("value");
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
        // Re-read until the reference resolves again, or the timeout passes.
        const timeoutMs = Number(args["timeoutMs"] ?? 5_000);
        const until = Date.now() + (Number.isFinite(timeoutMs) ? timeoutMs : 5_000);
        for (;;) {
          await this.refresh();
          if (ref !== undefined && this.nodes.some((one) => one.ref === ref)) return { ok: true };
          if (Date.now() >= until) {
            throw new ActionabilityError(`Waiting for ${ref ?? "the window"} timed out.`, {
              adapter: "ax",
            });
          }
          await new Promise((done) => setTimeout(done, 200));
        }
      }

      case "screenshot": {
        await this.screenshot(str("path"));
        return { ok: true };
      }

      case "dragTo": {
        const from = need(ref);
        const to = need(ref2);
        void from;
        void to;
        throw new ActionabilityError(
          "The AX adapter cannot drag: `capabilities().drag` is false, because a drag is a " +
            "sequence of pointer events and System Events has no press-move-release (LLD §2.4).",
          { adapter: "ax" },
        );
      }

      default:
        throw new ActionabilityError(
          `The AX adapter has no "${action}". See \`capabilities()\` for what a desktop window ` +
            "supports (LLD §2.4).",
          { adapter: "ax" },
        );
    }
  }

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
    if (node.source.actions?.includes("AXPress") === true) {
      await this.live().perform({ kind: "action", path: node.path, action: "AXPress" });
      return;
    }
    await this.live().perform({ kind: "click", at: this.centreOf(node) });
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
      case "title":
        return this.windowTitle;
      case "url":
        throw new NavigationError(
          "A desktop window has no URL. Read its title instead.",
          { adapter: "ax" },
        );
      case "result":
        throw new ScriptError("The AX adapter runs no scripts, so there is no result to read.", {
          adapter: "ax",
        });
      default: {
        if (ref === undefined) {
          throw new LocateError(`Reading "${kind}" needs a reference.`, { adapter: "ax" });
        }
        const node = this.nodeFor(ref);
        if (kind === "text") return node.name ?? node.value ?? "";
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
     * to restore on a desktop: an application's state is its own, and Svatah
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
     */
    await this.live().screenshot(path);
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
  app?: { appPath?: string; processName?: string };
  run?: { stepTimeoutMs?: number };
}): AgentSurface {
  return new AxSurface({
    ...(config.app?.processName === undefined ? {} : { processName: config.app.processName }),
    ...(config.app?.appPath === undefined ? {} : { appPath: config.app.appPath }),
    ...(config.run?.stepTimeoutMs === undefined ? {} : { timeoutMs: config.run.stepTimeoutMs }),
  });
}

