/**
 * The Windows UI Automation adapter: `AgentSurface` on a desktop application
 * (T6.1, LLD §7.5, REQ-ADP-6, REQ-ADE-6).
 *
 * The sibling of `@svatah/yam-adapter-ax`. References are indices into the last
 * snapshot, for the same reason: a UIA `AutomationElement` is a COM object that
 * does not survive between PowerShell processes, so there is nothing to hold on
 * to between calls.
 *
 * ## Acting is a pattern, then the mouse
 *
 * > `act` via UIA patterns (Invoke, Value, Toggle, Selection, Scroll) with a
 * > mouse/keyboard fallback at the element's box centre.
 *
 * A UIA **control pattern** is the accessible way to operate a control:
 * `InvokePattern.Invoke()` presses a button without moving the mouse,
 * `ValuePattern.SetValue()` writes a whole string into a field without typing
 * it, `SelectionItemPattern.Select()` picks a tab. Where a provider declares
 * none — a canvas, a custom-drawn control, a Chromium node Chromium did not
 * pattern — the fallback is a click at the centre of the element's rectangle,
 * which is why the box is in the snapshot.
 *
 * The order matters beyond speed. `SetValue` does not fire the keystroke events
 * a `SendKeys` does, so a field with a JavaScript `keyup` handler behaves
 * differently under the two. The pattern is preferred anyway, because it is the
 * deterministic one: it either sets the value or reports that it cannot.
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
  powershellBridge,
  UiaBridgeError,
  type UiaBridge,
  type UiaSnapshotCost,
  type UiaWindow,
} from "./bridge.js";
import { matchNodes, synthesise } from "./locate.js";
import { evaluateUiaPredicate, pageTextOf } from "./predicates.js";
import { convertTree, nameOf, saidBy, type UiaSnapshotNode } from "./tree.js";

const DEFAULT_MAX_NODES = 1_500;

/**
 * How far a window's measured size may sit from the one asked for and still
 * count as obeyed. A pixel, for a rectangle a scaled display rounds; anything
 * wider is the window declining.
 */
const SIZE_TOLERANCE = 1;

/**
 * What this adapter can do (LLD §2.4).
 *
 * `dialogs` is false because a Windows dialog is a top-level window of its own;
 * `frames` is false because a desktop window has no frames. `windows` is true.
 * `drag` is true, unlike the AX adapter: `mouse_event` gives press, move and
 * release as three calls, which is exactly what a drag is.
 */
export const UIA_CAPABILITIES: Capabilities = {
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

export interface UiaAdapterOptions {
  /** The process to drive, without `.exe`; `config.app.processName`. */
  readonly processName?: string;
  readonly appPath?: string;
  /** `config.run.candidateTimeoutMs` — how long a `locate` may keep re-reading. */
  readonly candidateTimeoutMs?: number;
  /** `config.app.launch` — how to start it when nothing of that name has a window. */
  readonly launch?: LaunchConfig;
  /** `config.app.quit` — the graceful route, then a signal. */
  readonly quit?: QuitConfig;
  readonly maxNodes?: number;
  readonly timeoutMs?: number;
  /** Injected by the tests, so the whole adapter runs against a recorded tree. */
  readonly bridge?: UiaBridge;
}

export class UiaSurface implements AgentSurface {
  readonly kind: SurfaceKind = "desktop";

  private bridge: UiaBridge | undefined;
  private processName: string | undefined;
  private nodes: UiaSnapshotNode[] = [];
  private windowTitle = "";
  /** What this session launched, and so what it is responsible for quitting. */
  private launched: LaunchConfig | undefined;
  /**
   * The costliest window read of this session (Draft 2.8 §7.5), as the AX
   * adapter keeps it: the biggest window the suite touched is the read the
   * ten-second budget is about, and a mean over small reads would hide it.
   */
  private worstCost: UiaSnapshotCost | undefined;
  /**
   * How the tree was last read, so a wait re-reads it the same way: a
   * controls-only tree and a whole one are different trees to compare.
   */
  private lastRead: { interactiveOnly?: boolean; maxNodes?: number } = {};

  constructor(private readonly options: UiaAdapterOptions = {}) {}

  capabilities(): Capabilities {
    return { ...UIA_CAPABILITIES };
  }

  async open(session: SessionInit): Promise<void> {
    const name = session.processName ?? this.options.processName;
    this.bridge =
      this.options.bridge ??
      powershellBridge({
        process: name ?? "",
        ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
      });

    /*
     * The host first — before the configuration, and before the first snapshot,
     * exactly as the AX adapter checks its permission. Telling someone on macOS
     * to set `app.processName` is the wrong advice: the host is the problem.
     *
     * Unlike macOS there is no permission to grant. What can go wrong is a
     * constrained PowerShell, or a target running at a higher integrity level
     * than Yam, and both are said plainly here.
     */
    const availability = await this.bridge.availability();
    if (availability.state !== "available") {
      throw new SessionError(
        `UI Automation is not reachable (${availability.state}). ${availability.advice} ` +
          "Run `yam surface doctor` to check it.",
        { adapter: "uia" },
      );
    }

    if (name === undefined || name.trim() === "") {
      throw new SessionError(
        "The UIA adapter needs the name of the process to drive. Set `app.processName` in " +
          '`yam.config.yaml` (the app is "Yam"). Driving whatever happens to be ' +
          "frontmost would make a run depend on what was last clicked.",
        { adapter: "uia" },
      );
    }
    this.processName = name;

    /*
     * Launch it, if nothing of that name owns a window yet (T11.2, LLD §13.9).
     *
     * The same rule and the same helper as the AX adapter: "owns a window", not
     * "is running", because a process that is still exiting and a helper that
     * shares its application's name are both running and neither can be driven.
     * A session that found the application already up will not quit it.
     */
    const launch = session.launch ?? this.options.launch;
    if (launch !== undefined && !(await this.hasWindow())) {
      const started = launchApplication(launch);
      if (!started.ok) {
        throw new SessionError(
          `Could not launch the application: ${started.command}` +
            `${started.detail === undefined ? "" : ` — ${started.detail}`}`,
          { adapter: "uia" },
        );
      }
      const appeared = await waitFor(() => this.hasWindow(), {
        ...(launch.timeoutMs === undefined ? {} : { timeoutMs: launch.timeoutMs }),
      });
      if (!appeared.ready) {
        throw new SessionError(
          `"${name}" was launched and showed no window within ${appeared.ms} ms.`,
          { adapter: "uia" },
        );
      }
      this.launched = launch;
    }

    await this.bridge.perform({ kind: "activate" }).catch(() => undefined);
    await this.refresh();
  }

  /** Does a process of this name own a window this adapter can read? */
  private async hasWindow(): Promise<boolean> {
    if (this.bridge === undefined || this.processName === undefined) return false;
    try {
      await this.bridge.window({ process: this.processName, maxNodes: 1 });
      return true;
    } catch {
      return false;
    }
  }

  /** The graceful route, then a signal — and a failure when it survives both. */
  private async quitTheApplication(): Promise<string> {
    const launch = this.launched ?? this.options.launch;
    const executable = launch === undefined ? undefined : executableOf(launch, process.platform);
    if (executable === undefined) {
      throw new SessionError(
        "`Quit the app` needs to know which application to quit. Set `app.launch.path` in " +
          "`yam.config.yaml`: a quit addressed by process name alone would reach somebody " +
          "else's copy of the same application.",
        { adapter: "uia" },
      );
    }
    const outcome = await quitApplication(executable, this.options.quit ?? {});
    this.nodes = [];
    this.launched = undefined;
    if (!outcome.gone) {
      throw new SessionError(
        `"${this.processName ?? executable}" was asked to quit and did not: ` +
          `${outcome.steps.map((one) => one.what).join(" → ")} over ${outcome.ms} ms.`,
        { adapter: "uia" },
      );
    }
    return `quit in ${outcome.ms} ms (${outcome.steps.map((one) => one.what).join(" → ")})`;
  }

  async close(): Promise<void> {
    if (this.launched !== undefined) {
      await this.quitTheApplication().catch(() => undefined);
    }
    this.bridge = undefined;
    this.nodes = [];
  }

  /** What the biggest snapshot of this session cost; see `AxSurface`. */
  bridgeCost(): UiaSnapshotCost | undefined {
    return this.worstCost;
  }

  private live(): UiaBridge {
    if (this.bridge === undefined || this.processName === undefined) {
      throw new SessionError("The UIA session is not open.", { adapter: "uia" });
    }
    return this.bridge;
  }

  /* ── snapshot, locate, describe ─────────────────────────────────────────── */

  private async readWindow(maxNodes: number): Promise<UiaWindow> {
    try {
      return await this.live().window({ process: this.processName!, maxNodes });
    } catch (error) {
      if (error instanceof UiaBridgeError) {
        throw new SessionError(
          `${error.message}${error.detail === undefined ? "" : ` (${error.detail})`}`,
          { adapter: "uia" },
        );
      }
      throw error;
    }
  }

  private async refresh(
    options: { interactiveOnly?: boolean; maxNodes?: number } = {},
  ): Promise<void> {
    const budget = options.maxNodes ?? this.options.maxNodes ?? DEFAULT_MAX_NODES;
    const window = await this.readWindow(budget);
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
      maxNodes: budget,
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

    const visible = opts.root === undefined ? this.nodes : this.subtree(this.nodeFor(opts.root));
    const nodes = visible.map(
      ({ path: _path, source: _source, controlPath: _controlPath, ...node }) => node,
    ) as SnapshotNode[];
    return buildSnapshot(opts.root ?? nodes[0]?.ref ?? "r0", nodes, structuralHash(nodes));
  }

  private subtree(root: UiaSnapshotNode): UiaSnapshotNode[] {
    const kept = new Set<string>([root.ref]);
    const out: UiaSnapshotNode[] = [];
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
     * Re-read until it is there, or until just short of the candidate timeout
     * (T11.2).
     *
     * The same reasoning as the AX adapter's: a web adapter's locator retries
     * inside Playwright, and a desktop snapshot is a moment. A click is a
     * request the application answers, and the next `locate` is expected to
     * find something that was not there when the click was sent. Short of the
     * timeout rather than up to it, because the resolver races the same budget
     * and a tie makes it publish "candidate timed out" where the truth is
     * "matched nothing" (`locateDeadline`).
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
    const textOf = (one: UiaSnapshotNode): string => one.name ?? one.value ?? "";

    const attrs: Record<string, string> = { ...node.native };
    if (node.source.helpText !== undefined) attrs["HelpText"] = node.source.helpText;
    if (node.source.localizedControlType !== undefined) {
      attrs["LocalizedControlType"] = node.source.localizedControlType;
    }
    if (node.source.patterns !== undefined) attrs["patterns"] = node.source.patterns.join(",");

    return {
      ref,
      role: node.role,
      ...(node.name === undefined ? {} : { name: node.name }),
      ...(node.value === undefined ? {} : { value: node.value }),
      // The `tag` of a desktop element is its native control type.
      tag: node.source.controlType,
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
         * The element's classes, for the fingerprint's `class` (LLD §6.4).
         * Chromium publishes a DOM element's `class` attribute as its UIA
         * `ClassName` — the Windows runner's trace reads `sv-rail-item
         * sv-rail-active` on the Flows rail row — and a native control's is its
         * window class. By the web adapters' rule, and in `describe` only,
         * because the fingerprint is the only reader.
         */
        ...(stableClassesOf(node.source.className) === undefined
          ? {}
          : { stableClasses: stableClassesOf(node.source.className)! }),
      },
    };
  }

  private rolePathOf(node: UiaSnapshotNode): string[] {
    const byRef = new Map(this.nodes.map((one) => [one.ref, one]));
    const out: string[] = [];
    let cursor: UiaSnapshotNode | undefined = node;
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

  /**
   * The window's own size, as the tree it was just read from publishes it.
   *
   * The root of a UIA window tree *is* the window, so its bounding rectangle is
   * the window's frame. `undefined` when the root carries none, which is a
   * window that cannot be measured rather than one of size zero.
   */
  private windowSize(): readonly [number, number] | undefined {
    const root = this.nodes.find((one) => one.depth === 0);
    if (root?.box === undefined) return undefined;
    return [root.box[2], root.box[3]];
  }

  private nodeFor(ref: Ref): UiaSnapshotNode {
    const node = this.nodes.find((one) => one.ref === ref);
    if (node === undefined) {
      throw new LocateError(
        `Reference ${ref} is not in the current snapshot. A desktop window that changed ` +
          "invalidates every reference (LLD §2.2); take a new snapshot.",
        { adapter: "uia" },
      );
    }
    return node;
  }

  private supports(node: UiaSnapshotNode, pattern: string): boolean {
    return node.source.patterns?.includes(pattern) === true;
  }

  /* ── act ────────────────────────────────────────────────────────────────── */

  async act(action: SurfaceAction, ref?: Ref, args: ActArgs = {}, ref2?: Ref): Promise<ActResult> {
    const bridge = this.live();
    const need = (which: Ref | undefined): UiaSnapshotNode => {
      if (which === undefined) {
        throw new LocateError(`The "${action}" action needs a reference.`, { adapter: "uia" });
      }
      return this.nodeFor(which);
    };
    const str = (name: string, fallback?: string): string => {
      const value = args[name];
      if (value === undefined) {
        if (fallback !== undefined) return fallback;
        throw new ScriptError(`The "${action}" action needs an argument "${name}".`, {
          adapter: "uia",
        });
      }
      return Array.isArray(value) ? value.join(",") : String(value);
    };

    switch (action) {
      /*
       * Refused as unsupported, not as a navigation that failed (SF-11): a
       * `NavigationError` is told to a caller as `CONNECT_FAILED`, and nothing
       * was sent to the application for it to have failed at.
       */
      case "navigate":
      case "back":
      case "forward":
      case "refresh":
        throw new UnsupportedError(
          `A desktop application has no "${action}". Drive its own controls instead: the ` +
            "UIA adapter has no address bar to type into.",
          { adapter: "uia" },
        );

      /** `Quit the app` (pattern 31, T11.2, LLD §13.9). */
      case "quit":
        return { ok: true, value: await this.quitTheApplication() };

      case "click":
      case "submit":
        await this.invoke(need(ref));
        await this.refresh();
        return { ok: true };

      case "doubleClick": {
        const node = need(ref);
        await this.invoke(node);
        await this.invoke(node);
        await this.refresh();
        return { ok: true };
      }

      case "rightClick": {
        const node = need(ref);
        /*
         * There is no "right-invoke" pattern. `SendKeys`'s `+{F10}` is the
         * accessible context menu — the keyboard's own way — and it goes to the
         * focused element, which is why the focus comes first.
         */
        await bridge.perform({ kind: "focus", path: node.path });
        await bridge.perform({ kind: "keys", text: "+{F10}" });
        await this.refresh();
        return { ok: true };
      }

      case "hover":
        /*
         * Refused, where it answered `{ok: true}` and did nothing (SF-11).
         *
         * The bridge has no pointer move: its only pointer command is a click
         * at a point, which presses what is there, and UI Automation has no
         * hover pattern. A "hover to reveal the menu" step passed with the menu
         * never shown. Refused before the reference is resolved, because no
         * element makes it possible.
         */
        throw new UnsupportedError(
          "The UIA adapter cannot hover: its bridge can click at a point but cannot move the " +
            "pointer without pressing, and UI Automation has no hover pattern. Click the element " +
            "if pressing it is what is meant.",
          { adapter: "uia" },
        );

      case "scrollIntoView": {
        const node = need(ref);
        if (this.supports(node, "ScrollItem")) {
          await bridge.perform({
            kind: "pattern",
            path: node.path,
            pattern: "Scroll",
            method: "ScrollIntoView",
          });
          await this.refresh();
          return { ok: true };
        }
        /*
         * No `ScrollItem` pattern: `ok` only for an element already in view
         * (SF-11). This answered `{ok: true}` for any element in the tree, which
         * says nothing about whether it is on screen — and a click at the centre
         * of an off-screen rectangle lands on whatever is there instead. Inside
         * the window's rectangle is in view; outside it, or with no rectangle to
         * tell, there is nothing this bridge can do about it, and it says so.
         */
        const window = this.nodes.find((one) => one.depth === 0)?.box;
        if (node.box !== undefined && window !== undefined && boxInside(node.box, window)) {
          return { ok: true };
        }
        throw new UnsupportedError(
          `${node.role}${node.name === undefined ? "" : ` "${node.name}"`} supports no ` +
            "`ScrollItemPattern` and " +
            (node.box === undefined || window === undefined
              ? "publishes no bounding rectangle to show it is inside the window"
              : `is outside the window (its rectangle is ${node.box.join(", ")}; the window's is ` +
                `${window.join(", ")})`) +
            ". The UIA adapter has no other way to scroll it into view.",
          { adapter: "uia" },
        );
      }

      case "type": {
        const node = need(ref);
        const value = str("value", "");
        await bridge.perform({ kind: "focus", path: node.path });
        if (this.supports(node, "Value")) {
          await bridge.perform({
            kind: "pattern",
            path: node.path,
            pattern: "Value",
            method: "SetValue",
            argument: value,
          });
        } else {
          await bridge.perform({ kind: "keys", text: escapeSendKeys(value) });
        }
        await this.refresh();
        return { ok: true };
      }

      case "clear": {
        const node = need(ref);
        await bridge.perform({ kind: "focus", path: node.path });
        if (this.supports(node, "Value")) {
          await bridge.perform({
            kind: "pattern",
            path: node.path,
            pattern: "Value",
            method: "SetValue",
            argument: "",
          });
        } else {
          await bridge.perform({ kind: "keys", text: "^a{DEL}" });
        }
        await this.refresh();
        return { ok: true };
      }

      case "keyDown":
      case "keyUp":
        /*
         * Refused, where both sent a whole key press (SF-11). `SendKeys` presses
         * and releases every key it is given; the bridge has no way to hold one
         * down, so `keyDown "Shift"` then a click clicked unshifted. Refused
         * before anything is focused, because nothing was going to be sent.
         */
        throw new UnsupportedError(
          `The UIA adapter has no "${action}": SendKeys sends a key as one press and release and ` +
            'cannot hold a key down. Press the chord in one step instead (`press "Shift+Tab"`).',
          { adapter: "uia" },
        );

      case "press": {
        if (ref !== undefined) await bridge.perform({ kind: "focus", path: need(ref).path });
        await bridge.perform({ kind: "keys", text: sendKeysFor(str("key")) });
        await this.refresh();
        return { ok: true };
      }

      case "setChecked": {
        const node = need(ref);
        const wanted = String(args["checked"] ?? "true") === "true";
        if (node.states.includes("checked") === wanted) return { ok: true };
        if (this.supports(node, "Toggle")) {
          await bridge.perform({
            kind: "pattern",
            path: node.path,
            pattern: "Toggle",
            method: "Toggle",
          });
        } else {
          await this.invoke(node);
        }
        await this.refresh();
        return { ok: true };
      }

      case "deselectOption":
        /*
         * Refused, where it used to share `selectOption`'s code and so *select*
         * the option it was asked to deselect (SF-11).
         *
         * UIA does have the call — `SelectionItemPattern.RemoveFromSelection` —
         * but the bridge's `SelectionItem` branch only ever sends `Select()`,
         * and teaching it a second method is PowerShell that no runner here can
         * execute. It would also only mean something on a multiple-selection
         * list: the combo box `selectOption` expands holds one choice at a time,
         * and a single-selection container that requires a selection answers
         * `RemoveFromSelection` with `InvalidOperationException` rather than
         * leaving the box empty. A refusal that says so is better than an
         * untested call, and far better than the opposite of what was asked.
         */
        throw new UnsupportedError(
          "The UIA adapter cannot deselect an option: its bridge sends " +
            "`SelectionItemPattern.Select` and never `RemoveFromSelection`, and a combo box holds " +
            "exactly one choice, so it has no deselected state. Select the option that should be " +
            "chosen instead.",
          { adapter: "uia" },
        );

      case "selectOption": {
        const node = need(ref);
        // `value`, `values` or `label`, as every other adapter reads them (T20).
        const wanted = str(
          args["value"] !== undefined ? "value" : args["values"] !== undefined ? "values" : "label",
        );
        /*
         * A combo box opens before its items exist in the tree, so the sequence
         * is expand, re-read, then select the item — the same shape the AX
         * adapter uses, with `ExpandCollapse` and `SelectionItem` doing what
         * `AXPress` does there.
         */
        if (this.supports(node, "ExpandCollapse")) {
          await bridge.perform({
            kind: "pattern",
            path: node.path,
            pattern: "ExpandCollapse",
            method: "Expand",
          });
        }
        await this.refresh();
        const option = this.nodes.find(
          (one) => (one.role === "option" || one.role === "menuitem") && one.name === wanted,
        );
        if (option === undefined) {
          throw new ActionabilityError(
            `No option named "${wanted}" appeared after opening ${ref}. The UIA adapter selects ` +
              "by expanding the control and then selecting the item it opens.",
            { adapter: "uia" },
          );
        }
        await bridge.perform({
          kind: "pattern",
          path: option.path,
          pattern: "SelectionItem",
          method: "Select",
        });
        await this.refresh();
        return { ok: true };
      }

      case "switchWindow": {
        await bridge.perform({ kind: "activate" });
        await this.refresh();
        return { ok: true };
      }

      /**
       * `Resize the window to <w> by <h>` (pattern 33, T12.7, LLD §13.9).
       *
       * Through the main window's size, which is what the toolbar rules these
       * sentences exist for are measured against. The tree is re-read: a resize
       * is a relayout, and every box in the snapshot has moved.
       */
      case "resizeWindow": {
        const width = Number(args["width"]);
        const height = Number(args["height"]);
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          throw new ScriptError(
            `"resizeWindow" needs a width and a height; it was given ` +
              `${JSON.stringify(args["width"])} by ${JSON.stringify(args["height"])}.`,
            { adapter: "uia" },
          );
        }
        /*
         * Read back, because setting a window's size is a *request* (native-feedback D2).
         *
         * A window with a fixed size, a maximised one, or one whose provider
         * clamps to a minimum takes the call without error and stays where it
         * was — so `{ok: true}` on the strength of the call returning is a
         * claim about a resize that a snapshot one step later contradicts. The
         * AX adapter had the same hole and closed it the same way; the write is
         * not the evidence, the size afterwards is.
         */
        const before = this.windowSize();
        await bridge.perform({ kind: "setSize", size: [width, height] });
        await this.refresh();
        const after = this.windowSize();

        if (after === undefined) {
          throw new ActionabilityError(
            `The window of "${this.processName ?? "the application"}" publishes no bounding ` +
              `rectangle, so a resize to ${width} by ${height} cannot be confirmed.`,
            { adapter: "uia" },
          );
        }
        if (
          Math.abs(after[0] - width) > SIZE_TOLERANCE ||
          Math.abs(after[1] - height) > SIZE_TOLERANCE
        ) {
          const stayed = before !== undefined && before[0] === after[0] && before[1] === after[1];
          throw new ActionabilityError(
            `The window would not take that size: it was asked for ${width} by ${height} and ` +
              `is ${after[0]} by ${after[1]}` +
              (stayed
                ? ", unchanged — the window is not resizable, or it is maximised."
                : ` (it was ${before?.[0] ?? "?"} by ${before?.[1] ?? "?"}) — the window clamped ` +
                  "the request to its own minimum or maximum."),
            { adapter: "uia" },
          );
        }
        // The size that was actually taken, so the record shows a measurement
        // rather than the request echoed back at whoever made it.
        return { ok: true, value: { width: after[0], height: after[1] } };
      }

      case "sleep": {
        const ms = Number(args["ms"] ?? 0);
        await new Promise((done) => setTimeout(done, Number.isFinite(ms) ? ms : 0));
        return { ok: true };
      }

      case "waitFor": {
        /*
         * No reference is a wait for the window — its text or its title — and
         * not for an element (SF-16). The loop below used to take that case too,
         * and it only ever returned when it had a reference to find: a wait for
         * "Saved" re-read the window until the timeout and failed, however early
         * the word appeared. With nothing to wait for at all, `waitForPage`
         * refuses at once as a missing argument.
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
         * Refused before either reference is resolved (SF-11): no pair of
         * elements makes a drag possible here, so a stale reference must not
         * turn the refusal into a locator failure. It was an
         * `ActionabilityError`, told as `TIMEOUT` — "try again", which never helps.
         */
        void ref2;
        throw new UnsupportedError(
          "The UIA adapter cannot drag: `capabilities().drag` is false. `mouse_event` gives " +
            "press, move and release, but a drag also needs the timing a real pointer has, " +
            "and a drag that silently did nothing would be worse than one that says so.",
          { adapter: "uia" },
        );

      default:
        throw new UnsupportedError(
          `The UIA adapter has no "${action}". See \`capabilities()\` for what a desktop ` +
            "window supports (LLD §2.4).",
          { adapter: "uia" },
        );
    }
  }

  /**
   * `waitFor` with no reference: the window's text or its title (SF-16).
   *
   * `waitForPage`, so the words mean what they mean on every adapter, with the
   * text read as `pageTextOf` over a fresh tree — what a page `textContains`
   * answers from. A URL is refused first: `read("url")` throws, a page wait
   * reads a throw as "not yet", and it would spend its whole timeout learning
   * that a window has no address.
   */
  private async waitForWindow(args: ActArgs): Promise<ActResult> {
    if (typeof args["url"] === "string") {
      throw new UnsupportedError(
        "A desktop window has no URL to wait for. Wait for its title or its text instead.",
        { adapter: "uia" },
      );
    }
    return await waitForPage(this, args, {
      adapter: "uia",
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
   * This ignored the state and re-read the window until some node sat at the
   * reference's index — at once, a reference being an index — so `to be
   * hidden` returned on a showing element, `to be enabled` on a disabled one,
   * and `to be detached` only on a window that had shrunk. Each of the six
   * states now means what it means on every adapter: `attached` is in a fresh
   * read, `detached` is not, `visible` is there and not `hidden` (UIA's
   * `IsOffscreen`, or no area), `hidden` is gone or `hidden`, and `enabled` and
   * `disabled` are there with or without `IsEnabled`. The element is found
   * again by what identifies it, not by the index a deletion moves; the budget
   * is `args.timeoutMs`, else the session's timeout.
   */
  private async waitForElement(ref: Ref, args: ActArgs): Promise<ActResult> {
    const state = waitStateOf(args);
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
          { adapter: "uia", timeoutMs },
        );
      }
      await new Promise((done) => setTimeout(done, 200));
    }
  }

  /** `InvokePattern` if the element declares it, then `SelectionItem`, then the mouse. */
  private async invoke(node: UiaSnapshotNode): Promise<void> {
    if (node.states.includes("disabled")) {
      throw new ActionabilityError(
        `${node.role}${node.name === undefined ? "" : ` "${node.name}"`} is disabled.`,
        { adapter: "uia" },
      );
    }
    if (this.supports(node, "Invoke")) {
      await this.live().perform({
        kind: "pattern",
        path: node.path,
        pattern: "Invoke",
        method: "Invoke",
      });
      return;
    }
    /*
     * A tab, an option and a radio have no `Invoke`: pressing one *selects* it,
     * and `SelectionItemPattern.Select()` is what that is. Without this a click
     * on the app's screen tabs would fall through to the mouse for no reason.
     */
    if (this.supports(node, "SelectionItem")) {
      await this.live().perform({
        kind: "pattern",
        path: node.path,
        pattern: "SelectionItem",
        method: "Select",
      });
      return;
    }
    if (this.supports(node, "Toggle")) {
      await this.live().perform({
        kind: "pattern",
        path: node.path,
        pattern: "Toggle",
        method: "Toggle",
      });
      return;
    }
    await this.live().perform({ kind: "click", at: this.centreOf(node) });
  }

  private centreOf(node: UiaSnapshotNode): [number, number] {
    if (node.box === undefined) {
      throw new ActionabilityError(
        `${node.role} supports no invocable pattern and has no bounding rectangle, so there ` +
          "is nowhere to click.",
        { adapter: "uia" },
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
         * The title now (SF-16). `check` re-reads before a title predicate and
         * this answered from the last refresh, so a title wait — which asks this
         * until it matches — could not see the window change. One node is
         * enough, and the snapshot the references index is left as it was.
         */
        /*
         * A window that cannot be read throws here, where the cached read used
         * to answer — and unlike the AX adapter, that includes a process with
         * no window open. The bridge's `no-window` is also its answer for a
         * process that has quit: the script looks only at processes that own a
         * main window, so "running with none" and "not running" arrive as the
         * same word, and answering the last title for it would call a quit
         * application alive. (On Windows closing the last window usually ends
         * the process anyway.)
         */
        const window = await this.readWindow(1);
        this.windowTitle = window.title;
        return this.windowTitle;
      }
      /*
       * Unsupported rather than a failed navigation or script (SF-11), which
       * the broker told as `CONNECT_FAILED` and `OUTCOME_UNKNOWN`.
       */
      case "url":
        throw new UnsupportedError("A desktop window has no URL. Read its title instead.", {
          adapter: "uia",
        });
      case "result":
        throw new UnsupportedError("The UIA adapter runs no scripts, so there is no result to read.", {
          adapter: "uia",
        });
      default: {
        if (ref === undefined) {
          throw new LocateError(`Reading "${kind}" needs a reference.`, { adapter: "uia" });
        }
        const node = this.nodeFor(ref);
        // `saidBy`, not the name: on an edit the words on the screen are the
        // value and the name is its label (see `saidBy`).
        if (kind === "text") return saidBy(node);
        if (kind === "value") return node.value ?? "";
        if (name === undefined) {
          throw new ScriptError("Reading an attribute needs its name.", { adapter: "uia" });
        }
        return node.native?.[name] ?? "";
      }
    }
  }

  async check(predicate: Predicate, subject: CheckSubject, ref?: Ref): Promise<CheckResult> {
    await this.refresh();
    return evaluateUiaPredicate(predicate, subject, ref, {
      nodes: this.nodes,
      windowTitle: this.windowTitle,
      node: (which) => this.nodes.find((one) => one.ref === which),
    });
  }

  async state(): Promise<SessionState> {
    return {
      kind: "desktop",
      ...(this.windowTitle === "" ? {} : { windowTitle: this.windowTitle }),
      windowIndex: 0,
    };
  }

  async restore(state: SessionState): Promise<void> {
    await this.live().perform({ kind: "activate" });
    await this.refresh();
    const wanted = state.windowTitle;
    if (wanted !== undefined && wanted !== "" && wanted !== this.windowTitle) {
      throw new SessionError(
        `The window is "${this.windowTitle}" and the checkpoint was taken on "${wanted}". ` +
          "A desktop application's state is its own; put it back where the checkpoint was " +
          "before resuming.",
        { adapter: "uia" },
      );
    }
  }

  async screenshot(path: string, mask?: Ref[]): Promise<void> {
    void mask;
    // Whole-screen and unmasked, like the AX adapter: the capture is written by
    // another process and there is no chance to paint over it (REQ-NFR-6 is
    // honoured by not screenshotting a secret-injecting step at all).
    await this.live().screenshot(path);
  }

  /** Whether UI Automation is reachable, for `surface doctor`. */
  async availability(): ReturnType<UiaBridge["availability"]> {
    const bridge =
      this.bridge ??
      powershellBridge({
        process: this.processName ?? this.options.processName ?? "",
        ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
      });
    return await bridge.availability();
  }

  /** The `controlPath` of a node, for a report. */
  controlPathFor(ref: Ref): string {
    return this.nodeFor(ref).controlPath;
  }
}

/**
 * A key name → a `SendKeys` sequence.
 *
 * `SendKeys` is the only keyboard Windows gives a script without P/Invoke, and
 * its notation is its own: `{ENTER}` for a named key, `^` `%` `+` for control,
 * alt and shift. A key name that is not in the table is sent as a character,
 * which is right for `a` and wrong for nothing else the IR produces.
 */
export function sendKeysFor(key: string): string {
  const parts = key.split("+").map((part) => part.trim());
  const last = parts.pop() ?? "";
  let prefix = "";
  for (const part of parts) prefix += MODIFIERS[part.toLowerCase()] ?? "";
  const named = KEY_NAMES[last.toLowerCase()];
  return prefix + (named ?? escapeSendKeys(last));
}

/**
 * Escape a literal for `SendKeys`.
 *
 * `+^%~(){}[]` are its own syntax, so a password containing `%` would otherwise
 * send an Alt chord. Braces around each is `SendKeys`'s own escape.
 */
export function escapeSendKeys(text: string): string {
  return text.replace(/[+^%~(){}[\]]/g, (character) => `{${character}}`);
}

const MODIFIERS: Readonly<Record<string, string>> = {
  ctrl: "^",
  control: "^",
  alt: "%",
  option: "%",
  shift: "+",
  // Windows has no Command key; a flow written on a Mac that says `cmd+a`
  // means "the platform's own modifier", which here is Control.
  cmd: "^",
  command: "^",
  meta: "^",
};

const KEY_NAMES: Readonly<Record<string, string>> = {
  enter: "{ENTER}",
  return: "{ENTER}",
  tab: "{TAB}",
  space: " ",
  delete: "{DEL}",
  backspace: "{BACKSPACE}",
  escape: "{ESC}",
  esc: "{ESC}",
  left: "{LEFT}",
  right: "{RIGHT}",
  up: "{UP}",
  down: "{DOWN}",
  arrowleft: "{LEFT}",
  arrowright: "{RIGHT}",
  arrowup: "{UP}",
  arrowdown: "{DOWN}",
  home: "{HOME}",
  end: "{END}",
  pageup: "{PGUP}",
  pagedown: "{PGDN}",
  f1: "{F1}",
  f2: "{F2}",
  f3: "{F3}",
  f4: "{F4}",
  f5: "{F5}",
};

/** The factory the registry calls (LLD §2.4). */
export function createUiaSurface(config: {
  app?: { appPath?: string; processName?: string; launch?: LaunchConfig; quit?: QuitConfig };
  run?: { stepTimeoutMs?: number; candidateTimeoutMs?: number };
}): AgentSurface {
  return new UiaSurface({
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

/** The six states a reference `waitFor` waits for (pattern 19). */
const WAIT_STATES = ["attached", "detached", "visible", "hidden", "enabled", "disabled"] as const;
type WaitState = (typeof WAIT_STATES)[number];

/** `args.state`, `visible` when there is none; anything else is a caller's mistake. */
function waitStateOf(args: ActArgs): WaitState {
  const asked = args["state"] ?? "visible";
  if (typeof asked === "string" && (WAIT_STATES as readonly string[]).includes(asked)) {
    return asked as WaitState;
  }
  throw new DataError(
    `waitFor cannot wait for ${JSON.stringify(asked)}; it waits for attached, detached, visible, ` +
      "hidden, enabled or disabled.",
    { adapter: "uia" },
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
  return (
    `is ${states.includes("hidden") ? "hidden" : "showing"} and ` +
    `${states.includes("disabled") ? "disabled" : "enabled"}`
  );
}

/** A `controlPath` without its window segment, so a retitled window does not move every element. */
function withinWindow(node: UiaSnapshotNode, title: string): string {
  const root = `Window[${title}]`;
  return node.controlPath.startsWith(root) ? node.controlPath.slice(root.length) : node.controlPath;
}

/**
 * The element a reference named, in a fresh read of the window (pattern 19) —
 * the AX adapter's rule.
 *
 * What it is like: its automation id and role when it has an id, its role and
 * name when it has a name, and otherwise its role among the same-role siblings
 * under the same parent. Nothing like it now is gone; one like it then and now,
 * with an id or a name, is that one wherever it moved; otherwise only the one at
 * the same `controlPath`, and only if as many are like it as were — a deletion
 * ahead of it moves a look-alike into its place. Anything else is a
 * `LocateError`, because an answer about the neighbour is worse than none.
 */
function findWaitedElement(
  ref: Ref,
  was: UiaSnapshotNode,
  then: { readonly nodes: readonly UiaSnapshotNode[]; readonly title: string },
  now: { readonly nodes: readonly UiaSnapshotNode[]; readonly title: string },
): UiaSnapshotNode | undefined {
  const idOf = (node: UiaSnapshotNode): string | undefined => {
    const id = node.native?.["automationId"];
    return typeof id === "string" && id !== "" ? id : undefined;
  };
  const id = idOf(was);
  const name = was.name ?? "";
  const place = withinWindow(was, then.title);
  const parent = `${place.slice(0, place.lastIndexOf("/"))}/`;
  const alike = (title: string) => (one: UiaSnapshotNode): boolean =>
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
    { adapter: "uia" },
  );
}

/** Whether a rectangle lies wholly inside another: `[x, y, width, height]` each. */
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
