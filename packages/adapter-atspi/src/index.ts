export { AtspiSurface, createAtspiSurface, atspiAvailability, type AtspiSurfaceOptions } from "./surface.js";
export { registerAtspiAdapter, ATSPI_ADAPTER } from "./register.js";
export {
  pythonBridge,
  parseTree,
  runProcess,
  AtspiBridgeError,
  WALK_SCRIPT,
  PERFORM_SCRIPT,
  type AtspiBridge,
  type AtspiNode,
  type AtspiWindow,
  type AtspiCommand,
  type AtspiAvailability,
  type Run,
} from "./bridge.js";
export {
  buildNodes,
  roleOf,
  nameOf,
  statesOf,
  valueOf,
  automationIdOf,
  isInteractive,
  actionFor,
  ACTION_PREFERENCE,
  type BuiltNode,
} from "./tree.js";
