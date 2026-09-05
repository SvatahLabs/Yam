/**
 * A stub surface and a plan builder, for the executor's tests (T2.7 Validate).
 *
 * The executor's contract is about *orchestration* — which steps run, in which
 * order, what a policy does, what a guard prevents — and none of that is about a
 * browser. Driving a real one would make the interesting cases slow to arrange
 * and would test the adapter at the same time, so the failures would be
 * ambiguous.
 *
 * The stub records every call, so a test can assert what the executor did *not*
 * do — which is most of what a guard's contract is (REQ-AUTO-1: "never performs
 * the action").
 */
import {
  SCHEMA_VERSION,
  planHash,
  type ActResult,
  type Candidate,
  type Capabilities,
  type CheckResult,
  type Config,
  type ElementDescription,
  type Plan,
  type Predicate,
  type Ref,
  type SessionState,
  type Snapshot,
  type Step,
  type Story,
  type SurfaceAction,
  type SurfaceKind,
  DEFAULT_CONFIG,
} from "@svatah/schema";
import type { AgentSurface } from "@svatah/surface";
import { buildSnapshot, CheckError, NO_CAPABILITIES, structuralHash } from "@svatah/surface";
import { LocatorError } from "@svatah/bindings";
import type { Resolver } from "../src/index.js";

export interface StubOptions {
  /** Predicate kind → what `check` answers. Default: true. */
  readonly checks?: Readonly<Record<string, boolean>>;
  /** Element ids that cannot be resolved, so the step fails with `locator`. */
  readonly unresolvable?: readonly string[];
  /** Actions that throw, keyed `<action>` or `<action>:<ref>`. */
  readonly failing?: Readonly<Record<string, Error>>;
  /** What `read` answers, by reference. */
  readonly reads?: Readonly<Record<string, unknown>>;
  readonly defaultRead?: unknown;
}

export interface Call {
  readonly method: string;
  readonly action?: string;
  readonly ref?: string;
  readonly args?: unknown;
}

export class StubSurface implements AgentSurface {
  readonly kind: SurfaceKind = "web";
  readonly calls: Call[] = [];

  constructor(private readonly options: StubOptions = {}) {}

  /** Every `act` this surface performed, which is what a guard must prevent. */
  get actions(): string[] {
    return this.calls.filter((c) => c.method === "act").map((c) => `${c.action}:${c.ref ?? ""}`);
  }

  capabilities(): Capabilities {
    return { ...NO_CAPABILITIES, screenshot: true, restore: true };
  }
  async open(): Promise<void> {
    this.calls.push({ method: "open" });
  }
  async close(): Promise<void> {
    this.calls.push({ method: "close" });
  }
  async snapshot(): Promise<Snapshot> {
    return buildSnapshot("r0", [], structuralHash([]));
  }
  async act(action: SurfaceAction, ref?: Ref, args?: unknown): Promise<ActResult> {
    this.calls.push({ method: "act", action, ...(ref === undefined ? {} : { ref }), args });
    const failure = this.options.failing?.[`${action}:${ref ?? ""}`] ?? this.options.failing?.[action];
    if (failure !== undefined) throw failure;
    return { ok: true };
  }
  async read(kind: string, ref?: Ref, name?: string): Promise<unknown> {
    this.calls.push({ method: "read", action: kind, ...(ref === undefined ? {} : { ref }), args: name });
    return this.options.reads?.[ref ?? ""] ?? this.options.defaultRead ?? "read";
  }
  async check(predicate: Predicate, subject: string, ref?: Ref): Promise<CheckResult> {
    this.calls.push({ method: "check", action: predicate.kind, ...(ref === undefined ? {} : { ref }) });
    const answer = this.options.checks?.[predicate.kind] ?? true;
    const negated = (predicate as { negate?: boolean }).negate === true ? !answer : answer;
    void subject;
    return { ok: negated, actual: answer };
  }
  async locate(candidate: Candidate): Promise<Ref[]> {
    this.calls.push({ method: "locate", args: candidate });
    return ["r1"];
  }
  async describe(ref: Ref): Promise<ElementDescription> {
    this.calls.push({ method: "describe", ref });
    return {
      ref,
      role: "button",
      tag: "button",
      attrs: {},
      text: "",
      neighbours: { before: [], after: [] },
      rolePath: [],
      box: [0, 0, 0, 0],
      index: 0,
      states: [],
    };
  }
  async screenshot(path: string, mask?: Ref[]): Promise<void> {
    this.calls.push({ method: "screenshot", args: { path, mask } });
  }
  async state(): Promise<SessionState> {
    return { kind: "web", url: "http://app.test/" };
  }
  async restore(): Promise<void> {
    this.calls.push({ method: "restore" });
  }
}

/** A resolver over the stub: every target resolves unless the test says not. */
export function stubResolver(options: StubOptions = {}): Resolver {
  const unresolvable = new Set(options.unresolvable ?? []);
  return async (target) => {
    if (unresolvable.has(target.ref)) {
      throw new LocatorError({
        id: target.ref,
        phrase: target.phrase,
        contextDrift: false,
        tried: [
          {
            candidate: { by: "css", value: `#${target.ref}`, score: 0.68 },
            matched: 0,
            durationMs: 1,
          },
        ],
      });
    }
    return { ref: `ref:${target.ref}`, candidateIndex: 0, by: "css" };
  };
}

/* ── building a plan without a compiler ───────────────────────────────────── */

let counter = 0;

export function step(parts: Partial<Step> & { action: Step["action"] }): Step {
  counter += 1;
  return {
    id: parts.id ?? `s${counter}`,
    storyName: parts.storyName ?? "Story",
    line: parts.line ?? counter,
    text: parts.text ?? `${parts.action} step ${counter}`,
    timeoutMs: 5_000,
    origin: { tier: 1, rule: parts.action, confidence: 1 },
    ...parts,
  } as Step;
}

export function target(ref: string) {
  return { ref, phrase: `the ${ref}`, status: "unbound" as const };
}

export function story(name: string, steps: Step[], parts: Partial<Story> = {}): Story {
  return {
    name,
    kind: "story",
    file: "flows/a.flow",
    meta: { enabled: true, onFailure: "stop", tags: [] },
    steps: steps.map((s) => ({ ...s, storyName: name })),
    ...parts,
  };
}

export function plan(stories: Story[], runs?: Record<string, string[]>): Plan {
  const withoutHash = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: "1970-01-01T00:00:00.000Z",
    project: "test",
    stories,
    compositions: {},
    runs: runs ?? { "flows/a.flow": stories.map((s) => s.name) },
    targets: {},
    apis: [],
    customSteps: [],
  };
  return { ...withoutHash, hash: planHash(withoutHash) } as Plan;
}

export function config(overrides: Partial<Config["run"]> = {}): Config {
  return {
    ...DEFAULT_CONFIG,
    project: "test",
    run: { ...DEFAULT_CONFIG.run, workers: 1, audit: true, checkpoints: false, ...overrides },
  } as Config;
}

export { CheckError };
