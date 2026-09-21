/**
 * The Linux desktop, through AT-SPI (T23, SF-23, REQ-ADP-7).
 *
 * The same contract as every other adapter, over the same catalogue operations,
 * reaching the accessibility bus through `bridge.ts`. Everything about the shape
 * of a snapshot, the meaning of a reference and the mapping of a role is a pure
 * function of an `AtspiNode[]` and lives in `tree.ts`, so all of it is driven by
 * tests on a machine with no bus.
 *
 * ## What this is, honestly
 *
 * **Implemented, unvalidated here.** No Linux runner is provisioned for this
 * repository, so no session has ever been opened through this adapter against a
 * real registry. What has been driven is the tree mapping, the reference scope,
 * the role table, the state inversion, the action selection and every refusal —
 * against recorded answers. What has *not* been driven is `bridge.ts`'s
 * conversation with the bus.
 *
 * For this to become *validated*, all of the following would have to be true on
 * a provisioned runner, and the support matrix says so in these words:
 *
 * 1. a Linux host with a session bus;
 * 2. toolkit accessibility on, and `at-spi2-registryd` running;
 * 3. `python3` with `pyatspi` (the binding every Linux accessibility tool uses);
 * 4. an application publishing a window on the bus.
 *
 * `probeAdapter("atspi")` answers with which of those it could not find. Nothing
 * in the coverage report counts an AT-SPI row as passing until a run does.
 */
import type {
  ActArgs,
  ActResult,
  Candidate,
  Capabilities,
  CheckResult,
  Config,
  ElementDescription,
  Predicate,
  ReadKind,
  Ref,
  SessionInit,
  SessionState,
  Snapshot,
  SurfaceKind,
} from "@svatah/yam-schema";
import type { AgentSurface } from "@svatah/yam-surface";
import {
  ActionabilityError,
  DataError,
  DEFAULT_PAGE_WAIT_MS,
  LocateError,
  SessionError,
  TimeoutError,
  UnsupportedError,
  buildSnapshot,
  structuralHash,
  waitForPage,
} from "@svatah/yam-surface";
import { pythonBridge, type AtspiBridge, type AtspiNode } from "./bridge.js";
import {
  actionFor,
  buildNodes,
  findAgain,
  nameOf,
  roleOf,
  statesOf,
  valueOf,
  type BuiltNode,
} from "./tree.js";

const ADAPTER = "atspi";

/**
 * How many snapshots back a reference can still be asked about.
 *
 * A check or a wait names an element by the reference a snapshot issued, and
 * answers about the element as it is *now* — so the adapter has to remember
 * what that reference was. Eight snapshots is far more than a step ever spans,
 * and bounded, so a long session does not keep every tree it ever read.
 */
const REMEMBERED_SNAPSHOTS = 8;

/** How often a wait re-reads the window. */
const WAIT_EVERY_MS = 200;

/** The states a reference `waitFor` waits for (pattern 19). */
const WAIT_STATES: readonly string[] = ["attached", "detached", "visible", "hidden", "enabled", "disabled"];

/**
 * The predicates `check` answers; anything else is refused before the bus is read.
 *
 * `title`, `titleContains` and the geometry predicates were refused as
 * unsupported (SF-11) although this adapter reads both: the walker answers the
 * window's title with every read, and `Component.GetExtents` gives each element
 * a box. "Never" was the wrong answer about a question the bus answers.
 */
const PREDICATES: ReadonlySet<string> = new Set([
  "present",
  "absent",
  "visible",
  "hidden",
  "enabled",
  "disabled",
  "checked",
  "unchecked",
  "selected",
  "text",
  "textContains",
  "value",
  "tag",
  "title",
  "titleContains",
  "location",
  "size",
  "box",
]);

export interface AtspiSurfaceOptions {
  readonly bridge?: AtspiBridge;
  /** The application whose window this session drives. */
  readonly application?: string;
  /**
   * `config.run.stepTimeoutMs`: how long a `waitFor` waits when the step does
   * not say. `DEFAULT_PAGE_WAIT_MS` when it is not configured.
   */
  readonly timeoutMs?: number;
}

/** A snapshot this session issued: the references it gave, and the whole tree they came from. */
interface Issued {
  /** The nodes that were given references — fewer than `tree` when only controls were asked for. */
  readonly nodes: readonly BuiltNode[];
  /** Every node the walker read, which is what telling one element from another needs. */
  readonly tree: readonly BuiltNode[];
}

export class AtspiSurface implements AgentSurface {
  readonly kind: SurfaceKind = "desktop";
  private readonly bridge: AtspiBridge;
  private application: string | undefined;
  private generation = 0;
  private nodes: BuiltNode[] = [];
  private title: string | undefined;
  /** Each recent snapshot, by generation, so a reference can be re-found. */
  private readonly issued = new Map<number, Issued>();

  constructor(private readonly options: AtspiSurfaceOptions = {}) {
    this.bridge = options.bridge ?? pythonBridge();
    this.application = options.application;
  }

  capabilities(): Capabilities {
    return {
      dialogs: false,
      frames: false,
      /*
       * One window at a time: the walker reads the application's active window,
       * and `switchWindow` would need a second sentence for choosing among them.
       * Said here rather than discovered when a flow asks.
       */
      windows: false,
      upload: false,
      drag: false,
      trace: false,
      webmcp: false,
      pick: false,
      observe: false,
      /*
       * On Linux the decorations belong to the window manager's process, not to
       * the application, so they are in no application's accessibility tree —
       * and on a bare `Xvfb` there is no window manager to own them at all
       * (Draft 2.29).
       */
      windowChrome: false,
      /*
       * A screenshot of a Linux desktop is a compositor question — X11 and
       * Wayland answer it differently and Wayland mostly refuses — and this
       * adapter does not answer it. `false` is what stops a caller being offered
       * a button that cannot work (SF-17).
       */
      screenshot: false,
      restore: false,
    };
  }

  async open(session: SessionInit): Promise<void> {
    const application = session.processName ?? this.options.application;
    if (application === undefined || application.trim() === "") {
      throw new SessionError(
        "An AT-SPI session needs the application to drive. Name it with `--app <application>`, " +
          "as the accessibility bus publishes it.",
        { adapter: ADAPTER },
      );
    }
    const available = await this.bridge.availability();
    if (!available.available) {
      throw new SessionError(available.reason ?? "The accessibility bus is not reachable.", {
        adapter: ADAPTER,
      });
    }
    this.application = application;
  }

  async close(): Promise<void> {
    /*
     * Nothing to close. This adapter only ever *attaches* — it does not launch
     * an application and so has none to quit, which is the ownership answer
     * SF-05 asks every adapter to have.
     */
    this.application = undefined;
    this.nodes = [];
    this.issued.clear();
  }

  private live(): string {
    if (this.application === undefined) {
      throw new SessionError("The AT-SPI session is not open.", { adapter: ADAPTER });
    }
    return this.application;
  }

  async snapshot(
    opts: { root?: Ref; maxNodes?: number; interactiveOnly?: boolean } = {},
  ): Promise<Snapshot> {
    const application = this.live();
    const window = await this.bridge.window({
      application,
      maxNodes: opts.maxNodes ?? 1_000,
      deadlineMs: 30_000,
    });
    this.generation += 1;
    this.title = window.title;
    this.nodes = buildNodes(window.nodes, this.generation, {
      ...(opts.interactiveOnly === undefined ? {} : { interactiveOnly: opts.interactiveOnly }),
      ...(opts.maxNodes === undefined ? {} : { maxNodes: opts.maxNodes }),
    });
    /*
     * The whole tree as well as the references (SF-10). Whether an element can
     * be told from its neighbours is a question about every node the walker
     * read, and a controls-only snapshot leaves out exactly the labels and rows
     * that make two elements look alike.
     */
    const tree =
      opts.interactiveOnly === true
        ? buildNodes(window.nodes, this.generation, {
            ...(opts.maxNodes === undefined ? {} : { maxNodes: opts.maxNodes }),
          })
        : this.nodes;
    this.issued.set(this.generation, { nodes: this.nodes, tree });
    this.issued.delete(this.generation - REMEMBERED_SNAPSHOTS);
    const nodes = this.nodes.map((one) => one.node);
    return {
      ...buildSnapshot((nodes[0]?.ref ?? `a${this.generation}_0`) as Ref, nodes, structuralHash(nodes)),
      ...(window.truncated ? { truncated: true } : {}),
    };
  }

  private find(ref: Ref | undefined, what: string): BuiltNode {
    if (ref === undefined) {
      throw new DataError(`${what} needs a reference to an element.`, { adapter: ADAPTER });
    }
    const found = this.nodes.find((one) => one.node.ref === ref);
    if (found === undefined) {
      throw new LocateError(
        `${ref} is not an element of the current snapshot. Take a fresh one and use the ` +
          "reference it gives.",
        { adapter: ADAPTER },
      );
    }
    return found;
  }

  /**
   * The window as it is now, without issuing references.
   *
   * A check and a wait are questions about now, and answering them from the
   * last snapshot answered about then. Reading into a fresh snapshot would
   * answer about now and cost every reference the caller holds (SF-10), so the
   * read is built at generation zero — which no snapshot ever issues — and kept
   * to this call.
   */
  private async readNow(): Promise<{ nodes: BuiltNode[]; title?: string }> {
    const window = await this.bridge.window({
      application: this.live(),
      maxNodes: 1_000,
      deadlineMs: 30_000,
    });
    return {
      nodes: buildNodes(window.nodes, 0),
      ...(window.title === undefined ? {} : { title: window.title }),
    };
  }

  /**
   * What a reference was issued for: its node in the snapshot that issued it,
   * and that snapshot's whole tree.
   *
   * `undefined` for a reference no remembered snapshot issued, which is not the
   * same as an element that has gone — nothing can be said about what it was.
   */
  private issuedNode(
    ref: Ref,
  ): { readonly node: BuiltNode; readonly tree: readonly BuiltNode[] } | undefined {
    const generation = /^a(\d+)_\d+$/u.exec(ref)?.[1];
    if (generation === undefined) return undefined;
    const issued = this.issued.get(Number(generation));
    const node = issued?.nodes.find((one) => one.node.ref === ref);
    return issued === undefined || node === undefined ? undefined : { node, tree: issued.tree };
  }

  /**
   * The same element in a fresh read, by what identifies it rather than by
   * where it was (SF-10) — `findAgain` in `tree.ts` has the rules.
   *
   * `undefined` is an element that has gone. An element that cannot be told
   * apart from another is neither there nor gone, and is refused as a
   * `LocateError`: this used to pick whichever look-alike sat at the old index
   * path, which after a deletion is the neighbour that moved into it, so
   * `absent` on the deleted row failed and `text` answered with the neighbour's
   * words.
   */
  private sameElement(
    ref: Ref,
    was: { readonly node: BuiltNode; readonly tree: readonly BuiltNode[] },
    now: readonly BuiltNode[],
  ): BuiltNode | undefined {
    const answer = findAgain(was.node, was.tree, now);
    if (answer.kind === "ambiguous") {
      throw new LocateError(
        `${ref} ("${nameOf(was.node.source) || was.node.node.role}") cannot be told apart from ` +
          `other elements in the window: ${answer.why}. Give the element an accessible name or ` +
          "an automation id (GTK: `accessible-id`), or ask about the list rather than one row.",
        { adapter: ADAPTER },
      );
    }
    return answer.kind === "found" ? answer.node : undefined;
  }

  /** Every name in a tree, one per line: what `read("text")` answers for the window. */
  private static textOf(nodes: readonly BuiltNode[]): string {
    return nodes
      .map((one) => nameOf(one.source))
      .filter((one) => one !== "")
      .join("\n");
  }

  async act(action: string, ref?: Ref, args?: ActArgs, _ref2?: Ref): Promise<ActResult> {
    this.live();
    switch (action) {
      case "type":
      case "clear": {
        const found = this.find(ref, "type");
        const value = action === "clear" ? "" : args?.["value"];
        if (typeof value !== "string") {
          throw new DataError("The type action needs an argument value.", { adapter: ADAPTER });
        }
        await this.bridge.perform({ kind: "focus", path: found.path });
        await this.bridge.perform({ kind: "setValue", path: found.path, value });
        return { ok: true, ref: found.node.ref };
      }

      case "press": {
        const key = args?.["key"] ?? args?.["value"];
        if (typeof key !== "string") {
          throw new DataError("The press action needs an argument key.", { adapter: ADAPTER });
        }
        if (ref !== undefined) {
          await this.bridge.perform({ kind: "focus", path: this.find(ref, "press").path });
        }
        await this.bridge.perform({ kind: "key", key });
        return { ok: true, ...(ref === undefined ? {} : { ref }) };
      }

      case "setChecked": {
        const found = this.find(ref, action);
        /*
         * The state first, then a click only if it is wrong (SF-11).
         *
         * This clicked unconditionally, and a click on a check box is a toggle:
         * `setChecked` with `checked: false` on a box that was already unchecked
         * checked it, and answered `{ok: true}`. The state is read from the
         * window as it is now rather than from the snapshot, because the step
         * before this one may well have been the click that changed it.
         */
        const wanted = args?.["checked"] !== false && args?.["checked"] !== "false";
        const now = this.sameElement(
          found.node.ref,
          this.issuedNode(found.node.ref) ?? { node: found, tree: this.nodes },
          (await this.readNow()).nodes,
        );
        if (now === undefined) {
          throw new LocateError(
            `"${nameOf(found.source) || found.node.role}" (${found.node.ref}) is no longer in the ` +
              "window. Take a fresh snapshot and use the reference it gives.",
            { adapter: ADAPTER },
          );
        }
        if (statesOf(now.source).includes("checked") === wanted) {
          return { ok: true, ref: found.node.ref };
        }
        await this.perform(action, now);
        return { ok: true, ref: found.node.ref };
      }

      case "click":
      case "doubleClick":
      case "selectOption":
      case "hover":
      case "scrollIntoView": {
        const found = this.find(ref, action);
        await this.perform(action, found);
        return { ok: true, ref: found.node.ref };
      }

      case "focus": {
        const found = this.find(ref, "focus");
        await this.bridge.perform({ kind: "focus", path: found.path });
        return { ok: true, ref: found.node.ref };
      }

      case "sleep": {
        const ms = Number(args?.["ms"] ?? args?.["value"] ?? 0);
        await new Promise((done) => setTimeout(done, Math.max(0, ms)));
        return { ok: true };
      }

      case "waitFor":
        return await this.waitFor(ref, args ?? {});

      default:
        /*
         * The same refusal a desktop adapter has always given a web action
         * (REQ-SURF-5): a window has no URL to navigate and no tab to switch.
         *
         * An `UnsupportedError` (SF-11). It was a `DataError`, which a caller is
         * told as `INVALID_ARGUMENT` — "fix what you sent" — about an action no
         * argument would make this adapter perform.
         */
        throw new UnsupportedError(
          `An AT-SPI session has no "${action}". It takes click, doubleClick, type, clear, ` +
            "press, focus, setChecked, selectOption, hover, scrollIntoView, sleep and waitFor.",
          { adapter: ADAPTER },
        );
    }
  }

  /**
   * Perform the AT-SPI action a gesture maps to on one element.
   *
   * Refused by name, with what the element *does* offer, when it declares none
   * of them. AT-SPI names actions per toolkit, so "this element has no click" is
   * a fact about the application rather than about the adapter, and a caller
   * can only act on it if it is told which actions there are.
   *
   * Unsupported, where it was an `ActionabilityError` (SF-11). An element's
   * action list is what its toolkit gave it, not a state it passes through: a
   * label does not grow a `click` if the caller waits, and `TIMEOUT` told them
   * to wait.
   *
   * Except when the list is missing because the bus did not answer (SF-11).
   * The walker used to drop an Action-interface error with every other, so one
   * D-Bus hiccup read as "offers none" and was refused as never possible. Now
   * the walker records it, the window is read again once — the snapshot's
   * failure is the snapshot's — and if the interface still does not answer the
   * refusal is an `ActionabilityError`, which a caller is told is worth trying
   * again.
   */
  private async perform(action: string, target: BuiltNode): Promise<void> {
    let node = target;
    if (actionFor(action, node.source) === undefined && node.source.actionsError !== undefined) {
      const was = this.issuedNode(target.node.ref);
      const again =
        was === undefined
          ? undefined
          : this.sameElement(target.node.ref, was, (await this.readNow()).nodes);
      if (again !== undefined) node = again;
    }
    const named = actionFor(action, node.source);
    if (named === undefined) {
      const what = nameOf(node.source) || target.node.role;
      if (node.source.actionsError !== undefined) {
        throw new ActionabilityError(
          `"${what}" did not say which actions it offers: its Action interface failed to answer ` +
            `(${node.source.actionsError}). Nothing was performed; the application may be busy.`,
          { adapter: ADAPTER },
        );
      }
      throw new UnsupportedError(
        `"${what}" declares no action for ${action}. ` +
          `It offers: ${(node.source.actions ?? []).join(", ") || "none"}.`,
        { adapter: ADAPTER },
      );
    }
    await this.bridge.perform({ kind: "action", path: node.path, action: named });
  }

  /**
   * `waitFor`, which this adapter did not have (SF-16).
   *
   * Without a reference it waits for the window — its text or its title —
   * through `waitForPage`, as every adapter does, reading the window fresh each
   * time and issuing no references. A URL is refused before anything waits: a
   * page wait reads a `read("url")` that throws as "not yet", and would spend
   * its whole timeout finding out that a window has no address.
   *
   * With a reference it re-reads the window until the element is in the state
   * asked for: `visible` (the default) is present and showing, `attached` is
   * present, `hidden` is gone or not showing, and `detached` is gone. The element
   * is found again by what identifies it (`sameElement`), so the caller's
   * reference is still good when the wait returns.
   */
  private async waitFor(ref: Ref | undefined, args: ActArgs): Promise<ActResult> {
    if (ref === undefined) {
      if (typeof args["url"] === "string") {
        throw new UnsupportedError(
          "A desktop window has no URL to wait for. Wait for its title or its text instead.",
          { adapter: ADAPTER },
        );
      }
      return await waitForPage(this, args, {
        adapter: ADAPTER,
        textOf: async () => AtspiSurface.textOf((await this.readNow()).nodes),
        everyMs: WAIT_EVERY_MS,
        defaultTimeoutMs: this.defaultTimeoutMs(),
      });
    }

    /*
     * The six states the executor sends (pattern 19). `enabled` and `disabled`
     * were refused here as unknown, so `Wait for the Save button to be enabled`
     * failed on the desktop before it had waited for anything.
     */
    const state = args["state"] ?? "visible";
    if (typeof state !== "string" || !WAIT_STATES.includes(state)) {
      throw new DataError(
        `waitFor cannot wait for ${JSON.stringify(state)}; it waits for attached, detached, ` +
          "visible, hidden, enabled or disabled.",
        { adapter: ADAPTER },
      );
    }
    const was = this.issuedNode(ref);
    if (was === undefined) {
      throw new LocateError(
        `${ref} was not issued by a recent snapshot, so there is nothing to wait for. Take a ` +
          "fresh one and use the reference it gives.",
        { adapter: ADAPTER },
      );
    }
    const fallback = this.defaultTimeoutMs();
    const asked = Number(args["timeoutMs"] ?? fallback);
    const timeoutMs = Number.isFinite(asked) && asked >= 0 ? asked : fallback;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const found = this.sameElement(ref, was, (await this.readNow()).nodes);
      const states = found === undefined ? undefined : statesOf(found.source);
      const showing = states !== undefined && !states.includes("hidden");
      const enabled = states !== undefined && !states.includes("disabled");
      const holds =
        state === "detached"
          ? found === undefined
          : state === "hidden"
            ? !showing
            : state === "attached"
              ? found !== undefined
              : state === "enabled"
                ? enabled
                : state === "disabled"
                  ? found !== undefined && !enabled
                  : showing;
      if (holds) return { ok: true, ref };
      if (Date.now() >= deadline) {
        const where =
          found === undefined
            ? "is not in the window"
            : `is ${showing ? "showing" : "not showing"} and ${enabled ? "enabled" : "disabled"}`;
        throw new TimeoutError(
          `Waited ${timeoutMs} ms for "${nameOf(was.node.source) || was.node.node.role}" (${ref}) ` +
            `to be ${state}, and it ${where}.`,
          { adapter: ADAPTER, timeoutMs },
        );
      }
      await new Promise((done) => setTimeout(done, WAIT_EVERY_MS));
    }
  }

  /** How long a wait waits when the step does not say: the configured step timeout. */
  private defaultTimeoutMs(): number {
    return this.options.timeoutMs ?? DEFAULT_PAGE_WAIT_MS;
  }

  async read(kind: ReadKind, ref?: Ref, name?: string): Promise<unknown> {
    this.live();
    switch (kind) {
      case "text":
        return ref === undefined
          ? this.nodes.map((one) => nameOf(one.source)).filter((one) => one !== "").join("\n")
          : nameOf(this.find(ref, "read").source);
      case "value":
        return valueOf(this.find(ref, "read").source);
      case "title": {
        /*
         * The title now, not the last snapshot's (SF-16): a wait for a title
         * asks this until it matches, and a cached answer could never change.
         * The title comes with the window, so one node is enough, and the
         * snapshot the references belong to is left alone.
         */
        const window = await this.bridge.window({
          application: this.live(),
          maxNodes: 1,
          deadlineMs: 30_000,
        });
        this.title = window.title;
        return this.title ?? "";
      }
      case "attribute": {
        if (name === undefined) {
          throw new DataError("Reading an attribute needs its name.", { adapter: ADAPTER });
        }
        const found = this.find(ref, "read").source;
        if (name === "automationId") return found.automationId ?? "";
        if (name === "role") return found.role;
        if (name === "description") return found.description ?? "";
        throw new DataError(
          `An AT-SPI element has no attribute "${name}" this adapter reads. It reads ` +
            "automationId, role and description.",
          { adapter: ADAPTER },
        );
      }
      default:
        // `url` and `result`: a window has neither, whatever is asked (SF-11).
        throw new UnsupportedError(`An AT-SPI session cannot be read for "${kind}".`, {
          adapter: ADAPTER,
        });
    }
  }

  async check(predicate: Predicate, subject: string, ref?: Ref): Promise<CheckResult> {
    this.live();
    const kind = (predicate as { kind: string }).kind;
    const negate = (predicate as { negate?: boolean }).negate === true;
    const wanted = String(
      (predicate as { value?: { value?: unknown } }).value?.value ??
        (predicate as { value?: unknown }).value ??
        "",
    );
    const answer = (ok: boolean, actual: unknown): CheckResult => ({ ok: negate ? !ok : ok, actual });
    if (!PREDICATES.has(kind)) {
      // Refused, not failed (SF-11): `CHECK_FAILED` would call it an assertion.
      throw new UnsupportedError(`An AT-SPI session cannot answer the "${kind}" predicate.`, {
        adapter: ADAPTER,
      });
    }

    /*
     * Re-read first. A predicate is a question about now, and this
     * answered it from the last snapshot — so `the Surfaces toggle should be
     * checked`, one step after the click that checked it, read the state from
     * before the click and failed on a window that was right.
     */
    const now = await this.readNow();

    if (subject === "page" && (kind === "text" || kind === "textContains")) {
      const said = AtspiSurface.textOf(now.nodes);
      return answer(kind === "text" ? said === wanted : said.includes(wanted), said);
    }

    /*
     * The window's title, from the read just made: the walker answers it with
     * every tree, so this is the title now and costs nothing more. Whatever the
     * subject, as the AX and UIA adapters answer it — a desktop window's title
     * is the nearest thing it has to a page title.
     */
    if (kind === "title" || kind === "titleContains") {
      const title = now.title ?? "";
      this.title = now.title;
      return answer(kind === "title" ? title === wanted : title.includes(wanted), title);
    }

    /*
     * The element as it is now, found again by what identifies it.
     *
     * A reference to an element that has since gone is an *answer* — absent, not
     * present, hidden — and not a `LocateError`. It used to be looked up in the
     * snapshot and nowhere else, so `the row should be absent` after deleting
     * the row threw instead of passing: the one reference that predicate can
     * be asked about is one whose element is gone. What still throws is a
     * reference no recent snapshot issued, because then nothing is known about
     * what it named.
     */
    let found: BuiltNode | undefined;
    if (ref !== undefined) {
      const was = this.issuedNode(ref);
      if (was === undefined) {
        throw new LocateError(
          `${ref} was not issued by a recent snapshot. Take a fresh one and use the reference it ` +
            "gives.",
          { adapter: ADAPTER },
        );
      }
      found = this.sameElement(ref, was, now.nodes);
    }
    const states = found === undefined ? [] : statesOf(found.source);
    const said = found === undefined ? "" : nameOf(found.source);

    switch (kind) {
      case "present":
        return answer(found !== undefined, found !== undefined);
      case "absent":
        return answer(found === undefined, found !== undefined);
      case "visible":
        return answer(found !== undefined && !states.includes("hidden"), states);
      case "hidden":
        return answer(found === undefined || states.includes("hidden"), states);
      case "enabled":
        return answer(found !== undefined && !states.includes("disabled"), states);
      case "disabled":
        return answer(found !== undefined && states.includes("disabled"), states);
      case "checked":
        return answer(states.includes("checked"), states);
      case "unchecked":
        return answer(!states.includes("checked"), states);
      case "selected":
        return answer(states.includes("selected"), states);
      case "text":
        return answer(said === wanted, said);
      case "textContains":
        return answer(said.includes(wanted), said);
      case "value": {
        const value = found === undefined ? "" : valueOf(found.source);
        return answer(value === wanted, value);
      }
      case "tag":
        return answer(found !== undefined && roleOf(found.source) === wanted, found?.node.role);
      case "location":
      case "size":
      case "box": {
        /*
         * From `Component.GetExtents`, in desktop coordinates, compared after
         * rounding as the AX adapter compares them. An element that has gone
         * has no box and fails; an element whose toolkit gives it no Component
         * interface is refused, because "its size is not 0 by 0" is not an
         * answer this adapter has.
         */
        const numbers = (predicate as { numbers?: readonly number[] }).numbers ?? [];
        if (found === undefined) return { ok: false, actual: null, expected: [...numbers] };
        const box = found.source.box;
        if (box === undefined) {
          throw new UnsupportedError(
            `"${said || found.node.role}" publishes no extents (it has no AT-SPI Component ` +
              `interface), so its ${kind} cannot be checked.`,
            { adapter: ADAPTER },
          );
        }
        const actual =
          kind === "location" ? [box[0], box[1]] : kind === "size" ? [box[2], box[3]] : [...box];
        const ok =
          actual.length === numbers.length &&
          actual.every((one, at) => Math.round(one) === Math.round(numbers[at]!));
        // A geometry predicate has no `negate` in the IR (LLD §3.2).
        return { ok, actual, expected: [...numbers] };
      }
      default:
        throw new UnsupportedError(`An AT-SPI session cannot answer the "${kind}" predicate.`, {
          adapter: ADAPTER,
        });
    }
  }

  /**
   * A candidate to references (LLD §6.3).
   *
   * `automationId` first, because it is the one a rewording cannot break and the
   * one LLD §3.3 asks every platform to publish. A candidate this surface cannot
   * answer is refused by name, so a resolver is told which of its candidates
   * were even tried.
   */
  async locate(candidate: Candidate): Promise<Ref[]> {
    this.live();
    if (this.nodes.length === 0) await this.snapshot({ maxNodes: 1_000 });
    const value = String(candidate.value);
    const matches = (one: BuiltNode): boolean => {
      switch (candidate.by) {
        case "automationId":
          return one.source.automationId === value;
        case "role":
          return roleOf(one.source) === value;
        case "text":
        case "label":
          return nameOf(one.source) === value;
        case "name":
          return one.source.name === value;
        default:
          return false;
      }
    };
    if (!["automationId", "role", "text", "label", "name"].includes(candidate.by)) {
      throw new LocateError(
        `An AT-SPI session cannot be located by "${candidate.by}"; it answers automationId, ` +
          "role, name, text and label.",
        { adapter: ADAPTER },
      );
    }
    return this.nodes.filter(matches).map((one) => one.node.ref);
  }

  async describe(ref: Ref): Promise<ElementDescription> {
    const found = this.find(ref, "describe");
    const at = this.nodes.indexOf(found);
    return {
      ref,
      role: roleOf(found.source),
      name: nameOf(found.source),
      value: valueOf(found.source),
      tag: found.source.role,
      attrs: {
        ...(found.source.automationId === undefined
          ? {}
          : { automationId: found.source.automationId }),
        ...(found.source.description === undefined
          ? {}
          : { description: found.source.description }),
      },
      text: nameOf(found.source),
      neighbours: {
        before: at > 0 ? [nameOf(this.nodes[at - 1]!.source)] : [],
        after: at + 1 < this.nodes.length ? [nameOf(this.nodes[at + 1]!.source)] : [],
      },
      rolePath: found.path.map(() => "group").concat(roleOf(found.source)),
      box: (found.source.box ?? [0, 0, 0, 0]) as [number, number, number, number],
      index: Math.max(0, at),
      states: statesOf(found.source),
      /*
       * The same bag the snapshot node carries (T12.3, SF-23).
       *
       * `ax` and `uia` both spread their node's `native` into the description,
       * and every caller that wants the application's own id for an element
       * reads it from there — `describe(ref).native.automationId` is how the
       * desktop healing cases check that a relocalization landed on the element
       * that was recorded, rather than on one that merely scored well. This
       * adapter put the id in `attrs` only, so that check compared the key with
       * `undefined` and the Linux gate's two healing cases failed at the last
       * step, having relocalized correctly.
       */
      native: {
        atspiRole: found.source.role,
        ...(found.source.automationId === undefined
          ? {}
          : { automationId: found.source.automationId }),
      },
    };
  }

  async screenshot(): Promise<void> {
    /*
     * `capabilities().screenshot` is false and this is the same answer said
     * again, because a caller that ignores the capability deserves a sentence
     * rather than a zero-byte file.
     */
    throw new UnsupportedError(
      "This adapter takes no screenshots: a picture of a Linux desktop is a compositor " +
        "question, and Wayland does not answer it to an ordinary client.",
      { adapter: ADAPTER },
    );
  }

  async state(): Promise<SessionState> {
    return {
      kind: this.kind,
      ...(this.title === undefined ? {} : { windowTitle: this.title }),
    } as SessionState;
  }

  async restore(): Promise<void> {
    // `capabilities().restore` is false; unsupported rather than a lost session (SF-11).
    throw new UnsupportedError(
      "An AT-SPI session cannot be restored: it attaches to an application somebody else is " +
        "running, and where that application is now is its own business.",
      { adapter: ADAPTER },
    );
  }
}

/** For a caller that wants to know before it opens one. */
export async function atspiAvailability(
  bridge: AtspiBridge = pythonBridge(),
): Promise<{ available: boolean; reason?: string }> {
  const answer = await bridge.availability();
  return answer.available
    ? { available: true }
    : { available: false, reason: answer.reason ?? "The accessibility bus is not reachable." };
}

export function createAtspiSurface(config: Config): AtspiSurface {
  const application = (config as { app?: { processName?: string } }).app?.processName;
  const timeoutMs = (config as { run?: { stepTimeoutMs?: number } }).run?.stepTimeoutMs;
  return new AtspiSurface({
    ...(application === undefined ? {} : { application }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

export type { AtspiNode };
