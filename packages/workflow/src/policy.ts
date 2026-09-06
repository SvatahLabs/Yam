/**
 * The environment policy (REQ-AUTO-7, 8, LLD §13.2, T5.2).
 *
 * "Config declares `environment: test|staging|production`; production requires
 * `idempotent` or an explicit `allowSideEffects` on each flow run."
 *
 * ## Why this is a refusal and not a warning
 *
 * A test suite that runs against production and fails has told you something. A
 * *workflow* that runs against production has done something — booked a slot,
 * charged a card, deleted a record — and there is no undo for it in this
 * repository. The story that says `idempotent` has promised that running it
 * twice is the same as running it once; the person who passed
 * `--allow-side-effects` has said they meant it. Anything else is someone who
 * had a staging config open in another window.
 *
 * The check is here rather than in `runtime` because it is a property of the
 * *behavior*: a test run against production is a normal thing to do (that is
 * what a smoke test is), and `runtime` is the thing both behaviors share.
 */
import type { Config, Story } from "@svatah/yam-schema";

/** A run refused before it started (LLD §15, exit 10). */
export class EnvironmentRefusal extends Error {
  constructor(
    message: string,
    readonly story: string,
    readonly environment: Config["environment"],
  ) {
    super(message);
    this.name = "EnvironmentRefusal";
  }
}

export interface PolicyOptions {
  /** `--allow-side-effects` on this invocation, over `config.allowSideEffects`. */
  readonly allowSideEffects?: boolean;
}

/**
 * Refuse a non-idempotent story in production without an explicit override.
 *
 * Both halves of REQ-AUTO-7's "requires `idempotent` or an explicit
 * `allowSideEffects`": the story's own declaration, and the caller's. The
 * config's `allowSideEffects` counts as the caller's — it is a line someone
 * wrote deliberately in the file that also says `environment: production`.
 */
export function checkEnvironment(
  story: Story,
  config: Config,
  options: PolicyOptions = {},
): void {
  if (config.environment !== "production") return;
  if (story.meta.idempotent === true) return;
  if (options.allowSideEffects === true || config.allowSideEffects === true) return;

  throw new EnvironmentRefusal(
    `"${story.name}" is not marked \`idempotent\` and this project's environment is ` +
      "`production`, so running it as a workflow is refused (REQ-AUTO-7). Running it would " +
      "have whatever effect it has on the real application, and there is no undo. Either mark " +
      `the story \`story (idempotent=true): ${story.name}\` if running it twice is the same as ` +
      "running it once, or pass --allow-side-effects to say you meant it.",
    story.name,
    config.environment,
  );
}
