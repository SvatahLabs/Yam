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
import { verifyResumeHashes, type Resume } from "./resume.js";
import type { AgentSurface } from "@svatah/surface";
import { Auditor, MemoryAuditSink, type AuditSink } from "./audit.js";
import { abortedByPolicy as aborts, checkpointFor, summarise, type RunDirectory } from "./results.js";
import { Scope } from "./scope.js";
import { messageOf } from "./failure.js";
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
  /**
   * Pick up where an interrupted run stopped (REQ-AUTO-3, LLD §8.1, T5.1).
   *
   * The checkpoint is loaded by the caller — it lives in a run directory, and
   * `runtime` has no opinion about where those are — and this verifies its
   * hashes, restores the scope and the session, runs only the flow it belongs
   * to, and starts at `resume.from`.
   */
  readonly resume?: Resume;
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

  /*
   * The hashes, before anything opens a browser (REQ-AUTO-3, LLD §15).
   *
   * A checkpoint is a claim about a plan and a store. If either has moved, the
   * remaining steps mean something the checkpoint never saw, and the run would
   * be wrong in a way nothing downstream could detect. Throwing here rather than
   * recording a failed step is deliberate: `--resume` with a stale checkpoint is
   * a mistake at the command line, not a failure of the application under test,
   * and it exits 12 rather than 1.
   */
  if (options.resume !== undefined) {
    verifyResumeHashes(options.resume.checkpoint, {
      planHash: plan.hash,
      bindingsHash: options.bindingsHash ?? "none",
    });
  }

  const order = expandRuns(plan, options);
  const results: StepResult[] = [];
  const outputs: Record<string, unknown> = {};
  /*
   * The same outputs with secret values replaced (REQ-NFR-6).
   *
   * `summary.json` is a file in the run directory; the returned `outputs` are a
   * value handed to whoever asked for the run. A story may legitimately declare
   * an output whose value came from a `secret` input — `Pay for a slot` reading
   * the card number back off the form is the shape of it — and the caller who
   * supplied the secret may have it back. The file may not: it is committed to
   * bug reports and read by CI.
   */
  const redactedOutputs: Record<string, unknown> = {};
  const flowStatuses: Summary["flows"] = {};

  logger.log({
    at: startedAt.toISOString(),
    level: "info",
    message: "run started",
    runId,
    detail: { flows: [...order.keys()], behavior },
  });

  /*
   * A resumed run runs one flow: the one the checkpoint belongs to.
   *
   * The others were not interrupted. Running them again would be running them
   * twice, and leaving them out is what makes "results equal a full run from
   * step 5 onward" a comparison of like with like.
   */
  const flows = [...order.entries()].filter(
    ([flow]) => options.resume === undefined || flow === options.resume.flow,
  );
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
      Object.assign(redactedOutputs, outcome.redactedOutputs);
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
    ...(Object.keys(redactedOutputs).length === 0 ? {} : { outputs: redactedOutputs }),
    /*
     * The names of the inputs this run received (Draft 2.6, LLD §10).
     *
     * Names only. A run directory is attached to bug reports and committed to
     * CI artifacts, and an input may be a secret (REQ-NFR-6). What the names are
     * for is `svatah heal --run <id>`: healing a failure at step 5 replays the
     * four steps before it, two of which type `{input.email}` and
     * `{input.password}`, and the replay has to be told what they were. The
     * summary is what lets it say *which* input it is missing rather than
     * reporting a bare `unreachable`.
     */
    ...(Object.keys(options.inputs ?? {}).length === 0
      ? {}
      : { inputs: Object.keys(options.inputs!).sort() }),
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
  /** The same, safe to write down (REQ-NFR-6). */
  redactedOutputs: Record<string, unknown>;
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

  /*
   * And every `secret`-typed *input* this run was given, for the same reason.
   *
   * The run-level audit line records the inputs (REQ-AUTO-6) and is written
   * before the first story starts — before `validateInputs` has had a chance to
   * note the secret ones. A workflow called with `card=5123…` therefore wrote
   * the card number into `audit.jsonl` on the first line, whatever the signature
   * said about it.
   *
   * Which inputs are secret is a property of the *stories about to run*, and
   * they are known here: the signature says `card: secret`, and the value was
   * handed in. Noting it before anything is written is what makes REQ-NFR-6's
   * "secrets never appear in … audit" true of the first line rather than the
   * tenth.
   */
  for (const name of storyNames) {
    const story = context.byName.get(name);
    for (const [input, declared] of Object.entries(story?.signature?.inputs ?? {})) {
      if (declared.type !== "secret") continue;
      const value = options.inputs?.[input];
      if (value !== undefined) scope.noteSecret(value);
    }
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
  const redactedOutputs: Record<string, unknown> = {};

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

  /*
   * A session that will not open is `infrastructure`, reported as a result
   * rather than thrown (REQ-RUN-8). A browser that could not launch, or an
   * application that is not up, is a normal CI failure — and a run that crashed
   * leaves no `results.jsonl` for anything downstream to read.
   */
  let raw: AgentSurface;
  try {
    raw = await options.openSurface(flow);
  } catch (error) {
    const at = new Date().toISOString();
    const result: StepResult = {
      runId: context.runId,
      behavior: context.behavior,
      flow,
      story: storyNames[0] ?? flow,
      stepId: `${flow}#session`,
      line: 1,
      text: `open a session for ${flow}`,
      status: "failed",
      startedAt: at,
      endedAt: at,
      durationMs: 0,
      failure: { class: "infrastructure", message: messageOf(error) },
    };
    options.directory?.result(result);
    options.onResult?.(result);
    return {
      results: [result],
      outputs: {},
      redactedOutputs: {},
      status: { status: "failed", passed: 0, failed: 1, skipped: 0 },
    };
  }

  /*
   * Where the run is, for the audit.
   *
   * `element` is the one the resolver is currently looking for (P9-F5): the
   * surface's `locate(candidate)` is never told which element a candidate
   * belongs to, so without it every locate line read `locate · ok`. It is set
   * and cleared by `resolveTarget` in `step.ts` and never survives a step.
   */
  let where: { story?: string; stepId?: string; element?: string } = {};
  const at = {
    get: () => where,
    set: (value: { story?: string; stepId?: string; element?: string }) => {
      where = value;
    },
  };
  const surface = auditor.auditing(raw, at.get);

  /*
   * Restore the interrupted run's state (REQ-AUTO-3, LLD §8.1).
   *
   * The scope first, then the session. The scope is what the remaining steps
   * read `{bookingId}` out of; the session is where they read it *from*, and
   * `restore` is adapter-specific — the Playwright and BiDi adapters navigate
   * to the recorded URL and re-apply the storage state, a desktop adapter
   * activates the window.
   *
   * A session that will not restore stops the resume rather than continuing on
   * whatever page happens to be open, for the same reason a hash mismatch does:
   * the remaining steps would run somewhere the checkpoint never was.
   */
  const resume = options.resume;
  if (resume !== undefined) {
    scope.restore(resume.checkpoint.scope, resume.checkpoint.story);
    /*
     * Whatever `--input` supplied wins over the checkpoint (REQ-NFR-6).
     *
     * A checkpoint's inputs are redacted, so a `secret` input comes back as
     * `«redacted»` and has to be given again — the same bargain `heal --run`
     * makes. Merging rather than replacing means a run resumed with no `--input`
     * at all still has its non-secret inputs.
     */
    const supplied = Object.entries(options.inputs ?? {});
    if (supplied.length > 0) {
      scope.restore(
        {
          inputs: { ...resume.checkpoint.scope.inputs, ...Object.fromEntries(supplied) },
          captures: resume.checkpoint.scope.captures,
        },
        resume.checkpoint.story,
      );
    }
    try {
      await surface.restore(resume.checkpoint.session);
    } catch (error) {
      const failedAt = new Date().toISOString();
      const result: StepResult = {
        runId: context.runId,
        behavior: context.behavior,
        flow,
        story: resume.story,
        stepId: `${resume.story}#resume`,
        line: 1,
        text: `restore the session of run "${resume.checkpoint.runId}"`,
        status: "failed",
        startedAt: failedAt,
        endedAt: failedAt,
        durationMs: 0,
        failure: { class: "infrastructure", message: messageOf(error) },
      };
      record(result);
      await (options.closeSurface?.(raw, flow) ?? raw.close()).catch(() => undefined);
      return {
        results: [result],
        outputs: {},
        redactedOutputs: {},
        status: { status: "failed", passed: 0, failed: 1, skipped: 0 },
      };
    }
  }

  /*
   * A resumed flow starts at the checkpoint's story, not at the flow's first.
   * The stories before it ran in the run being resumed.
   */
  const fromStory = resume === undefined ? 0 : storyNames.indexOf(resume.story);
  const remaining = fromStory < 0 ? storyNames : storyNames.slice(fromStory);

  try {
    for (const name of remaining) {
      const story = context.byName.get(name);
      if (story === undefined) {
        // A run block naming a story that does not exist is a compile error
        // (E_UNKNOWN_STORY). Reaching it here means the plan was hand-edited.
        record(missingStory(flow, name, context));
        break;
      }
      if (!story.meta.enabled) continue;

      at.set({ story: name });
      /*
       * Run-level inputs reach only the stories that declare them.
       *
       * `--input email=…` is about the run, and a run holds stories with
       * different signatures — most with none at all. Passing every input to
       * every story would make an unrelated story fail for having been given
       * something it never asked for. An `invoke` is the other case, and stays
       * strict: there the caller named one story deliberately.
       */
      const declared = story.signature?.inputs ?? {};
      const inputs = Object.fromEntries(
        Object.entries(options.inputs ?? {}).filter(([key]) => declared[key] !== undefined),
      );

      const outcome = await runStory(story, inputs, {
        ...storyContext(flow, story, scope, surface, auditor, context, at, record),
        // Only the story the resume starts in skips steps; the ones after it
        // run whole.
        ...(resume !== undefined && name === resume.story ? { startAt: resume.from } : {}),
        // Before the step, not after its result: the audit has to say which step
        // made a surface call, and after the fact it is the *previous* step.
        onStep: (step) => at.set({ story: name, stepId: step.id }),
        onResult: record,
      });

      for (const [key, value] of Object.entries(outcome.outputs)) {
        outputs[`${name}.${key}`] = value;
        redactedOutputs[`${name}.${key}`] = scope.redact(value);
      }

      if (outcome.flowStopped) break;
    }
  } finally {
    await (options.closeSurface?.(raw, flow) ?? raw.close()).catch(() => undefined);
  }

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const healed = results.filter((r) => r.status === "healed").length;

  return {
    results,
    outputs,
    redactedOutputs,
    status: {
      /*
       * `aborted` beats `failed` (LLD §8.3): a flow that compensated is not
       * simply a flow that failed, and the two have different exit codes.
       *
       * Read from the results rather than from the story outcome, because
       * `results.jsonl` is the only account a foreign runtime, the Playwright
       * Test reporter, and the conformance suite all share — and since Draft
       * 2.7 the compensating story's steps keep their own statuses, so a step
       * *status* no longer says an abort happened. The failing step's
       * `policyApplied` does.
       */
      status: aborts(results)
        ? "aborted"
        : failed > 0
          ? "failed"
          : healed > 0
            ? "healed"
            : "passed",
      passed,
      failed,
      skipped,
    },
  };
}

/**
 * Where the run is, as the audit records it.
 *
 * `element` is the one the resolver is looking for right now (P9-F5); it is not
 * an audit-line field, and `audit.ts` takes it off before writing.
 */
export interface AuditWhere {
  story?: string;
  stepId?: string;
  element?: string;
}

/** `{ story, stepId, element }` without the element. */
function omitElement(where: AuditWhere): AuditWhere {
  const { element, ...rest } = where;
  void element;
  return rest;
}

function storyContext(
  flow: string,
  story: Story,
  scope: Scope,
  surface: AgentSurface,
  auditor: Auditor,
  context: FlowContext,
  /**
   * Where the run is, read by the audit proxy and written before each step.
   *
   * A pair rather than a getter because the nested runs — `invoke` and a
   * compensating story — have to move it too: a surface call made inside an
   * invoked story is that story's step's call, not the calling step's
   * (REQ-AUTO-6).
   */
  at: {
    get(): AuditWhere;
    set(value: AuditWhere): void;
  },
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
      onStep: (step) => at.set({ story: name, stepId: step.id }),
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
    resolving: (element) => {
      const current = at.get();
      at.set(element === undefined ? omitElement(current) : { ...current, element });
    },
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
                /*
                 * Redacted, like every other thing a run writes down
                 * (REQ-NFR-6, LLD §3.4).
                 *
                 * A checkpoint holds a story's inputs, and a story's inputs
                 * include its `secret`-typed ones — `password` is the whole
                 * point of the type. `runs/<id>/checkpoints/*.json` is a file
                 * people attach to bug reports, so the password cannot be in
                 * it, and the note under `Checkpoint.scope` ("run data is
                 * deliberately absent … which also keeps secrets out of the
                 * run directory") is only true if the inputs are treated the
                 * same way.
                 *
                 * What resume does about it is what `heal --run` does: the
                 * caller supplies the value again with `--input` or
                 * `SVATAH_INPUT_<NAME>`, and it is merged over the restored
                 * scope. A secret is never recorded, so it is always
                 * re-supplied.
                 */
                scope: {
                  inputs: scope.redact(scope.inputsOf(story.name)),
                  captures: scope.redact(scope.allCaptures()),
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
      // Collected by the caller, which records them; recording them here as
      // well would put each one in the results twice.
      const outcome = await runStory(target, {}, {
        ...storyContext(flow, target, scope, surface, auditor, context, at, () => undefined),
        onStep: (step) => at.set({ story: name, stepId: step.id }),
      });
      /*
       * The compensating story's steps keep their own statuses (LLD §8.3,
       * Draft 2.7).
       *
       * They used to be re-labelled `aborted`, which made the results unable
       * to answer the only question a reader has about a compensation: did the
       * booking actually get cancelled? A passed step and a failed step both
       * came out `aborted` with no failure attached, so the audit log was the
       * only place the difference survived.
       *
       * What is `aborted` is the *flow* and the *run* — the intent was not
       * carried out — and the failing step carries `policyApplied`, which is
       * how a reader (and `summarise`) knows the compensation happened at all.
       */
      return outcome.results;
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
export function expandRuns(
  plan: Plan,
  options: Pick<RunOptions, "flows" | "stories"> = {},
): Map<string, string[]> {
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
