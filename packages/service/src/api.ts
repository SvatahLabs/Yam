/**
 * What the service is given, rather than what it imports (LLD §13.5).
 *
 * "Every handler calls the same functions the CLI calls; no logic lives in the
 * service." The first draft satisfied that by importing `@svatah/yam` — and made
 * the workspace graph cyclic, because the CLI mounts `yam serve`. A clean
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
import type { StepResult, Summary } from "@svatah/yam-schema";

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
 * that is the app's screen rule read from this side (LLD §13.6): a handler that
 * needed a fifth capability nobody could reach from a command line would be the
 * service growing logic of its own.
 */
export interface ServiceApi {
  loadProject(root: string): Promise<ProjectHandle>;
  /**
   * Is a model credential available to this service (REQ-ADE-4, Draft 2.7)?
   *
   * `GET /project` reports the answer so the Record screen can offer
   * `anthropic` when there is one and `fake` when there is not. Deliberately a
   * boolean and not the key: the app never needs the value, and a service that
   * handed it out over HTTP — even on loopback, even behind the bearer token —
   * would be a place a credential leaks from (REQ-NFR-6).
   *
   * Optional, like the rest: a build with no gateway wired reports `false`,
   * which is the truth for it.
   */
  hasModelCredential?(): boolean;
  /** Draft 2.21: whether a person at this machine can click in a headed browser (the human gateway). */
  hasDisplay?(): boolean;
  compileProject(loaded: ProjectHandle, options?: { stable?: boolean }): CompileOutcome;
  runProject(
    loaded: ProjectHandle,
    options?: {
      runId?: string;
      flows?: readonly string[];
      stories?: readonly string[];
      inputs?: Record<string, unknown>;
      onResult?: (result: StepResult) => void;
      /**
       * Cancel this run between steps (Draft 2.12 §13.5, T10.4).
       *
       * `POST /runs/:id/stop` aborts it. The executor notices before the next
       * step starts — never during one, because a step that has clicked has
       * already changed the application — records the rest as `skipped`, writes
       * a `stop` audit line and marks the summary `stopped`.
       */
      signal?: AbortSignal;
    },
  ): Promise<RunOutcome>;
  newRunId(): string;
  /**
   * Execute one `ApiRequest` ad hoc, for the app's API client (LLD §13.5).
   *
   * The HTTP adapter is module (b)'s and the service imports only
   * `@svatah/yam-schema`, so this arrives the same way the others do. `yam run`
   * calls the same function for an `api` step, which is what keeps the app's API
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
   * and waits for the client's answer. `yam record` passes no reviewer and
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
    /** A line about what the session is doing (Draft 2.21). */
    log?: (message: string) => void;
      review?: (proposal: unknown) => Promise<unknown>;
      /** Handed the live surface, so the picker can snapshot the driven session. */
      onSurface?: (surface: unknown) => void;
      signal?: AbortSignal;
    },
  ): Promise<unknown>;

  /**
   * Record a flow from what a person does (LLD §13.5's `POST /capture`, Draft 2.23).
   *
   * The other recording — `record` above — drives a flow somebody wrote and
   * binds its targets. This one writes the flow: the browser opens at the
   * application, the person drives, each sentence is reported through `onStep`
   * as it is written, and `signal` ends the session. The flow file and the
   * bindings are written when it ends, which is why `POST /capture/{id}/stop`
   * is the *only* way it finishes — a capture nobody stopped has written
   * nothing.
   */
  capture?(
    loaded: ProjectHandle,
    options: {
      /** The story's name; the service names it for the client that did not. */
      name?: string;
      onStep?: (sentence: string) => void;
      log?: (message: string) => void;
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
   * The surface operations, as the catalogue defines them (SF-03, T12).
   *
   * The service may not import `surface-control` — it may import the CLI's
   * command functions and `schema`, and nothing else (LLD §1) — so the
   * catalogue is *handed* to it, one descriptor per operation, and the routes
   * are registered from that list rather than written out here.
   *
   * That is what makes one source true rather than aspirational. Wave 2's first
   * cut generated an OpenAPI document from the catalogue and left the service
   * serving hand-written routes beside it, so an argument added to the
   * catalogue reached the CLI and MCP and not the HTTP API, and the generated
   * document described an API nobody served.
   */
  surfaceOperations?: ReadonlyArray<{
    readonly name: string;
    readonly method: "GET" | "POST" | "DELETE";
    /** As the catalogue writes it, with `:session` for the path parameter. */
    readonly path: string;
    readonly run: (args: Record<string, unknown>) => Promise<unknown>;
  }>;


  /** Compile a captured trajectory into `proposals/<date>/` (T5.5). */
  compileTrajectory?(
    loaded: ProjectHandle,
    options: { path?: string; lines?: readonly unknown[]; name?: string },
  ): Promise<unknown>;

  /** The tools a project would expose, and the invocations one has served. */
  toolsFor?(loaded: ProjectHandle, options?: { expose?: string }): Promise<unknown>;

  /* ── T6.6: the prototype database import (REQ-ADE-9, LLD §13.5) ────────── */

  /**
   * Import a Yam prototype's electron-db directory into this project.
   *
   * Into *this* project, deliberately: the service confines every write to the
   * directory it was opened on, and an import that could write anywhere would
   * be the one route around that. The app's flow is therefore "open an empty
   * directory as a project, then import into it", which is also what
   * `yam migrate <dest> --from-prototype <src>` does.
   *
   * The source is a path outside the project, and reading it is the point.
   */
  migrateFromPrototype?(
    loaded: ProjectHandle,
    options: { source: string; project?: string },
  ): Promise<unknown>;
}
