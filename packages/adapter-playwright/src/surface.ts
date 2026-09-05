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
import type { AgentSurface } from "@svatah/surface";
import {
  ActionabilityError,
  DialogError,
  LocateError,
  NavigationError,
  ScriptError,
  SessionError,
  TimeoutError,
} from "@svatah/surface";
import { describeElement } from "./page-script.js";
import { coordsOf, locatorFor } from "./locate.js";
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
  testIdAttributes?: readonly string[];
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
  // WebMCP tool declarations are REQ-ADP-9 (P2); until then the resolver falls
  // through to the locator candidates behind a `webmcp` candidate.
  webmcp: false,
  screenshot: true,
  restore: true,
};

export class PlaywrightSurface implements AgentSurface {
  readonly kind: SurfaceKind = "web";

  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  /** True when the context was handed in and must not be closed by us. */
  private borrowedContext = false;
  private pages: Page[] = [];
  private activePage = 0;
  private activeFrame: Frame | undefined;
  private space: RefSpace | undefined;
  private mechanism: SnapshotMechanism = "own";
  private readonly dialogs: Array<{ type: string; message: string }> = [];
  /** How the next dialog is answered; set by `act("dialog", …)`. */
  private dialogPolicy: { accept: boolean; promptText?: string } | undefined;
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

    if (this.options.page !== undefined) {
      this.context = this.options.page.context();
      this.borrowedContext = true;
      this.trackPage(this.options.page);
    } else if (this.options.context !== undefined) {
      this.context = this.options.context;
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
    this.space = new RefSpace(this.activeFrame, this.mechanism, this.testIdAttributes());
  }

  async close(): Promise<void> {
    await this.space?.reset();
    this.space = undefined;
    if (this.tracing) await this.trace(false).catch(() => undefined);
    if (this.context !== undefined && !this.borrowedContext) await this.context.close();
    if (this.browser !== undefined) await this.browser.close();
    this.context = undefined;
    this.browser = undefined;
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

  private testIdAttributes(): readonly string[] {
    return this.options.testIdAttributes ?? ["data-testid", "data-test-id", "data-test"];
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
    const policy = this.dialogPolicy ?? { accept: true };
    this.dialogPolicy = undefined;
    try {
      if (policy.accept) await dialog.accept(policy.promptText);
      else await dialog.dismiss();
    } catch {
      // The page navigated away before the dialog could be answered.
    }
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

  /** Register an element handle and return a reference for it. */
  refForHandle(handle: ElementHandle<Element>): Ref {
    return this.refs().mint(handle);
  }

  async locate(candidate: Candidate): Promise<Ref[]> {
    const space = this.refs();
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

    const all = await locator.all();
    const refs: Ref[] = [];
    for (const one of all) {
      const handle = await one.elementHandle();
      if (handle !== null) refs.push(space.mint(handle as ElementHandle<Element>));
    }
    return refs;
  }

  async describe(ref: Ref): Promise<ElementDescription> {
    const space = this.refs();
    const handle = await space.handleFor(ref);
    try {
      const raw = await handle.evaluate(describeElement, {
        testIdAttributes: [...this.testIdAttributes()],
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
          const accept = args["accept"] === undefined ? true : Boolean(args["accept"]);
          const text = args["text"];
          this.dialogPolicy = {
            accept,
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
    testIdAttributes: config.bindings.testIdAttributes,
    outputDir: config.run.outputDir,
    ...overrides,
  });
}
