/**
 * The Playwright adapter: `AgentSurface` on Playwright (LLD §7.1, REQ-ADP-1).
 *
 * One `BrowserContext` per session, `storageState` from config, page tracking for
 * `switchWindow`, a dialog queue, an active frame, and tracing to
 * `traces/<name>.zip`. Every action in the vocabulary REQ-RUN-10 carries over
 * from the Java framework has a row in `act`, every predicate has a row in
 * `check`, and the snapshot mechanism is behind `snapshot.ts` so nothing here
 * knows whether a reference came from Playwright or from our own walker.
 */
import { chromium, firefox, webkit } from "playwright";
import type {
  Browser,
  BrowserContext,
  BrowserType,
  Dialog,
  ElementHandle,
  Frame,
  Locator,
  Page,
} from "playwright";
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
} from "@svatah/schema";
import { DEFAULT_IGNORE_ATTRIBUTES } from "@svatah/schema";
import type { AgentSurface } from "@svatah/surface";
import {
  ActionabilityError,
  DialogError,
  locateDeadline,
  LocateError,
  NavigationError,
  ScriptError,
  SessionError,
  TimeoutError,
} from "@svatah/surface";
import { describeElement } from "./page-script.js";
import { coordsOf, locatorFor } from "./locate.js";
import { callTool, declaredTools, declaresTool, type DeclaredTool } from "./webmcp.js";
import { evaluatePredicate } from "./predicates.js";
import {
  ariaSnapshotText,
  chooseMechanism,
  RefSpace,
  takeSnapshot,
  type SnapshotMechanism,
  type SnapshotOptions,
} from "./snapshot.js";

export type BrowserName = "chromium" | "firefox" | "webkit";

const BROWSERS: Record<BrowserName, BrowserType> = { chromium, firefox, webkit };

/** Everything the adapter needs that is not in `SessionInit`. */
export interface PlaywrightAdapterOptions {
  browser?: BrowserName;
  headless?: boolean;
  viewport?: [number, number];
  /** Per-action timeout; `Config.run.stepTimeoutMs`. */
  timeoutMs?: number;
  /**
   * `config.run.candidateTimeoutMs` — how long a `locate` may keep asking
   * before it answers "nothing" (T11.2). Zero is one query, which is what every
   * caller had before.
   */
  candidateTimeoutMs?: number;
  testIdAttributes?: readonly string[];
  /**
   * `config.bindings.ignoreAttributes` (LLD §3.5): attribute names the surface
   * never reports. Stripped from `describe()`'s `attrs` and from `native`, so
   * nothing above the surface can bind to one, score on one, or fingerprint one.
   */
  ignoreAttributes?: readonly string[];
  /** Where `trace(true, path)` writes when no path is given. */
  outputDir?: string;
  /** Force a snapshot mechanism; otherwise `SVATAH_PW_SNAPSHOT`, otherwise auto. */
  snapshotMechanism?: SnapshotMechanism | "auto";
  /** Drive an existing context instead of launching a browser (the Playwright Test host). */
  context?: BrowserContext;
  /**
   * Drive an existing page. The Playwright Test host hands the surface the page
   * the test is already using, so `bind()` acts on the test's own session rather
   * than opening a second browser beside it.
   */
  page?: Page;
  /**
   * Attach to a Chromium that is already running, over CDP (T11.2, LLD §13.9).
   *
   * > The Playwright adapter attaches to an existing Chromium when
   * > `SVATAH_CDP_URL` or `app.attach.cdpUrl` is set, exactly as the BiDi
   * > adapter attaches, so a flow can drive the ADE's renderer.
   *
   * The ADE is the case it exists for. Playwright's `_electron.launch` cannot
   * open a packaged build — it attaches to Electron's *Node* inspector, and the
   * `RunAsNode` and `EnableNodeCliInspectArguments` fuses are off by design
   * (T8.1) — but the renderer's own DevTools endpoint is a different thing and
   * is available. Attaching to it is how one flow drives the ADE through both
   * the accessibility tree and the DOM, which is what the parity gate of §13.9
   * compares.
   */
  cdpUrl?: string;
}

/** How many neighbouring texts `describe()` collects on each side (LLD §3.3). */
const NEIGHBOUR_COUNT = 3;

/** The capability descriptor for this adapter (LLD §2.4). */
export const PLAYWRIGHT_CAPABILITIES: Capabilities = {
  dialogs: true,
  frames: true,
  windows: true,
  upload: true,
  drag: true,
  trace: true,
  /*
   * WebMCP (T6.3, REQ-ADP-9). The capability says this adapter *can* read a
   * page's `navigator.modelContext` declaration — not that the page in front of
   * it declares anything. That distinction is what makes the fall-through work:
   * the resolver asks `locate({ by: "webmcp" })` per resolution, and a page that
   * has stopped declaring the tool answers with nothing, so the locators
   * recorded behind it are tried in the same run (LLD §6.3).
   */
  webmcp: true,
  screenshot: true,
  restore: true,
};

export class PlaywrightSurface implements AgentSurface {
  readonly kind: SurfaceKind = "web";

  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  /** True when the context was handed in and must not be closed by us. */
  private borrowedContext = false;
  /**
   * True when this session attached to a browser it did not start (T11.2).
   *
   * It closes the *connection* and not the browser: a `close()` that quit
   * somebody's Chromium — or the ADE — because a flow ended would be the
   * adapter deciding what the application is for.
   */
  private attached = false;
  private pages: Page[] = [];
  private activePage = 0;
  private activeFrame: Frame | undefined;
  private space: RefSpace | undefined;
  private mechanism: SnapshotMechanism = "own";
  private readonly dialogs: Array<{ type: string; message: string }> = [];
  /** How the next dialog is answered; set by `act("dialog", …)`. */
  private dialogPolicy: { accept: boolean; promptText?: string } | undefined;
  /**
   * Dialogs answered since the executor last asked (Draft 2.9 LLD §3.2, T8.3).
   *
   * A dialog is answered inside a Playwright event handler, outside any surface
   * call, so the audit proxy that wraps this object never sees one. The
   * executor drains this after each step and writes a `kind: "dialog"` line —
   * which is how "the default is never silent" is made true for the case that
   * caused it, a `dialog` step written *after* the click it meant to answer.
   */
  private readonly answered: Array<{
    type: string;
    message: string;
    armed: boolean;
    answer: "accept" | "dismiss";
  }> = [];
  private baseUrl: string | undefined;
  private storageStatePath: string | undefined;
  private tracing = false;

  constructor(private readonly options: PlaywrightAdapterOptions = {}) {}

  /* ── lifecycle ──────────────────────────────────────────────────────────── */

  capabilities(): Capabilities {
    return { ...PLAYWRIGHT_CAPABILITIES };
  }

  async open(session: SessionInit): Promise<void> {
    if (this.context !== undefined) {
      throw new SessionError("This surface already has an open session.", { adapter: "playwright" });
    }
    this.baseUrl = session.baseUrl;
    this.storageStatePath = session.storageState;

    /*
     * Flag or configuration, then the environment (LLD §15, Draft 2.5's
     * precedence for every session-opening command).
     */
    const fromEnvironment =
      process.env["SVATAH_CDP_URL"] === undefined || process.env["SVATAH_CDP_URL"] === ""
        ? undefined
        : process.env["SVATAH_CDP_URL"];
    /*
     * The session's own, then the environment, then the configuration — LLD
     * §15's precedence for every session-opening command, and the order matters
     * (T11.5).
     *
     * The configuration was first, so `evals/self/cdp`'s written-down port beat
     * the one `svatah eval self` had actually started an ADE on, and the
     * attaching side of the parity gate reported "could not attach to
     * 127.0.0.1:9464" — a port nothing was listening on, named in a file. A
     * port in a configuration is a *default* for somebody with no better idea;
     * an environment variable is somebody who does.
     */
    const cdpUrl = session.attach?.cdpUrl ?? fromEnvironment ?? this.options.cdpUrl;

    if (this.options.page !== undefined) {
      this.context = this.options.page.context();
      this.borrowedContext = true;
      this.trackPage(this.options.page);
    } else if (this.options.context !== undefined) {
      this.context = this.options.context;
      this.borrowedContext = true;
    } else if (cdpUrl !== undefined) {
      /*
       * Attach, do not launch (T11.2, LLD §13.9).
       *
       * The precedence is the one every session-opening command uses (LLD §15,
       * Draft 2.5): the flag or the configuration, then the environment
       * variable. `connectOverCDP` gives back the browser's *existing*
       * contexts, and taking the first is what makes this the application that
       * is running rather than a fresh window beside it — the BiDi adapter's
       * `attach` makes the same distinction, and P4-F's finding there was that
       * a second session on a driver-hosted endpoint is not an attachment.
       */
      try {
        this.browser = await chromium.connectOverCDP(cdpUrl);
      } catch (cause) {
        throw new SessionError(
          `Could not attach to a Chromium at ${cdpUrl}. Start it with ` +
            "`--remote-debugging-port=<port>` and check the URL: this is the renderer's " +
            "DevTools endpoint, not a Node inspector.",
          { cause, adapter: "playwright" },
        );
      }
      this.attached = true;
      const existing = this.browser.contexts();
      const context = existing[0];
      if (context === undefined) {
        throw new SessionError(
          `The Chromium at ${cdpUrl} has no browser context to drive. It is running and it ` +
            "has no page open.",
          { adapter: "playwright" },
        );
      }
      this.context = context;
      // Borrowed: closing it would close somebody else's browser.
      this.borrowedContext = true;
    } else {
      const name = this.options.browser ?? "chromium";
      const type = BROWSERS[name];
      if (type === undefined) {
        throw new SessionError(`Unknown browser "${name}".`, { adapter: "playwright" });
      }
      try {
        this.browser = await type.launch({ headless: this.options.headless ?? true });
      } catch (cause) {
        throw new SessionError(
          `Could not launch ${name}. Run \`pnpm exec playwright install ${name}\`.`,
          { cause, adapter: "playwright" },
        );
      }
      const viewport = this.options.viewport;
      this.context = await this.browser.newContext({
        ...(viewport === undefined ? {} : { viewport: { width: viewport[0], height: viewport[1] } }),
        ...(session.storageState === undefined ? {} : { storageState: session.storageState }),
        ...(session.baseUrl === undefined ? {} : { baseURL: session.baseUrl }),
      });
    }

    this.context.setDefaultTimeout(this.options.timeoutMs ?? 10_000);
    this.context.on("page", (page) => this.trackPage(page));
    for (const page of this.context.pages()) this.trackPage(page);
    if (this.pages.length === 0) this.trackPage(await this.context.newPage());

    // An adopted page is the active one, whatever order the context reports.
    this.activePage =
      this.options.page === undefined ? 0 : Math.max(0, this.pages.indexOf(this.options.page));
    this.activeFrame = this.page().mainFrame();
    this.mechanism = await chooseMechanism(
      this.activeFrame,
      this.options.snapshotMechanism ?? process.env["SVATAH_PW_SNAPSHOT"],
    );
    this.space = new RefSpace(
      this.activeFrame,
      this.mechanism,
      this.testIdAttributes(),
      this.ignoreAttributes(),
    );
  }

  async close(): Promise<void> {
    await this.space?.reset();
    this.space = undefined;
    if (this.tracing) await this.trace(false).catch(() => undefined);
    if (this.context !== undefined && !this.borrowedContext) await this.context.close();
    /*
     * An attached browser is disconnected from, not closed (T11.2).
     *
     * `Browser.close()` on a CDP connection ends the browser, and the browser
     * here is a person's Chromium — or the ADE, mid-run. What this session owns
     * is the connection.
     */
    if (this.browser !== undefined) {
      if (this.attached) await this.browser.close({ reason: "svatah detaching" }).catch(() => undefined);
      else await this.browser.close();
    }
    this.context = undefined;
    this.browser = undefined;
    this.attached = false;
    this.pages = [];
    this.activeFrame = undefined;
  }

  /** Which snapshot mechanism this session settled on (LLD §7.1). */
  snapshotMechanism(): SnapshotMechanism {
    return this.mechanism;
  }

  /**
   * The active Playwright `Page`.
   *
   * The surface is the only way down for everything above it (REQ-SURF-5), and
   * nothing above the surface may call this. It exists for the adapter's own
   * tests, which have to check that what the surface did reached the browser —
   * a `coords` click landing on a canvas, for instance, which has no
   * accessibility node to read back through.
   */
  pageForTests(): Page {
    return this.page();
  }

  /**
   * Read one attribute of a referenced element with a page script, deliberately
   * going *around* the surface contract (LLD §16, Draft 2.3).
   *
   * This exists for the healing eval and nothing else. The eval needs each
   * element's ground-truth label, and the label is precisely what
   * `bindings.ignoreAttributes` makes the surface unable to see: `describe()`
   * strips it, `native` never carries it, synthesis and fingerprinting filter it
   * again. Reading it through the surface would defeat the point, so the eval
   * reads it here, from the page, by a path no binding can take.
   *
   * It is not on `AgentSurface`, it is not part of the conformance suite, and
   * nothing in the runtime or the healer may call it. An adapter that does not
   * implement it makes the eval report every case as `unverified`, which is the
   * correct outcome for a run that could not check its answers.
   */
  async readRawAttribute(ref: Ref, attribute: string): Promise<string | undefined> {
    const space = this.refs();
    const handle = await space.handleFor(ref);
    try {
      const value = await handle.evaluate(
        (el: Element, name: string) => el.getAttribute(name),
        attribute,
      );
      return value ?? undefined;
    } finally {
      if (!space.ownsHandle(ref)) await handle.dispose();
    }
  }

  private testIdAttributes(): readonly string[] {
    return this.options.testIdAttributes ?? ["data-testid", "data-test-id", "data-test"];
  }

  private ignoreAttributes(): readonly string[] {
    return this.options.ignoreAttributes ?? DEFAULT_IGNORE_ATTRIBUTES;
  }

  private trackPage(page: Page): void {
    if (this.pages.includes(page)) return;
    this.pages.push(page);
    page.on("dialog", (dialog: Dialog) => void this.handleDialog(dialog));
    page.on("close", () => {
      const index = this.pages.indexOf(page);
      if (index >= 0) this.pages.splice(index, 1);
      if (this.activePage >= this.pages.length) this.activePage = Math.max(0, this.pages.length - 1);
    });
    page.on("framenavigated", (frame) => {
      if (frame === this.activeFrame) void this.space?.reset();
    });
  }

  /**
   * Native dialogs are queued rather than auto-dismissed.
   *
   * Playwright dismisses an unhandled dialog and lets the page continue, which
   * would make `dialog` a no-op and `check(text, "dialog")` unanswerable. The
   * policy set by the last `act("dialog", …)` is applied and the message kept,
   * so an expectation can be checked after the fact.
   */
  private async handleDialog(dialog: Dialog): Promise<void> {
    this.dialogs.push({ type: dialog.type(), message: dialog.message() });
    const armed = this.dialogPolicy !== undefined;
    const policy = this.dialogPolicy ?? { accept: true };
    this.dialogPolicy = undefined;
    this.answered.push({
      type: dialog.type(),
      message: dialog.message(),
      armed,
      answer: policy.accept ? "accept" : "dismiss",
    });
    try {
      if (policy.accept) await dialog.accept(policy.promptText);
      else await dialog.dismiss();
    } catch {
      // The page navigated away before the dialog could be answered.
    }
  }

  /**
   * The dialogs answered since this was last called, and forget them.
   *
   * Duck-typed rather than part of `AgentSurface`, the way `bridgeCost()` is:
   * the published surface (LLD §2) has no dialog-event channel and adding one
   * for an audit line would widen the standard for a diagnostic.
   */
  dialogLog(): ReadonlyArray<{
    type: string;
    message: string;
    armed: boolean;
    answer: "accept" | "dismiss";
  }> {
    return this.answered.splice(0, this.answered.length);
  }

  private page(): Page {
    const page = this.pages[this.activePage];
    if (page === undefined) {
      throw new SessionError("The session has no open page.", { adapter: "playwright" });
    }
    return page;
  }

  private frame(): Frame {
    if (this.activeFrame === undefined) {
      throw new SessionError("The session is not open.", { adapter: "playwright" });
    }
    return this.activeFrame;
  }

  private refs(): RefSpace {
    if (this.space === undefined) {
      throw new SessionError("The session is not open.", { adapter: "playwright" });
    }
    this.space.frame = this.frame();
    return this.space;
  }

  /* ── snapshot, locate, describe ─────────────────────────────────────────── */

  async snapshot(opts: SnapshotOptions = {}): Promise<Snapshot> {
    return await takeSnapshot(this.refs(), opts);
  }

  /** The public ARIA snapshot, as the independent account of the tree (LLD §7.1). */
  async ariaSnapshot(): Promise<string> {
    return await ariaSnapshotText(this.frame());
  }

  /**
   * The Playwright `Locator` a stored candidate names.
   *
   * The surface never exposes a locator to callers above it (REQ-SURF-5), and
   * this does not break that: the Playwright Test host is *not* above the
   * surface — it is the one place LLD §1 lets the adapter and the bindings meet,
   * and `bind()` has to return a real `Locator` because that is the whole point
   * of adopting a Playwright user's own test.
   */
  locatorForCandidate(candidate: Candidate): Locator {
    const locator = locatorFor(this.frame(), candidate, this.testIdAttributes());
    if (locator === null) {
      throw new LocateError(
        `A "${candidate.by}" candidate names no locator; it is answered by the surface itself.`,
        { adapter: "playwright" },
      );
    }
    return locator;
  }

  /** The active frame, for the host's picker. */
  frameForHost(): Frame {
    return this.frame();
  }

  /**
   * Every WebMCP tool the current page declares (T6.3, REQ-ADP-9).
   *
   * Not part of `AgentSurface`: nothing above the surface addresses a tool by
   * anything but a `webmcp` candidate, and a method for listing them would be a
   * browser idea in a platform-neutral interface. It is here because a record
   * report can usefully say what the page offered — including the tools nothing
   * bound to.
   */
  async declaredSiteTools(): Promise<DeclaredTool[]> {
    return await declaredTools(this.frame());
  }

  /** Register an element handle and return a reference for it. */
  refForHandle(handle: ElementHandle<Element>): Ref {
    return this.refs().mint(handle);
  }

  async locate(candidate: Candidate): Promise<Ref[]> {
    const space = this.refs();
    if (candidate.by === "webmcp") {
      /*
       * A `webmcp` candidate names a *tool*, not an element, so what comes back
       * is a synthetic reference — `wN` — that `act` recognises and calls. It
       * resolves to exactly one when the page declares the tool right now, and
       * to nothing when it does not, which is the whole of the fall-through
       * (LLD §6.3).
       */
      const tool = candidate.tool;
      if (tool === undefined || tool === "") {
        throw new LocateError('A "webmcp" candidate must carry a tool name.', {
          adapter: "playwright",
        });
      }
      return (await declaresTool(this.frame(), tool)) ? [space.mintTool(tool)] : [];
    }
    if (candidate.by === "coords") {
      // Coordinates name a point, not an element; a `coords` candidate resolves
      // to whatever is at that point, so exactly one reference or none.
      const { x, y } = coordsOf(candidate);
      const handle = await this.frame().evaluateHandle(
        ({ px, py }: { px: number; py: number }) => document.elementFromPoint(px, py),
        { px: x, py: y },
      );
      const element = handle.asElement();
      if (element === null) {
        await handle.dispose();
        return [];
      }
      return [space.mint(element as ElementHandle<Element>)];
    }

    const locator = locatorFor(this.frame(), candidate, this.testIdAttributes());
    if (locator === null) return [];

    /*
     * `all()` does not wait, and a click is a request (T11.2).
     *
     * Playwright's *actions* auto-wait; `locator.all()` is a query and answers
     * from the page as it is this instant. Every flow that clicks something and
     * then looks for what the click produced therefore raced the application —
     * on the web it usually won, because a DOM update is a few milliseconds,
     * and against the ADE's renderer it lost about a third of the time, where
     * clicking a project starts a service.
     *
     * So a locate that finds nothing is retried until just short of the
     * candidate timeout, exactly as the desktop adapters' now is — short of it,
     * because the resolver races the same budget and a tie makes it publish
     * "candidate timed out" where the truth is "matched nothing"
     * (`locateDeadline`). One that finds something answers at once, so only the
     * case that was going to fail pays for it — and the two sides of the parity
     * gate behave the same, which is the thing a gate comparing them depends
     * on.
     */
    const deadline = locateDeadline(this.options.candidateTimeoutMs);
    for (;;) {
      const all = await locator.all();
      if (all.length > 0 || Date.now() >= deadline) {
        const refs: Ref[] = [];
        for (const one of all) {
          const handle = await one.elementHandle();
          if (handle !== null) refs.push(space.mint(handle as ElementHandle<Element>));
        }
        return refs;
      }
      await this.page().waitForTimeout(100);
    }
  }

  async describe(ref: Ref): Promise<ElementDescription> {
    const space = this.refs();
    const handle = await space.handleFor(ref);
    try {
      const raw = await handle.evaluate(describeElement, {
        testIdAttributes: [...this.testIdAttributes()],
        ignoreAttributes: [...this.ignoreAttributes()],
        neighbourCount: NEIGHBOUR_COUNT,
      });
      return { ref, ...raw } as ElementDescription;
    } finally {
      if (!space.ownsHandle(ref)) await handle.dispose();
    }
  }

  /* ── act ────────────────────────────────────────────────────────────────── */

  async act(action: SurfaceAction, ref?: Ref, args: ActArgs = {}, ref2?: Ref): Promise<ActResult> {
    const space = this.refs();
    const page = this.page();
    const timeout = this.options.timeoutMs ?? 10_000;

    /** Resolve a ref to a handle, disposing it afterwards unless the space owns it. */
    const withHandle = async <T>(
      which: Ref | undefined,
      what: string,
      run: (handle: ElementHandle<Element>) => Promise<T>,
    ): Promise<T> => {
      if (which === undefined) {
        throw new LocateError(`The "${what}" action needs a reference.`, { adapter: "playwright" });
      }
      const handle = await space.handleFor(which);
      try {
        return await run(handle);
      } finally {
        if (!space.ownsHandle(which)) await handle.dispose();
      }
    };

    const str = (name: string, fallback?: string): string => {
      const value = args[name];
      if (value === undefined) {
        if (fallback !== undefined) return fallback;
        throw new ActionabilityError(`The "${action}" action needs an argument "${name}".`, {
          adapter: "playwright",
        });
      }
      return Array.isArray(value) ? value.join(",") : String(value);
    };

    /*
     * A tool reference is answered by calling the tool, whatever the action was
     * (T6.3). `Use the "book-slot" site tool` compiles to a `click` on a target
     * whose binding carries a `webmcp` candidate (pattern 30), so the action
     * that arrives here is `click` — and clicking a tool is calling it. Every
     * argument the step carried is passed through, renamed by the binding's
     * `paramMap` where it has one.
     */
    if (ref !== undefined && space.isToolRef(ref)) {
      const tool = space.toolFor(ref);
      const called = await callTool(this.frame(), tool, args as Record<string, unknown>);
      if (!called.ok) {
        throw new ActionabilityError(
          `The site tool "${tool}" did not run: ${called.error ?? "unknown"}.`,
          { adapter: "playwright" },
        );
      }
      return { ok: true, ref, ...(called.value === undefined ? {} : { value: called.value }) };
    }

    try {
      switch (action) {
        /* ── navigation ─────────────────────────────────────────────────── */
        case "navigate": {
          const url = str("url");
          const absolute =
            /^[a-z][a-z0-9+.-]*:/i.test(url) || this.baseUrl === undefined
              ? url
              : new URL(url, this.baseUrl).toString();
          const response = await page.goto(absolute, { timeout });
          await space.reset();
          if (response !== null && response.status() >= 400) {
            throw new NavigationError(
              `Navigating to ${absolute} returned ${response.status()}.`,
              { adapter: "playwright" },
            );
          }
          return { ok: true, navigated: true };
        }
        case "back":
          await page.goBack({ timeout });
          await space.reset();
          return { ok: true, navigated: true };
        case "forward":
          await page.goForward({ timeout });
          await space.reset();
          return { ok: true, navigated: true };
        case "refresh":
          await page.reload({ timeout });
          await space.reset();
          return { ok: true, navigated: true };

        /* ── pointer ────────────────────────────────────────────────────── */
        case "click":
          await withHandle(ref, action, (h) => h.click({ timeout }));
          return { ok: true, ref };
        case "doubleClick":
          await withHandle(ref, action, (h) => h.dblclick({ timeout }));
          return { ok: true, ref };
        case "rightClick":
          await withHandle(ref, action, (h) => h.click({ timeout, button: "right" }));
          return { ok: true, ref };
        case "hover":
          await withHandle(ref, action, (h) => h.hover({ timeout }));
          return { ok: true, ref };
        case "hoverAndClick":
          await withHandle(ref, action, async (h) => {
            await h.hover({ timeout });
            await h.click({ timeout });
          });
          return { ok: true, ref };
        case "pressAndHold":
          await withHandle(ref, action, async (h) => {
            await h.hover({ timeout });
            await page.mouse.down();
          });
          return { ok: true, ref };
        case "release":
          if (ref !== undefined) await withHandle(ref, action, (h) => h.hover({ timeout }));
          await page.mouse.up();
          return { ok: true, ref };
        case "dragTo": {
          if (ref2 === undefined) {
            throw new LocateError('The "dragTo" action needs a second reference.', {
              adapter: "playwright",
            });
          }
          const target = await space.handleFor(ref2);
          try {
            // `ElementHandle` has no drag pair, so the drag is driven from the
            // mouse: hover the source, press, move to the target in two steps so
            // HTML5 drag listeners see movement, and release.
            await withHandle(ref, action, async (h) => {
              await h.scrollIntoViewIfNeeded({ timeout });
              const from = await h.boundingBox();
              const to = await target.boundingBox();
              if (from === null || to === null) {
                throw new ActionabilityError("A dragged element has no bounding box.", {
                  adapter: "playwright",
                });
              }
              const centre = (b: { x: number; y: number; width: number; height: number }) => ({
                x: b.x + b.width / 2,
                y: b.y + b.height / 2,
              });
              const start = centre(from);
              const end = centre(to);
              await page.mouse.move(start.x, start.y);
              await page.mouse.down();
              await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2);
              await page.mouse.move(end.x, end.y);
              await page.mouse.up();
            });
          } finally {
            if (!space.ownsHandle(ref2)) await target.dispose();
          }
          return { ok: true, ref };
        }

        /* ── keyboard and input ─────────────────────────────────────────── */
        case "type":
          await withHandle(ref, action, (h) => h.fill(str("value"), { timeout }));
          return { ok: true, ref };
        case "clear":
          await withHandle(ref, action, (h) => h.fill("", { timeout }));
          return { ok: true, ref };
        case "press":
          if (ref === undefined) await page.keyboard.press(str("key"));
          else await withHandle(ref, action, (h) => h.press(str("key"), { timeout }));
          return { ok: true, ref };
        case "keyDown":
          if (ref !== undefined) await withHandle(ref, action, (h) => h.focus());
          await page.keyboard.down(str("key"));
          return { ok: true, ref };
        case "keyUp":
          if (ref !== undefined) await withHandle(ref, action, (h) => h.focus());
          await page.keyboard.up(str("key"));
          return { ok: true, ref };
        case "submit":
          await withHandle(ref, action, (h) =>
            h.evaluate((el) => {
              const form = el instanceof HTMLFormElement ? el : el.closest("form");
              if (form === null) throw new Error("The element is not inside a form.");
              form.requestSubmit();
            }),
          );
          return { ok: true, ref };
        case "upload": {
          const raw = args["files"] ?? args["value"];
          const files = Array.isArray(raw) ? raw : [String(raw ?? "")];
          await withHandle(ref, action, (h) => h.setInputFiles(files, { timeout }));
          return { ok: true, ref };
        }

        /* ── selection ──────────────────────────────────────────────────── */
        case "selectOption": {
          const raw = args["value"] ?? args["values"] ?? args["label"];
          const values = Array.isArray(raw) ? raw : [String(raw ?? "")];
          const by = args["by"] === undefined ? "value" : String(args["by"]);
          const selected = await withHandle(ref, action, (h) =>
            h.selectOption(
              by === "label"
                ? values.map((v) => ({ label: v }))
                : by === "index"
                  ? values.map((v) => ({ index: Number(v) }))
                  : values.map((v) => ({ value: v })),
              { timeout },
            ),
          );
          return { ok: true, ref, value: selected };
        }
        case "deselectOption": {
          const raw = args["value"] ?? args["values"];
          const values = Array.isArray(raw) ? raw : [String(raw ?? "")];
          const remaining = await withHandle(ref, action, (h) =>
            h.evaluate((el, drop: string[]) => {
              if (!(el instanceof HTMLSelectElement)) {
                throw new Error("deselectOption needs a <select>.");
              }
              for (const option of Array.from(el.options)) {
                if (drop.includes(option.value)) option.selected = false;
              }
              el.dispatchEvent(new Event("change", { bubbles: true }));
              return Array.from(el.selectedOptions).map((o) => o.value);
            }, values),
          );
          return { ok: true, ref, value: remaining };
        }
        case "deselectAll":
          await withHandle(ref, action, (h) =>
            h.evaluate((el) => {
              if (!(el instanceof HTMLSelectElement)) {
                throw new Error("deselectAll needs a <select>.");
              }
              for (const option of Array.from(el.options)) option.selected = false;
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }),
          );
          return { ok: true, ref };
        case "setChecked": {
          const checked = args["checked"] === undefined ? true : Boolean(args["checked"]);
          await withHandle(ref, action, (h) => h.setChecked(checked, { timeout }));
          return { ok: true, ref };
        }

        /* ── scrolling ──────────────────────────────────────────────────── */
        case "scrollIntoView":
          await withHandle(ref, action, (h) => h.scrollIntoViewIfNeeded({ timeout }));
          return { ok: true, ref };
        case "scrollToTop":
          await this.frame().evaluate(() => window.scrollTo(0, 0));
          return { ok: true };
        case "scrollToBottom":
          await this.frame().evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          return { ok: true };

        /* ── waiting ────────────────────────────────────────────────────── */
        case "sleep": {
          const ms = Number(args["ms"] ?? args["seconds"] ?? 0) * (args["seconds"] === undefined ? 1 : 1000);
          await page.waitForTimeout(ms);
          return { ok: true };
        }
        case "waitFor": {
          const state = String(args["state"] ?? "visible") as
            | "visible"
            | "hidden"
            | "attached"
            | "detached";
          await withHandle(ref, action, (h) => h.waitForElementState(
            state === "visible" ? "visible" : state === "hidden" ? "hidden" : "stable",
            { timeout },
          ));
          return { ok: true, ref };
        }

        /* ── windows and frames ─────────────────────────────────────────── */
        case "switchWindow": {
          const wanted = args["index"] ?? args["title"] ?? args["url"];
          let index = -1;
          if (typeof wanted === "number") index = wanted;
          else if (args["index"] !== undefined) index = Number(args["index"]);
          else {
            const needle = String(wanted ?? "");
            for (let i = 0; i < this.pages.length; i += 1) {
              const page_ = this.pages[i]!;
              const title = await page_.title().catch(() => "");
              if (title.includes(needle) || page_.url().includes(needle)) {
                index = i;
                break;
              }
            }
          }
          if (index < 0 || index >= this.pages.length) {
            throw new SessionError(
              `No window matches ${JSON.stringify(wanted)}; the session has ${this.pages.length}.`,
              { adapter: "playwright" },
            );
          }
          this.activePage = index;
          this.activeFrame = this.page().mainFrame();
          await space.reset();
          await this.page().bringToFront();
          return { ok: true, navigated: true };
        }
        case "closeOtherWindows": {
          const keep = this.page();
          for (const other of [...this.pages]) if (other !== keep) await other.close();
          this.pages = [keep];
          this.activePage = 0;
          this.activeFrame = keep.mainFrame();
          await space.reset();
          return { ok: true };
        }
        case "switchFrame": {
          const wanted = args["name"] ?? args["url"] ?? args["index"];
          if (wanted === undefined || String(wanted) === "main" || String(wanted) === "") {
            this.activeFrame = page.mainFrame();
          } else if (ref !== undefined) {
            const frame = await withHandle(ref, action, (h) => h.contentFrame());
            if (frame === null) {
              throw new SessionError("That reference is not a frame.", { adapter: "playwright" });
            }
            this.activeFrame = frame;
          } else {
            const needle = String(wanted);
            const frames = page.frames();
            const found =
              frames.find((f) => f.name() === needle) ??
              frames.find((f) => f.url().includes(needle)) ??
              (Number.isInteger(Number(needle)) ? frames[Number(needle)] : undefined);
            if (found === undefined) {
              throw new SessionError(`No frame matches "${needle}".`, { adapter: "playwright" });
            }
            this.activeFrame = found;
          }
          await space.reset();
          return { ok: true };
        }

        /* ── dialogs ────────────────────────────────────────────────────── */
        case "dialog": {
          /*
           * `args.action`, and nothing else (Draft 2.8 LLD §3.2).
           *
           * The grammar has always emitted `{ action: "accept" | "dismiss" }`
           * and this adapter read `args.accept`, which no step ever carried —
           * so `args.accept === undefined` and the default `true` accepted
           * every dialog, including the ones a flow said to dismiss. `Dismiss
           * the dialog` left the sample page saying `confirmed` end to end
           * (K7, confirmed by the Phase 6 verification as F4).
           *
           * §3.2 now fixes the key on both sides and adds the sentence that
           * makes this a defect rather than a preference: "an adapter that
           * defaults a missing `action` to accept is a defect". A missing
           * `action` is a caller error and is refused, because the two ways of
           * being wrong are not symmetric — a dialog wrongly dismissed shows up
           * as a failing assertion, and one wrongly accepted silently confirms
           * whatever it was asking about.
           */
          const answer = args["action"];
          if (answer !== "accept" && answer !== "dismiss") {
            throw new ActionabilityError(
              'The "dialog" action needs args.action of "accept" or "dismiss" ' +
                `(LLD §3.2), and was given ${answer === undefined ? "nothing" : JSON.stringify(answer)}. ` +
                "A missing action is never treated as accept: a dialog wrongly accepted confirms " +
                "whatever it asked about and says nothing about it.",
              { adapter: "playwright" },
            );
          }
          const text = args["text"];
          this.dialogPolicy = {
            accept: answer === "accept",
            ...(text === undefined ? {} : { promptText: String(text) }),
          };
          return { ok: true };
        }

        /* ── reading and scripting ──────────────────────────────────────── */
        case "read": {
          const value = await this.read(
            String(args["kind"] ?? "text") as ReadKind,
            ref,
            args["name"] === undefined ? undefined : String(args["name"]),
          );
          return { ok: true, ref, value };
        }
        case "evaluate": {
          const expression = str("expression");
          try {
            const value =
              ref === undefined
                ? await this.frame().evaluate<unknown, string>(
                    (source) => (0, eval)(source) as unknown,
                    expression,
                  )
                : await withHandle(ref, action, (h) =>
                    h.evaluate(
                      (el, source: string) =>
                        (0, eval)(`(function(element){${source}})`)(el) as unknown,
                      expression,
                    ),
                  );
            return { ok: true, ref, value };
          } catch (cause) {
            throw new ScriptError(`The script threw: ${describeError(cause)}`, {
              cause,
              adapter: "playwright",
            });
          }
        }
        case "screenshot": {
          const path = str("path");
          await this.screenshot(path);
          return { ok: true, value: path };
        }

        /* ── the executor's own actions ─────────────────────────────────── */
        case "invoke":
          throw new ActionabilityError(
            'The "invoke" action is an executor concern and never reaches an adapter (LLD §8.2).',
            { adapter: "playwright" },
          );

      /*
       * `Quit the app` is a desktop step (pattern 31, T11.2, LLD §13.9).
       *
       * Refused rather than approximated, which is the boundary REQ-SURF-5
       * draws from the other side: a desktop adapter refuses `navigate`, and a
       * web adapter refuses this. A browser tab is not an application a flow
       * closes, and closing the page instead would let a desktop flow "pass"
       * against a browser it never quit.
       */
      case "quit":
        throw new NavigationError(
          'A browser has no application to quit. "Quit the app" is a desktop step ' +
            "(pattern 31); drive a web application through its own controls, and let the " +
            "session close when the run ends.",
          { adapter: "playwright" },
        );

        default: {
          const exhaustive: never = action;
          throw new ActionabilityError(`Unknown action "${String(exhaustive)}".`, {
            adapter: "playwright",
          });
        }
      }
    } catch (error) {
      throw translate(error);
    }
  }

  /* ── read and check ─────────────────────────────────────────────────────── */

  async read(kind: ReadKind, ref?: Ref, name?: string): Promise<unknown> {
    const page = this.page();
    if (kind === "url") return page.url();
    if (kind === "title") return await page.title();

    const space = this.refs();
    if (ref === undefined) {
      throw new LocateError(`Reading "${kind}" needs a reference.`, { adapter: "playwright" });
    }
    const handle = await space.handleFor(ref);
    try {
      switch (kind) {
        case "text":
          return ((await handle.textContent()) ?? "").replace(/\s+/g, " ").trim();
        case "value":
          return await handle.evaluate((el) => {
            const tag = el.tagName.toLowerCase();
            if (tag === "select") {
              return Array.from((el as HTMLSelectElement).selectedOptions)
                .map((o) => o.value)
                .join(", ");
            }
            if (tag === "input" || tag === "textarea") return (el as HTMLInputElement).value;
            return (el.textContent ?? "").replace(/\s+/g, " ").trim();
          });
        case "attribute": {
          if (name === undefined) {
            throw new LocateError('Reading "attribute" needs the attribute name.', {
              adapter: "playwright",
            });
          }
          return await handle.getAttribute(name);
        }
        case "result":
          return await handle.evaluate((el) => (el.textContent ?? "").trim());
        default:
          throw new LocateError(`Unknown read kind "${String(kind)}".`, { adapter: "playwright" });
      }
    } finally {
      if (!space.ownsHandle(ref)) await handle.dispose();
    }
  }

  async check(predicate: Predicate, subject: CheckSubject, ref?: Ref): Promise<CheckResult> {
    const space = this.refs();
    let handle: ElementHandle<Element> | undefined;
    if (subject === "ref" && ref !== undefined) {
      try {
        handle = await space.handleFor(ref);
      } catch {
        // A missing element is what `absent` asserts, so it is not an error here.
        handle = undefined;
      }
    }
    try {
      return await evaluatePredicate(predicate, subject, {
        page: this.page(),
        frame: this.frame(),
        handle,
        dialog: this.dialogs[this.dialogs.length - 1],
      });
    } finally {
      if (handle !== undefined && ref !== undefined && !space.ownsHandle(ref)) {
        await handle.dispose();
      }
    }
  }

  /* ── screenshots, state, tracing ────────────────────────────────────────── */

  /**
   * A screenshot, with the boxes of the masked references painted over
   * (REQ-NFR-6: screenshots of secret-injecting steps are masked).
   *
   * Playwright masks by locator, and the surface hands us references, so each
   * masked element is stamped with a marker attribute for the duration of the
   * call and unstamped afterwards. The stamp never reaches `describe()`, which
   * reads the element directly.
   */
  async screenshot(path: string, mask?: Ref[]): Promise<void> {
    const space = this.refs();
    const marked: Array<{ ref: Ref; handle: ElementHandle<Element> }> = [];
    const locators = [];
    try {
      for (const ref of mask ?? []) {
        const handle = await space.handleFor(ref).catch(() => null);
        if (handle === null) continue;
        const marker: string = `m${locators.length}`;
        await handle.evaluate((el, m) => el.setAttribute("data-svatah-mask", m), marker);
        marked.push({ ref, handle });
        locators.push(this.frame().locator(`[data-svatah-mask="${marker}"]`));
      }
      await this.page().screenshot({
        path,
        ...(locators.length > 0 ? { mask: locators } : {}),
      });
    } finally {
      for (const { ref, handle } of marked) {
        await handle
          .evaluate((el) => el.removeAttribute("data-svatah-mask"))
          .catch(() => undefined);
        // A handle the ref space owns stays alive: disposing it here would make
        // the caller's own reference unusable after taking a screenshot.
        if (!space.ownsHandle(ref)) await handle.dispose().catch(() => undefined);
      }
    }
  }

  async state(): Promise<SessionState> {
    const page = this.page();
    const state: SessionState = {
      kind: "web",
      url: page.url(),
      windowIndex: this.activePage,
    };
    const title = await page.title().catch(() => undefined);
    if (title !== undefined) state.windowTitle = title;
    const frame = this.activeFrame;
    if (frame !== undefined && frame !== page.mainFrame()) {
      state.frame = frame.name() === "" ? frame.url() : frame.name();
    }
    const dialog = this.dialogs[this.dialogs.length - 1];
    state.dialog = dialog === undefined ? null : { type: dialog.type, message: dialog.message };
    if (this.storageStatePath !== undefined) state.storageState = this.storageStatePath;
    return state;
  }

  async restore(state: SessionState): Promise<void> {
    if (state.kind !== "web") {
      throw new SessionError(`Cannot restore a "${state.kind}" session into a web adapter.`, {
        adapter: "playwright",
      });
    }
    if (state.storageState !== undefined && this.context !== undefined) {
      // Re-applying storage state means replacing cookies and origins, which the
      // context API supports directly.
      const parsed = await import("node:fs/promises").then((fs) =>
        fs.readFile(state.storageState!, "utf8").then((t) => JSON.parse(t) as {
          cookies?: Parameters<BrowserContext["addCookies"]>[0];
        }),
      );
      if (parsed.cookies !== undefined) {
        await this.context.clearCookies();
        await this.context.addCookies(parsed.cookies);
      }
    }
    if (state.windowIndex !== undefined && state.windowIndex < this.pages.length) {
      this.activePage = state.windowIndex;
    }
    if (state.url !== undefined && state.url !== "about:blank") {
      await this.page().goto(state.url, { timeout: this.options.timeoutMs ?? 10_000 });
    }
    this.activeFrame = this.page().mainFrame();
    await this.space?.reset();
  }

  async trace(start: boolean, path?: string): Promise<void> {
    if (this.context === undefined) {
      throw new SessionError("The session is not open.", { adapter: "playwright" });
    }
    if (start) {
      await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      this.tracing = true;
      return;
    }
    const target = path ?? `${this.options.outputDir ?? "."}/trace.zip`;
    await this.context.tracing.stop({ path: target });
    this.tracing = false;
  }
}

/* ── error translation (LLD §2.3, §8.4) ───────────────────────────────────── */

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

/**
 * Playwright's errors carry their cause in the message. Mapping them onto the
 * surface's typed errors is what lets the executor classify a failure without
 * knowing which adapter ran (LLD §8.4).
 */
export function translate(error: unknown): unknown {
  if (
    error instanceof ActionabilityError ||
    error instanceof LocateError ||
    error instanceof TimeoutError ||
    error instanceof DialogError ||
    error instanceof NavigationError ||
    error instanceof ScriptError ||
    error instanceof SessionError
  ) {
    return error;
  }
  if (!(error instanceof Error)) return error;
  const message = error.message;

  if (/Timeout .*exceeded|waiting for locator|exceeded while waiting/i.test(message)) {
    return new TimeoutError(message, { cause: error, adapter: "playwright" });
  }
  if (/strict mode violation|resolved to \d+ elements|no element matches/i.test(message)) {
    return new LocateError(message, { cause: error, adapter: "playwright" });
  }
  if (/net::ERR|Navigation|ERR_ABORTED|frame was detached/i.test(message)) {
    return new NavigationError(message, { cause: error, adapter: "playwright" });
  }
  if (/dialog/i.test(message)) {
    return new DialogError(message, { cause: error, adapter: "playwright" });
  }
  if (
    /Target (page|browser|context).*(closed|crashed)|has been closed|browserContext\.close|Browser has been closed/i.test(
      message,
    )
  ) {
    return new SessionError(message, { cause: error, adapter: "playwright" });
  }
  if (/Evaluation failed|SyntaxError|is not a function|is not defined/i.test(message)) {
    return new ScriptError(message, { cause: error, adapter: "playwright" });
  }
  return new ActionabilityError(message, { cause: error, adapter: "playwright" });
}

/** Build a surface from a project config (LLD §2.4). */
export function createPlaywrightSurface(
  config: Config,
  overrides: PlaywrightAdapterOptions = {},
): PlaywrightSurface {
  return new PlaywrightSurface({
    browser: config.run.browser ?? "chromium",
    headless: config.run.headless,
    ...(config.run.viewport === undefined ? {} : { viewport: config.run.viewport }),
    timeoutMs: config.run.stepTimeoutMs,
    candidateTimeoutMs: config.run.candidateTimeoutMs,
    testIdAttributes: config.bindings.testIdAttributes,
    ignoreAttributes: config.bindings.ignoreAttributes ?? DEFAULT_IGNORE_ATTRIBUTES,
    outputDir: config.run.outputDir,
    // `app.attach.cdpUrl` (T11.2, LLD §13.9): drive a Chromium that is already
    // running — the ADE's renderer, for the parity gate — instead of launching.
    ...(config.app.attach?.cdpUrl === undefined ? {} : { cdpUrl: config.app.attach.cdpUrl }),
    ...overrides,
  });
}
