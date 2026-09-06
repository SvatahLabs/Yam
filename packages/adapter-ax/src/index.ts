/**
 * `@svatah/adapter-ax` — the macOS Accessibility adapter (T6.2, REQ-ADP-7).
 *
 * The conformance target is the Svatah ADE, launched with `SVATAH_A11Y=1` so
 * Chromium publishes the renderer's accessibility tree (LLD §7.5, REQ-ADE-6).
 * See `README.md` for the permission this needs and how to grant it.
 */
export {
  machineLoad,
  osascriptBridge,
  parseWindow,
  runOsascript,
  PERFORM_SCRIPT,
  AxBridgeError,
  type AxBridge,
  type AxCommand,
  type AxNode,
  type AxPermission,
  type AxPermissionState,
  type AxSnapshotCost,
  type AxWindow,
  type OsascriptLanguage,
  type OsascriptBridgeOptions,
} from "./bridge.js";
export {
  AX_SUBROLE_MAP,
  AX_SUBROLE_NAME,
  automationIdOf,
  childIndex,
  controlPathOf,
  convertTree,
  insidePopUp,
  isTextual,
  nameOf,
  roleOf,
  statesOf,
  valueOf,
  type AxSnapshotNode,
  type ConvertOptions,
} from "./tree.js";
export { matchNodes, synthesise } from "./locate.js";
export { evaluateAxPredicate, literalValue, type AxCheckContext } from "./predicates.js";
export {
  AxSurface,
  AX_CAPABILITIES,
  createAxSurface,
  keyChord,
  type AxAdapterOptions,
} from "./surface.js";
export { registerAxAdapter, AX_ADAPTER_NAME } from "./register.js";
