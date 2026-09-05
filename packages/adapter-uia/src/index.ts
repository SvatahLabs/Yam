/**
 * `@svatah/adapter-uia` — the Windows UI Automation adapter (T6.1, REQ-ADP-6).
 *
 * The conformance target is the Svatah ADE, launched with `SVATAH_A11Y=1` so
 * Chromium publishes the renderer's accessibility tree (LLD §7.5, REQ-ADE-6).
 * See `README.md` for what this needs of a Windows host.
 */
export {
  powershellBridge,
  runPowershell,
  UiaBridgeError,
  type UiaAvailability,
  type UiaAvailabilityState,
  type UiaBridge,
  type UiaCommand,
  type UiaNode,
  type UiaWindow,
  type PowershellBridgeOptions,
} from "./bridge.js";
export {
  automationIdOf,
  childIndex,
  controlPathOf,
  convertTree,
  insideRow,
  isTextual,
  nameOf,
  roleOf,
  statesOf,
  valueOf,
  type ConvertOptions,
  type UiaSnapshotNode,
} from "./tree.js";
export { matchNodes, synthesise } from "./locate.js";
export { evaluateUiaPredicate, literalValue, type UiaCheckContext } from "./predicates.js";
export {
  UiaSurface,
  UIA_CAPABILITIES,
  createUiaSurface,
  escapeSendKeys,
  sendKeysFor,
  type UiaAdapterOptions,
} from "./surface.js";
export { registerUiaAdapter, UIA_ADAPTER_NAME } from "./register.js";
