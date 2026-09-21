/**
 * The BiDi session: contexts, refs, evaluation and actionability (T4.1, LLD §7.3).
 *
 * Everything between the wire (`client.ts`) and the surface (`surface.ts`).
 * `surface.ts` is a table of actions; this is what those actions are written in.
 */
import type { Ref } from "@svatah/yam-schema";
import { ActionabilityError, LocateError, SessionError, TimeoutError } from "@svatah/yam-surface";
import type { BidiClient } from "./client.js";
import {
  actionabilityOf,
  describeElement,
  locateInPage,
  walkDocument,
  HANDLES,
  REGISTRY,
  type Actionability,
  type RawCandidate,
  type RawDescription,
  type RawNode,
} from "@svatah/yam-page-script";

/** A BiDi browsing context id: a top-level tab, or a frame inside one. */
export type ContextId = string;

/** A value BiDi will accept as a `script.callFunction` argument. */
type LocalValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "null" }
  | { type: "undefined" }
  | { type: "array"; value: LocalValue[] }
  | { type: "object"; value: Array<[LocalValue, LocalValue]> };

/** Turn a plain JSON value into BiDi's tagged `LocalValue` form. */
export function toLocalValue(value: unknown): LocalValue {
  if (value === null) return { type: "null" };
  if (value === undefined) return { type: "undefined" };
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "number") return { type: "number", value };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (Array.isArray(value)) return { type: "array", value: value.map(toLocalValue) };
  return {
    type: "object",
    value: Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      { type: "string", value: k } as LocalValue,
      toLocalValue(v),
    ]),
  };
}

/** Turn BiDi's tagged `RemoteValue` back into a plain JSON value. */
export function fromRemoteValue(remote: unknown): unknown {
  if (remote === null || typeof remote !== "object") return remote;
  const value = remote as { type?: string; value?: unknown };
  switch (value.type) {
    case "undefined":
      return undefined;
    case "null":
      return null;
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return value.value;
    case "array":
    case "set":
      return (value.value as unknown[]).map(fromRemoteValue);
    case "object":
    case "map": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of (value.value ?? []) as Array<[unknown, unknown]>) {
        out[String(fromRemoteValue(k))] = fromRemoteValue(v);
      }
      return out;
    }
    default:
      return value.value;
  }
}

/** A dialog the browser opened and has not yet been answered. */
export interface OpenPrompt {
  readonly context: ContextId;
  readonly type: string;
  readonly message: string;
  readonly defaultValue?: string;
}

/**
 * Everything `snapshot`, `locate`, `describe` and `act` need to turn a `Ref`
 * back into an element.
 *
 * Two in-page arrays, mirroring the Playwright adapter's two ref kinds:
 * `rN` indexes the walker's registry, which every snapshot replaces, and `hN`
 * indexes the handles `locate()` minted, which survive until navigation. Keeping
 * them apart is what stops a resolved binding from silently pointing at whatever
 * a later snapshot put at that index.
 */
export class RefSpace {
  constructor(
    readonly testIdAttributes: readonly string[],
    readonly ignoreAttributes: readonly string[],
  ) {}

  /** `["handle" | "registry", index]` for a ref, or a `LocateError`. */
  static decode(ref: Ref): { from: "handle" | "registry"; index: number } {
    const digits = ref.slice(1);
    // `Number("")` is 0, so a bare "r" would otherwise decode to index 0 and act
    // on whatever the walk put first — silently, on the wrong element.
    const index = /^\d+$/.test(digits) ? Number(digits) : Number.NaN;
    if ((ref[0] !== "r" && ref[0] !== "h") || !Number.isInteger(index) || index < 0) {
      throw new LocateError(`"${ref}" is not a reference this adapter issued.`, {
        adapter: "bidi",
      });
    }
    return { from: ref[0] === "h" ? "handle" : "registry", index };
  }
}

export interface EvaluateOptions {
  /** Which context the function runs in; the session's active one by default. */
  readonly context?: ContextId;
  /** Ask BiDi to keep a handle on the result, for a node we will act on. */
  readonly ownership?: "root" | "none";
}

/**
 * One open BiDi session: the client, the contexts it knows about, and the
 * in-page helpers.
 */
/**
 * What an already-created session says it is (Draft 2.6, LLD §7.3).
 *
 * "It learns the browser from `session.status`." That command is answerable
 * whether or not a session exists, which is exactly why the spec names it: it
 * is the one question the adapter can ask an endpoint it did not create.
 *
 * What it gets back is less than `session.new` would have given. chromedriver
 * answers `{ ready: false, message: "already connected", build: { version },
 * os: {…} }` — a build string and no browser name, because there is no field
 * for one. So the name is reported when a driver offers it and the version
 * always, rather than a name being invented: a conformance report that said
 * "chrome" because the URL had a port number in the nine thousands would be a
 * report making things up.
 */
async function describeHostedSession(
  client: BidiClient,
): Promise<{ browserName?: string; browserVersion?: string }> {
  const status = (await client.call("session.status", {})) as {
    build?: { version?: string; browserName?: string };
    browserName?: string;
    os?: { name?: string };
  };

  const browserName = status.build?.browserName ?? status.browserName;
  const browserVersion = status.build?.version;
  return {
    ...(browserName === undefined ? {} : { browserName }),
    ...(browserVersion === undefined ? {} : { browserVersion }),
  };
}

export class BidiSession {
  /** Top-level contexts, in the order the browser reported or created them. */
  windows: ContextId[] = [];
  /** Index into `windows` of the one actions apply to. */
  activeWindow = 0;
  /** A frame inside the active window, when `switchFrame` narrowed to one. */
  activeFrame: ContextId | undefined;
  /** Dialogs seen, newest last; `check("present", "dialog")` reads the last. */
  readonly dialogs: Array<{ type: string; message: string }> = [];
  /** How the next dialog is answered; set by `act("dialog", …)`. */
  dialogPolicy: { accept: boolean; promptText?: string } | undefined;
  /**
   * The chain of `browsingContext.handleUserPrompt` calls, so an action can
   * wait for a dialog it opened to have been *answered* (T7.3).
   *
   * The prompt handler cannot `await` — it runs on the event stream — so it used
   * to fire the answer off with `void` and return. That is fine until something
   * reads the page straight afterwards: the conformance case clicks a confirm
   * and reads what the page recorded, and read the value from *before* the
   * confirm was answered. The same shape as the navigation problem below, and
   * it gets the same treatment.
   *
   * Chained rather than replaced, so two prompts in a row both complete.
   */
  private promptHandling: Promise<void> = Promise.resolve();
  /**
   * Navigations started, per top-level context.
   *
   * BiDi actions return as soon as the browser has *dispatched* them, so a click
   * on a link comes back before the new document exists — the conformance suite
   * reads the URL straight afterwards and would see the old one. Counting
   * `navigationStarted` events is how an action can tell whether it navigated
   * without guessing from the URL, which is the thing that changes last.
   */
  private readonly navigations = new Map<ContextId, number>();
  /**
   * Navigations started and not yet finished, per context.
   *
   * `navigationStarted` says a navigation began; `load`, `navigationFailed` and
   * `navigationAborted` say it ended. Waiting on `document.readyState` alone is
   * not enough for a history traversal: Gecko puts a fresh `about:blank` in
   * place *first* and that document is `complete` immediately, so a caller that
   * only watched readyState would resolve its next locator against a blank page.
   */
  private readonly inFlight = new Map<ContextId, Set<string>>();

  private constructor(
    readonly client: BidiClient,
    readonly refs: RefSpace,
    readonly timeoutMs: number,
  ) {}

  /** What `session.new` said it is: `firefox 153.0`, `chrome 152.0.…`. */
  describedBrowser = "an unidentified browser";

  static async open(
    client: BidiClient,
    options: {
      testIdAttributes: readonly string[];
      ignoreAttributes: readonly string[];
      timeoutMs: number;
      /**
       * The endpoint is a session someone already created (Draft 2.6, LLD §7.3).
       *
       * chromedriver and msedgedriver expose `…/session/<id>` after a classic
       * session is created with `webSocketUrl: true` — the documented route to
       * stock Chrome and Edge. Sending `session.new` there is answered with
       * `session not created: session already exists`, and it was the adapter's
       * first message, so the README's own commands failed on contact.
       */
      readonly hosted?: boolean;
      /**
       * How long each opening command may take, when that is not the client's
       * command timeout: a browser this adapter just launched is still starting.
       *
       * Firefox prints that it is listening before its first window's content
       * process is up, and the first `session.subscribe` waits for it. Here that
       * is a tenth of a second against a millisecond for each subscription
       * after it; on the Windows runner it was more than the thirty-second
       * command timeout, once in fifteen launches, and the next launch took
       * twenty-three seconds and passed. That is the browser's startup, so it is
       * spent from the startup budget.
       */
      readonly setupTimeoutMs?: number;
    },
  ): Promise<BidiSession> {
    const setup = options.setupTimeoutMs === undefined ? {} : { timeoutMs: options.setupTimeoutMs };
    /*
     * Create a session, or attach to one (Draft 2.6, LLD §7.3).
     *
     * Both shapes end up in the same place: a client that can subscribe, walk
     * the context tree and drive the browser. What differs is the first message
     * and where the browser's name comes from — `session.new`'s capabilities
     * when we made it, `session.status`'s build when we did not.
     */
    const created = options.hosted === true
      ? { capabilities: await describeHostedSession(client) }
      : ((await client.call("session.new", {
          capabilities: {
            /*
             * `unhandledPromptBehavior: "ignore"` — without it this adapter
             * cannot accept a dialog at all (T7.3).
             *
             * WebDriver's default is *dismiss and notify*: the browser answers
             * the prompt itself the moment it opens and then tells us about it,
             * so `browsingContext.handleUserPrompt` arrives after the dialog is
             * already gone. Measured against the sample `/widgets` page, every
             * confirm reported `dismissed` — including the ones the flow said to
             * accept — which is the same *symptom* as P6-F4 from a completely
             * different cause, and would have been invisible until someone
             * wrote a flow that depended on accepting one.
             *
             * `ignore` leaves the prompt open and makes answering it this
             * adapter's job, which is what the surface contract already says it
             * is (LLD §7.3, §3.2).
             */
            alwaysMatch: { unhandledPromptBehavior: "ignore" },
          },
        }, setup)) as {
          capabilities?: { browserName?: string; browserVersion?: string };
        });
    const session = new BidiSession(
      client,
      new RefSpace(options.testIdAttributes, options.ignoreAttributes),
      options.timeoutMs,
    );

    /*
     * Dialogs are answered from an event handler rather than polled for, because
     * a native prompt blocks the page: a `click` that opens an `alert` does not
     * return until something dismisses it, so a policy applied afterwards would
     * apply after a deadlock.
     */
    /*
     * One `session.subscribe` per event, not one call listing them all.
     *
     * BiDi is a moving standard and browsers implement different parts of it:
     * Gecko has no `browsingContext.navigationAborted`, and a single call naming
     * it is refused *whole* — every subscription in it, including the dialog one
     * the adapter cannot work without. Subscribing one at a time means a browser
     * that lacks an event loses that event and nothing else, which is what
     * "drives stock Chrome, Edge and Firefox" has to mean in practice.
     */
    const REQUIRED = [
      "browsingContext.userPromptOpened",
      "browsingContext.contextCreated",
      "browsingContext.contextDestroyed",
      "browsingContext.navigationStarted",
      "browsingContext.load",
    ];
    const OPTIONAL = ["browsingContext.navigationFailed", "browsingContext.navigationAborted"];

    for (const event of REQUIRED) await client.call("session.subscribe", { events: [event] }, setup);
    for (const event of OPTIONAL) {
      await client.call("session.subscribe", { events: [event] }, setup).catch(() => undefined);
    }

    client.on((event) => session.onEvent(event.method, event.params));

    /*
     * What the browser calls itself, rather than where its binary is. A
     * conformance report is committed, and a report that recorded an absolute
     * path would record whose machine ran it (LLD §16's hygiene rule).
     */
    const name = created.capabilities?.browserName;
    const version = created.capabilities?.browserVersion;
    if (name !== undefined) {
      session.describedBrowser = version === undefined ? name : `${name} ${version}`;
    } else if (version !== undefined) {
      // An attached driver session: `session.status` gave a build and no name.
      // The build is what the report can honestly record.
      session.describedBrowser = `a WebDriver BiDi browser, build ${version}`;
    }

    const tree = (await client.call("browsingContext.getTree", {}, setup)) as {
      contexts?: Array<{ context: string }>;
    };
    session.windows = (tree.contexts ?? []).map((c) => c.context);
    if (session.windows.length === 0) {
      const created = (await client.call("browsingContext.create", { type: "tab" }, setup)) as {
        context: string;
      };
      session.windows = [created.context];
    }
    return session;
  }

  /** The context an action applies to: the active frame, else the active window. */
  context(): ContextId {
    const window = this.windows[this.activeWindow];
    if (window === undefined) {
      throw new SessionError("The BiDi session has no open window.", { adapter: "bidi" });
    }
    return this.activeFrame ?? window;
  }

  /** The active *top-level* context, ignoring any frame narrowing. */
  window(): ContextId {
    const window = this.windows[this.activeWindow];
    if (window === undefined) {
      throw new SessionError("The BiDi session has no open window.", { adapter: "bidi" });
    }
    return window;
  }

  private onEvent(method: string, params: Record<string, unknown>): void {
    if (method === "browsingContext.userPromptOpened") {
      const context = String(params["context"] ?? "");
      const type = String(params["type"] ?? "alert");
      const message = String(params["message"] ?? "");
      this.dialogs.push({ type, message });
      const policy = this.dialogPolicy ?? { accept: true };
      this.promptHandling = this.promptHandling.then(async () => {
        await this.client
          .send("browsingContext.handleUserPrompt", {
            context,
            accept: policy.accept,
            ...(policy.promptText === undefined ? {} : { userText: policy.promptText }),
          })
          .catch(() => undefined);
      });
      return;
    }
    if (method === "browsingContext.contextCreated") {
      const context = String(params["context"] ?? "");
      // Only top-level contexts are windows; a frame has a parent and is reached
      // through `switchFrame` instead.
      if (params["parent"] == null && context !== "" && !this.windows.includes(context)) {
        this.windows.push(context);
      }
      return;
    }
    if (method === "browsingContext.navigationStarted") {
      const context = String(params["context"] ?? "");
      const navigation = String(params["navigation"] ?? "");
      this.navigations.set(context, (this.navigations.get(context) ?? 0) + 1);
      const set = this.inFlight.get(context) ?? new Set<string>();
      set.add(navigation);
      this.inFlight.set(context, set);
      return;
    }
    if (
      method === "browsingContext.load" ||
      method === "browsingContext.navigationFailed" ||
      method === "browsingContext.navigationAborted"
    ) {
      const context = String(params["context"] ?? "");
      this.inFlight.get(context)?.delete(String(params["navigation"] ?? ""));
      return;
    }
    if (method === "browsingContext.contextDestroyed") {
      const context = String(params["context"] ?? "");
      const at = this.windows.indexOf(context);
      if (at < 0) return;
      this.windows.splice(at, 1);
      if (this.activeWindow >= this.windows.length) this.activeWindow = Math.max(0, this.windows.length - 1);
      if (this.activeFrame === context) this.activeFrame = undefined;
    }
  }

  /* ── navigation ───────────────────────────────────────────────────────── */

  /** How many navigations the active window has started so far. */
  navigationCount(): number {
    return this.navigations.get(this.window()) ?? 0;
  }

  /** Whether a navigation the active window started has not finished. */
  private navigating(): boolean {
    return (this.inFlight.get(this.window())?.size ?? 0) > 0;
  }

  /**
   * After an action, settle the page if the action navigated (LLD §7.3).
   *
   * `before` is `navigationCount()` read just before the action. If nothing
   * started within the grace period, nothing navigated and this returns at once —
   * which is the common case, and must stay cheap. If something did, the wait is
   * for the new document to finish, so the next `read("url")` or `locate()` sees
   * it rather than the one that is being torn down.
   *
   * The grace period is what makes this reliable rather than racy: a click that
   * navigates does not do so in the same task, so checking once immediately
   * afterwards would always see zero.
   */
  /**
   * Wait for any dialog this action opened to have been answered (T7.3).
   *
   * Free where it is used: every caller has just been through
   * `settleIfNavigated`, whose grace period is far longer than the round trip
   * of a `userPromptOpened` event, so by the time this is reached the answer is
   * either already sent or already queued. Awaiting the chain is what makes the
   * next `read` see a page that has been told.
   */
  async settlePrompts(): Promise<void> {
    await this.promptHandling;
  }

  async settleIfNavigated(before: number, timeoutMs: number, graceMs = 400): Promise<boolean> {
    const deadline = Date.now() + graceMs;
    while (this.navigationCount() === before && Date.now() < deadline) await sleep(20);
    if (this.navigationCount() === before) return false;

    this.activeFrame = undefined;
    await this.waitFor(
      async () =>
        !this.navigating() &&
        (await this.evaluate("document.readyState").catch(() => "loading")) === "complete",
      timeoutMs,
      "the new document to finish loading",
    ).catch(() => undefined);
    return true;
  }

  /* ── evaluation ───────────────────────────────────────────────────────── */

  /**
   * Call a function in the page and get its return value as plain JSON.
   *
   * The function is serialised to its source, so it must be self-contained —
   * which is exactly the constraint `@svatah/yam-page-script` is written under.
   */
  async callFunction<T>(
    fn: (...args: never[]) => T,
    args: unknown[] = [],
    options: EvaluateOptions = {},
  ): Promise<T> {
    const result = (await this.client.call("script.callFunction", {
      functionDeclaration: fn.toString(),
      arguments: args.map(toLocalValue),
      target: { context: options.context ?? this.context() },
      awaitPromise: true,
      ...(options.ownership === undefined ? {} : { resultOwnership: options.ownership }),
      // The walker returns a deep tree; BiDi truncates at depth 1 unless asked.
      serializationOptions: { maxObjectDepth: 20, maxDomDepth: 0 },
    })) as { type?: string; result?: unknown; exceptionDetails?: { text?: string } };

    if (result.type === "exception") {
      throw new ActionabilityError(
        `A script in the page threw: ${result.exceptionDetails?.text ?? "unknown error"}`,
        { adapter: "bidi" },
      );
    }
    return fromRemoteValue(result.result) as T;
  }

  /**
   * Give the top-level context a viewport (pattern 33, T12.7).
   *
   * `browsingContext.setViewport` on the *top-level* context, because a frame
   * has no viewport of its own: the session's active context may be a frame,
   * and asking a frame to resize is a protocol error rather than a no-op.
   */
  async setViewport(width: number, height: number): Promise<void> {
    await this.client.call("browsingContext.setViewport", {
      context: this.window(),
      viewport: { width, height },
    });
  }

  /** Evaluate an expression and get its value as plain JSON. */
  async evaluate(expression: string, options: EvaluateOptions = {}): Promise<unknown> {
    const result = (await this.client.call("script.evaluate", {
      expression,
      target: { context: options.context ?? this.context() },
      awaitPromise: true,
      serializationOptions: { maxObjectDepth: 20, maxDomDepth: 0 },
    })) as { type?: string; result?: unknown; exceptionDetails?: { text?: string } };
    if (result.type === "exception") {
      throw new ActionabilityError(
        `A script in the page threw: ${result.exceptionDetails?.text ?? "unknown error"}`,
        { adapter: "bidi" },
      );
    }
    return fromRemoteValue(result.result);
  }

  /* ── refs ─────────────────────────────────────────────────────────────── */

  /** The whole normalised node list for the active context (LLD §2.2). */
  async walk(options: { maxNodes: number; interactiveOnly: boolean; root?: Ref }): Promise<RawNode[]> {
    const rootIndex =
      options.root === undefined || options.root[0] !== "r" ? null : Number(options.root.slice(1));
    return await this.callFunction(walkDocument as never, [
      {
        registry: REGISTRY,
        maxNodes: options.maxNodes,
        interactiveOnly: options.interactiveOnly,
        testIdAttributes: [...this.refs.testIdAttributes],
        ignoreAttributes: [...this.refs.ignoreAttributes],
        rootIndex: Number.isInteger(rootIndex) ? rootIndex : null,
      },
    ]);
  }

  /** Candidate → refs, minting an `hN` for each match (LLD §6.3). */
  async locate(candidate: RawCandidate): Promise<Ref[]> {
    const indices = await this.callFunction<number[]>(locateInPage as never, [
      { handles: HANDLES, candidate, testIdAttributes: [...this.refs.testIdAttributes] },
    ]);
    return indices.map((index) => `h${index}`);
  }

  /**
   * Everything synthesis and fingerprinting read from one element (LLD §3.3).
   *
   * The element goes across as a BiDi *node reference* — the `sharedId` the
   * protocol mints — rather than as an index the page looks up. `describeElement`
   * is then the `functionDeclaration` itself, with the element as its first
   * argument, which is how it stays the same self-contained function the
   * Playwright adapter evaluates rather than a string a wrapper rebuilds. It also
   * means no `new Function` in the page, which a strict Content-Security-Policy
   * would refuse.
   */
  async describe(ref: Ref, neighbourCount: number): Promise<RawDescription> {
    const shared = await this.sharedId(ref);
    const result = (await this.client.call("script.callFunction", {
      functionDeclaration: describeElement.toString(),
      arguments: [
        { sharedId: shared },
        toLocalValue({
          testIdAttributes: [...this.refs.testIdAttributes],
          neighbourCount,
          ignoreAttributes: [...this.refs.ignoreAttributes],
        }),
      ],
      target: { context: this.context() },
      awaitPromise: false,
      serializationOptions: { maxObjectDepth: 20, maxDomDepth: 0 },
    })) as { type?: string; result?: unknown; exceptionDetails?: { text?: string } };

    if (result.type === "exception") {
      throw new ActionabilityError(
        `describe(${ref}) threw in the page: ${result.exceptionDetails?.text ?? "unknown error"}`,
        { adapter: "bidi" },
      );
    }
    return fromRemoteValue(result.result) as RawDescription;
  }

  /** The BiDi node reference for a ref, for `input.*` and `input.setFiles`. */
  async sharedId(ref: Ref): Promise<string> {
    const { from, index } = RefSpace.decode(ref);
    const result = (await this.client.call("script.callFunction", {
      functionDeclaration:
        "(handles, registry, from, index) => { " +
        "const win = document.defaultView; " +
        "const array = win[from === 'handle' ? handles : registry] || []; " +
        "return array[index] || null; }",
      arguments: [HANDLES, REGISTRY, from, index].map(toLocalValue),
      target: { context: this.context() },
      awaitPromise: false,
      serializationOptions: { maxDomDepth: 0 },
    })) as { result?: { type?: string; sharedId?: string } };

    const shared = result.result?.sharedId;
    if (shared === undefined) throw staleRef(ref);
    return shared;
  }

  /* ── actionability (LLD §7.3) ─────────────────────────────────────────── */

  /** What is true of an element right now. */
  async actionability(ref: Ref): Promise<Actionability> {
    const { from, index } = RefSpace.decode(ref);
    const state = await this.callFunction<Actionability | null>(actionabilityOf as never, [
      { handles: HANDLES, registry: REGISTRY, index, from },
    ]);
    if (state === null) throw staleRef(ref);
    return state;
  }

  /**
   * Wait until an element is actionable, or say why it is not (LLD §7.3).
   *
   * > wait for `visible && enabled && stable(box unchanged over two frames)`
   * > before `act`, with the configured timeout.
   *
   * Playwright has this built in; BiDi has no such notion, which is precisely
   * why the spec puts it in the adapter. Doing it here rather than above the
   * surface is what keeps every caller — resolver, executor, recorder — free of
   * "wait for the button to settle" code that would then have to be written once
   * per adapter anyway.
   */
  async waitActionable(ref: Ref, timeoutMs?: number): Promise<Actionability> {
    const deadline = Date.now() + (timeoutMs ?? this.timeoutMs);
    let previous: Actionability | undefined;

    for (;;) {
      const now = await this.actionability(ref);
      if (
        now.visible &&
        now.enabled &&
        previous !== undefined &&
        previous.box.every((n, i) => n === now.box[i])
      ) {
        return now;
      }
      previous = now;

      if (Date.now() >= deadline) {
        const why = !now.attached
          ? "it is no longer in the document"
          : !now.visible
            ? "it is not visible"
            : !now.enabled
              ? "it is disabled"
              : "its box is still moving";
        throw new ActionabilityError(
          `The element ${ref} did not become actionable: ${why} (LLD §7.3).`,
          { adapter: "bidi" },
        );
      }
      // One animation frame, roughly. Shorter would burn round trips; longer
      // would make a settled element wait for no reason.
      await sleep(16);
    }
  }

  /** Scroll an element into view, which every pointer action needs first. */
  async scrollIntoView(ref: Ref): Promise<void> {
    const { from, index } = RefSpace.decode(ref);
    await this.callFunction(
      ((input: { handles: string; registry: string; from: string; index: number }) => {
        const win = document.defaultView as unknown as Record<string, unknown>;
        const array = (win[input.from === "handle" ? input.handles : input.registry] ??
          []) as Element[];
        const el = array[input.index];
        if (el === undefined) return false;
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        return true;
      }) as never,
      [{ handles: HANDLES, registry: REGISTRY, from, index }],
    );
  }

  /** Wait for a condition, polling; used by `waitFor` and by navigation. */
  async waitFor(condition: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await condition()) return;
      if (Date.now() >= deadline) {
        throw new TimeoutError(`Timed out waiting for ${what}.`, { adapter: "bidi" });
      }
      await sleep(50);
    }
  }
}

export function staleRef(ref: Ref): LocateError {
  return new LocateError(
    `Reference "${ref}" no longer resolves to an element. References are stable within a ` +
      "snapshot and are lost on navigation — take a new snapshot (LLD §2.2).",
    { adapter: "bidi" },
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, ms);
    (timer as { unref?: () => void }).unref?.();
  });
}
