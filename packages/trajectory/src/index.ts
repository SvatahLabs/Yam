/**
 * @svatah/trajectory
 *
 * An agent's exploration over the surface, captured and — from T5.5 — compiled
 * into a story draft, a plan fragment and `verified: false` bindings under
 * `proposals/` (REQ-BEH-4, LLD §13.4).
 *
 * Phase 4 builds the capture half (T4.6): the MCP raw-surface tools require an
 * `intent` per call, and this is the file they write. The compile half is
 * Phase 5's; the line shape here is what it will read.
 */
export {
  checkTrajectory,
  readTrajectory,
  trajectoryCallSchema,
  trajectoryLineSchema,
  TrajectoryWriter,
  type TrajectoryCall,
  type TrajectoryLine,
} from "./capture.js";
