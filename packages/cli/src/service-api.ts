/**
 * The CLI functions the local service is given (T5.7, T5.8, LLD §13.5).
 *
 * "Every handler calls the same functions the CLI calls; no logic lives in the
 * service. The functions are injected through a `ServiceApi` interface so the
 * service imports only `@svatah/yam-schema`."
 *
 * Phase 3 injected four. Phase 5's app screens need five more — record with a
 * reviewer, bindings verify, heal, a surface session, and the tool list — and
 * every one of them is here rather than in the service for the reason the rule
 * exists: an app that recorded through its own code and a person who recorded
 * through `yam record` would be doing two different things, and the store
 * would be the place they disagreed.
 *
 * Each function below opens a browser, calls the same package the command does,
 * and shapes the answer. Nothing here decides anything a command line cannot.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BindingsStore, resolve as resolveBinding } from "@svatah/yam-bindings";
import {
  clearRegrounder,
  heal as healJob,
  readRunFailures,
  type HealResult,
} from "@svatah/yam-healer";
import { record, type GroundingProposal, type ReviewDecision } from "@svatah/yam-recorder";
import { createSurface, type AgentSurface } from "@svatah/yam-surface";
import { toolsFor as deriveTools } from "@svatah/yam-tool";
import {
  compileTrajectory,
  readTrajectory,
  TrajectoryWriter,
  writeProposal,
} from "@svatah/yam-trajectory";
import type { Config, Ref } from "@svatah/yam-schema";
import { registerAllAdapters } from "./adapters.js";
import { compileProject } from "./project.js";
import type { loadProject } from "./project.js";
import { gatewayForRecording } from "./gateway-for.js";
import { loadBindings, projectRunners } from "./commands/run.js";
import { registerRuntimeReplayer } from "./replayer.js";

type Loaded = Awaited<ReturnType<typeof loadProject>>;

/** A session opened the way `yam run` and `yam record` open one. */
async function open(
  loaded: Loaded,
  options: { headed?: boolean } = {},
): Promise<{ surface: AgentSurface; config: Config }> {
  registerAllAdapters();
  const config: Config = {
    ...loaded.config,
    run: { ...loaded.config.run, headless: options.headed !== true },
  };
  const surface = await createSurface(config);
  await surface.open({
    ...(config.app.baseUrl === undefined ? {} : { baseUrl: config.app.baseUrl }),
    ...(config.app.storageState === undefined ? {} : { storageState: config.app.storageState }),
  });
  // The flow-start navigation the executor and the recorder both perform
  // (LLD §8, Draft 2.4): a session is not a page.
  if (config.app.baseUrl !== undefined && surface.kind === "web") {
    await surface.act("navigate", undefined, { url: config.app.baseUrl });
  }
  return { surface, config };
}

/* ── record with review (REQ-ADE-4) ───────────────────────────────────────── */

export async function serviceRecord(
  loaded: Loaded,
  options: {
    stories?: readonly string[];
    flows?: readonly string[];
    rebind?: boolean;
    headed?: boolean;
    gateway?: string;
    inputs?: Record<string, unknown>;
    onStep?: (step: unknown) => void;
    /** A line about what the session is doing, for the stream (Draft 2.21). */
    log?: (message: string) => void;
    review?: (proposal: unknown) => Promise<unknown>;
    onSurface?: (surface: unknown) => void;
    signal?: AbortSignal;
  },
): Promise<unknown> {
  const compiled = compileProject(loaded, { stable: true });
  const store = loadBindings(loaded);
  /*
   * The same gateway the command line chooses, by the same rule: `--gateway
   * fake` is the eval's committed answers, `anthropic` needs a credential, and
   * the default is whichever of those is available. A recorder in the app and a
   * recorder at a terminal must be grounding against the same thing.
   */
  const gateway = gatewayForRecording(
    { command: [], options: options.gateway === undefined ? {} : { gateway: options.gateway }, rest: [] },
    loaded,
    { out: () => undefined, err: () => undefined },
  );
  if (gateway === undefined) {
    throw new Error(
      "Recording needs a model. Set ANTHROPIC_API_KEY, or ask for the fake gateway — which " +
        "answers from evals/grounding/cases and is a fixture, not a model.",
    );
  }

  // A person cannot click in a headless browser: the human gateway is headed.
  const { surface, config } = await open(loaded, {
    ...(gateway.name === "human" ? { headed: true } : options.headed === undefined ? {} : { headed: options.headed }),
  });
  options.onSurface?.(surface);

  const screenshotDir = resolve(loaded.root, ".yam", "record");
  mkdirSync(screenshotDir, { recursive: true });
  let shot = 0;

  const { api, custom } = projectRunners(loaded, {
    ...(config.app.baseUrl === undefined ? {} : { baseUrl: config.app.baseUrl }),
    cwd: loaded.root,
  });

  try {
    return await record({
      plan: compiled.plan,
      surface,
      store,
      gateway,
      ...(options.rebind === undefined ? {} : { rebind: options.rebind }),
      ...(options.flows === undefined ? {} : { flows: options.flows }),
      ...(options.stories === undefined ? {} : { stories: options.stories }),
      ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
      data: loaded.project.data.values,
      secrets: loaded.project.data.secrets,
      api,
      custom,
      stepTimeoutMs: config.run.stepTimeoutMs,
      candidateTimeoutMs: config.run.candidateTimeoutMs,
      grounding: {
        maxSnapshotTokens: config.record.maxSnapshotTokens,
        visionFallback: config.record.visionFallback,
        environment: config.environment,
        testIdAttributes: config.bindings.testIdAttributes,
        ...(config.bindings.ignoreAttributes === undefined
          ? {}
          : { ignoreAttributes: config.bindings.ignoreAttributes }),
        ...(config.bindings.matchHost === undefined ? {} : { matchHost: config.bindings.matchHost }),
        screenshotPath: () => join(screenshotDir, `vision-${(shot += 1)}.png`),
        readScreenshot: async (path) => {
          const { readFile } = await import("node:fs/promises");
          return { mediaType: "image/png", base64: (await readFile(path)).toString("base64") };
        },
      },
      ...(options.onStep === undefined ? {} : { onStep: options.onStep }),
      ...(options.log === undefined ? {} : { log: options.log }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.review === undefined
        ? {}
        : {
            review: async (proposal: GroundingProposal): Promise<ReviewDecision> => {
              /*
               * Stopping is a rejection, not a separate path. A session whose
               * browser is about to close must not sit waiting for a decision no
               * one will make.
               */
              if (options.signal?.aborted === true) {
                return { accept: false, why: "the session was stopped" };
              }
              return (await options.review!(proposal)) as ReviewDecision;
            },
          }),
    });
  } finally {
    await surface.close().catch(() => undefined);
  }
}

/* ── bindings verify (REQ-ADE-5) ──────────────────────────────────────────── */

/**
 * Dry-resolve the store, one binding at a time.
 *
 * The same `resolve` a run uses, against a live page — which is what makes the
 * bindings browser's status mean something rather than being a re-reading of the
 * YAML. `yam bindings verify` does exactly this from a command line.
 */
export async function serviceVerifyBindings(
  loaded: Loaded,
  options: { id?: string; headed?: boolean } = {},
): Promise<unknown> {
  const store = BindingsStore.load(resolve(loaded.root, loaded.config.bindings.dir));
  const ids = options.id === undefined ? store.ids() : [options.id];

  const { surface, config } = await open(loaded, {
    ...(options.headed === undefined ? {} : { headed: options.headed }),
  });

  try {
    const results = [];
    for (const id of ids) {
      const file = store.get(id);
      try {
        const resolution = await resolveBinding(id, surface, store, {
          candidateTimeoutMs: config.run.candidateTimeoutMs,
        });
        results.push({
          id,
          status: "resolved" as const,
          by: resolution.by,
          candidateIndex: resolution.candidateIndex,
          phrases: file?.phrases ?? [],
          entries: file?.entries.length ?? 0,
        });
      } catch (error) {
        results.push({
          id,
          status: "unresolved" as const,
          message: error instanceof Error ? error.message.split("\n")[0] : String(error),
          phrases: file?.phrases ?? [],
          entries: file?.entries.length ?? 0,
        });
      }
    }
    return {
      at: new Date().toISOString(),
      resolved: results.filter((one) => one.status === "resolved").length,
      unresolved: results.filter((one) => one.status === "unresolved").length,
      results,
    };
  } finally {
    await surface.close().catch(() => undefined);
  }
}

/* ── heal review (REQ-ADE-5) ──────────────────────────────────────────────── */

/**
 * Heal a run, streaming each proposal as it is decided.
 *
 * The same job `yam heal --run` runs, with the same runtime replayer
 * registered (LLD §10) and the same `--input` bargain: a story with a signature
 * cannot replay without its inputs, and a run records only their names.
 */
export async function serviceHeal(
  loaded: Loaded,
  options: {
    runId: string;
    useModel?: boolean;
    apply?: boolean;
    inputs?: Record<string, unknown>;
    onProposal?: (proposal: unknown) => void;
  },
): Promise<unknown> {
  registerAllAdapters();
  const bindingsDir = resolve(loaded.root, loaded.config.bindings.dir);
  const store = BindingsStore.load(bindingsDir);
  const runDir = join(loaded.root, loaded.config.run.outputDir, options.runId);

  if (!existsSync(runDir)) {
    throw new Error(`There is no run "${options.runId}" in ${loaded.config.run.outputDir}/.`);
  }

  // Relocalization only unless the project says otherwise, which is the same
  // default `heal.useModel: false` gives a command line.
  if (options.useModel !== true) clearRegrounder();

  registerRuntimeReplayer({
    root: loaded.root,
    // The plan in hand, rather than one read off disk: healing must not leave a
    // compile artifact behind for a reason the command does not explain.
    plan: compileProject(loaded, { stable: true }).plan,
    data: loaded.project.data.values,
    secrets: loaded.project.data.secrets,
    stepTimeoutMs: loaded.config.run.stepTimeoutMs,
    ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
    resolve: async (target, surface) => {
      const resolution = await resolveBinding(target.ref, surface, store, {
        candidateTimeoutMs: loaded.config.run.candidateTimeoutMs,
        phrase: target.phrase,
      });
      return {
        ref: resolution.ref,
        candidateIndex: resolution.candidateIndex,
        by: resolution.by,
      };
    },
  });

  const before = new Map(store.ids().map((id) => [id, JSON.stringify(store.get(id))]));

  const report = await healJob({
    bindingsDir,
    inputs: readRunFailures(runDir),
    ...(options.inputs === undefined ? {} : { storyInputs: options.inputs }),
    ...(options.apply === undefined ? {} : { apply: options.apply }),
    testIdAttributes: loaded.config.bindings.testIdAttributes,
    open: async () => (await open(loaded)).surface,
    onProgress: () => undefined,
  });

  /*
   * One event per result, with the before and after of the binding it touched
   * (REQ-ADE-5: "a proposed diff with before and after candidates").
   *
   * The *after* comes from the report rather than from the directory, because a
   * proposal is by definition not written: with `apply: false` the file on disk
   * is still the broken one, and re-reading it would show a reviewer the same
   * thing twice. `report.changed` is what the store would hold.
   *
   * Emitted after the job rather than during it: `heal()` reports its results as
   * a whole, and a proposal the job then superseded would be a state the store
   * never had.
   */
  const changed = (report as { changed: Record<string, unknown> }).changed;
  for (const one of (report as { results: readonly HealResult[] }).results) {
    options.onProposal?.({
      ...one,
      before: JSON.parse(before.get(one.id) ?? "null") as unknown,
      after: changed[one.id] ?? null,
    });
  }

  return report;
}

/* ── the surface explorer (REQ-ADE-8) ─────────────────────────────────────── */

/**
 * A session the explorer drives call by call, writing `trajectory.jsonl`.
 *
 * The same thing `yam mcp`'s raw-surface tools do, and for the same reason:
 * an intent per call is what turns an exploration into something T5.5 can
 * compile (LLD §13.4). The service refuses a call without one; this records what
 * it is given.
 */
export async function serviceOpenSurfaceSession(
  loaded: Loaded,
  options: { sessionId: string; headed?: boolean },
): Promise<{
  call(call: "snapshot" | "act" | "read" | "check", args: Record<string, unknown>): Promise<unknown>;
  trajectoryPath: string;
  close(): Promise<void>;
}> {
  const { surface } = await open(loaded, {
    ...(options.headed === undefined ? {} : { headed: options.headed }),
  });
  const trajectoryPath = join(
    loaded.root,
    loaded.config.run.outputDir,
    options.sessionId,
    "trajectory.jsonl",
  );
  const trajectory = new TrajectoryWriter(trajectoryPath);

  return {
    trajectoryPath,
    async call(call, args) {
      const intent = String(args["intent"] ?? "");
      const ref = args["ref"] === undefined ? undefined : (String(args["ref"]) as Ref);
      const { intent: _i, ...rest } = args;
      void _i;

      const snapshotHash = await surface
        .snapshot({ interactiveOnly: true })
        .then((one) => one.hash)
        .catch(() => undefined);
      const url = (await surface.state().catch(() => undefined))?.url;
      const describe = ref === undefined ? undefined : await surface.describe(ref).catch(() => undefined);

      const record_ = (result: unknown, error?: string): void => {
        trajectory.write({
          intent,
          call,
          ...(Object.keys(rest).length === 0 ? {} : { args: rest }),
          ...(snapshotHash === undefined ? {} : { snapshotHash }),
          ...(url === undefined ? {} : { url }),
          ...(ref === undefined ? {} : { ref }),
          ...(describe === undefined ? {} : { describe }),
          ...(error === undefined ? { ...(result === undefined ? {} : { result }) } : { error }),
        });
      };

      try {
        const result =
          call === "snapshot"
            ? await surface.snapshot({ interactiveOnly: rest["interactiveOnly"] === true })
            : call === "act"
              ? await surface.act(
                  rest["action"] as never,
                  ref,
                  (rest["args"] ?? {}) as never,
                )
              : call === "read"
                ? await surface.read((rest["kind"] ?? "text") as never, ref)
                : await surface.check(
                    rest["predicate"] as never,
                    (rest["subject"] ?? "ref") as never,
                    ref,
                  );
        // A snapshot's own text is the answer; recording it in the trajectory
        // would put a page in every line of the file.
        record_(call === "snapshot" ? undefined : result);
        return result;
      } catch (error) {
        record_(undefined, error instanceof Error ? error.message.split("\n")[0] : String(error));
        throw error;
      }
    },
    async close() {
      await surface.close().catch(() => undefined);
    },
  };
}

/** Compile a captured trajectory into `proposals/<date>/` (T5.5). */
export async function serviceCompileTrajectory(
  loaded: Loaded,
  options: { path: string; name?: string },
): Promise<unknown> {
  const compiled = compileTrajectory(readTrajectory(resolve(loaded.root, options.path)), {
    sourceTrajectory: options.path,
    ...(options.name === undefined ? {} : { storyName: options.name }),
  });
  const { dir, files } = writeProposal(join(loaded.root, "proposals"), compiled);
  return {
    dir,
    files,
    steps: compiled.steps,
    review: compiled.review,
    flow: compiled.proposal.flow,
  };
}

/* ── the tool panel (REQ-ADE-8) ───────────────────────────────────────────── */

/** The tools a project would expose, and the reasons for the ones it would not. */
export async function serviceToolsFor(
  loaded: Loaded,
  options: { expose?: string } = {},
): Promise<unknown> {
  const compiled = compileProject(loaded, { stable: true });
  const { tools, exposure } = deriveTools({
    plan: compiled.plan,
    config: loaded.config,
    ...(options.expose === undefined ? {} : { expose: options.expose }),
  });
  return { tools, refused: exposure.refused };
}

/* ── T6.6: the prototype database import (REQ-ADE-9, LLD §13.5) ───────────── */

/**
 * `POST /migrate`, which is `yam migrate <dest> --from-prototype <src>`.
 *
 * The same two steps the command line takes, in the same order and through the
 * same functions: extract the prototype's database back into the v2 files it
 * kept in columns, then convert them. The app's button and the command line must
 * produce the same directory, and the way to be sure of that is for there to be
 * one implementation.
 */
export async function serviceMigrateFromPrototype(
  loaded: Loaded,
  options: { source: string; project?: string },
): Promise<unknown> {
  const { extractPrototypeProject, migrate, renderReviewReport } = await import("@svatah/yam-migrate");
  const destination = loaded.root;

  const extracted = extractPrototypeProject({
    source: options.source,
    destination,
    ...(options.project === undefined ? {} : { project: options.project }),
  });
  const result = migrate({ source: destination, destination });
  for (const one of extracted.intermediates) rmSync(join(destination, one), { force: true });

  const files = [...new Set([...extracted.files, ...result.files])]
    .filter((one) => !extracted.intermediates.includes(one))
    .sort();
  const review = renderReviewReport({
    source: options.source,
    destination,
    files,
    notes: [...extracted.notes, ...result.notes],
    unmapped: result.unmapped,
    stories: result.stories,
  });
  writeFileSync(join(destination, "migration-review.md"), review, "utf8");

  return {
    project: extracted.project,
    files: [...files, "migration-review.md"].sort(),
    stories: result.stories,
    unmapped: result.unmapped,
    notes: [...extracted.notes, ...result.notes],
    review: "migration-review.md",
  };
}
