/**
 * @svatah/adapter-appium
 *
 * The Appium adapter: `AgentSurface` on Android and iOS (REQ-ADP-5, LLD §7.4).
 *
 * One session, two worlds. Inside a webview the device is a browser and the web
 * candidate kinds mean what they mean anywhere else; inside the native app a
 * screen is an XML page source, converted into the same snapshot shape a web
 * page produces (REQ-SURF-4). Nothing above the surface knows which of the two
 * it is in.
 *
 * ```ts
 * const surface = createAppiumSurface(config);
 * await surface.open({ baseUrl: "http://10.0.2.2:4173" });   // the emulator's host
 * ```
 */
export {
  AppiumSurface,
  APPIUM_CAPABILITIES,
  createAppiumSurface,
  type AppiumAdapterOptions,
} from "./surface.js";

export { registerAppiumAdapter, APPIUM_ADAPTER_NAME } from "./register.js";

export {
  appiumServerUrl,
  appiumUnreachable,
  capabilitiesFromEnv,
  connectWebdriverIo,
  webdriverIoClient,
  APPIUM_CAPS_ENV,
  APPIUM_URL_ENV,
  DEFAULT_APPIUM_URL,
  type AppiumClient,
  type AppiumConnectOptions,
  type ElementId,
  type WebdriverIoBrowser,
} from "./client.js";

export {
  classesForRole,
  isNativeContext,
  nativeStrategy,
  strategyFor,
  webviewStrategy,
  xpathLiteral,
  type Strategy,
} from "./locate.js";

export {
  boxOf,
  convertPageSource,
  nameOf,
  parseBounds,
  parsePageSource,
  roleOf,
  statesOf,
  unescapeXml,
  valueOf,
  xpathOf,
  type ConvertedNode,
  type ConvertOptions,
  type SourceNode,
} from "./page-source.js";

export { evaluateAppiumPredicate, literalValue, type AppiumCheckContext } from "./predicates.js";
export { maskPng, UnsupportedPng } from "./mask.js";
