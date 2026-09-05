/**
 * The runtime-backed `Replayer` (LLD §10, §12, Draft 2.3, T2.12).
 *
 * "Module (b) registers a runtime-backed implementation that replays the story
 * to the failing step. `healer` therefore never imports `runtime`."
 *
 * A `bind()` failure carries the page the test was on, and restoring it is
 * enough — that is module (a)'s default and it is honest. A *flow's* failure is
 * different: the failing step may be six steps into a booking, and the page it
 * failed on cannot be reached by navigating to a URL. So this replays the story
 * from its first step up to the one before the failure, through the same
 * executor that produced the failure.
 *
 * ## Why it stops one step short
 *
 * The failing step is the one being repaired. Running it would fail again — it
 * has no working binding, which is the whole reason we are here — and would
 * leave the session in whatever state a failed action leaves it. Replaying to
 * *just before* it puts the page in exactly the state the binding was recorded
 * against, which is where relocalization has a chance.
 *
 * ## Where the replay starts (Draft 2.4, LLD §10)
 *
 * The session it is handed has already been opened at the flow's base URL with
 * the configured storage state, exactly as the executor opens one — that is
 * `HealOptions.open`'s job, because it is the only party that knows them. So a
 * story whose *first* step failed needs no replay at all, and this used to
 * report `reached` for it unconditionally. That was the bug F1 names: with no
 * flow-start navigation the page was `about:blank`, relocalization ran against
 * an empty document and every such failure came back `not-found`. Now the
 * arrival is checked against the URL the failure recorded, first step or not.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { planSchema, type Plan, type Story } from "@svatah/schema";
import type { HealInput, Replayer, ReplayOutcome } from "@svatah/healer";
import { reachedRecordedPage, registerReplayer } from "@svatah/healer";
import { runStory, Scope, type Resolver } from "@svatah/runtime";
import type { AgentSurface } from "@svatah/surface";

export interface RuntimeReplayerOptions {
  /** The project root, for finding `.svatah/plan.json`. */
  readonly root: string;
  /** Resolves a target, the same resolver the run used. */
  readonly resolve: Resolver;
  /** Run data, so a replayed step reads the same values the run did. */
  readonly data?: Readonly<Record<string, unknown>>;
  readonly secrets?: ReadonlySet<string>;
  readonly stepTimeoutMs?: number;
  readonly onProgress?: (message: string) => void;
}

/**
 * A replayer over a compiled plan.
 *
 * Returns `unreachable` rather than guessing when the plan is missing, the story
 * is not in it, or the replay itself fails. A repair verified on the wrong page
 * is worse than no repair (REQ-HEAL-3), so every uncertainty is `unreachable`.
 */
export function runtimeReplayer(options: RuntimeReplayerOptions): Replayer {
  return {
    name: "runtime",
    async toFailure(input: HealInput, surface: AgentSurface): Promise<ReplayOutcome> {
      // A bind-failure has no story to replay; the recorded state is all there
      // is, and module (a)'s default is the right answer for it.
      if (input.source !== "run" || input.story === undefined || input.stepId === undefined) {
        return "unreachable";
      }

      const planPath = join(options.root, ".svatah", "plan.json");
      if (!existsSync(planPath)) {
        options.onProgress?.(
          `no plan at ${planPath}; run \`svatah compile\` before healing a run directory`,
        );
        return "unreachable";
      }

      let plan: Plan;
      try {
        plan = planSchema.parse(JSON.parse(readFileSync(planPath, "utf8"))) as Plan;
      } catch {
        return "unreachable";
      }

      const story = plan.stories.find((one) => one.name === input.story);
      if (story === undefined) return "unreachable";

      const at = story.steps.findIndex((step) => step.id === input.stepId);
      if (at < 0) return "unreachable";
      if (at === 0) {
        /*
         * The first step failed, so there is nothing to replay: the session was
         * opened at the flow's base URL and that *is* where the story starts.
         * Checked rather than asserted (Draft 2.4, LLD §10) — a session that
         * never navigated is on `about:blank`, and relocalizing there finds
         * nothing and blames the fingerprint for it.
         */
        return await reachedRecordedPage(input, surface);
      }

      const prefix: Story = { ...story, steps: story.steps.slice(0, at) };
      const scope = new Scope({
        ...(options.data === undefined ? {} : { data: options.data }),
        ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
      });

      options.onProgress?.(`replaying "${story.name}" to ${input.stepId} (${at} step(s))`);

      const outcome = await runStory(prefix, {}, {
        runId: `heal-${input.stepId}`,
        behavior: "test",
        flow: story.file,
        surface,
        scope,
        resolve: options.resolve,
        stepTimeoutMs: options.stepTimeoutMs ?? 10_000,
        screenshots: "never",
      });

      // Anything short of every step passing means the page is not where the
      // binding was recorded, and relocalizing there would be relocalizing
      // against the wrong thing.
      if (!outcome.results.every((result) => result.status === "passed")) return "unreachable";

      // And even a clean replay has to land where the failure was recorded: a
      // step that "passed" after the application redirected it elsewhere would
      // otherwise hand relocalization the wrong page (Draft 2.4, LLD §10).
      return await reachedRecordedPage(input, surface);
    },
  };
}

/** Register it. `svatah heal --run <id>` calls this; nothing else does. */
export function registerRuntimeReplayer(options: RuntimeReplayerOptions): void {
  registerReplayer(runtimeReplayer(options));
}
