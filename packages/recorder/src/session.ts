/**
 * The record session (T3.3, REQ-REC-1, 5, 8, 9, LLD §11).
 *
 * ```
 * record(plan, surface, options):
 *   refuse if environment is production and --force-production was not given
 *   for each story in the run order, for each step:
 *     if the step has a target with no binding here (or --rebind): ground it
 *     runStep(step)                       // the executor's own, not a copy
 *     step failed → stop the session, write the report, write no bindings
 *     step passed → the bindings it used are verified
 *   write the store and the report
 * ```
 *
 * ## Why it runs the steps through `runStep`
 *
 * REQ-REC-5: "the recorder performs the step with the top candidate and verifies
 * any expectation before committing." The only way that verification means
 * anything is if recording performs a step the way replay will. A second
 * implementation of "what a step does" would drift, and the drift would show up
 * as a binding that was verified during recording and fails on the first run.
 *
 * So the session is a loop around `runStep` from `@svatah/runtime` — the same
 * function `svatah run` and the Playwright host call — with one thing added
 * before each step: grounding.
 *
 * ## Only what a step proved is written
 *
 * REQ-REC-5 says the recorder verifies "before committing", and that is exactly
 * the rule: a binding reaches the store when a step performed through it and its
 * expectation held. A binding the model proposed and nothing acted on is a
 * guess, however confident, and a session that stopped at step four writes the
 * three it proved and not the fourth.
 *
 * The grounded-but-unproven entries are still put into the live store while the
 * session runs, because the resolver has to be able to find them to perform the
 * step at all. Rolling them back at the end — restoring each id to the bytes it
 * had — is what keeps "unverified never reaches disk" true without making the
 * resolver read from two places.
 *
 * The report is written either way, and the model cache means a re-run after the
 * fix pays for nothing it already asked.
 */
import {
  resolve as resolveBinding,
  type BindingsStore,
  type Resolution,
} from "@svatah/bindings";
import type {
  BindingEntry,
  BindingFile,
  Candidate,
  Plan,
  Ref,
  Step,
  StepResult,
  Story,
  TargetRef,
} from "@svatah/schema";
import type { Gateway } from "@svatah/gateway";
import type { AgentSurface } from "@svatah/surface";
import {
  runStep,
  Scope,
  type ApiRunner,
  type CustomStepRunner,
  type Resolver,
} from "@svatah/runtime";
import {
  assertRecordable,
  entryFor,
  ground,
  type GroundingDecision,
  type GroundOptions,
  type GroundingTarget,
} from "./ground.js";

/** One step of the session, as the report records it (REQ-REC-8). */
export interface RecordedStep {
  readonly story: string;
  readonly stepId: string;
  readonly line: number;
  readonly text: string;
  /** `passed` or `failed`; a session stops at the first failure. */
  readonly status: StepResult["status"];
  readonly durationMs: number;
  /** The element the step addressed, when it had a target. */
  readonly elementId?: string;
  /** How the binding was obtained. */
  readonly binding?: "existing" | "grounded" | "rebound";
  readonly decision?: GroundingDecision;
  /** The candidate the step actually resolved through. */
  readonly matched?: { by: Candidate["by"]; index: number };
  readonly failure?: { class: string; message: string };
}

export interface RecordReport {
  readonly at: string;
  readonly plan: string;
  /** Which gateway produced the decisions — a report must say (REQ-PKG-4). */
  readonly gateway: { readonly name: string; readonly model: string; readonly real: boolean };
  readonly stories: readonly string[];
  readonly steps: readonly RecordedStep[];
  readonly totals: {
    readonly steps: number;
    readonly grounded: number;
    readonly reused: number;
    readonly failed: number;
    readonly modelCalls: number;
    readonly cacheHits: number;
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly costUsd: number;
  };
  /** True when every step passed and the store was written. */
  readonly complete: boolean;
  /** Why it stopped, when it did not finish. */
  readonly stoppedBecause?: string;
  /** Element ids written, in order. */
  readonly written: readonly string[];
}

export interface RecordSessionOptions {
  readonly plan: Plan;
  readonly surface: AgentSurface;
  readonly store: BindingsStore;
  readonly gateway: Gateway;

  /** Re-ground every target, even ones the store already has (REQ-REC-1). */
  readonly rebind?: boolean;
  /** Record only these flows. */
  readonly flows?: readonly string[];
  /** Record only these stories, in this order. */
  readonly stories?: readonly string[];

  readonly data?: Readonly<Record<string, unknown>>;
  readonly secrets?: ReadonlySet<string>;
  readonly inputs?: Readonly<Record<string, unknown>>;

  readonly custom?: CustomStepRunner;
  readonly api?: ApiRunner;
  readonly stepTimeoutMs?: number;
  readonly candidateTimeoutMs?: number;

  /** Everything `ground()` needs, minus the gateway. */
  readonly grounding?: Omit<GroundOptions, "gateway" | "snapshot">;

  /** Called as each step finishes, for a live stream (REQ-ADE-4). */
  readonly onStep?: (step: RecordedStep) => void;
  /**
   * Review each grounding **before the binding is written** (REQ-ADE-4, T5.7).
   *
   * "A record session streams grounding decisions; the ADE shows the snapshot
   * excerpt, chosen reference, candidate bundle, and fingerprint per target,
   * with accept, re-pick by clicking in the driven session, or reject, before
   * bindings are written."
   *
   * Before, and that is the whole of it. A hook that ran after the store was
   * written would be showing a person a decision already made, and "reject"
   * would mean "undo", which is a different and much weaker promise.
   *
   * Absent — which is what `svatah record` passes — every grounding is accepted,
   * so the command line behaves exactly as it did.
   */
  readonly review?: (proposal: GroundingProposal) => Promise<ReviewDecision>;
  readonly log?: (message: string) => void;
}

/** What a reviewer is shown for one target (REQ-ADE-4). */
export interface GroundingProposal {
  readonly story: string;
  readonly stepId: string;
  readonly text: string;
  readonly elementId: string;
  readonly phrase: string;
  readonly decision: GroundingDecision;
  /** The entry as it would be written: candidates, fingerprint and context. */
  readonly entry: BindingEntry;
  /** The page as the model saw it, so a reviewer can see what it chose from. */
  readonly snapshot: string;
  readonly url?: string;
}

/** What the reviewer said (REQ-ADE-4). */
export type ReviewDecision =
  | { readonly accept: true }
  | { readonly accept: false; readonly why?: string }
  /**
   * "Re-pick by clicking in the driven session": the reviewer names a different
   * reference from the *same* snapshot, and the entry is re-synthesised from
   * that element. Not a different phrase and not a hand-written candidate — the
   * bundle a reviewer accepts has to be one this project's synthesis produced,
   * or the store would hold a locator nothing else knows how to make.
   */
  | { readonly accept: false; readonly repick: Ref };

export async function record(options: RecordSessionOptions): Promise<RecordReport> {
  assertRecordable({
    ...(options.grounding?.environment === undefined
      ? {}
      : { environment: options.grounding.environment }),
    ...(options.grounding?.forceProduction === undefined
      ? {}
      : { forceProduction: options.grounding.forceProduction }),
  });

  const { plan, surface, store, gateway } = options;
  const platform = surface.kind === "http" ? "web" : surface.kind;
  const order = storyOrder(plan, options);
  const byName = new Map(plan.stories.map((story) => [story.name, story]));

  const scope = new Scope({
    ...(options.data === undefined ? {} : { data: options.data }),
    ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
  });
  for (const path of options.secrets ?? []) scope.noteSecret(readPath(options.data ?? {}, path));

  const steps: RecordedStep[] = [];
  /** Ids a passing step proved. Only these are saved. */
  const verified: string[] = [];
  /**
   * Ids this session grounded, with the file as it was before.
   *
   * `undefined` means the store had nothing for that id, so rolling back means
   * removing it rather than restoring it.
   */
  const staged = new Map<string, BindingFile | undefined>();

  let stoppedBecause: string | undefined;

  const resolver: Resolver = async (target, live) => {
    const resolution: Resolution = await resolveBinding(target.ref, live, store, {
      ...(options.candidateTimeoutMs === undefined
        ? {}
        : { candidateTimeoutMs: options.candidateTimeoutMs }),
      phrase: target.phrase,
    });
    return { ref: resolution.ref, candidateIndex: resolution.candidateIndex, by: resolution.by };
  };

  outer: for (const name of order) {
    const story = byName.get(name);
    if (story === undefined) {
      stoppedBecause = `The plan has no story named "${name}".`;
      break;
    }
    if (!story.meta.enabled) continue;

    scope.enterStory(story.name, scope.validateInputs(story.name, story.signature, inputsFor(story, options)));

    for (const step of story.steps) {
      const started = Date.now();
      const url = (await surface.state().catch(() => undefined))?.url;
      const record_: {
        elementId?: string;
        binding?: RecordedStep["binding"];
        decision?: GroundingDecision;
      } = {};

      /* ── grounding, before the step acts ─────────────────────────────────── */

      for (const target of targetsOf(step)) {
        const needs = options.rebind === true || !hasBindingHere(store, target.ref, platform, url);
        record_.elementId = target.ref;
        record_.binding = needs ? (store.has(target.ref) ? "rebound" : "grounded") : "existing";
        if (!needs) continue;

        const result = await ground(
          {
            id: target.ref,
            phrase: target.phrase,
            sentence: step.text,
          } satisfies GroundingTarget,
          surface,
          { gateway, ...(options.grounding ?? {}) },
        );
        record_.decision = result.decision;
        options.log?.(`${target.ref}: ${result.decision.outcome}`);

        if (result.entry === undefined) {
          const failed: RecordedStep = {
            story: story.name,
            stepId: step.id,
            line: step.line,
            text: step.text,
            status: "failed",
            durationMs: Date.now() - started,
            elementId: target.ref,
            ...(record_.binding === undefined ? {} : { binding: record_.binding }),
            decision: result.decision,
            failure: {
              class: "locator",
              message: result.decision.message ?? `Could not ground "${target.phrase}".`,
            },
          };
          steps.push(failed);
          options.onStep?.(failed);
          stoppedBecause =
            `Grounding "${target.phrase}" (${target.ref}) ${result.decision.outcome}: ` +
            (result.decision.message ?? "no element was chosen.");
          break outer;
        }

        /*
         * The reviewer, before the store is touched (REQ-ADE-4, T5.7).
         *
         * `entry` is what would be written; the snapshot is what the model saw.
         * A rejection stops the session — a flow whose element nobody would
         * accept is not a flow to keep recording — and a re-pick re-synthesises
         * the entry from the element the reviewer named, in the same snapshot,
         * so the bundle in the store is one this project's synthesis produced.
         */
        let entry = result.entry;
        if (options.review !== undefined) {
          const reviewed = await options.review({
            story: story.name,
            stepId: step.id,
            text: step.text,
            elementId: target.ref,
            phrase: target.phrase,
            decision: result.decision,
            entry,
            snapshot: result.snapshot ?? "",
            ...(url === undefined ? {} : { url }),
          });

          if (!reviewed.accept) {
            const repick = (reviewed as { repick?: Ref }).repick;
            if (repick === undefined) {
              const rejected: RecordedStep = {
                story: story.name,
                stepId: step.id,
                line: step.line,
                text: step.text,
                status: "failed",
                durationMs: Date.now() - started,
                elementId: target.ref,
                ...(record_.binding === undefined ? {} : { binding: record_.binding }),
                decision: result.decision,
                failure: {
                  class: "locator",
                  message:
                    (reviewed as { why?: string }).why ??
                    `The reviewer rejected the grounding of "${target.phrase}".`,
                },
              };
              steps.push(rejected);
              options.onStep?.(rejected);
              stoppedBecause =
                `The reviewer rejected "${target.phrase}" (${target.ref})` +
                ((reviewed as { why?: string }).why === undefined
                  ? "."
                  : `: ${(reviewed as { why?: string }).why!}`);
              break outer;
            }

            const replacement = await entryFor(surface, repick, {
              ...(options.grounding ?? {}),
            }).catch(() => undefined);
            if (replacement === undefined) {
              stoppedBecause =
                `The reviewer re-picked ${repick} for "${target.phrase}", and nothing could be ` +
                "synthesised from it — the reference may belong to an older snapshot.";
              break outer;
            }
            entry = replacement;
            options.log?.(`${target.ref}: re-picked ${repick} by the reviewer`);
          }
        }

        if (!staged.has(target.ref)) staged.set(target.ref, store.get(target.ref));

        /*
         * A re-record supersedes the entry that applied here, rather than
         * sitting beside it (`--rebind`, REQ-REC-1).
         *
         * The context hash moves whenever the page's shape has changed at all —
         * which is most of the time, since it is why anyone re-records — so
         * without naming what this replaces the store would keep both, with the
         * older one first (LLD §6.3), and the next run would resolve the entry
         * the re-record was meant to retire. An element genuinely seen on a new
         * page has no entry here, and is added.
         */
        const superseded = store.entryFor(target.ref, {
          ...(url === undefined ? {} : { url }),
          platform,
        });
        store.put(target.ref, entry, target.phrase, {
          ...(superseded === undefined ? {} : { replaces: superseded.context }),
        });
      }

      /* ── the step, through the executor's own runStep (REQ-REC-5) ────────── */

      const outcome = await runStep(step, {
        surface,
        scope,
        resolve: resolver,
        ...(options.custom === undefined ? {} : { custom: options.custom }),
        ...(options.api === undefined ? {} : { api: options.api }),
        stepTimeoutMs: options.stepTimeoutMs ?? 10_000,
        screenshots: "never",
      });

      const recorded: RecordedStep = {
        story: story.name,
        stepId: step.id,
        line: step.line,
        text: step.text,
        status: outcome.status,
        durationMs: Date.now() - started,
        ...(record_.elementId === undefined ? {} : { elementId: record_.elementId }),
        ...(record_.binding === undefined ? {} : { binding: record_.binding }),
        ...(record_.decision === undefined ? {} : { decision: record_.decision }),
        ...(outcome.matched === undefined
          ? {}
          : { matched: { by: outcome.matched.by, index: outcome.matched.candidateIndex } }),
        ...(outcome.failure === undefined
          ? {}
          : { failure: { class: outcome.failure.class, message: outcome.failure.message } }),
      };
      steps.push(recorded);
      options.onStep?.(recorded);

      if (outcome.status === "failed") {
        /*
         * REQ-REC-5: "failure stops the session with a report."
         *
         * An expectation that cannot hold is the case this exists for. The
         * bindings recorded so far are not written: they were never confirmed by
         * a flow that ran, and a store that looks recorded and is not is worse
         * than no store.
         */
        stoppedBecause = `${story.name} · ${step.text}: ${outcome.failure?.message ?? "failed"}`;
        break outer;
      }

      /*
       * The step passed, so the bindings it used are verified (REQ-REC-5).
       *
       * Marked here rather than at the end because a step that passed is the
       * evidence — and because a later failure stops the session before anything
       * is written anyway.
       */
      for (const target of targetsOf(step)) {
        if (!staged.has(target.ref)) continue;
        markVerified(store, target.ref, platform, url);
        staged.delete(target.ref);
        if (!verified.includes(target.ref)) verified.push(target.ref);
      }
    }
  }

  /*
   * Roll back everything no step proved (REQ-REC-5).
   *
   * `staged` is what is left over: grounded, put into the live store so the
   * resolver could find it, and never confirmed by a step that passed. Each id
   * goes back to the bytes it had — or out of the store entirely, if it had none.
   */
  for (const [id, before] of staged) {
    if (before === undefined) store.remove(id);
    else store.replaceFile(id, before);
  }
  if (verified.length > 0) store.save();

  const complete = stoppedBecause === undefined;

  const usage = gateway.usage();
  return {
    at: new Date().toISOString(),
    plan: plan.hash,
    gateway: { name: gateway.name, model: gateway.model, real: gateway.real },
    stories: order,
    steps,
    totals: {
      steps: steps.length,
      grounded: steps.filter((s) => s.binding === "grounded" || s.binding === "rebound").length,
      reused: steps.filter((s) => s.binding === "existing").length,
      failed: steps.filter((s) => s.status === "failed").length,
      modelCalls: usage.calls,
      cacheHits: usage.cacheHits,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd: usage.costUsd,
    },
    complete,
    ...(stoppedBecause === undefined ? {} : { stoppedBecause }),
    written: verified,
  };
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** The targets one step addresses, in the order it resolves them. */
function targetsOf(step: Step): TargetRef[] {
  const targets: TargetRef[] = [];
  if (step.target !== undefined) targets.push(step.target);
  if (step.target2 !== undefined) targets.push(step.target2);
  // A Tier 0 custom step's `target` placeholders are grounded exactly like a
  // grammar step's (LLD §11, Draft 2.2 §3.2).
  for (const target of Object.values(step.custom?.targets ?? {})) targets.push(target);
  return targets;
}

/**
 * Whether the store already has a binding for the context the session is in.
 *
 * The URL is read once per step and passed in rather than fetched per target: a
 * step's two targets are on the same page by definition, and an extra round-trip
 * per target would double a session's chatter with the browser for nothing.
 */
function hasBindingHere(
  store: BindingsStore,
  id: string,
  platform: "web" | "mobile" | "desktop",
  url: string | undefined,
): boolean {
  if (!store.has(id)) return false;
  return store.entryFor(id, { ...(url === undefined ? {} : { url }), platform }) !== undefined;
}

/** Mark the entry the session just used as verified (REQ-REC-5). */
function markVerified(
  store: BindingsStore,
  id: string,
  platform: "web" | "mobile" | "desktop",
  url: string | undefined,
): void {
  const entry = store.entryFor(id, { ...(url === undefined ? {} : { url }), platform });
  if (entry === undefined) return;
  store.put(id, { ...entry, verified: true }, undefined, { replaces: entry.context });
}

/** The order the run blocks give, narrowed by `--flow` and `--story`. */
export function storyOrder(plan: Plan, options: RecordSessionOptions): string[] {
  if (options.stories !== undefined && options.stories.length > 0) return [...options.stories];

  const wanted = options.flows === undefined ? undefined : new Set(options.flows);
  const order: string[] = [];
  for (const [file, names] of Object.entries(plan.runs)) {
    if (wanted !== undefined && !wanted.has(file)) continue;
    for (const name of names) {
      const composition = plan.compositions[name];
      for (const story of composition ?? [name]) {
        if (!order.includes(story)) order.push(story);
      }
    }
  }
  return order;
}

function inputsFor(
  story: Story,
  options: RecordSessionOptions,
): Record<string, unknown> {
  const declared = story.signature?.inputs ?? {};
  return Object.fromEntries(
    Object.entries(options.inputs ?? {}).filter(([key]) => declared[key] !== undefined),
  );
}

function readPath(tree: Readonly<Record<string, unknown>>, path: string): unknown {
  let cursor: unknown = tree;
  for (const segment of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}
