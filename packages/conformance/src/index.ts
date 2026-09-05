/**
 * @svatah/conformance
 *
 * The published conformance suites (REQ-STD-2). An adapter is "conformant" only
 * when the surface suite passes against it (REQ-SURF-3), and a third party can
 * run these against their own adapter or runtime without any of Svatah's
 * internals: the suite is handed an `AgentSurface` and knows nothing else.
 *
 * The runtime suite (plans plus bindings plus expected results, for foreign
 * runtimes) arrives with the executor in Phase 2.
 */
export { SURFACE_CASES } from "./surface/cases.js";
export { runSurfaceConformance, type RunOptions } from "./surface/run.js";
export { renderReport, renderMarkdown } from "./surface/report.js";
export type {
  CaseContext,
  CaseReport,
  CheckResult,
  ConformanceCase,
  ConformanceReport,
} from "./surface/types.js";
