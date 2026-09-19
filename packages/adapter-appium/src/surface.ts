/**
 * The Appium adapter: `AgentSurface` on Android and iOS (T4.2, LLD §7.4, REQ-ADP-5).
 *
 * One session, two worlds. Inside a **webview** the device is a browser and every
 * web candidate kind means what it means anywhere else; inside the **native app**
 * there is no DOM, and a screen is an XML page source that `page-source.ts`
 * converts into the same snapshot shape a web page produces (REQ-SURF-4). The
 * caller above the surface does not know which of the two it is in, which is the
 * point of the surface being a boundary at all.
 *
 * References are `rN` — an index into the snapshot most recently taken — exactly
 * as on the web adapters, because a native page source is a *snapshot* in the
 * literal sense: there is nothing to hold on to between queries, so a reference
 * has to be an index into the picture that was taken. `hN` refs come from
 * `locate()` and hold a protocol element id, which the driver does keep alive.
 */
import { writeFileSync } from "node:fs";
import type {
  ActArgs,
  ActResult,
  Candidate,
  Capabilities,
  CheckResult,
  CheckSubject,
  Config,
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
import { DEFAULT_IGNORE_ATTRIBUTES } from "@svatah/yam-schema";
import type { AgentSurface } from "@svatah/yam-surface";
import {
  ActionabilityError,
  buildSnapshot,
  DataError,
  LocateError,
  NavigationError,
  ScriptError,
  SessionError,
  structuralHash,
  TimeoutError,
  UnsupportedError,
  waitForPage,
  type SnapshotNode,
} from "@svatah/yam-surface";
import {
  appiumServerUrl,
  capabilitiesFromEnv,
  connectWebdriverIo,
  type AppiumClient,
  type ElementId,
} from "./client.js";
import { isNativeContext, strategyFor } from "./locate.js";
import {
  boxOf,
  convertPageSource,
  nameOf,
  parsePageSource,
  roleOf,
  statesOf,
  valueOf,
  xpathOf,
  type ConvertedNode,
  type SourceNode,
} from "./page-source.js";
import { evaluateAppiumPredicate } from "./predicates.js";

const DEFAULT_MAX_NODES = 1_000;

/**
 * WebDriver's codepoint for the Enter key.
 *
 * On a phone this is the IME's action key — "Search", "Go", "Done" — which is
 * why `submit` and `press "Enter"` are the same gesture here and different ones
 * on a desktop.
 */
const ENTER = "\uE007";

/**
 * The named keys a flow sends, as the WebDriver codepoints a key action takes.
 *
 * A W3C key action's `value` is one key: a single character, or a codepoint in
 * the private-use range the spec assigns to named keys. `press "Tab"` sent the
 * three characters `Tab` as that value, which a driver rejects as an invalid
 * argument — or, worse, types. A small table of its own rather than an import
 * from the BiDi adapter: an adapter depends on the surface and the schema, not
 * on another adapter.
 */
const W3C_KEYS: Readonly<Record<string, string>> = {
  enter: ENTER,
  tab: "\uE004",
  escape: "\uE00C",
  backspace: "\uE003",
  delete: "\uE017",
  arrowup: "\uE013",
  arrowdown: "\uE015",
  arrowleft: "\uE012",
  arrowright: "\uE014",
  home: "\uE011",
  end: "\uE010",
  pageup: "\uE00E",
  pagedown: "\uE00F",
  space: "\uE00D",
};

/** What a key action sends for a key name: the character itself, or its codepoint. */
function w3cKeyFor(key: string): string {
  if ([...key].length === 1) return key;
  const named = W3C_KEYS[key.toLowerCase()];
  if (named === undefined) {
    throw new UnsupportedError(
      `The Appium adapter cannot press "${key}": a key action sends one character or one named ` +
        "key, and it knows Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, " +
        "ArrowRight, Home, End, PageUp, PageDown and Space.",
      { adapter: "appium" },
    );
  }
  return named;
}

/**
 * How many swipes a native `scrollIntoView` makes before it says the element
 * cannot be brought on screen.
 *
 * Each swipe moves at most four tenths of the screen, so eight is three screens
 * of travel — more than a form or a settings page needs, and few enough that a
 * list which is not going to produce the element fails while someone is still
 * looking at it.
 */
const MAX_SCROLL_SWIPES = 8;

/** The W3C element reference, which is how an element crosses into a script. */
const W3C_ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

/**
 * What this adapter can do (LLD §2.4).
 *
 * A phone has no windows in the desktop sense and no native `<iframe>`s: Appium
 * has *contexts*, and switching to a webview is `switchContext`, not
 * `switchFrame`. Declaring `frames` and `windows` false is what makes the
 * executor refuse such a plan at start rather than fail halfway through it
 * (LLD §2.4) — and `switchFrame` is still implemented for a webview context,
 * where an iframe genuinely exists.
 */
export const APPIUM_CAPABILITIES: Capabilities = {
  dialogs: false,
  frames: false,
  windows: false,
  upload: false,
  drag: true,
  trace: false,
  webmcp: false,
  pick: false,
  observe: false,
  screenshot: true,
  restore: true,
};

export interface AppiumAdapterOptions {
  /** Where the Appium server is; `YAM_APPIUM_URL`, else localhost:4723. */
  serverUrl?: string;
  /** W3C capabilities, `appium:`-prefixed. Merged under `YAM_APPIUM_CAPS`. */
  capabilities?: Readonly<Record<string, unknown>>;
  timeoutMs?: number;
  testIdAttributes?: readonly string[];
  ignoreAttributes?: readonly string[];
  maxNodes?: number;
  /** Injected by the tests, so the whole adapter is exercisable without a device. */
  connect?: () => Promise<AppiumClient>;
}

export class AppiumSurface implements AgentSurface {
  readonly kind: SurfaceKind = "mobile";

  private client: AppiumClient | undefined;
  private context = "NATIVE_APP";
  private baseUrl: string | undefined;
  /** The nodes of the most recent snapshot; `rN` indexes this. */
  private nodes: ConvertedNode[] = [];
  /** Element ids minted by `locate()`; `hN` indexes this. */
  private handles: ElementId[] = [];

  constructor(private readonly options: AppiumAdapterOptions = {}) {}

  capabilities(): Capabilities {
    return { ...APPIUM_CAPABILITIES };
  }

  /** Where the session is talking, for a report. */
  server(): string {
    return appiumServerUrl(this.options.serverUrl);
  }

  async open(session: SessionInit): Promise<void> {
    const capabilities = {
      ...(this.options.capabilities ?? {}),
      ...capabilitiesFromEnv(),
    };
    this.baseUrl = session.baseUrl;

    this.client =
      this.options.connect !== undefined
        ? await this.options.connect()
        : await connectWebdriverIo({
            ...(this.options.serverUrl === undefined ? {} : { serverUrl: this.options.serverUrl }),
            capabilities,
          });

    this.context = await this.live().getContext();
    /*
     * Android Chrome is a webview context, and a session started against it opens
     * in `NATIVE_APP` regardless (LLD §7.4). Switching when the capabilities
     * asked for a browser is what makes `yam run --adapter appium` against a
     * mobile browser behave like `--adapter playwright` does.
     */
    if (capabilities["browserName"] !== undefined && isNativeContext(this.context)) {
      await this.switchToWebview();
    }
    if (session.baseUrl !== undefined && !isNativeContext(this.context)) {
      await this.live().navigateTo(session.baseUrl);
    }
  }

  async close(): Promise<void> {
    await this.client?.deleteSession().catch(() => undefined);
    this.client = undefined;
    this.nodes = [];
    this.handles = [];
  }

  private live(): AppiumClient {
    if (this.client === undefined) {
      throw new SessionError("The Appium session is not open.", { adapter: "appium" });
    }
    return this.client;
  }

  private native(): boolean {
    return isNativeContext(this.context);
  }

  /** Switch to the first webview Appium reports, or say there is none. */
  private async switchToWebview(): Promise<void> {
    const contexts = await this.live().getContexts();
    const webview = contexts.find((name) => !isNativeContext(name));
    if (webview === undefined) {
      throw new SessionError(
        `The session has no webview context; Appium reports ${contexts.join(", ") || "(none)"}. ` +
          "A Chrome session needs `browserName: Chrome`; a hybrid app needs its webview to be " +
          "debuggable (`WebView.setWebContentsDebuggingEnabled(true)`).",
        { adapter: "appium" },
      );
    }
    await this.live().switchContext(webview);
    this.context = webview;
    this.invalidate();
  }

  /** A navigation or a context switch loses every reference (LLD §2.2). */
  private invalidate(): void {
    this.nodes = [];
    this.handles = [];
  }

  /* ── snapshot, locate, describe ─────────────────────────────────────────── */

  async snapshot(opts: { root?: Ref; maxNodes?: number; interactiveOnly?: boolean } = {}): Promise<Snapshot> {
    const source = parsePageSource(await this.live().getPageSource());
    const root = opts.root === undefined ? source : this.sourceFor(opts.root);

    this.nodes = convertPageSource(root, {
      maxNodes: opts.maxNodes ?? this.options.maxNodes ?? DEFAULT_MAX_NODES,
      interactiveOnly: opts.interactiveOnly === true,
      ignoreAttributes: this.options.ignoreAttributes ?? DEFAULT_IGNORE_ATTRIBUTES,
    });

    const nodes = this.nodes.map(({ path: _path, ...node }) => node) as SnapshotNode[];
    return buildSnapshot(opts.root ?? nodes[0]?.ref ?? "r0", nodes, structuralHash(nodes));
  }

  async locate(candidate: Candidate): Promise<Ref[]> {
    const strategy = strategyFor(candidate, this.context, this.testIdAttributes());
    const found = await this.live().findElements(strategy.using, strategy.value);
    const chosen = candidate.nth === undefined ? found : found.slice(candidate.nth, candidate.nth + 1);
    return chosen.map((id) => {
      const ref = `h${this.handles.length}`;
      this.handles.push(id);
      return ref;
    });
  }

  async describe(ref: Ref): Promise<ElementDescription> {
    if (ref.startsWith("r")) return this.describeFromSource(ref);

    /*
     * A `locate()` reference is a protocol element id and not a position in the
     * page source, so the description is read from the driver. That is more
     * round trips than reading the tree — but it is the only answer that is
     * about *this* element rather than about one that looks like it.
     */
    const id = this.handleFor(ref);
    const client = this.live();
    const attribute = async (name: string): Promise<string | undefined> =>
      (await client.getAttribute(id, name).catch(() => null)) ?? undefined;

    const rect = await client.getRect(id).catch(() => ({ x: 0, y: 0, width: 0, height: 0 }));
    const tag = (await attribute("class")) ?? (await attribute("type")) ?? "unknown";
    const attrs: Record<string, string> = {};
    for (const name of NATIVE_ATTRIBUTES) {
      const value = await attribute(name);
      if (value !== undefined && value !== "" && !this.ignored().has(name.toLowerCase())) {
        attrs[name] = value;
      }
    }
    const text = (await client.getText(id).catch(() => "")).replace(/\s+/g, " ").trim();
    const pseudo: SourceNode = { tag, attrs, children: [] };

    return {
      ref,
      role: roleOf(pseudo),
      ...(nameOf(pseudo) === "" ? {} : { name: nameOf(pseudo) }),
      ...(valueOf(pseudo) === undefined ? {} : { value: valueOf(pseudo)! }),
      tag,
      attrs,
      text,
      // A driver-side element has no siblings to read without another page
      // source, and a description that guessed at them would be worse than one
      // that says it has none.
      neighbours: { before: [], after: [] },
      rolePath: [],
      box: [rect.x, rect.y, rect.width, rect.height],
      index: 0,
      states: statesOf(pseudo),
      native: { ...attrs, class: tag },
    };
  }

  /** A `describe` answered from the snapshot, which knows the whole tree. */
  private describeFromSource(ref: Ref): ElementDescription {
    const node = this.nodeFor(ref);
    const path = node.path;
    const element = path[path.length - 1]!;
    const parent = path[path.length - 2];

    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(element.attrs)) {
      if (this.ignored().has(key.toLowerCase()) || value === "") continue;
      attrs[key] = value;
    }

    const siblings = parent?.children ?? [];
    const at = siblings.indexOf(element);
    const textOf = (one: SourceNode): string => nameOf(one) || (one.attrs["text"] ?? "");
    const before = siblings.slice(Math.max(0, at - 3), at).map(textOf).filter((t) => t !== "");
    const after = siblings.slice(at + 1, at + 4).map(textOf).filter((t) => t !== "");

    const role = roleOf(element);
    let index = 0;
    for (const sibling of siblings) {
      if (sibling === element) break;
      if (roleOf(sibling) === role) index += 1;
    }

    return {
      ref,
      role,
      ...(node.name === undefined ? {} : { name: node.name }),
      ...(node.value === undefined ? {} : { value: node.value }),
      tag: element.tag,
      attrs,
      text: (element.attrs["text"] ?? nameOf(element)).replace(/\s+/g, " ").trim(),
      neighbours: { before, after },
      rolePath: path.slice(0, -1).map(roleOf).filter((r) => r !== "generic"),
      box: node.box ?? [0, 0, 0, 0],
      index,
      states: node.states,
      native: { ...(node.native ?? {}), xpath: xpathOf(path) },
    };
  }

  /* ── act ────────────────────────────────────────────────────────────────── */

  async act(action: SurfaceAction, ref?: Ref, args: ActArgs = {}, ref2?: Ref): Promise<ActResult> {
    const client = this.live();
    const need = (which: Ref | undefined): Ref => {
      if (which === undefined) {
        throw new LocateError(`The "${action}" action needs a reference.`, { adapter: "appium" });
      }
      return which;
    };
    const str = (name: string, fallback?: string): string => {
      const value = args[name];
      if (value === undefined) {
        if (fallback !== undefined) return fallback;
        throw new ScriptError(`The "${action}" action needs an argument "${name}".`, {
          adapter: "appium",
        });
      }
      return Array.isArray(value) ? value.join(",") : String(value);
    };

    switch (action) {
      case "navigate": {
        /*
         * Unsupported in this context, not a navigation that failed (SF-11). No
         * wait makes a native screen take a URL, nothing was dispatched, and a
         * `NavigationError` is told to a caller as `CONNECT_FAILED` — about a
         * device that is connected and fine. The message says which context can.
         */
        if (this.native()) {
          throw new UnsupportedError(
            'A native context has no URL to navigate to. Switch to a webview first ("switchFrame" ' +
              'with name "webview"), or start the session with `browserName`.',
            { adapter: "appium" },
          );
        }
        const url = str("url");
        const absolute =
          /^[a-z][a-z0-9+.-]*:/i.test(url) || this.baseUrl === undefined
            ? url
            : new URL(url, this.baseUrl).toString();
        await client.navigateTo(absolute);
        this.invalidate();
        return { ok: true, navigated: true };
      }
      case "back":
        await client.back();
        this.invalidate();
        return { ok: true, navigated: true };
      case "forward":
        await client.forward();
        this.invalidate();
        return { ok: true, navigated: true };
      case "refresh":
        await client.refresh();
        this.invalidate();
        return { ok: true, navigated: true };

      /*
       * A phone has no pointer to rest over anything (SF-11).
       *
       * `hover` used to be a tap, which is not a gesture without an effect: it
       * presses whatever it lands on, so "move to the menu" opened the menu, or
       * followed the link, before the step that was meant to. Refused instead,
       * and before the reference is resolved, because no element makes it
       * possible.
       */
      case "hover":
        throw new UnsupportedError(
          "A touch screen has no hover: there is no pointer to rest over an element, and a tap " +
            "in its place would press it. Tap the element if pressing it is what is meant.",
          { adapter: "appium" },
        );

      /*
       * `hoverAndClick` stays a tap. Its meaning is the click — "move to the
       * element and click it" — and the move is how a desktop pointer gets
       * there; on a touch screen the tap arrives at the element directly, so
       * the one gesture a phone has is the whole of what was asked.
       */
      case "click":
      case "doubleClick":
      case "hoverAndClick": {
        const id = await this.elementFor(need(ref));
        await client.click(id);
        if (action === "doubleClick") await client.click(id);
        // A tap navigates on a phone as often as it does on a page; whatever the
        // caller reads next has to come from a fresh look at the screen.
        this.invalidate();
        return { ok: true, ref };
      }
      /*
       * Nothing is held to release (SF-11). `pressAndHold` here is a whole long
       * press — down, pause, up — because a W3C action sequence ends with its
       * pointer lifted, so no press survives the call that made it. `release`
       * used to send its own down and up, which is a tap: a second press on the
       * element rather than the end of the first.
       */
      case "release":
        throw new UnsupportedError(
          'There is no held press to release: "pressAndHold" on a touch screen is a complete ' +
            "long press, lifted when it ends, and a release sent now would be a tap.",
          { adapter: "appium" },
        );

      case "rightClick":
      case "pressAndHold":
      case "dragTo": {
        const id = await this.elementFor(need(ref));
        const rect = await client.getRect(id);
        const at = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        const stream: Array<Record<string, unknown>> = [
          { type: "pointerMove", duration: 0, x: at.x, y: at.y },
          { type: "pointerDown", button: 0 },
        ];
        if (action === "pressAndHold" || action === "rightClick") {
          // A long press is what a phone has instead of a right click.
          stream.push({ type: "pause", duration: 800 }, { type: "pointerUp", button: 0 });
        } else if (action === "dragTo") {
          const target = await client.getRect(await this.elementFor(need(ref2)));
          stream.push(
            { type: "pause", duration: 200 },
            {
              type: "pointerMove",
              duration: 400,
              x: Math.round(target.x + target.width / 2),
              y: Math.round(target.y + target.height / 2),
            },
            { type: "pointerUp", button: 0 },
          );
        } else {
          stream.push({ type: "pointerUp", button: 0 });
        }
        await client.performActions([
          { type: "pointer", id: "finger", parameters: { pointerType: "touch" }, actions: stream },
        ]);
        this.invalidate();
        return { ok: true, ref };
      }

      case "type":
        await client.sendKeys(await this.elementFor(need(ref)), str("value"));
        return { ok: true, ref };
      case "clear":
        await client.clear(await this.elementFor(need(ref)));
        return { ok: true, ref };
      case "setChecked": {
        const id = await this.elementFor(need(ref));
        const wanted = args["checked"] !== false && args["checked"] !== "false";
        if ((await client.isSelected(id)) !== wanted) await client.click(id);
        this.invalidate();
        return { ok: true, ref };
      }

      case "keyDown":
      case "keyUp":
        /*
         * Refused, where both sent a whole key press (SF-11). A W3C action
         * sequence releases every key it pressed when it ends, so a `keyDown`
         * sent on its own is a press and a release — no key survives the call
         * to be held — and a `keyUp` presses a key that was not down. There is
         * no held-key primitive here to send; nothing was sent.
         */
        throw new UnsupportedError(
          `The Appium adapter has no "${action}": a key action sequence releases its keys when it ` +
            "ends, so a key cannot be held down across steps. Press the key in one step instead.",
          { adapter: "appium" },
        );

      case "submit":
      case "press": {
        /*
         * A phone's keyboard is not a desktop's: `press "Enter"` is the IME's
         * action key, which is why `submit` is the same gesture here. A named
         * key goes as its W3C codepoint (`w3cKeyFor`), a single character as
         * itself, and anything else is refused before it reaches the driver.
         */
        const key = action === "submit" ? ENTER : w3cKeyFor(str("key", "Enter"));
        await client.performActions([
          {
            type: "key",
            id: "keyboard",
            actions: [
              { type: "keyDown", value: key },
              { type: "keyUp", value: key },
            ],
          },
        ]);
        // Enter submits, and a submit navigates as often as a tap does.
        if (key === ENTER) this.invalidate();
        return { ok: true, ...(ref === undefined ? {} : { ref }) };
      }

      case "scrollIntoView": {
        const target = need(ref);
        if (!this.native()) {
          /*
           * The element goes in as the script's argument. It used to be called
           * with an empty argument list, so `arguments[0]` was undefined, the
           * guard in front of it made that silent, and the step answered
           * `{ok: true}` having scrolled nothing at all.
           */
          const id = await this.elementFor(target);
          await client.execute("arguments[0].scrollIntoView({block: 'center'})", [
            { [W3C_ELEMENT]: id },
          ]);
          return { ok: true, ref: target };
        }
        return await this.swipeIntoView(target);
      }

      case "scrollToTop":
      case "scrollToBottom": {
        if (!this.native()) {
          await client.execute(
            action === "scrollToTop"
              ? "window.scrollTo(0, 0)"
              : "window.scrollTo(0, document.body.scrollHeight)",
            [],
          );
          return { ok: true, ...(ref === undefined ? {} : { ref }) };
        }
        /*
         * Native scrolling is a swipe from the screen's centre, four tenths of
         * the screen's height up or down.
         *
         * The distance was the centre's own `y` — a coordinate, not a length.
         * On a screen whose box starts at 0 that is half the height, so the
         * finger ended exactly on the edge, where Android and iOS start their
         * own gestures (the notification shade, the home indicator); on one
         * whose box starts lower, it ended past the edge altogether. Four tenths
         * from the centre stops a tenth short of either edge, which is the rule
         * `swipeIntoView` already follows.
         */
        const [left, top, width, height] = await this.screenBox();
        const x = Math.round(left + width / 2);
        const y = Math.round(top + height / 2);
        const distance = Math.round(height * 0.4) * (action === "scrollToTop" ? 1 : -1);
        await client.performActions([
          {
            type: "pointer",
            id: "finger",
            parameters: { pointerType: "touch" },
            actions: [
              { type: "pointerMove", duration: 0, x, y },
              { type: "pointerDown", button: 0 },
              { type: "pause", duration: 100 },
              { type: "pointerMove", duration: 400, x, y: y + distance },
              { type: "pointerUp", button: 0 },
            ],
          },
        ]);
        this.invalidate();
        return { ok: true, ...(ref === undefined ? {} : { ref }) };
      }

      case "sleep": {
        const ms = Number(args["ms"] ?? 0) + Number(args["seconds"] ?? 0) * 1000;
        await new Promise((done) => setTimeout(done, Math.max(0, ms)));
        return { ok: true };
      }
      case "waitFor": {
        /*
         * No reference is a wait for the screen — its text, its URL, its title
         * (SF-16) — and it used to be refused as a missing reference, so the
         * wait an agent most often needs, for the next screen's words, could
         * not be asked for at all.
         */
        if (ref === undefined) {
          /*
           * A URL is refused in a native context before anything waits (SF-16).
           * `read("url")` answers "" there, so a wait for one re-read an empty
           * string for its whole timeout and then failed as a timeout — on a
           * screen that will never have an address. The AX and UIA adapters
           * refuse it the same way; a webview has a URL and waits for it.
           */
          if (this.native() && typeof args["url"] === "string") {
            throw new UnsupportedError(
              'A native context has no URL to wait for. Wait for its text or its title, or switch ' +
                'to a webview first ("switchFrame" with name "webview").',
              { adapter: "appium" },
            );
          }
          return await waitForPage(this, args, {
            adapter: "appium",
            textOf: () => this.screenText(),
            ...(this.options.timeoutMs === undefined
              ? {}
              : { defaultTimeoutMs: this.options.timeoutMs }),
          });
        }
        return await this.waitForElement(need(ref), args);
      }

      case "switchFrame": {
        /*
         * On a phone this is a *context* switch, which is the nearest thing the
         * platform has and the one LLD §7.4 names. `main` goes back to the
         * native app; anything else names a webview.
         */
        const wanted = String(args["name"] ?? args["url"] ?? "webview");
        if (wanted === "main" || isNativeContext(wanted)) {
          await client.switchContext("NATIVE_APP");
          this.context = "NATIVE_APP";
          this.invalidate();
          return { ok: true };
        }
        const contexts = await client.getContexts();
        const found =
          contexts.find((name) => name === wanted) ??
          contexts.find((name) => name.toLowerCase().includes(wanted.toLowerCase())) ??
          contexts.find((name) => !isNativeContext(name));
        if (found === undefined) {
          throw new NavigationError(
            `No context matches "${wanted}"; the session has ${contexts.join(", ") || "(none)"}.`,
            { adapter: "appium" },
          );
        }
        await client.switchContext(found);
        this.context = found;
        this.invalidate();
        return { ok: true };
      }

      case "read":
        return {
          ok: true,
          value: await this.read(
            String(args["kind"] ?? "text") as ReadKind,
            ref,
            args["name"] === undefined ? undefined : String(args["name"]),
          ),
        };
      case "evaluate": {
        // Unsupported, not a script that threw (SF-11): nothing ran, and
        // `OUTCOME_UNKNOWN` would send a caller to find out whether it had.
        if (this.native()) {
          throw new UnsupportedError(
            'A native context has no JavaScript to evaluate. Switch to a webview first ("switchFrame" ' +
              'with name "webview").',
            { adapter: "appium" },
          );
        }
        return { ok: true, value: await client.execute(str("script", str("expression", "")), []) };
      }
      case "screenshot":
        await this.screenshot(str("path"));
        return { ok: true };

      case "selectOption":
      case "deselectOption":
      case "deselectAll":
      case "upload":
      case "switchWindow":
      case "closeOtherWindows":
      case "resizeWindow":
      case "dialog":
        /*
         * `resizeWindow` is here for the same reason the other four are: a
         * phone's screen is the size it is, so pattern 33 has nothing to
         * resize, and the capability descriptor says so rather than the
         * adapter pretending (LLD §2.4).
         *
         * `UnsupportedError`, where it was a `ScriptError` (SF-11): a caller was
         * told `OUTCOME_UNKNOWN` — go and check whether it happened — about an
         * action that was never sent to the device.
         */
        throw new UnsupportedError(
          `The Appium adapter does not implement "${action}": ` +
            "a phone has no windows, no file picker and no native <select> " +
            "(LLD §2.4 — the capability descriptor declares it rather than emulating it).",
          { adapter: "appium" },
        );
      case "invoke":
        throw new UnsupportedError(
          '"invoke" calls another story and is the executor\'s, not an adapter\'s (LLD §8.2).',
          { adapter: "appium" },
        );
      /*
       * `Quit the app` is a desktop step (pattern 31, T11.2, LLD §13.9).
       *
       * Refused rather than approximated, which is the boundary REQ-SURF-5
       * draws from the other side: a desktop adapter refuses `navigate`, and a
       * mobile session refuses this. Closing the page instead would let a desktop
       * flow "pass" against something it never quit.
       */
      case "quit":
        throw new UnsupportedError(
          'There is no application to quit here. "Quit the app" is a desktop step ' +
            "(pattern 31); drive this application through its own controls instead.",
          { adapter: "appium" },
        );

      default: {
        const never: never = action;
        throw new UnsupportedError(`The Appium adapter has no row for "${String(never)}".`, {
          adapter: "appium",
        });
      }
    }
  }

  /* ── read, check, screenshot, state ─────────────────────────────────────── */

  async read(kind: ReadKind, ref?: Ref, name?: string): Promise<unknown> {
    const client = this.live();
    if (kind === "url") return this.native() ? "" : await client.getUrl();
    if (kind === "title") {
      if (!this.native()) return await client.getTitle();
      // A native screen's "title" is the top-most named thing on it, which is
      // the closest honest answer rather than an empty string.
      const nodes = (await this.snapshot()).nodes;
      return nodes.find((node) => node.name !== undefined && node.name !== "")?.name ?? "";
    }

    if (ref === undefined) {
      throw new LocateError(`Reading "${kind}" needs a reference.`, { adapter: "appium" });
    }
    const id = await this.elementFor(ref);
    switch (kind) {
      case "text":
      case "result":
        return (await client.getText(id)).replace(/\s+/g, " ").trim();
      case "value":
        return (
          (await client.getAttribute(id, this.native() ? "text" : "value")) ??
          (await client.getText(id))
        );
      case "attribute": {
        if (name === undefined) {
          throw new LocateError('Reading "attribute" needs the attribute name.', {
            adapter: "appium",
          });
        }
        return await client.getAttribute(id, name);
      }
      default:
        throw new LocateError(`Unknown read kind "${String(kind)}".`, { adapter: "appium" });
    }
  }

  async check(predicate: Predicate, subject: CheckSubject, ref?: Ref): Promise<CheckResult> {
    return await evaluateAppiumPredicate(predicate, subject, ref, {
      client: this.live(),
      native: this.native(),
      element: (which) => this.elementFor(which),
      snapshotText: async () =>
        (await this.snapshot()).nodes
          .map((node) => `${node.name ?? ""} ${node.value ?? ""}`)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
    });
  }

  /**
   * A screenshot of the device, with the masked boxes painted over.
   *
   * Appium screenshots the whole screen and takes no mask, so masking is done to
   * the PNG afterwards — there is nowhere else to do it, and REQ-NFR-6 says a
   * screenshot of a secret-injecting step is masked, not that it is skipped.
   */
  async screenshot(path: string, mask?: Ref[]): Promise<void> {
    const png = Buffer.from(await this.live().screenshot(), "base64");
    if ((mask ?? []).length === 0) {
      writeFileSync(path, png);
      return;
    }
    const boxes: Array<[number, number, number, number]> = [];
    for (const ref of mask ?? []) {
      const rect = await this.live()
        .getRect(await this.elementFor(ref))
        .catch(() => undefined);
      if (rect !== undefined) boxes.push([rect.x, rect.y, rect.width, rect.height]);
    }
    const { maskPng } = await import("./mask.js");
    writeFileSync(path, maskPng(png, boxes));
  }

  async state(): Promise<SessionState> {
    const state: SessionState = { kind: "mobile", windowIndex: 0 };
    if (!this.native()) {
      state.url = await this.live().getUrl();
      state.windowTitle = await this.live().getTitle();
    }
    // The context is the only navigable thing a native session has, and
    // `frame` is where the surface's state shape keeps "which sub-document".
    state.frame = this.context;
    state.dialog = null;
    return state;
  }

  async restore(state: SessionState): Promise<void> {
    if (state.kind !== "mobile") {
      throw new SessionError(`Cannot restore a "${state.kind}" session into a mobile adapter.`, {
        adapter: "appium",
      });
    }
    if (state.frame !== undefined && state.frame !== this.context) {
      await this.live().switchContext(state.frame);
      this.context = state.frame;
    }
    this.invalidate();
    if (state.url !== undefined && state.url !== "" && !this.native()) {
      await this.live().navigateTo(state.url);
    }
  }

  /* ── refs ───────────────────────────────────────────────────────────────── */

  private testIdAttributes(): readonly string[] {
    return this.options.testIdAttributes ?? ["data-testid"];
  }

  private ignored(): Set<string> {
    return new Set(
      (this.options.ignoreAttributes ?? DEFAULT_IGNORE_ATTRIBUTES).map((a) => a.toLowerCase()),
    );
  }

  private nodeFor(ref: Ref): ConvertedNode {
    const index = /^r(\d+)$/.exec(ref);
    const node = index === null ? undefined : this.nodes[Number(index[1])];
    if (node === undefined) throw staleRef(ref);
    return node;
  }

  private sourceFor(ref: Ref): SourceNode {
    const path = this.nodeFor(ref).path;
    return path[path.length - 1]!;
  }

  private handleFor(ref: Ref): ElementId {
    const index = /^h(\d+)$/.exec(ref);
    const id = index === null ? undefined : this.handles[Number(index[1])];
    if (id === undefined) throw staleRef(ref);
    return id;
  }

  /**
   * `waitFor` with a reference: the element in the state `args.state` names
   * (pattern 19).
   *
   * The six states, as every adapter means them: `attached` is an element the
   * driver still finds, `detached` is one it does not, `visible` is found and
   * displayed, `hidden` is gone or not displayed, and `enabled` and `disabled`
   * are found with `isEnabled` true or false.
   *
   * This read four of them and guessed the rest: `attached` and `disabled`
   * both fell through to "displayed", so `Wait for the button to be disabled`
   * returned the moment an enabled button was on screen, and `attached` waited
   * for visibility it did not ask for. An unknown state fell through the same
   * way instead of being refused. And every read that threw was "not shown" —
   * a lost session read as a `hidden` that had arrived. Now only the driver's
   * own "this element is gone" (stale, no such element) is absence, and
   * anything else ends the wait with what the driver said.
   *
   * The budget is `args.timeoutMs` (SF-16) — this waited the session's step
   * timeout whatever the step said — else the session's timeout; running out
   * is a `TimeoutError` that says where the element is.
   */
  private async waitForElement(target: Ref, args: ActArgs): Promise<ActResult> {
    const state = waitStateOf(args);
    // A reference this session never issued is a mistake to say now, not an absence to wait out.
    if (target.startsWith("h")) this.handleFor(target);
    else this.nodeFor(target);
    const fallback = this.options.timeoutMs ?? 10_000;
    const asked = Number(args["timeoutMs"] ?? fallback);
    const timeoutMs = Number.isFinite(asked) && asked >= 0 ? asked : fallback;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = await this.elementState(target);
      if (waitStateHolds(state, found)) return { ok: true, ref: target };
      if (Date.now() >= deadline) {
        const where =
          found === undefined
            ? "the driver no longer finds it"
            : `it is ${found.displayed ? "displayed" : "not displayed"} and ` +
              `${found.enabled ? "enabled" : "disabled"}`;
        throw new TimeoutError(`Waited ${timeoutMs} ms for ${target} to be ${state}, and ${where}.`, {
          adapter: "appium",
          timeoutMs,
        });
      }
      await new Promise((done) => setTimeout(done, 100));
    }
  }

  /** Whether the driver finds the element now, and if it does, what it says about it. */
  private async elementState(
    target: Ref,
  ): Promise<{ readonly displayed: boolean; readonly enabled: boolean } | undefined> {
    const client = this.live();
    try {
      const id = await this.elementFor(target);
      return { displayed: await client.isDisplayed(id), enabled: await client.isEnabled(id) };
    } catch (error) {
      if (error instanceof LocateError || isGoneElement(error)) return undefined;
      throw error;
    }
  }

  /**
   * The driver-side element a reference means.
   *
   * An `hN` already is one. An `rN` is a position in the page source, so it is
   * turned into one by asking the driver for the XPath the snapshot recorded —
   * the one place the snapshot and the driver have to agree, and the reason
   * `xpathOf` is part of the conversion rather than an afterthought.
   */
  private async elementFor(ref: Ref): Promise<ElementId> {
    if (ref.startsWith("h")) return this.handleFor(ref);
    const node = this.nodeFor(ref);
    const xpath = node.native?.["xpath"] ?? xpathOf(node.path);
    const found = await this.live().findElements("xpath", xpath);
    if (found.length === 0) throw staleRef(ref);
    return found[0]!;
  }

  /**
   * The screen's own rectangle: the first element of the page source that has
   * one.
   *
   * Not the root's. `parsePageSource` hands back a synthetic `hierarchy` with no
   * attributes above the XML's own, so `boxOf(root)` was always undefined and
   * every native swipe was measured against a 1080 by 1920 screen that an
   * iPhone's 390 by 844 is not. The first box in document order is the
   * application's frame on Android and the `XCUIElementTypeApplication` on iOS.
   */
  private async screenBox(): Promise<[number, number, number, number]> {
    const pending: SourceNode[] = [parsePageSource(await this.live().getPageSource())];
    while (pending.length > 0) {
      const node = pending.shift()!;
      const box = boxOf(node);
      if (box !== undefined && box[2] > 0 && box[3] > 0) return box;
      pending.push(...node.children);
    }
    return [0, 0, 1080, 1920];
  }

  /**
   * The words on the screen, for a page wait (SF-16).
   *
   * In a webview that is the document's `innerText`, which is what a person
   * reads there; a webview's page source is its HTML, whose text the native
   * conversion does not look for. In a native context it is the snapshot's
   * names and values, the same words a page `textContains` answers from, so a
   * wait and the assertion after it cannot disagree.
   */
  private async screenText(): Promise<string> {
    if (!this.native()) {
      return String(
        (await this.live().execute<string>("return document.body ? document.body.innerText : ''", [])) ??
          "",
      );
    }
    return (await this.snapshot()).nodes
      .map((node) => `${node.name ?? ""} ${node.value ?? ""}`)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Swipe until the element is on screen, or say that it will not come
   * (SF-11, LLD §7.4).
   *
   * This was one half-screen swipe in a fixed direction whatever the element
   * was and wherever it was — so an element above the screen was scrolled
   * further away, one two screens down stayed off it, and one already in view
   * was scrolled out of it, and every one of those answered `{ok: true}`.
   *
   * Now the element's rectangle decides. Below the screen, the finger moves up;
   * above it, down; by the distance still to go, at most four tenths of a
   * screen and never from an edge, where Android and iOS start their own
   * gestures. The pause before the finger lifts is what keeps a list from
   * flinging past the element. It stops when the element is inside the screen,
   * and gives up — with the element's position and the screen's in the
   * message — when a swipe moved nothing (the list has ended, or the element is
   * not in anything that scrolls this way) or after `MAX_SCROLL_SWIPES`.
   *
   * Vertical only: a vertical swipe cannot bring a carousel's next card across,
   * and pretending to try would be the defect this replaces.
   */
  private async swipeIntoView(target: Ref): Promise<ActResult> {
    const client = this.live();
    const id = await this.elementFor(target);
    const [left, top, width, height] = await this.screenBox();
    const bottom = top + height;
    const x = Math.round(left + width / 2);
    const rectOf = async (): Promise<{ x: number; y: number; width: number; height: number }> => {
      const rect = await client.getRect(id).catch(() => undefined);
      if (rect === undefined) throw staleRef(target);
      return rect;
    };
    /*
     * Inside is the whole element between the top and the bottom. An element
     * taller than the screen can never be, and is in view once it spans the
     * screen's middle.
     */
    const inside = (rect: { y: number; height: number }): boolean =>
      rect.height > height
        ? rect.y <= top + height / 2 && rect.y + rect.height >= top + height / 2
        : rect.y >= top && rect.y + rect.height <= bottom;

    let rect = await rectOf();
    let swipes = 0;
    while (!inside(rect)) {
      if (swipes >= MAX_SCROLL_SWIPES) {
        throw new ActionabilityError(
          `${target} is still outside the screen after ${swipes} swipes: it is at y ${rect.y} ` +
            `(height ${rect.height}) and the screen runs from ${top} to ${bottom}.`,
          { adapter: "appium" },
        );
      }
      const below = rect.y + rect.height > bottom;
      const still = below ? rect.y + rect.height - bottom : top - rect.y;
      const margin = Math.round(height * 0.05);
      const distance = Math.min(Math.round(height * 0.4), still + margin);
      const from = Math.round(top + height / 2 + (below ? distance / 2 : -distance / 2));
      const to = below ? from - distance : from + distance;
      await client.performActions([
        {
          type: "pointer",
          id: "finger",
          parameters: { pointerType: "touch" },
          actions: [
            { type: "pointerMove", duration: 0, x, y: from },
            { type: "pointerDown", button: 0 },
            { type: "pause", duration: 100 },
            { type: "pointerMove", duration: 400, x, y: to },
            { type: "pause", duration: 200 },
            { type: "pointerUp", button: 0 },
          ],
        },
      ]);
      swipes += 1;
      this.invalidate();
      const moved = await rectOf();
      if (moved.y === rect.y && moved.height === rect.height) {
        throw new ActionabilityError(
          `${target} is outside the screen (at y ${rect.y}, height ${rect.height}; the screen runs ` +
            `from ${top} to ${bottom}) and a swipe ${below ? "up" : "down"} did not move it: the ` +
            "list has ended, or the element is not inside anything that scrolls this way.",
          { adapter: "appium" },
        );
      }
      rect = moved;
    }
    return { ok: true, ref: target };
  }
}

/** The attributes `describe()` reads from a driver-side element. */
const NATIVE_ATTRIBUTES = [
  "class",
  "content-desc",
  "resource-id",
  "text",
  "label",
  "name",
  "value",
  "checkable",
  "checked",
  "clickable",
  "enabled",
  "focused",
  "password",
  "selected",
  "displayed",
  "type",
];

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
    { adapter: "appium" },
  );
}

function waitStateHolds(
  state: WaitState,
  found: { readonly displayed: boolean; readonly enabled: boolean } | undefined,
): boolean {
  switch (state) {
    case "attached":
      return found !== undefined;
    case "detached":
      return found === undefined;
    case "visible":
      return found?.displayed === true;
    case "hidden":
      return found === undefined || !found.displayed;
    case "enabled":
      return found?.enabled === true;
    case "disabled":
      return found !== undefined && !found.enabled;
  }
}

/** The W3C errors a driver answers about an element that is no longer there. */
function isGoneElement(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /stale element|no such element/i.test(`${error.name} ${error.message}`);
}

function staleRef(ref: Ref): LocateError {
  return new LocateError(
    `Reference "${ref}" no longer resolves to an element. References are stable within a ` +
      "snapshot and are lost when the screen changes — take a new snapshot (LLD §2.2).",
    { adapter: "appium" },
  );
}

/** Build a surface from a project config (LLD §2.4). */
export function createAppiumSurface(
  config: Config,
  overrides: AppiumAdapterOptions = {},
): AppiumSurface {
  // `config.mobile` is LLD §3.5's: `{ appium: string; capabilities: … }`, where
  // `appium` is the server URL.
  const mobile = config.mobile;
  return new AppiumSurface({
    ...(mobile?.appium === undefined ? {} : { serverUrl: mobile.appium }),
    ...(mobile?.capabilities === undefined ? {} : { capabilities: mobile.capabilities }),
    timeoutMs: config.run.stepTimeoutMs,
    testIdAttributes: config.bindings.testIdAttributes,
    ignoreAttributes: config.bindings.ignoreAttributes ?? DEFAULT_IGNORE_ATTRIBUTES,
    ...overrides,
  });
}
