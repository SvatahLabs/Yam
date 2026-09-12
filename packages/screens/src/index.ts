/**
 * `@svatah/yam-screens` — the headless screen model (T9.1, REQ-ADE-10, REQ-ADE-13,
 * LLD §13.7).
 *
 * > The app and the terminal cockpit `yam ui` are two renderers of one
 * > headless **screen model**, and both are views over the local service and
 * > nothing else. […] A screen's logic lives in `@svatah/yam-screens`; the app and
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
  ActionInput,
  ActionOutcome,
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

export { AUTHORING_SCREENS, applyHealEvent, applyRecordEvent, loadRecord, outcomeOf } from "./screens/authoring.js";
export type {
  BindingCandidate,
  BindingInspector,
  BindingRow,
  BindingsState,
  HealProposal,
  HealState,
  RecordDecision,
  RecordView,
  RunsFilters,
  RunsInspector,
  RunsRow,
  RunsState,
} from "./screens/authoring.js";

export { sessionScreen, modeFrom, SESSION_MODES } from "./screens/session.js";
export type {
  SessionState,
  SessionMode,
  SayView,
  SaidSentence,
} from "./screens/session.js";
export type { SurfaceLoad } from "./screens/surfaces.js";
export type { RecordLoad } from "./screens/authoring.js";

export { DESKTOP_HOLDER } from "./holder.js";

export {
  loadSurface,
  TREE_MAX_NODES,
  envelopeError,
  platformGroups,
  problemFor,
  surfaceOutcomeView,
  treeLines,
} from "./screens/surfaces.js";
export type {
  SurfaceView,
  SurfaceAdapterRow,
  SurfaceTargetRow,
  SurfacePlatformGroup,
  SurfaceSessionRow,
  SurfaceTreeLine,
  SurfaceElementView,
  SurfaceActionField,
  SurfaceActionOffer,
  SurfaceSessionView,
  SurfaceProblem,
  SurfaceProblemKind,
  SurfaceOutcomeView,
  SurfaceAgentSetup,
} from "./screens/surfaces.js";

export {
  SECONDARY_SCREENS,
  apiResponseView,
  importResultView,
} from "./screens/secondary.js";
export type {
  AgentsState,
  ApiRequestRow,
  ApiResponseView,
  ApiState,
  DataRow,
  DataState,
  ImportState,
  SettingsState,
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
import { sessionScreen } from "./screens/session.js";
import { SCREEN_IDS, type Screen, type ScreenId, type ScreenStateBase } from "./types.js";

/**
 * Every screen, in rail order (LLD §13.7's information architecture).
 *
 * Surfaces first (T14), then the automation screens, Activity's runs and
 * Settings — plus the three reached from another screen rather than from the
 * rail: `run` (from Runs or from starting one), `record` and `heal` (from Flows
 * and Run). `SCREENS` is the order the palette's "Go to" group and the TUI's
 * tree use.
 */
export const SCREENS: readonly Screen<ScreenStateBase>[] = [
  sessionScreen as unknown as Screen<ScreenStateBase>,
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
 * Primary navigation, surface-first (T14, SF-02, SF-16).
 *
 * > Primary navigation is Surfaces, Automations, Activity, Settings. Surfaces
 * > opens by default. Flows, recording, binding repair and tool publishing move
 * > under Automations […]; run evidence moves under Activity.
 *
 * Four sections, each with a sub-rail of the screens it holds and the screen it
 * opens on. This supersedes the flat Flows/Runs/Bindings… rail of Draft 2.11
 * (LLD §13.7); the screens themselves are unchanged, only where they are
 * reached from. The three screens reached from another screen rather than a
 * rail — `record`, `run`, `heal` — are not on any sub-rail and stay reachable
 * through the palette's Go-to rows.
 */
/**
 * The four destinations (`SF-16`, `REQ-ADE-11`).
 *
 * Draft 2.27 renamed the first: Surfaces became **Session**, one screen over one
 * broker session with record, say and do modes, because the three ways of
 * writing a flow disagree about who is driving and not about what is made.
 */
export type SectionId = "session" | "automations" | "activity" | "settings";

export interface Section {
  readonly id: SectionId;
  readonly label: string;
  /** The screens on this section's sub-rail, in order; the first is its default. */
  readonly rail: readonly ScreenId[];
}

export const SECTIONS: readonly Section[] = [
  { id: "session", label: "Session", rail: ["session"] },
  { id: "automations", label: "Automations", rail: ["flows", "bindings", "agents", "api", "data", "import"] },
  { id: "activity", label: "Activity", rail: ["runs"] },
  { id: "settings", label: "Settings", rail: ["settings"] },
];

/** The section a screen belongs to, including the palette-only screens. */
const SECTION_OF_EXTRA: Readonly<Record<string, SectionId>> = {
  heal: "automations",
  run: "activity",
};

export function sectionOf(screen: ScreenId): SectionId {
  for (const section of SECTIONS) if (section.rail.includes(screen)) return section.id;
  return SECTION_OF_EXTRA[screen] ?? "session";
}

/** The screen a section opens on: the first row of its sub-rail. */
export function defaultScreenOf(section: SectionId): ScreenId {
  return SECTIONS.find((one) => one.id === section)?.rail[0] ?? "session";
}

/**
 * The flat rail of Draft 2.11, kept as the union of the sections' sub-rails.
 *
 * Nothing new reads it — `SECTIONS` is the navigation now — but the label table
 * is still the one both renderers draw a rail row with, so it is derived from
 * the sections rather than deleted, and stays in step with them by construction.
 */
const RAIL_LABEL: Readonly<Record<ScreenId, string>> = {
  session: "Session",
  flows: "Flows",
  runs: "Runs",
  bindings: "Bindings",
  agents: "Agents and tools",
  api: "API",
  data: "Data",
  import: "Import prototype database",
  settings: "Settings",
  run: "Run",
  heal: "Heal review",
};

export const RAIL: ReadonlyArray<{
  readonly section: SectionId;
  readonly screen: ScreenId;
  readonly label: string;
}> = SECTIONS.flatMap((section) =>
  section.rail.map((screen) => ({ section: section.id, screen, label: RAIL_LABEL[screen] })),
);

/** Every screen id has exactly one screen. The renderers rely on it; so does `--json`. */
export const EVERY_SCREEN_IS_MODELLED: boolean = SCREEN_IDS.every((id) =>
  SCREENS.some((screen) => screen.id === id),
);
