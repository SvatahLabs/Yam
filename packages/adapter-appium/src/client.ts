/**
 * The Appium session, behind an interface (T4.2, LLD §7.4).
 *
 * > WebdriverIO client; webview contexts use web candidate kinds; native
 * > contexts use `accessibilityId`, `resourceId`, `xpath`.
 *
 * WebdriverIO is the client, as the spec chooses. It sits behind `AppiumClient`
 * for one reason: everything above it — the page-source conversion, the
 * candidate mapping, the context switching, the action table — is testable
 * without a device, and an adapter whose logic could only be exercised on an
 * emulator would be an adapter nobody could check.
 *
 * The interface is the W3C WebDriver subset Appium serves, named the way the
 * protocol names it, so a reader can follow a call from here into the Appium
 * documentation without a translation step.
 */
import type { SessionError as SessionErrorType } from "@svatah/yam-surface";
import { SessionError } from "@svatah/yam-surface";

/** An element the driver found: the opaque id the protocol hands back. */
export type ElementId = string;

/**
 * The W3C WebDriver commands this adapter uses.
 *
 * Deliberately small. Everything an `AgentSurface` needs from a mobile device is
 * here, and anything not here is something the adapter does for itself — which
 * is the same division the BiDi adapter makes and for the same reason.
 */
export interface AppiumClient {
  /** `GET /session/:id/source` — the whole screen as XML. */
  getPageSource(): Promise<string>;
  /** `GET /session/:id/contexts` — `["NATIVE_APP", "WEBVIEW_chrome", …]`. */
  getContexts(): Promise<string[]>;
  /** `GET /session/:id/context`. */
  getContext(): Promise<string>;
  /** `POST /session/:id/context`. */
  switchContext(name: string): Promise<void>;

  findElements(using: string, value: string): Promise<ElementId[]>;
  click(element: ElementId): Promise<void>;
  sendKeys(element: ElementId, text: string): Promise<void>;
  clear(element: ElementId): Promise<void>;
  getText(element: ElementId): Promise<string>;
  getAttribute(element: ElementId, name: string): Promise<string | null>;
  getRect(element: ElementId): Promise<{ x: number; y: number; width: number; height: number }>;
  isDisplayed(element: ElementId): Promise<boolean>;
  isEnabled(element: ElementId): Promise<boolean>;
  isSelected(element: ElementId): Promise<boolean>;

  navigateTo(url: string): Promise<void>;
  getUrl(): Promise<string>;
  getTitle(): Promise<string>;
  back(): Promise<void>;
  forward(): Promise<void>;
  refresh(): Promise<void>;
  execute<T>(script: string, args: unknown[]): Promise<T>;
  /** `POST /session/:id/actions` — pointer and key streams (W3C actions). */
  performActions(actions: object[]): Promise<void>;
  screenshot(): Promise<string>;
  deleteSession(): Promise<void>;
}

export interface AppiumConnectOptions {
  /** Where the Appium server is. `http://127.0.0.1:4723` by default. */
  readonly serverUrl?: string;
  /** The W3C capabilities, `appium:`-prefixed as Appium 2 requires. */
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly connectionTimeoutMs?: number;
}

/** `YAM_APPIUM_URL`: where the Appium server is listening. */
export const APPIUM_URL_ENV = "YAM_APPIUM_URL";
/** `YAM_APPIUM_CAPS`: a JSON object of capabilities, merged over the config's. */
export const APPIUM_CAPS_ENV = "YAM_APPIUM_CAPS";

export const DEFAULT_APPIUM_URL = "http://127.0.0.1:4723";

/** Where the Appium server is, from the flag layer, the environment, or the default. */
export function appiumServerUrl(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const named = explicit ?? env[APPIUM_URL_ENV];
  return (named === undefined || named === "" ? DEFAULT_APPIUM_URL : named).replace(/\/+$/, "");
}

/**
 * Capabilities the environment adds or overrides.
 *
 * A device farm, an emulator on a different port, an app under test built by
 * this CI run: all of them are things a project's committed config should not
 * have to name (REQ-NFR-7's portability, and the same argument as
 * `YAM_BASE_URL` in LLD §15).
 */
export function capabilitiesFromEnv(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const raw = env[APPIUM_CAPS_ENV];
  if (raw === undefined || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("it is not a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (cause) {
    throw new SessionError(
      `${APPIUM_CAPS_ENV} must be a JSON object of Appium capabilities: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
      { adapter: "appium" },
    );
  }
}

/**
 * Connect through WebdriverIO (LLD §7.4).
 *
 * Imported dynamically so that requiring the package — which the CLI does at
 * start, to register every adapter — does not pull WebdriverIO's tree into every
 * `yam lint`. It is only loaded when a session is actually opened.
 */
export async function connectWebdriverIo(options: AppiumConnectOptions): Promise<AppiumClient> {
  const url = new URL(appiumServerUrl(options.serverUrl));

  /*
   * The one shape this needs from WebdriverIO: a function that takes options and
   * gives back a driver. Typed structurally rather than by importing the
   * package's types, so `@svatah/yam-adapter-appium` compiles whether or not
   * WebdriverIO is installed — the real client is loaded only when a session is
   * actually opened.
   */
  type Remote = (options: Record<string, unknown>) => Promise<WebdriverIoBrowser>;
  let remote: Remote;
  try {
    ({ remote } = (await import("webdriverio")) as unknown as { remote: Remote });
  } catch (cause) {
    throw new SessionError(
      "The Appium adapter needs `webdriverio`, which is not installed. " +
        "Run `pnpm install` in the workspace, or install `@svatah/yam-adapter-appium` " +
        "with its dependencies.",
      { adapter: "appium", cause },
    );
  }

  let browser: WebdriverIoBrowser;
  try {
    browser = await remote({
      protocol: url.protocol.replace(":", "") as "http" | "https",
      hostname: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      path: url.pathname === "/" ? "/" : url.pathname,
      logLevel: "error",
      connectionRetryTimeout: options.connectionTimeoutMs ?? 120_000,
      /*
       * WebDriver Classic unless the caller asks otherwise. WebdriverIO 9 adds
       * `webSocketUrl: true` to every session to open WebDriver BiDi, and
       * Appium's UiAutomator2 driver and Android's ChromeDriver can refuse a
       * session that asks for it — every command this adapter sends is Classic.
       */
      capabilities: { "wdio:enforceWebDriverClassic": true, ...options.capabilities },
    });
  } catch (cause) {
    throw appiumUnreachable(appiumServerUrl(options.serverUrl), cause);
  }

  return webdriverIoClient(browser);
}

/** The message a person can act on when there is no Appium server. */
export function appiumUnreachable(url: string, cause: unknown): SessionErrorType {
  return new SessionError(
    `Could not open an Appium session at ${url}.\n` +
      "  Start a server with `appium --port 4723`, start a device or emulator\n" +
      "  (`emulator -avd <name>` or `adb devices` to check), and name the app or\n" +
      `  browser in \`config.mobile.capabilities\` or in ${APPIUM_CAPS_ENV}.\n` +
      `  Cause: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`,
    { adapter: "appium", cause },
  );
}

/**
 * `AppiumClient` over a WebdriverIO browser object.
 *
 * Every method here is one protocol command. WebdriverIO's element objects are
 * deliberately not used: they carry their own waiting, retrying and re-querying,
 * and an adapter that inherited all of that would be an adapter whose behaviour
 * came from somewhere the surface contract does not describe. The element *id*
 * is what the protocol returns and what this adapter holds.
 */
/**
 * The element id inside what the protocol hands back (LLD §7.4).
 *
 * A W3C element crosses the wire as `{"element-6066-…": "<id>"}`, and every
 * `elementClick`, `getElementText` and the rest take the id *string*. Anything
 * that returns an element — `findElements`, and a script that returns a DOM
 * node — has to come through here first, or WebdriverIO answers *"Malformed
 * type for elementId parameter … Expected: string, Actual: object"*.
 *
 * `ELEMENT` is the JSON Wire Protocol's spelling, which some drivers still use.
 */
export function elementIdOf(element: unknown): ElementId {
  const record = element as Record<string, string> | null;
  if (record === null || typeof record !== "object") return String(element);
  return record["element-6066-11e4-a52e-4f735466cecf"] ?? record["ELEMENT"] ?? String(element);
}

/**
 * An element id as an argument a script receives as the DOM node (LLD §7.4).
 *
 * W3C's wire form for an element is `{"element-6066-…": "<id>"}` in both
 * directions: hand one to `executeScript` and it arrives in the page as the
 * element itself.
 */
export function elementArg(id: ElementId): Record<string, string> {
  return { "element-6066-11e4-a52e-4f735466cecf": id };
}

/**
 * What a control in a web page is *currently* worth (Draft 2.29).
 *
 * `getElementAttribute(id, "value")` answers with the attribute — what the HTML
 * said — and typing does not change it, so a field the caller had just filled
 * read back empty. A `<select>` has no `value` attribute at all and fell through
 * to the element's text, which is the options' labels.
 *
 * One script, because `read("value")` and the `value` predicate are two callers
 * of one question and answered it differently: the read was fixed and the
 * predicate still compared against the attribute, so `login.type-changes-value`
 * reported the value correctly and then failed the assertion about it.
 */
export const ELEMENT_VALUE_SCRIPT =
  "var el = arguments[0];" +
  "if (!el) return null;" +
  "if (el.multiple && el.options) {" +
  "  var out = [];" +
  "  for (var i = 0; i < el.options.length; i += 1)" +
  "    if (el.options[i].selected) out.push(el.options[i].value);" +
  "  return out.join(', ');" +
  "}" +
  "if (el.value !== undefined && el.value !== null) return String(el.value);" +
  "return (el.textContent || '').replace(/\\s+/g, ' ').trim();";

export function webdriverIoClient(browser: WebdriverIoBrowser): AppiumClient {
  const id = elementIdOf;

  return {
    getPageSource: () => browser.getPageSource(),
    getContexts: async () => (await browser.getContexts()).map((c) => (typeof c === "string" ? c : c.id)),
    getContext: async () => {
      const context = await browser.getContext();
      return typeof context === "string" ? context : (context?.id ?? "NATIVE_APP");
    },
    switchContext: (name) => browser.switchContext(name),

    findElements: async (using, value) => (await browser.findElements(using, value)).map(id),
    click: (element) => browser.elementClick(element),
    /*
     * Two arguments. W3C Element Send Keys takes `{text}` and nothing else, and
     * WebdriverIO rejects a third with *"Wrong parameters applied for
     * elementSendKeys"* rather than ignoring it. The `[...text]` was the old
     * JSON Wire Protocol's `value` array, which W3C replaced.
     *
     * It type-checked because `WebdriverIoBrowser` below is a hand-written
     * structural type — written out so this package compiles without the
     * driver installed — and it declared the arity the code wanted. The first
     * real device the adapter ever drove is what found it; every earlier test
     * drove a fake client that accepted whatever it was handed.
     */
    sendKeys: (element, text) => browser.elementSendKeys(element, text),
    clear: (element) => browser.elementClear(element),
    getText: (element) => browser.getElementText(element),
    getAttribute: (element, name) => browser.getElementAttribute(element, name),
    getRect: (element) => browser.getElementRect(element),
    isDisplayed: (element) => browser.isElementDisplayed(element),
    isEnabled: (element) => browser.isElementEnabled(element),
    isSelected: (element) => browser.isElementSelected(element),

    navigateTo: (url) => browser.navigateTo(url),
    getUrl: () => browser.getUrl(),
    getTitle: () => browser.getTitle(),
    back: () => browser.back(),
    forward: () => browser.forward(),
    refresh: () => browser.refresh(),
    /*
     * The one cast at the boundary: above the surface a script argument is
     * `unknown`, and what the protocol can carry is narrower. Checked here
     * rather than declared away, so `client-shape.test.ts` still holds the
     * hand-written type to WebdriverIO's.
     */
    execute: <T,>(script: string, args: unknown[]) =>
      browser.executeScript(script, args as ScriptArg[]) as Promise<T>,
    performActions: (actions) => browser.performActions(actions as object[]),
    screenshot: () => browser.takeScreenshot(),
    deleteSession: () => browser.deleteSession(),
  };
}

/** What W3C Execute Script can carry as an argument. */
export type ScriptArg = string | object | number | boolean | null | undefined;

/**
 * The WebdriverIO surface this adapter uses, as a structural type.
 *
 * Written out rather than imported so that `@svatah/yam-adapter-appium` type-checks
 * and its logic is testable whether or not WebdriverIO is installed — the real
 * client is loaded dynamically at `open()`.
 *
 * `test/client-shape.test.ts` holds it to WebdriverIO's own declarations. It had
 * drifted twice — a third argument to `elementSendKeys` that W3C dropped with
 * the JSON Wire Protocol, and `unknown[]` where the protocol takes JSON — and
 * both type-checked, because this is the declaration the compiler reads.
 */
export interface WebdriverIoBrowser {
  getPageSource(): Promise<string>;
  getContexts(): Promise<Array<string | { id: string }>>;
  getContext(): Promise<string | { id: string } | null>;
  switchContext(name: string): Promise<void>;
  findElements(using: string, value: string): Promise<unknown[]>;
  elementClick(element: string): Promise<void>;
  elementSendKeys(element: string, text: string): Promise<void>;
  elementClear(element: string): Promise<void>;
  getElementText(element: string): Promise<string>;
  getElementAttribute(element: string, name: string): Promise<string | null>;
  getElementRect(element: string): Promise<{ x: number; y: number; width: number; height: number }>;
  isElementDisplayed(element: string): Promise<boolean>;
  isElementEnabled(element: string): Promise<boolean>;
  isElementSelected(element: string): Promise<boolean>;
  navigateTo(url: string): Promise<void>;
  getUrl(): Promise<string>;
  getTitle(): Promise<string>;
  back(): Promise<void>;
  forward(): Promise<void>;
  refresh(): Promise<void>;
  /*
   * The argument types W3C Execute Script serialises, which is what WebdriverIO
   * declares. `unknown[]` was wider than the truth: a value the protocol has no
   * JSON form for — a symbol, a bigint, a function — type-checked here and is
   * refused on the wire.
   */
  executeScript(script: string, args: ScriptArg[]): Promise<unknown>;
  performActions(actions: object[]): Promise<void>;
  takeScreenshot(): Promise<string>;
  deleteSession(): Promise<void>;
}
