/**
 * Orchestration (REQ-RUN-1..4, 9, 13, LLD §8.1).
 *
 * ```
 * run(config, plan, bindings, data, opts):
 *   runId = ulid(); write summary skeleton; audit(kind:"run", …)
 *   order = expandCompositions(plan)
 *   pool(config.run.workers).map(flows, runFlow)
 *   summary; exit code
 * ```
 *
 * ## Runner-agnostic on purpose (REQ-RUN-13)
 *
 * Nothing here knows about Playwright Test, or about any runner. The host
 * (`@svatah/host-playwright`, T2.8) calls `runStory` inside a `test()` and
 * supplies its own surface; `svatah run --host none` calls this. The two share
 * every line of what a step *means*, which is what makes REQ-BEH-5 — "switching
 * behavior never requires recompiling or re-recording" — true rather than
 * aspirational.
 *
 * ## Parallelism
 *
 * Flows run in parallel up to `workers`; stories inside a flow are sequential;
 * each flow owns one session (REQ-RUN-3). So a flow is the unit of isolation,
 * and nothing shared is written from two places: each flow has its own `Scope`,
 * its own surface, and its own slice of the results.
 */
import {
  canonicalHash,
  SCHEMA_VERSION,
  type Config,
  type Invoker,
  type Plan,
  type StepResult,
  type Story,
  type Summary,
} from "@svatah/schema";
import type { AgentSurface } from "@svatah/surface";
import { Auditor, MemoryAuditSink, type AuditSink } from "./audit.js";
import { checkpointFor, summarise, type RunDirectory } from "./results.js";
import { Scope } from "./scope.js";
import { runStory, type StoryContext } from "./story.js";
import type { ApiRunner, CustomStepRunner, Resolver } from "./step.js";
import { SILENT, type Logger } from "./log.js";

export interface RunOptions {
  readonly config: Config;
  readonly plan: Plan;
  /** Opens a session for one flow. The runner never constructs an adapter. */
  readonly openSurface: (flow: string) => Promise<AgentSurface>;
  readonly closeSurface?: (surface: AgentSurface, flow: string) => Promise<void>;
  readonly resolve: Resolver;
  readonly behavior?: StepResult["behavior"];
  readonly invoker?: Invoker;
  /** Run only these flow files. Default: every flow with a run block. */
  readonly flows?: readonly string[];
  /** Run only these stories, in this order, ignoring the run blocks. */
  readonly stories?: readonly string[];
  /** Inputs for the story a workflow run invokes. */
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly secrets?: ReadonlySet<string>;
  readonly bindingsHash?: string;
  readonly custom?: CustomStepRunner;
  readonly api?: ApiRunner;
  readonly directory?: RunDirectory;
  readonly auditSink?: AuditSink;
  readonly logger?: Logger;
  readonly onResult?: (result: StepResult) => void;
  readonly runId?: string;
}

export interface RunOutcome {
  readonly runId: string;
  readonly summary: Summary;
  readonly results: readonly StepResult[];
  readonly outputs: Record<string, unknown>;
  readonly auditLines: readonly unknown[];
}

/** A lexicographically sortable id, which is what a run directory wants. */
export function newRunId(now = new Date(), random = Math.random): string {
  const time = now.getTime().toString(36).padStart(10, "0");
  const noise = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `${time}${noise}`;
}

export async function run(options: RunOptions): Promise<RunOutcome> {
  const { config, plan } = options;
  const runId = options.runId ?? newRunId();
  const behavior = options.behavior ?? "test";
  const invoker: Invoker = options.invoker ?? { kind: "user", id: "local", via: "cli" };
  const logger = options.logger ?? SILENT;
  const startedAt = new Date();

  const auditSink = options.auditSink ?? new MemoryAuditSink();
  const byName = new Map(plan.stories.map((story) => [story.name, story]));

  const order = expandRuns(plan, options);
  const results: StepResult[] = [];
  const outputs: Record<string, unknown> = {};
  const flowStatuses: Summary["flows"] = {};

  logger.log({
    at: startedAt.toISOString(),
    level: "info",
    message: "run started",
    runId,
    detail: { flows: [...order.keys()], behavior },
  });

  /* Flows in parallel up to `workers`; stories inside a flow sequential. */
  const flows = [...order.entries()];
  const workers = Math.max(1, config.run.workers);

  let next = 0;
  const takeOne = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= flows.length) return;
      const [flow, stories] = flows[index]!;
      const outcome = await runFlow(flow, stories, {
        runId,
        behavior,
        invoker,
        options,
        byName,
        auditSink,
        logger,
      });
      results.push(...outcome.results);
      Object.assign(outputs, outcome.outputs);
      flowStatuses[flow] = outcome.status;
    }
  };

  await Promise.all(Array.from({ length: Math.min(workers, flows.length) }, takeOne));

  const endedAt = new Date();
  const { totals, exitCode } = summarise(results);

  const summary: Summary = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    behavior,
    planHash: plan.hash,
    bindingsHash: options.bindingsHash ?? "none",
    configHash: canonicalHash(config),
    invoker,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    flows: flowStatuses,
    ...(Object.keys(outputs).length === 0 ? {} : { outputs }),
    totals,
    exitCode,
  };

  options.directory?.summary(summary);
  const auditLines = auditSink instanceof MemoryAuditSink ? auditSink.lines : [];
  for (const line of auditLines) options.directory?.audit(line);

  logger.log({
    at: endedAt.toISOString(),
    level: exitCode === 0 ? "info" : "error",
    message: "run finished",
    runId,
    detail: { totals, exitCode },
  });

  return { runId, summary, results, outputs, auditLines };
}

/* ── one flow ─────────────────────────────────────────────────────────────── */

interface FlowContext {
  runId: string;
  behavior: StepResult["behavior"];
  invoker: Invoker;
  options: RunOptions;
  byName: ReadonlyMap<string, Story>;
  auditSink: AuditSink;
  logger: Logger;
}

async function runFlow(
  flow: string,
  storyNames: readonly string[],
  context: FlowContext,
): Promise<{
  results: StepResult[];
  outputs: Record<string, unknown>;
  status: Summary["flows"][string];
}> {
  const { options } = context;
  const scope = new Scope({
    ...(options.data === undefined ? {} : { data: options.data }),
    ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
  });

  /*
   * Every secret's *value* is noted before anything runs.
   *
   * Redaction works by value (LLD §8.5), and a secret can reach the results
   * before the step that reads it from the data does — a password typed into a
   * field and then read back out of the page, say. Noting them up front means
   * the first line written is already safe, rather than the tenth.
   */
  for (const path of options.secrets ?? []) {
    scope.noteSecret(readPath(options.data ?? {}, path));
  }

  const auditor = new Auditor({
    runId: context.runId,
    sink: context.auditSink,
    scope,
    enabled: options.config.run.audit,
  });
  auditor.run(context.invoker, options.inputs ?? {});

  const results: StepResult[] = [];
  const outputs: Record<string, unknown> = {};

  /*
   * Every step that ran, including the steps of stories reached through
   * `invoke` and through a compensation. A failure inside an invoked story that
   * did not appear in `results.jsonl` would leave the run reporting "the calling
   * step failed" with nothing to say why.
   */
  const record = (result: StepResult): void => {
    results.push(result);
    options.directory?.result(result);
    options.onResult?.(result);
  };

  const raw = await options.openSurface(flow);
  let at: { story?: string; stepId?: string } = {};
  const surface = auditor.auditing(raw, () => at);

  try {
    for (const name of storyNames) {
      const story = context.byName.get(name);
      if (story === undefined) {
        // A run block naming a story that does not exist is a compile error
        // (E_UNKNOWN_STORY). Reaching it here means the plan was hand-edited.
        record(missingStory(flow, name, context));
        break;
      }
      if (!story.meta.enabled) continue;

      at = { story: name };
      const outcome = await runStory(story, options.inputs ?? {}, {
        ...storyContext(flow, story, scope, surface, auditor, context, () => at, record),
        onResult: (result) => {
          at = { story: name, stepId: result.stepId };
          record(result);
        },
      });

      for (const [key, value] of Object.entries(outcome.outputs)) outputs[`${name}.${key}`] = value;

      if (outcome.flowStopped) break;
    }
  } finally {
    await (options.closeSurface?.(raw, flow) ?? raw.close()).catch(() => undefined);
  }

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const aborted = results.filter((r) => r.status === "aborted").length;
  const healed = results.filter((r) => r.status === "healed").length;

  return {
    results,
    outputs,
    status: {
      status: aborted > 0 ? "aborted" : failed > 0 ? "failed" : healed > 0 ? "healed" : "passed",
      passed,
      failed,
      skipped,
    },
  };
}

function storyContext(
  flow: string,
  story: Story,
  scope: Scope,
  surface: AgentSurface,
  auditor: Auditor,
  context: FlowContext,
  at: () => { story?: string; stepId?: string },
  record: (result: StepResult) => void,
): StoryContext {
  const { options } = context;

  const invoke = async (
    name: string,
    inputs: Record<string, unknown>,
  ): Promise<{ outputs: Record<string, unknown>; ok: boolean }> => {
    const target = context.byName.get(name);
    if (target === undefined) return { outputs: {}, ok: false };
    const outcome = await runStory(target, inputs, {
      ...storyContext(flow, target, scope, surface, auditor, context, at, record),
      onResult: record,
    });
    // The caller's frame is re-entered: `invoke` is a call, and a call returns
    // to where it was made from (LLD §8.5).
    scope.enterStory(story.name, scope.inputsOf(story.name));
    return { outputs: outcome.outputs, ok: outcome.status === "passed" };
  };

  return {
    runId: context.runId,
    behavior: context.behavior,
    flow,
    surface,
    scope,
    resolve: options.resolve,
    ...(options.custom === undefined ? {} : { custom: options.custom }),
    ...(options.api === undefined ? {} : { api: options.api }),
    invoke,
    stepTimeoutMs: options.config.run.stepTimeoutMs,
    screenshots: options.config.run.screenshots,
    ...(options.directory === undefined
      ? {}
      : { screenshotPath: (step) => options.directory!.screenshot(`${step.id}`) }),
    audit: auditor,
    ...(options.config.run.checkpoints && options.directory !== undefined
      ? {
          checkpoint: async (step) => {
            options.directory!.checkpoint(
              checkpointFor({
                runId: context.runId,
                flow,
                story: story.name,
                stepId: step.id,
                at: new Date().toISOString(),
                planHash: options.plan.hash,
                bindingsHash: options.bindingsHash ?? "none",
                scope: {
                  inputs: scope.inputsOf(story.name),
                  captures: scope.allCaptures(),
                },
                session: await surface.state(),
              }),
            );
          },
        }
      : {}),
    compensate: async (name: string) => {
      const target = context.byName.get(name);
      if (target === undefined) return [];
      // Collected by the caller, which re-labels them; recording them here as
      // well would put each one in the results twice.
      const outcome = await runStory(target, {}, {
        ...storyContext(flow, target, scope, surface, auditor, context, at, () => undefined),
      });
      // The compensating story's own steps are recorded as `aborted`: they ran,
      // but as part of an abort rather than as part of the flow's intent
      // (REQ-AUTO-4, REQ-RUN-7).
      return outcome.results.map((result) =>
        result.status === "passed" ? { ...result, status: "aborted" as const } : result,
      );
    },
  };
}

function missingStory(flow: string, name: string, context: FlowContext): StepResult {
  const at = new Date().toISOString();
  return {
    runId: context.runId,
    behavior: context.behavior,
    flow,
    story: name,
    stepId: `${name}#0`,
    line: 1,
    text: name,
    status: "failed",
    startedAt: at,
    endedAt: at,
    durationMs: 0,
    failure: {
      class: "data",
      message: `The plan has no story called "${name}", but a run block names it.`,
    },
  };
}

function readPath(tree: Readonly<Record<string, unknown>>, path: string): unknown {
  let cursor: unknown = tree;
  for (const segment of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Which stories run, in which order (REQ-LANG-10, LLD §8.1).
 *
 * A run block names stories and compositions; a composition expands in place.
 * `--story` overrides both, which is how a person re-runs one thing.
 */
export function expandRuns(plan: Plan, options: RunOptions): Map<string, string[]> {
  if (options.stories !== undefined && options.stories.length > 0) {
    return new Map([["(selected)", [...options.stories]]]);
  }

  const out = new Map<string, string[]>();
  const wanted = options.flows === undefined ? undefined : new Set(options.flows);

  for (const [file, names] of Object.entries(plan.runs)) {
    if (wanted !== undefined && !wanted.has(file)) continue;
    const expanded: string[] = [];
    for (const name of names) {
      const composition = plan.compositions[name];
      if (composition !== undefined) expanded.push(...composition);
      else expanded.push(name);
    }
    if (expanded.length > 0) out.set(file, expanded);
  }
  return out;
}
