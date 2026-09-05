/**
 * The `svatah` fixture (REQ-RUN-12, REQ-BEH-1, LLD §9.1).
 *
 * "The `svatah` fixture creates the Playwright adapter over the test's
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
 * already reads. The Svatah failure class is in the message and in an annotation,
 * so nothing is lost, but the primary report is the runner's.
 */
import { test as base, expect, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createPlaywrightSurface } from "@svatah/adapter-playwright";
import { BindingsStore, resolve as resolveBinding } from "@svatah/bindings";
import {
  DEFAULT_CONFIG,
  planSchema,
  type Config,
  type Plan,
  type StepResult,
  type Story,
} from "@svatah/schema";
import {
  Auditor,
  MemoryAuditSink,
  Scope,
  runStory,
  type Resolver,
} from "@svatah/runtime";
import type { AgentSurface } from "@svatah/surface";
import { RESULTS_ATTACHMENT } from "./reporter.js";

/** The annotation a failing step leaves, so a report can group by class. */
export const FAILURE_ANNOTATION = "svatah-failure";
/** The annotation a healed test leaves (REQ-HEAL-4). */
export const HEALED_ANNOTATION = "healed";

export interface SvatahHostOptions {
  /** Path to `plan.json`. Also `SVATAH_PLAN`. */
  svatahPlan: string | undefined;
  /** Which flow this spec is for; the plan's `runs` key. */
  svatahFlow: string | undefined;
  /** Where the bindings store lives. Also `SVATAH_BINDINGS`. */
  svatahBindings: string | undefined;
  /** Run data, already resolved. Supplied by the generated spec or by config. */
  svatahData: Record<string, unknown> | undefined;
  /** Dotted paths declared secret (REQ-NFR-6). */
  svatahSecrets: readonly string[] | undefined;
  /** Overrides for `config.run`. */
  svatahConfig: Partial<Config["run"]> | undefined;
}

export interface SvatahHostFixture {
  /** Run one story of the flow, in the scope the worker owns. */
  runStory(name: string): Promise<readonly StepResult[]>;
  /** Every result this worker has produced, in order. */
  readonly results: readonly StepResult[];
  readonly plan: Plan;
  readonly surface: AgentSurface;
}

export interface SvatahHostFixtures {
  svatah: SvatahHostFixture;
}

/**
 * A flow's state, owned by the worker.
 *
 * Built lazily on the first `runStory`, because a worker that runs no Svatah
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

function readPath(tree: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = tree;
  for (const segment of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

export const test = base.extend<
  SvatahHostFixtures,
  SvatahHostOptions & { svatahSession: FlowSession }
>({
  svatahPlan: [undefined, { option: true, scope: "worker" }],
  svatahFlow: [undefined, { option: true, scope: "worker" }],
  svatahBindings: [undefined, { option: true, scope: "worker" }],
  svatahData: [undefined, { option: true, scope: "worker" }],
  svatahSecrets: [undefined, { option: true, scope: "worker" }],
  svatahConfig: [undefined, { option: true, scope: "worker" }],

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
  svatahSession: [
    async (
      { browser, svatahPlan, svatahFlow, svatahBindings, svatahData, svatahSecrets, svatahConfig },
      use,
      workerInfo,
    ) => {
      const planPath = svatahPlan ?? process.env["SVATAH_PLAN"] ?? ".svatah/plan.json";
      const plan = planSchema.parse(JSON.parse(readFileSync(planPath, "utf8"))) as Plan;

      const config: Config = {
        ...DEFAULT_CONFIG,
        project: plan.project,
        run: { ...DEFAULT_CONFIG.run, ...(svatahConfig ?? {}) },
      } as Config;

      const use_ = workerInfo.project.use as { baseURL?: string; viewport?: { width: number; height: number } | null };
      const context = await browser.newContext({
        ...(use_.viewport === undefined || use_.viewport === null ? {} : { viewport: use_.viewport }),
      });
      const page = await context.newPage();

      const surface = createPlaywrightSurface(config, { page });
      await surface.open({ ...(use_.baseURL === undefined ? {} : { baseUrl: use_.baseURL }) });

      const session = new FlowSession(
        plan,
        svatahFlow ?? "(flow)",
        config,
        surface,
        svatahBindings ?? process.env["SVATAH_BINDINGS"] ?? "bindings",
        svatahData ?? {},
        new Set(svatahSecrets ?? []),
      );

      await use(session);

      await surface.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    },
    { scope: "worker" },
  ],

  svatah: async ({ svatahSession }, use, testInfo) => {
    const fixture: SvatahHostFixture = {
      plan: svatahSession.plan,
      surface: svatahSession.surface,
      get results() {
        return svatahSession.results;
      },
      runStory: async (name) => await runOne(svatahSession, name, testInfo),
    };
    await use(fixture);
  },
});

/**
 * Run one story, and turn its outcome into a Playwright outcome.
 *
 * The Svatah results are kept whole — the reporter writes them, and a foreign
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
        "run `svatah host generate` again.",
    );
  }

  const before = session.results.length;
  await runStory(story, {}, {
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
   * The Svatah results are attached to the test, and the reporter collects them
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
