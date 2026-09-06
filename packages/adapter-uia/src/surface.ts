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
  executableOf,
  launchApplication,
  locateDeadline,
  LocateError,
  NavigationError,
  quitApplication,
  ScriptError,
  SessionError,
  structuralHash,
  waitFor,
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
import { evaluateUiaPredicate } from "./predicates.js";
import { convertTree, nameOf, type UiaSnapshotNode } from "./tree.js";

const DEFAULT_MAX_NODES = 1_500;

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
      native: { ...node.native, controlPath: node.controlPath },
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
      case "navigate":
      case "back":
      case "forward":
      case "refresh":
        throw new NavigationError(
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
        need(ref);
        return { ok: true };

      case "scrollIntoView": {
        const node = need(ref);
        if (this.supports(node, "ScrollItem")) {
          await bridge.perform({
            kind: "pattern",
            path: node.path,
            pattern: "Scroll",
            method: "ScrollIntoView",
          });
        }
        // No pattern and no failure: the element is in the tree, so it is
        // addressable, and a step must not fail over a gesture with no meaning.
        return { ok: true };
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

      case "press":
      case "keyDown":
      case "keyUp": {
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

      case "selectOption":
      case "deselectOption": {
        const node = need(ref);
        const wanted = str("value");
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
        await bridge.perform({ kind: "setSize", size: [width, height] });
        await this.refresh();
        return { ok: true };
      }

      case "sleep": {
        const ms = Number(args["ms"] ?? 0);
        await new Promise((done) => setTimeout(done, Number.isFinite(ms) ? ms : 0));
        return { ok: true };
      }

      case "waitFor": {
        const timeoutMs = Number(args["timeoutMs"] ?? 5_000);
        const until = Date.now() + (Number.isFinite(timeoutMs) ? timeoutMs : 5_000);
        for (;;) {
          await this.refresh();
          if (ref !== undefined && this.nodes.some((one) => one.ref === ref)) return { ok: true };
          if (Date.now() >= until) {
            throw new ActionabilityError(`Waiting for ${ref ?? "the window"} timed out.`, {
              adapter: "uia",
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
        void need(ref);
        void need(ref2);
        throw new ActionabilityError(
          "The UIA adapter cannot drag: `capabilities().drag` is false. `mouse_event` gives " +
            "press, move and release, but a drag also needs the timing a real pointer has, " +
            "and a drag that silently did nothing would be worse than one that says so.",
          { adapter: "uia" },
        );
      }

      default:
        throw new ActionabilityError(
          `The UIA adapter has no "${action}". See \`capabilities()\` for what a desktop ` +
            "window supports (LLD §2.4).",
          { adapter: "uia" },
        );
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
      case "title":
        return this.windowTitle;
      case "url":
        throw new NavigationError("A desktop window has no URL. Read its title instead.", {
          adapter: "uia",
        });
      case "result":
        throw new ScriptError("The UIA adapter runs no scripts, so there is no result to read.", {
          adapter: "uia",
        });
      default: {
        if (ref === undefined) {
          throw new LocateError(`Reading "${kind}" needs a reference.`, { adapter: "uia" });
        }
        const node = this.nodeFor(ref);
        if (kind === "text") return node.name ?? node.value ?? "";
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
