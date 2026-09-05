/**
 * Tier 0 custom typed steps (REQ-LANG-15, 16, LLD §5).
 *
 * The prose model needs an escape hatch for logic, and this is it: a `steps/`
 * directory of TypeScript files, each exporting a template sentence and a
 * handler. Templates are matched **before** the grammar, so a project can claim
 * a sentence shape the grammar would otherwise have taken.
 *
 * The handler receives a `StepContext` and nothing else. What is *not* on it is
 * the point: no `page`, no driver, no adapter. A custom step that reached the
 * adapter would be a step no other adapter could run, and the whole contract is
 * that a plan runs anywhere an adapter exists (REQ-SURF-2, REQ-STD-3). Making it
 * a type rather than a convention is what stops that happening by accident.
 */
import type { AgentSurface } from "@svatah/surface";
import type { Predicate, Ref, TargetRef, ValueRef } from "@svatah/schema";

/** The placeholder types a template may declare (LLD §5). */
export const PLACEHOLDER_TYPES = ["string", "number", "boolean", "target", "value"] as const;
export type PlaceholderType = (typeof PLACEHOLDER_TYPES)[number];

/**
 * `t` — the placeholder types, named, for anyone writing a template in code
 * rather than in a string (LLD §5 imports it alongside `defineStep`).
 */
export const t = {
  string: "string",
  number: "number",
  boolean: "boolean",
  target: "target",
  value: "value",
} as const satisfies Record<PlaceholderType, PlaceholderType>;

export interface Placeholder {
  readonly name: string;
  readonly type: PlaceholderType;
}

/** What `defineStep`'s second argument may say. */
export interface StepMeta {
  /**
   * The step changes something the run cannot undo (REQ-AUTO-8). Copied onto the
   * IR step's `sideEffect`, so lint can warn when a story containing it is
   * exposed as a tool without being marked `idempotent`.
   */
  readonly sideEffect?: boolean;
  /** One line, shown by `svatah lint` and by the ADE's step list. */
  readonly description?: string;
  /** Overrides `config.run.stepTimeoutMs` for this step. */
  readonly timeoutMs?: number;
}

/**
 * The arguments a handler receives.
 *
 * `target` placeholders arrive as `TargetRef`s to be passed to `resolve`; every
 * other placeholder arrives as an already-resolved value, because the executor
 * has the scope and the handler does not.
 */
export type StepArgs = Readonly<Record<string, unknown>>;

/**
 * What a handler can do.
 *
 * Deliberately small, and deliberately all of it above the surface:
 *
 * * `surface` — the published `AgentSurface`. Every adapter implements it, so a
 *   custom step written against it runs on all of them.
 * * `resolve` — a `TargetRef` to a live `Ref`, through the bindings store and
 *   the resolver, exactly as a grammar step's target is resolved (LLD §6.3).
 * * `scope` — read run data, inputs and captures; capture a new value.
 * * `expect` — assert a predicate, so a custom step fails the way every other
 *   step fails rather than by throwing something the runtime has to guess about.
 * * `audit` — a line in `audit.jsonl` (REQ-AUTO-6).
 * * `log` — the run's JSON-lines log (REQ-NFR-5).
 *
 * There is no adapter here, and no way to get one.
 */
export interface StepContext<A extends StepArgs = StepArgs> {
  readonly surface: AgentSurface;
  readonly args: A;
  resolve(target: TargetRef): Promise<Ref>;
  readonly scope: StepScope;
  expect(subject: Ref | "page" | "dialog", predicate: Predicate): Promise<void>;
  audit(detail: Record<string, unknown>): void;
  log(message: string, detail?: Record<string, unknown>): void;
  /** How long the step has left, so a handler that loops can stop in time. */
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

/** The slice of the run's scope a custom step may touch (LLD §8.5). */
export interface StepScope {
  /** Resolve a `ValueRef` — a literal, a capture, an input, or run data. */
  read(ref: ValueRef): unknown;
  /** Capture a value under a name. Re-capturing an existing name is an error. */
  capture(name: string, value: unknown): void;
  /** Run-level data, read-only (REQ-RUN-6). */
  readonly data: Readonly<Record<string, unknown>>;
  /** The current story's inputs. */
  readonly inputs: Readonly<Record<string, unknown>>;
}

export type StepHandler<A extends StepArgs = StepArgs> = (
  context: StepContext<A>,
) => Promise<void> | void;

/** What `defineStep` returns, and what a `steps/*.ts` file exports. */
export interface CustomStep<A extends StepArgs = StepArgs> {
  readonly template: string;
  readonly meta: StepMeta;
  readonly handler: StepHandler<A>;
  readonly placeholders: readonly Placeholder[];
  /**
   * `<file>#<export>` — set by the loader, because a definition does not know
   * where it was written. Empty until then.
   */
  readonly id: string;
}

/** Discriminates a `CustomStep` from anything else a module might export. */
export const CUSTOM_STEP = Symbol.for("svatah.customStep");

export function isCustomStep(value: unknown): value is CustomStep {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[CUSTOM_STEP] === true
  );
}
