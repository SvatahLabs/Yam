import type {
  ActArgs,
  ActResult,
  ApiRequest,
  ApiResponse,
  Candidate,
  Capabilities,
  CheckResult,
  CheckSubject,
  ElementDescription,
  Predicate,
  ReadKind,
  Ref,
  SessionInit,
  SessionState,
  Snapshot,
  SurfaceAction,
  SurfaceKind,
} from "@svatah/schema";

/**
 * The agent surface (LLD §2.1, REQ-SURF-1).
 *
 * This is the only way down. Nothing above it knows a locator, a protocol or a
 * platform (REQ-SURF-2, REQ-SURF-5): callers address elements by reference, or by
 * handing a stored `Candidate` to `locate`. Every adapter — Playwright, BiDi,
 * Appium, UIA, AX, AT-SPI, HTTP — implements exactly this interface, and an
 * adapter is "conformant" only when the conformance suite passes against it
 * (REQ-SURF-3).
 */
export interface AgentSurface {
  readonly kind: SurfaceKind;

  /** Which optional features this adapter has (LLD §2.4). */
  capabilities(): Capabilities;

  open(session: SessionInit): Promise<void>;
  close(): Promise<void>;

  /** A semantic tree with stable references, normalised across adapters (LLD §2.2). */
  snapshot(opts?: {
    root?: Ref;
    maxNodes?: number;
    interactiveOnly?: boolean;
  }): Promise<Snapshot>;

  act(action: SurfaceAction, ref?: Ref, args?: ActArgs, ref2?: Ref): Promise<ActResult>;

  read(kind: ReadKind, ref?: Ref, name?: string): Promise<unknown>;

  check(predicate: Predicate, subject: CheckSubject, ref?: Ref): Promise<CheckResult>;

  /** Candidate to references: 0, 1 or many. The resolver requires exactly one (LLD §6.3). */
  locate(candidate: Candidate): Promise<Ref[]>;

  /** Everything candidate synthesis and fingerprinting need from one element. */
  describe(ref: Ref): Promise<ElementDescription>;

  /** `mask` hides the boxes of secret-injecting elements (REQ-NFR-6). */
  screenshot(path: string, mask?: Ref[]): Promise<void>;

  /** The restorable subset of session state; what a checkpoint stores (REQ-AUTO-2). */
  state(): Promise<SessionState>;

  restore(state: SessionState): Promise<void>;

  /** Optional: adapter tracing. Present when `capabilities().trace`. */
  trace?(start: boolean, path?: string): Promise<void>;

  /** Optional: HTTP-capable adapters (REQ-ADP-2, REQ-ADP-3). */
  request?(req: ApiRequest, opts: { withSessionCookies: boolean }): Promise<ApiResponse>;
}

/** Every method name on `AgentSurface`, required first, then the optional ones. */
export const SURFACE_METHODS = [
  "capabilities",
  "open",
  "close",
  "snapshot",
  "act",
  "read",
  "check",
  "locate",
  "describe",
  "screenshot",
  "state",
  "restore",
  "trace",
  "request",
] as const;
export type SurfaceMethod = (typeof SURFACE_METHODS)[number];

/** The methods every adapter must implement; `trace` and `request` are optional. */
export const REQUIRED_SURFACE_METHODS = SURFACE_METHODS.filter(
  (m): m is Exclude<SurfaceMethod, "trace" | "request"> => m !== "trace" && m !== "request",
);

/** All capability flags default to false, so an adapter opts in to what it supports. */
export const NO_CAPABILITIES: Capabilities = {
  dialogs: false,
  frames: false,
  windows: false,
  upload: false,
  drag: false,
  trace: false,
  webmcp: false,
  screenshot: false,
  restore: false,
};

/**
 * Which capability an action needs, if any (LLD §2.4).
 *
 * The executor checks a plan against the adapter's capabilities at start, not
 * mid-run, so a missing feature is a refusal to begin rather than a failure
 * halfway through a flow.
 */
const ACTION_CAPABILITY: Partial<Record<SurfaceAction, keyof Capabilities>> = {
  dialog: "dialogs",
  switchFrame: "frames",
  switchWindow: "windows",
  closeOtherWindows: "windows",
  upload: "upload",
  dragTo: "drag",
  screenshot: "screenshot",
};

/** The capability an action requires, or `undefined` when every adapter must support it. */
export function capabilityForAction(action: SurfaceAction): keyof Capabilities | undefined {
  return ACTION_CAPABILITY[action];
}

/**
 * The capabilities a set of actions needs but the adapter lacks. Empty means the
 * plan can start.
 */
export function missingCapabilities(
  actions: readonly SurfaceAction[],
  capabilities: Capabilities,
): Array<keyof Capabilities> {
  const needed = new Set<keyof Capabilities>();
  for (const action of actions) {
    const capability = capabilityForAction(action);
    if (capability !== undefined && !capabilities[capability]) needed.add(capability);
  }
  return [...needed].sort();
}
