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
import type { HealInput, Replayer, ReplayContext, ReplayOutcome } from "@svatah/healer";
import { reachedRecordedPage, registerReplayer } from "@svatah/healer";
import { runStory, Scope, type Resolver } from "@svatah/runtime";
import type { AgentSurface } from "@svatah/surface";

export interface RuntimeReplayerOptions {
  /** The project root, for finding `.svatah/plan.json`. */
  readonly root: string;
  /** Resolves a target, the same resolver the run used. */
  readonly resolve: Resolver;
  /**
   * The plan, when the caller already has it (T5.7).
   *
   * `svatah heal --run` reads `.svatah/plan.json`, because a command line heals
   * a project it has not just compiled. The local service *has* just compiled
   * it — `POST /heal` loads the project the same way `POST /compile` does — and
   * making it write a file as a side effect of healing would put a compile
   * artifact on disk for a reason nobody could see from the command.
   */
  readonly plan?: Plan;
  /** Run data, so a replayed step reads the same values the run did. */
  readonly data?: Readonly<Record<string, unknown>>;
  readonly secrets?: ReadonlySet<string>;
  readonly stepTimeoutMs?: number;
  /**
   * The failing stories' inputs (Draft 2.6, LLD §10).
   *
   * A fallback beneath the ones the heal job passes per call, so a caller that
   * registers the replayer once and heals many failures can supply them once.
   */
  readonly inputs?: Readonly<Record<string, unknown>>;
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
    async toFailure(
      input: HealInput,
      surface: AgentSurface,
      context?: ReplayContext,
    ): Promise<ReplayOutcome> {
      // A bind-failure has no story to replay; the recorded state is all there
      // is, and module (a)'s default is the right answer for it.
      if (input.source !== "run" || input.story === undefined || input.stepId === undefined) {
        return "unreachable";
      }

      let plan: Plan;
      if (options.plan !== undefined) {
        plan = options.plan;
      } else {
        const planPath = join(options.root, ".svatah", "plan.json");
        if (!existsSync(planPath)) {
          options.onProgress?.(
            `no plan at ${planPath}; run \`svatah compile\` before healing a run directory`,
          );
          return "unreachable";
        }
        try {
          plan = planSchema.parse(JSON.parse(readFileSync(planPath, "utf8"))) as Plan;
        } catch {
          return "unreachable";
        }
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

      /*
       * The story's inputs (Draft 2.6, LLD §10).
       *
       * The prefix of `I want to validate login` types `{input.email}` and
       * `{input.password}`; with an empty scope those two steps fail and the
       * replay reports `unreachable` for a reason that has nothing to do with
       * the page. The values come from `--input` / `SVATAH_INPUT_<NAME>`,
       * because the run recorded only their names — a secret is never written
       * into a run directory (REQ-NFR-6).
       */
      const declared = story.signature?.inputs ?? {};
      /*
       * Only what this story declares. `--input` is about the *run*, and a run
       * holds stories with different signatures; handing a story something it
       * never asked for is an error (`"X" has no input "y"`), and it would be a
       * strange one to get while healing something else. `svatah run` filters
       * the same way for the same reason.
       */
      const inputs = Object.fromEntries(
        Object.entries({ ...options.inputs, ...context?.inputs }).filter(
          ([name]) => declared[name] !== undefined,
        ),
      );

      const missing = missingInputs(story, inputs);
      const first = missing[0];
      if (first !== undefined) {
        return {
          outcome: "unreachable",
          reason:
            `"${story.name}" needs the input${missing.length === 1 ? "" : "s"} ` +
            `${missing.map((name) => `"${name}"`).join(", ")} to replay the ${at} step(s) ` +
            `before ${input.stepId}, and ${missing.length === 1 ? "it was" : "they were"} ` +
            `not supplied. Pass --input ${first}=… or set ` +
            `SVATAH_INPUT_${environmentName(first)}.`,
        };
      }

      /*
       * A prefix is not the story, so it does not owe the story's outputs.
       *
       * `I want to validate login` declares `outputs: enterprise: string`,
       * captured by its sixth step. Replaying the first four and then asking for
       * `enterprise` would fail on a promise the prefix never made — and the
       * healer would read that as "could not reach the page".
       */
      const prefix: Story = {
        ...story,
        steps: story.steps.slice(0, at),
        ...(story.signature === undefined
          ? {}
          : { signature: { ...story.signature, outputs: {} } }),
      };
      const scope = new Scope({
        ...(options.data === undefined ? {} : { data: options.data }),
        ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
      });

      options.onProgress?.(
        `replaying "${story.name}" to ${input.stepId} (${at} step(s))` +
          (Object.keys(inputs).length === 0
            ? ""
            : ` with ${Object.keys(inputs).sort().join(", ")}`),
      );

      const outcome = await runStory(prefix, inputs, {
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

/**
 * The inputs a story declares, has no default for, and was not given.
 *
 * Named before the replay rather than discovered by it: the steps that read them
 * fail with "no value for {input.password}", which reaches the report as a
 * failure to arrive somewhere. Saying it up front is the difference between a
 * report a person can act on and one they have to reproduce (Draft 2.6, LLD §10).
 */
function missingInputs(story: Story, supplied: Readonly<Record<string, unknown>>): string[] {
  return Object.entries(story.signature?.inputs ?? {})
    .filter(([name, declared]) => !(name in supplied) && !("default" in declared))
    .map(([name]) => name)
    .sort();
}

/** `password` → `PASSWORD`, the way `SVATAH_INPUT_<NAME>` spells it. */
function environmentName(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

/** Register it. `svatah heal --run <id>` calls this; nothing else does. */
export function registerRuntimeReplayer(options: RuntimeReplayerOptions): void {
  registerReplayer(runtimeReplayer(options));
}
