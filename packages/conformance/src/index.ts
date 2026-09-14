/**
 * @svatah/yam-conformance
 *
 * The published conformance suites (REQ-STD-2). An adapter is "conformant" only
 * when the surface suite passes against it (REQ-SURF-3), and a third party can
 * run these against their own adapter or runtime without any of Yam's
 * internals: the suite is handed an `AgentSurface` and knows nothing else.
 *
 * The runtime suite (plans plus bindings plus expected results, for foreign
 * runtimes) arrives with the executor in Phase 2.
 */
export { SURFACE_CASES } from "./surface/cases.js";
/** The desktop suite: the Yam app, for the UIA and AX adapters (LLD §16). */
export { DESKTOP_CASES, DESKTOP_HEALING_CASES } from "./surface/desktop.js";
export { runSurfaceConformance, type RunOptions } from "./surface/run.js";
export { renderReport, renderMarkdown } from "./surface/report.js";
export type {
  BridgeCost,
  CaseContext,
  DesktopHealing,
  HealCandidate,
  HealOutcome,
  RecordedElement,
  CaseReport,
  CheckResult,
  ConformanceCase,
  ConformanceReport,
} from "./surface/types.js";
