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
 * The four functions a handler may call. Every one of them is the CLI's own.
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
}
