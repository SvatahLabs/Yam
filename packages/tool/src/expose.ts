/**
 * Which stories a tool server exposes, and which it refuses (REQ-AUTO-8, LLD §13.3).
 *
 * "Refuses to expose non-idempotent stories when `tool.requireIdempotent`
 * (default true in `production`)."
 *
 * A tool is a function an *agent* decides to call. Nobody reviews the call, and
 * an agent retries. So a story that books a slot, exposed to an agent that
 * retries on timeout, books two slots — and the only declaration standing
 * between those two facts is `idempotent`.
 *
 * The refusal is at *expose* time, not at call time: an agent that can see a tool
 * will eventually call it, and a tool that refuses on invocation has already told
 * the agent the operation exists. A tool that is not listed cannot be called.
 */
import type { Config, Plan, Story } from "@svatah/yam-schema";

export interface Exposed {
  readonly story: Story;
}

export interface Refused {
  readonly name: string;
  readonly why: string;
}

export interface Exposure {
  readonly exposed: readonly Exposed[];
  /** Named but not exposed, and why — printed at start, never hidden. */
  readonly refused: readonly Refused[];
}

/**
 * Whether `tool.requireIdempotent` applies (LLD §13.3).
 *
 * "Default true in `production`." The config's explicit value wins either way;
 * the default follows the environment, because a staging tool server is a thing
 * people build deliberately and a production one is a thing people acquire by
 * deploying with the wrong config file.
 */
export function requiresIdempotent(config: Config): boolean {
  return config.tool?.requireIdempotent ?? config.environment === "production";
}

/**
 * Resolve `--expose "a,b"` (or `config.tool.expose`) against the plan.
 *
 * Nothing is exposed by default. A tool server that published every story in a
 * project the moment it started would publish whatever the last person added,
 * and REQ-AUTO-8's idempotency declaration would be the only thing between an
 * agent and a story nobody meant it to see.
 */
export function exposureFor(
  plan: Plan,
  config: Config,
  names: readonly string[],
): Exposure {
  const byName = new Map(plan.stories.map((story) => [story.name, story]));
  const exposed: Exposed[] = [];
  const refused: Refused[] = [];
  const strict = requiresIdempotent(config);

  for (const name of names) {
    const story = byName.get(name);
    if (story === undefined) {
      refused.push({
        name,
        why:
          `no story called "${name}". This project has: ` +
          `${[...byName.keys()].sort().join(", ") || "(none)"}`,
      });
      continue;
    }
    if (story.signature === undefined) {
      refused.push({
        name,
        why:
          "it has no signature, so there is nothing to derive a tool schema from. Give it " +
          "`inputs:` and `outputs:` lines (REQ-LANG-13).",
      });
      continue;
    }
    if (strict && story.meta.idempotent !== true) {
      refused.push({
        name,
        why:
          "it is not marked `idempotent` and `tool.requireIdempotent` is on " +
          `(default in \`${config.environment}\`). An agent retries; a story that is not safe ` +
          "to run twice must not be a tool it can retry (REQ-AUTO-8).",
      });
      continue;
    }
    exposed.push({ story });
  }

  return { exposed, refused };
}

/** The story names `--expose` and the config between them ask for. */
export function exposeList(config: Config, flag: string | undefined): string[] {
  const fromFlag = (flag ?? "")
    .split(",")
    .map((one) => one.trim())
    .filter((one) => one !== "");
  return fromFlag.length > 0 ? fromFlag : [...(config.tool?.expose ?? [])];
}
