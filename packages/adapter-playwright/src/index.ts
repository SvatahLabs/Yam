/**
 * @svatah/adapter-playwright
 *
 * The default web adapter (REQ-ADP-1, LLD §7.1): `AgentSurface` implemented on
 * Playwright. It is consumed as an adapter, not as the core — nothing above the
 * surface imports this package except the CLI, which registers it, and
 * `@svatah/playwright-test`, which hosts it (LLD §1).
 */
export {
  PlaywrightSurface,
  PLAYWRIGHT_CAPABILITIES,
  createPlaywrightSurface,
  translate,
  type BrowserName,
  type PlaywrightAdapterOptions,
} from "./surface.js";

export { registerPlaywrightAdapter, PLAYWRIGHT_ADAPTER_NAME } from "./register.js";

export {
  takeSnapshot,
  parseAiSnapshot,
  chooseMechanism,
  playwrightMechanismAvailable,
  ariaSnapshotText,
  RefSpace,
  DEFAULT_MAX_NODES,
  REGISTRY,
  type SnapshotMechanism,
  type SnapshotOptions,
} from "./snapshot.js";

// The structural hash of LLD §6.2 lives in `@svatah/surface`, where both an
// adapter and `@svatah/bindings` can reach it (LLD §1). Re-exported so an adapter
// implementer needs one import.
export { structuralHash, renderForHash, lengthBucket } from "@svatah/surface";

export { locatorFor, coordsOf } from "./locate.js";
export { evaluatePredicate, type CheckContext } from "./predicates.js";
export { literalValue } from "./values.js";
export { walkDocument, describeElement, type RawNode, type RawDescription } from "./page-script.js";
export {
  callTool,
  declaredTools,
  declaresTool,
  type DeclaredTool,
  type ToolCall,
} from "./webmcp.js";
