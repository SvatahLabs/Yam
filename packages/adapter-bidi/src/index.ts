/**
 * @svatah/yam-adapter-bidi
 *
 * The WebDriver BiDi adapter (REQ-ADP-4, LLD §7.3): `AgentSurface` over the W3C
 * protocol, against stock browsers, with no driver SDK and no patched build.
 *
 * It exists to prove the surface boundary (HLD ADR-8). Nothing here shares a
 * line with `@svatah/yam-adapter-playwright` — a WebSocket, a command table, an
 * injected script — so a plan that replays identically through both is evidence
 * that the boundary is real rather than a description of Playwright.
 *
 * ```ts
 * const surface = createBidiSurface(config);
 * await surface.open({ baseUrl: "http://127.0.0.1:4173" });
 * const snapshot = await surface.snapshot();
 * ```
 */
export {
  BidiSurface,
  BIDI_CAPABILITIES,
  cookiesFor,
  createBidiSurface,
  type BidiAdapterOptions,
  type BidiCookie,
} from "./surface.js";

export { registerBidiAdapter, BIDI_ADAPTER_NAME } from "./register.js";

export {
  BidiClient,
  BidiError,
  type BidiClientOptions,
  type BidiEvent,
  type BidiEventHandler,
} from "./client.js";

export {
  bidiAvailable,
  findGecko,
  openEndpoint,
  BIDI_BROWSER_ENV,
  BIDI_URL_ENV,
  type BidiEndpoint,
  type LaunchOptions,
} from "./launch.js";

export {
  BidiSession,
  RefSpace,
  fromRemoteValue,
  toLocalValue,
  type ContextId,
} from "./session.js";

export {
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

export { keyActions, keyValue, pointerClick, pointerDrag, typeText } from "./input.js";
export { evaluateBidiPredicate, literalValue } from "./predicates.js";
