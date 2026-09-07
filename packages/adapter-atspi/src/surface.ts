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
  CheckError,
  DataError,
  LocateError,
  SessionError,
  buildSnapshot,
  structuralHash,
} from "@svatah/yam-surface";
import { pythonBridge, type AtspiBridge, type AtspiNode } from "./bridge.js";
import { actionFor, buildNodes, nameOf, roleOf, statesOf, valueOf, type BuiltNode } from "./tree.js";

const ADAPTER = "atspi";

export interface AtspiSurfaceOptions {
  readonly bridge?: AtspiBridge;
  /** The application whose window this session drives. */
  readonly application?: string;
}

export class AtspiSurface implements AgentSurface {
  readonly kind: SurfaceKind = "desktop";
  private readonly bridge: AtspiBridge;
  private application: string | undefined;
  private generation = 0;
  private nodes: BuiltNode[] = [];
  private title: string | undefined;

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

      case "click":
      case "doubleClick":
      case "setChecked":
      case "selectOption":
      case "hover":
      case "scrollIntoView": {
        const found = this.find(ref, action);
        const named = actionFor(action, found.source);
        if (named === undefined) {
          /*
           * Refused by name, with what the element *does* offer. AT-SPI names
           * actions per toolkit, so "this element has no click" is a fact about
           * the application rather than about the adapter, and a caller can only
           * act on it if it is told which actions there are.
           */
          throw new ActionabilityError(
            `"${nameOf(found.source) || found.node.role}" declares no action for ${action}. ` +
              `It offers: ${(found.source.actions ?? []).join(", ") || "none"}.`,
            { adapter: ADAPTER },
          );
        }
        await this.bridge.perform({ kind: "action", path: found.path, action: named });
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

      default:
        /*
         * The same refusal a desktop adapter has always given a web action
         * (REQ-SURF-5): a window has no URL to navigate and no tab to switch.
         */
        throw new DataError(
          `An AT-SPI session has no "${action}". It takes click, doubleClick, type, clear, ` +
            "press, focus, setChecked, selectOption, hover, scrollIntoView and sleep.",
          { adapter: ADAPTER },
        );
    }
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
      case "title":
        return this.title ?? "";
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
        throw new DataError(`An AT-SPI session cannot be read for "${kind}".`, {
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

    if (subject === "page" && (kind === "text" || kind === "textContains")) {
      const said = String(await this.read("text"));
      return answer(kind === "text" ? said === wanted : said.includes(wanted), said);
    }

    const found = ref === undefined ? undefined : this.find(ref, "check");
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
      default:
        throw new CheckError(`An AT-SPI session cannot answer the "${kind}" predicate.`, {
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
    };
  }

  async screenshot(): Promise<void> {
    /*
     * `capabilities().screenshot` is false and this is the same answer said
     * again, because a caller that ignores the capability deserves a sentence
     * rather than a zero-byte file.
     */
    throw new DataError(
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
    throw new SessionError(
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
  return new AtspiSurface(application === undefined ? {} : { application });
}

export type { AtspiNode };
