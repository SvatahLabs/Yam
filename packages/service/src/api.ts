/**
 * What the service is given, rather than what it imports (LLD §13.5).
 *
 * "Every handler calls the same functions the CLI calls; no logic lives in the
 * service." The first draft satisfied that by importing `@svatah/cli` — and made
 * the workspace graph cyclic, because the CLI mounts `svatah serve`. A clean
 * clone then failed to build: pnpm picked an order and the service's type build
 * ran before the CLI had any types to offer.
 *
 * So the functions are *injected*. The dependency points one way — `cli ─►
 * service` — and the rule is now stronger than the lint could make it: the
 * service does not merely refrain from importing the compiler or the executor,
 * it has no way to reach them. What it can do is exactly this interface.
 *
 * It also makes the service testable without a browser: a fake `api` is four
 * functions.
 */
import type { StepResult, Summary } from "@svatah/schema";

/** A project, as the CLI loaded it. Structural, so the service imports nothing. */
export interface ProjectHandle {
  readonly root: string;
  readonly config: {
    readonly project: string;
    readonly flows: { readonly dir: string };
    readonly bindings: { readonly dir: string };
    readonly run: { readonly outputDir: string };
    readonly [key: string]: unknown;
  };
  readonly project: {
    readonly flows: ReadonlyArray<{ readonly file: string }>;
    readonly stories: ReadonlyMap<
      string,
      { readonly story: { kind: string; steps: readonly unknown[]; signature?: unknown }; readonly file: string }
    >;
    readonly compositions: ReadonlyMap<string, { readonly names: readonly string[] }>;
    readonly runs: ReadonlyMap<string, readonly string[]>;
    readonly apis: { readonly requests: ReadonlyMap<string, unknown> };
    readonly data: {
      readonly values: Readonly<Record<string, unknown>>;
      readonly secrets: ReadonlySet<string>;
    };
  };
  readonly steps: { ids(): string[] };
  readonly diagnostics: ReadonlyArray<{ readonly severity: string; readonly [key: string]: unknown }>;
}

export interface CompileOutcome {
  readonly plan: { readonly hash: string; readonly stories: readonly unknown[] };
  readonly diagnostics: ReadonlyArray<{ readonly severity: string; readonly [key: string]: unknown }>;
}

export interface RunOutcome {
  readonly runId: string;
  readonly summary: Summary;
  readonly results: readonly StepResult[];
}

/**
 * The functions a handler may call. Every one of them is the CLI's own.
 *
 * The list grows only when a screen needs something the CLI can already do —
 * that is the ADE's screen rule read from this side (LLD §13.6): a handler that
 * needed a fifth capability nobody could reach from a command line would be the
 * service growing logic of its own.
 */
export interface ServiceApi {
  loadProject(root: string): Promise<ProjectHandle>;
  compileProject(loaded: ProjectHandle, options?: { stable?: boolean }): CompileOutcome;
  runProject(
    loaded: ProjectHandle,
    options?: {
      runId?: string;
      flows?: readonly string[];
      stories?: readonly string[];
      inputs?: Record<string, unknown>;
      onResult?: (result: StepResult) => void;
    },
  ): Promise<RunOutcome>;
  newRunId(): string;
  /**
   * Execute one `ApiRequest` ad hoc, for the ADE's API client (LLD §13.5).
   *
   * The HTTP adapter is module (b)'s and the service imports only
   * `@svatah/schema`, so this arrives the same way the others do. `svatah run`
   * calls the same function for an `api` step, which is what keeps the ADE's API
   * client from being a second HTTP client with its own idea of a header.
   */
  apiRequest?(
    loaded: ProjectHandle,
    request: unknown,
    options?: { withSessionCookies?: boolean },
  ): Promise<unknown>;

  /* ── T5.7: record with review, bindings, heal (REQ-ADE-4, 5) ───────────── */

  /**
   * Start a recording session (LLD §13.5's `POST /record`).
   *
   * `review` is called once per target, *before* the binding is written
   * (REQ-ADE-4), and the service turns each call into a `record.decision` event
   * and waits for the client's answer. `svatah record` passes no reviewer and
   * behaves exactly as it did.
   */
  record?(
    loaded: ProjectHandle,
    options: {
      stories?: readonly string[];
      flows?: readonly string[];
      rebind?: boolean;
      headed?: boolean;
      gateway?: string;
      inputs?: Record<string, unknown>;
      onStep?: (step: unknown) => void;
      review?: (proposal: unknown) => Promise<unknown>;
      /** Handed the live surface, so the picker can snapshot the driven session. */
      onSurface?: (surface: unknown) => void;
      signal?: AbortSignal;
    },
  ): Promise<unknown>;

  /** Dry-resolve every binding, or one (LLD §13.5's `POST /bindings/verify`). */
  verifyBindings?(
    loaded: ProjectHandle,
    options?: { id?: string; headed?: boolean },
  ): Promise<unknown>;

  /** Heal a run, and apply the repairs when asked (LLD §13.5's `POST /heal`). */
  heal?(
    loaded: ProjectHandle,
    options: {
      runId: string;
      useModel?: boolean;
      apply?: boolean;
      inputs?: Record<string, unknown>;
      onProposal?: (proposal: unknown) => void;
    },
  ): Promise<unknown>;

  /* ── T5.8: the surface explorer and the tool panel (REQ-ADE-8) ─────────── */

  /**
   * Open a surface session an agent — or the ADE's explorer — drives call by
   * call, writing `trajectory.jsonl` (LLD §13.5's `POST /surface/:sessionId/*`).
   */
  openSurfaceSession?(
    loaded: ProjectHandle,
    options: { sessionId: string; headed?: boolean },
  ): Promise<{
    call(
      call: "snapshot" | "act" | "read" | "check",
      args: Record<string, unknown>,
    ): Promise<unknown>;
    trajectoryPath: string;
    close(): Promise<void>;
  }>;

  /** Compile a captured trajectory into `proposals/<date>/` (T5.5). */
  compileTrajectory?(
    loaded: ProjectHandle,
    options: { path: string; name?: string },
  ): Promise<unknown>;

  /** The tools a project would expose, and the invocations one has served. */
  toolsFor?(loaded: ProjectHandle, options?: { expose?: string }): Promise<unknown>;
}
