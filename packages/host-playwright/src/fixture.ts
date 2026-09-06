/**
 * The `yam` fixture (REQ-RUN-12, REQ-BEH-1, LLD §9.1).
 *
 * "The `yam` fixture creates the Playwright adapter over the test's
 * `context`, loads plan and bindings, and owns the scope for the flow so captures
 * cross stories inside the same worker."
 *
 * ## Worker-scoped, and why that is the whole design
 *
 * A flow's stories are one conversation: the second reads what the first
 * captured, and both drive the same session. Playwright Test gives one worker
 * per file by default and `describe.configure({ mode: "serial" })` keeps the
 * order, so a worker-scoped fixture is exactly a flow — one scope, one adapter,
 * one bindings store, for the stories of one file, in order.
 *
 * A test-scoped fixture would give each story its own scope, and
 * `{Validate login.enterprise}` would read nothing.
 *
 * ## Failures are Playwright failures
 *
 * A step that fails throws, so Playwright reports it the way it reports any
 * failure — with the trace, the screenshot and the HTML report entry the team
 * already reads. The Yam failure class is in the message and in an annotation,
 * so nothing is lost, but the primary report is the runner's.
 */
import { test as base, expect, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createPlaywrightSurface } from "@svatah/yam-adapter-playwright";
import { BindingsStore, resolve as resolveBinding } from "@svatah/yam-bindings";
import {
  DEFAULT_CONFIG,
  planSchema,
  type Config,
  type Plan,
  type StepResult,
  type Story,
} from "@svatah/yam-schema";
import {
  Auditor,
  MemoryAuditSink,
  Scope,
  runStory,
  type Resolver,
} from "@svatah/yam-runtime";
import type { AgentSurface } from "@svatah/yam-surface";
import { RESULTS_ATTACHMENT } from "./reporter.js";

/** The annotation a failing step leaves, so a report can group by class. */
export const FAILURE_ANNOTATION = "yam-failure";
/** The annotation a healed test leaves (REQ-HEAL-4). */
export const HEALED_ANNOTATION = "healed";

export interface YamHostOptions {
  /** Path to `plan.json`. Also `YAM_PLAN`. */
  yamPlan: string | undefined;
  /** Which flow this spec is for; the plan's `runs` key. */
  yamFlow: string | undefined;
  /** Where the bindings store lives. Also `YAM_BINDINGS`. */
  yamBindings: string | undefined;
  /** Run data, already resolved. Supplied by the generated spec or by config. */
  yamData: Record<string, unknown> | undefined;
  /** Dotted paths declared secret (REQ-NFR-6). */
  yamSecrets: readonly string[] | undefined;
  /** Overrides for `config.run`. */
  yamConfig: Partial<Config["run"]> | undefined;
}

export interface YamHostFixture {
  /** Run one story of the flow, in the scope the worker owns. */
  runStory(name: string): Promise<readonly StepResult[]>;
  /** Every result this worker has produced, in order. */
  readonly results: readonly StepResult[];
  readonly plan: Plan;
  readonly surface: AgentSurface;
}

export interface YamHostFixtures {
  yam: YamHostFixture;
}

/**
 * A flow's state, owned by the worker.
 *
 * Built lazily on the first `runStory`, because a worker that runs no Yam
 * test should not open a browser context or read a plan.
 */
class FlowSession {
  readonly scope: Scope;
  readonly results: StepResult[] = [];
  readonly auditor: Auditor;
  /** One id for the whole flow, so its results read as one run. */
  readonly runId = `host-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  private readonly store: BindingsStore;

  constructor(
    readonly plan: Plan,
    readonly flow: string,
    readonly config: Config,
    readonly surface: AgentSurface,
    bindingsDir: string,
    data: Record<string, unknown>,
    secrets: ReadonlySet<string>,
    /** Run-level inputs, reaching only the stories that declare them. */
    readonly inputs: Record<string, unknown> = {},
  ) {
    this.scope = new Scope({ data, secrets });
    for (const path of secrets) this.scope.noteSecret(readPath(data, path));
    this.store = BindingsStore.load(bindingsDir);
    this.auditor = new Auditor({
      runId: this.runId,
      sink: new MemoryAuditSink(),
      scope: this.scope,
      enabled: config.run.audit,
    });
  }

  /**
   * The resolver the executor uses (LLD §6.3).
   *
   * Wrapping `resolve` rather than passing it straight through, because the
   * executor's `Resolver` takes a `TargetRef` and this takes an element id — and
   * keeping the executor's signature free of the store is what lets a host or a
   * foreign runtime resolve its own way.
   */
  resolver(): Resolver {
    return async (target, surface) => {
      const resolution = await resolveBinding(target.ref, surface, this.store, {
        candidateTimeoutMs: this.config.run.candidateTimeoutMs,
        phrase: target.phrase,
      });
      return {
        ref: resolution.ref,
        candidateIndex: resolution.candidateIndex,
        by: resolution.by,
      };
    };
  }

  story(name: string): Story | undefined {
    return this.plan.stories.find((s) => s.name === name);
  }
}

/** A JSON environment variable, or nothing. */
function readJson(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined || text === "") return undefined;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readPath(tree: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = tree;
  for (const segment of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

export const test = base.extend<
  YamHostFixtures,
  YamHostOptions & { yamSession: FlowSession }
>({
  yamPlan: [undefined, { option: true, scope: "worker" }],
  yamFlow: [undefined, { option: true, scope: "worker" }],
  yamBindings: [undefined, { option: true, scope: "worker" }],
  yamData: [undefined, { option: true, scope: "worker" }],
  yamSecrets: [undefined, { option: true, scope: "worker" }],
  yamConfig: [undefined, { option: true, scope: "worker" }],

  /**
   * The flow's session: one scope, one adapter, one store, for the whole worker.
   *
   * Worker-scoped, and that is the design (LLD §9.1). A flow's stories are one
   * conversation — the second reads what the first captured and both drive the
   * same session — and `describe.configure({ mode: "serial" })` in the generated
   * spec keeps them in one worker, in order.
   *
   * It creates its own context from Playwright's worker-scoped `browser` rather
   * than borrowing the test-scoped `context` fixture, because a test-scoped
   * context is torn down between stories and the session would not survive the
   * first one. Recorded as a deviation from LLD §9.1's "over the test's
   * `context`", which cannot hold alongside the same sentence's "worker-scoped".
   */
  yamSession: [
    async (
      { browser, yamPlan, yamFlow, yamBindings, yamData, yamSecrets, yamConfig },
      use,
      workerInfo,
    ) => {
      const planPath = yamPlan ?? process.env["YAM_PLAN"] ?? ".yam/plan.json";
      const plan = planSchema.parse(JSON.parse(readFileSync(planPath, "utf8"))) as Plan;

      const config: Config = {
        ...DEFAULT_CONFIG,
        project: plan.project,
        run: { ...DEFAULT_CONFIG.run, ...(yamConfig ?? {}) },
      } as Config;

      const use_ = workerInfo.project.use as { baseURL?: string; viewport?: { width: number; height: number } | null };
      const context = await browser.newContext({
        ...(use_.viewport === undefined || use_.viewport === null ? {} : { viewport: use_.viewport }),
      });
      const page = await context.newPage();

      const surface = createPlaywrightSurface(config, { page });
      await surface.open({ ...(use_.baseURL === undefined ? {} : { baseUrl: use_.baseURL }) });

      /*
       * Start at the base URL, exactly as `yam run --host none` does.
       *
       * A new context starts at `about:blank`, and a migrated flow begins by
       * clicking something on the home page because the old runner opened the
       * configured URL first. The two hosts have to agree about this or
       * REQ-BEH-5 — the same plan, either host, the same statuses — would be
       * false for every flow that does not navigate explicitly.
       */
      if (use_.baseURL !== undefined) {
        await surface.act("navigate", undefined, { url: use_.baseURL });
      }

      /*
       * The run's data and secrets travel by environment when the CLI spawned
       * this process (`yam run --host playwright`), and by fixture option
       * when a project wired the host itself. Both, so neither audience has to
       * do the other's setup.
       */
      const data = yamData ?? readJson(process.env["YAM_DATA"]) ?? {};
      const secrets = yamSecrets ?? (readJson(process.env["YAM_SECRETS"]) as string[] | undefined) ?? [];
      const inputs = readJson(process.env["YAM_INPUTS"]) ?? {};

      const session = new FlowSession(
        plan,
        yamFlow ?? "(flow)",
        config,
        surface,
        yamBindings ?? process.env["YAM_BINDINGS"] ?? "bindings",
        data,
        new Set(secrets),
        inputs,
      );

      await use(session);

      await surface.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    },
    { scope: "worker" },
  ],

  yam: async ({ yamSession }, use, testInfo) => {
    const fixture: YamHostFixture = {
      plan: yamSession.plan,
      surface: yamSession.surface,
      get results() {
        return yamSession.results;
      },
      runStory: async (name) => await runOne(yamSession, name, testInfo),
    };
    await use(fixture);
  },
});

/**
 * Run one story, and turn its outcome into a Playwright outcome.
 *
 * The Yam results are kept whole — the reporter writes them, and a foreign
 * runtime's conformance harness compares them (REQ-STD-2) — and the first
 * failure is thrown, so the runner reports the run the way it reports every
 * other one, with the trace, the screenshot and the HTML entry the team already
 * reads.
 */
async function runOne(
  session: FlowSession,
  name: string,
  testInfo: TestInfo,
): Promise<readonly StepResult[]> {
  const story = session.story(name);
  if (story === undefined) {
    throw new Error(
      `The plan has no story called "${name}". The generated spec is stale; ` +
        "run `yam host generate` again.",
    );
  }

  const before = session.results.length;
  // Only the inputs this story declares — the same rule the standalone runner
  // uses, so the two hosts agree about what a run-level input means (T2.7).
  const declared = story.signature?.inputs ?? {};
  const inputs = Object.fromEntries(
    Object.entries(session.inputs).filter(([key]) => declared[key] !== undefined),
  );

  await runStory(story, inputs, {
    runId: session.runId,
    behavior: "test",
    flow: session.flow,
    surface: session.surface,
    scope: session.scope,
    resolve: session.resolver(),
    stepTimeoutMs: session.config.run.stepTimeoutMs,
    screenshots: session.config.run.screenshots,
    audit: session.auditor,
    onResult: (result) => session.results.push(result),
  });

  const mine = session.results.slice(before);
  for (const result of mine) {
    if (result.status === "healed") {
      testInfo.annotations.push({ type: HEALED_ANNOTATION, description: result.stepId });
    }
  }

  /*
   * The Yam results are attached to the test, and the reporter collects them
   * (LLD §9.1). A reporter sees a test pass or fail and never sees steps, so the
   * results have to travel from here — which also keeps one source of truth
   * rather than a thinner account reconstructed from Playwright's view.
   */
  await testInfo.attach(RESULTS_ATTACHMENT, {
    body: JSON.stringify({ planHash: session.plan.hash, results: mine }),
    contentType: "application/json",
  });

  const failed = mine.find((r) => r.status === "failed");
  if (failed !== undefined) {
    testInfo.annotations.push({
      type: FAILURE_ANNOTATION,
      description: `${failed.failure?.class ?? "unknown"}: ${failed.stepId}`,
    });
    throw new Error(
      `[${failed.failure?.class ?? "unknown"}] ${failed.text}\n` +
        `  ${session.flow} · ${name} · line ${failed.line}\n` +
        `  ${failed.failure?.message ?? ""}`,
    );
  }

  return mine;
}

export { expect };
