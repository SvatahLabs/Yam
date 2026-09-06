/**
 * `@svatah/yam-screens` — the headless screen model (T9.1, REQ-ADE-10, REQ-ADE-13,
 * LLD §13.7).
 *
 * > The ADE and the terminal cockpit `yam ui` are two renderers of one
 * > headless **screen model**, and both are views over the local service and
 * > nothing else. […] A screen's logic lives in `@svatah/yam-screens`; the ADE and
 * > `yam ui` render it and add nothing.
 *
 * Three things live here and nowhere else: the twelve screens, the action
 * registry behind every palette, and the key bindings both renderers read. The
 * package has no DOM, no terminal and no dependency on a runtime package —
 * `@svatah/yam-schema` for the wire shapes, and a `ScreenService` it is handed.
 */
export { SCREEN_IDS } from "./types.js";
export type {
  Action,
  ActionArgs,
  ActionOutcome,
  Binding,
  Pill,
  Screen,
  ScreenId,
  ScreenParams,
  ScreenStateBase,
  StatusTone,
} from "./types.js";

export type { ScreenService, ServiceEventLike, ServiceConnectionInfo } from "./service.js";

export { ACTIONS, actionById, actionsForScreen } from "./registry.js";

export { flowsScreen } from "./screens/flows.js";
export type { FlowsState, FlowRow, FlowLine, StepInspector } from "./screens/flows.js";

export { runScreen, applyEvent, runStateFrom, stamp, policyText } from "./screens/run.js";
export type { RunState, RunStepRow, RunStoryRow, AuditRow, RunInspector } from "./screens/run.js";

export { AUTHORING_SCREENS, applyHealEvent, applyRecordEvent, outcomeOf } from "./screens/authoring.js";
export type {
  BindingCandidate,
  BindingInspector,
  BindingRow,
  BindingsState,
  HealProposal,
  HealState,
  RecordDecision,
  RecordState,
  RunsFilters,
  RunsInspector,
  RunsRow,
  RunsState,
} from "./screens/authoring.js";

export {
  SECONDARY_SCREENS,
  apiResponseView,
  applyExplorerEvent,
  importResultView,
  snapshotLines,
} from "./screens/secondary.js";
export type {
  AgentsState,
  ApiRequestRow,
  ApiResponseView,
  ApiState,
  DataRow,
  DataState,
  ExplorerState,
  ImportState,
  SettingsState,
  SnapshotLine,
  TrajectoryCall,
} from "./screens/secondary.js";

export { fakeService, FakeNotFound } from "./fake.js";
export type { FakeResponses, FakeService, FakeCall } from "./fake.js";

export { Sources, dotted, plural } from "./load.js";
export { ago } from "./format.js";
export { parseBinding } from "./bindings.js";

export type * from "./shapes.js";

import { flowsScreen } from "./screens/flows.js";
import { runScreen } from "./screens/run.js";
import { AUTHORING_SCREENS } from "./screens/authoring.js";
import { SECONDARY_SCREENS } from "./screens/secondary.js";
import { SCREEN_IDS, type Screen, type ScreenId, type ScreenStateBase } from "./types.js";

/**
 * Every screen, in rail order (LLD §13.7's information architecture).
 *
 * Flows, Runs, Bindings, Agents and tools; Resources: API, Data; bottom: Import,
 * Settings — plus the three that are reached from another screen rather than
 * from the rail: `run` (from Runs or from starting one), `record` and `heal`
 * (from Flows and Run). `SCREENS` is the order the palette's "Go to" group and
 * the TUI's tree use.
 */
export const SCREENS: readonly Screen<ScreenStateBase>[] = [
  flowsScreen as Screen<ScreenStateBase>,
  runScreen as Screen<ScreenStateBase>,
  ...(AUTHORING_SCREENS as readonly Screen<ScreenStateBase>[]),
  ...(SECONDARY_SCREENS as readonly Screen<ScreenStateBase>[]),
];

/** One screen by id. Throws rather than answering `undefined`: ids are a union. */
export function screenById(id: ScreenId): Screen<ScreenStateBase> {
  const found = SCREENS.find((one) => one.id === id);
  if (found === undefined) throw new Error(`No screen with id "${id}".`);
  return found;
}

/**
 * The rail, as both renderers draw it (LLD §13.7).
 *
 * > Left rail: Flows, Runs, Bindings, Agents and tools; Resources: API, Data;
 * > bottom: Import prototype database, Settings.
 */
export const RAIL: ReadonlyArray<{
  readonly group: "Project" | "Resources" | "Bottom";
  readonly screen: ScreenId;
  readonly label: string;
}> = [
  { group: "Project", screen: "flows", label: "Flows" },
  { group: "Project", screen: "runs", label: "Runs" },
  { group: "Project", screen: "bindings", label: "Bindings" },
  { group: "Project", screen: "agents", label: "Agents and tools" },
  { group: "Resources", screen: "api", label: "API" },
  { group: "Resources", screen: "data", label: "Data" },
  { group: "Bottom", screen: "import", label: "Import prototype database" },
  { group: "Bottom", screen: "settings", label: "Settings" },
];

/** Every screen id has exactly one screen. The renderers rely on it; so does `--json`. */
export const EVERY_SCREEN_IS_MODELLED: boolean = SCREEN_IDS.every((id) =>
  SCREENS.some((screen) => screen.id === id),
);
