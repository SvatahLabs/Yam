/**
 * @svatah/yam-surface
 *
 * The published agent surface (REQ-SURF-1..5, LLD §2): the `AgentSurface`
 * interface every adapter implements, the adapter registry, the typed errors and
 * their failure classes, the snapshot text renderer, and the role tables that
 * normalise UIA, AX and Appium trees onto the ARIA vocabulary.
 *
 * The wire shapes are defined in `@svatah/yam-schema` and published as
 * `packages/schema/json/surface.*.schema.json`; they are re-exported here so an
 * adapter implementer needs one import.
 */

export type { ObservedEvent } from "./surface.js";
export type {
  AgentSurface,
  SurfaceMethod,
} from "./surface.js";
export {
  SURFACE_METHODS,
  REQUIRED_SURFACE_METHODS,
  NO_CAPABILITIES,
  capabilityForAction,
  missingCapabilities,
} from "./surface.js";

export {
  registerAdapter,
  unregisterAdapter,
  listAdapters,
  hasAdapter,
  clearAdapters,
  adapterFactory,
  createSurface,
  type AdapterFactory,
} from "./registry.js";

export {
  SurfaceError,
  LocateError,
  ActionabilityError,
  TimeoutError,
  CheckError,
  DialogError,
  NavigationError,
  ScriptError,
  SessionError,
  DataError,
  SURFACE_ERRORS,
  failureClassOf,
} from "./errors.js";

export { structuralHash, renderForHash, lengthBucket } from "./hash.js";

export {
  renderNode,
  renderSnapshot,
  estimateTokens,
  buildSnapshot,
  type RenderOptions,
} from "./render.js";

export {
  executableOf,
  launchApplication,
  processIdsOf,
  quitApplication,
  systemRunner,
  waitFor,
  type LaunchConfig,
  type LifecycleStep,
  type QuitConfig,
  type Runner,
} from "./lifecycle.js";

export {
  FALLBACK_ROLE,
  INTERACTIVE_ROLES,
  isInteractiveRole,
  AX_WINDOW_CHROME_SUBROLES,
  UIA_WINDOW_CHROME_IDS,
  isWindowChrome,
  UIA_ROLE_MAP,
  AX_ROLE_MAP,
  APPIUM_ANDROID_ROLE_MAP,
  ROLE_MAPS,
  normaliseRole,
  normalisedRoles,
  type RoleMapName,
} from "./roles.js";

export { LOCATE_RETURN_MARGIN_MS, locateDeadline } from "./locate.js";

// The wire shapes, re-exported so an adapter implementer imports one package.
export {
  CAPABILITY_FLAGS,
  NODE_STATES,
  SURFACE_ACTIONS,
  capabilitiesSchema,
  snapshotSchema,
  snapshotNodeSchema,
  sessionInitSchema,
  sessionStateSchema,
  elementDescriptionSchema,
  actArgsSchema,
  actResultSchema,
  checkResultSchema,
  surfaceActionSchema,
  surfaceSnapshotMessageSchema,
  surfaceActMessageSchema,
  surfaceCheckMessageSchema,
  surfaceReadMessageSchema,
  surfaceLocateMessageSchema,
  surfaceCapabilitiesMessageSchema,
  type ActArgs,
  type ActResult,
  type ApiRequest,
  type ApiResponse,
  type Candidate,
  type Capabilities,
  type CapabilityFlag,
  type CheckResult,
  type CheckSubject,
  type ElementDescription,
  type NodeState,
  type Predicate,
  type ReadKind,
  type Ref,
  type SessionInit,
  type SessionState,
  type Snapshot,
  type SnapshotNode,
  type SurfaceAction,
  type SurfaceKind,
} from "@svatah/yam-schema";
