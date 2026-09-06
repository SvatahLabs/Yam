/**
 * The tool behavior: stories over MCP as deterministic tools
 * (REQ-BEH-3, REQ-AUTO-6, 8, LLD §13.3, T5.3).
 *
 * "`yam tool serve --expose "Book a slot,Cancel booking"`: an MCP server
 * whose tools are derived from story signatures. Each call runs `runWorkflow`
 * with `invoker: { kind: "agent", id: <mcp client id>, via: "mcp" }`, returns
 * `outputs` plus `runId`, and never touches a model."
 *
 * ## Why an agent calling a tool is not an agent driving a browser
 *
 * The MCP server in `@svatah/yam` (`yam mcp`, T4.6) hands an agent the raw
 * surface: snapshot, act by reference, one decision at a time. That is
 * exploration, and it is what a trajectory is made of.
 *
 * This is the opposite end. An agent calling `book_a_slot` is calling a
 * *function*: it passes arguments, gets typed outputs and a `runId`, and has no
 * say at all in what happens in between. Every step was decided at authoring
 * time and is in the plan. Nothing here can reach a model — `tool ─► workflow,
 * schema` (LLD §1), and the import-boundary lint says so — which is what makes
 * "deterministic tool" a structural claim rather than a promise.
 *
 * ## The audit line is the point
 *
 * A person running a workflow can say what they did. An agent cannot be asked
 * afterwards. So `audit.jsonl` records the invoker as an agent, with the MCP
 * client's own name, and the inputs it passed with secrets redacted (REQ-AUTO-6).
 * That record is the only account of why the system changed.
 */
import type { WorkflowOutcome } from "@svatah/yam-workflow";
import type { Config, Invoker, Plan, Story } from "@svatah/yam-schema";
import { exposeList, exposureFor, type Exposure } from "./expose.js";
import { descriptionOf, inputSchemaOf, toolNameOf, type ToolSchema } from "./schema.js";

/** One story, as a tool an MCP client can see and call. */
export interface ToolDefinition {
  /** `book_a_slot`. */
  readonly name: string;
  /** The story it runs, exactly as written. */
  readonly story: string;
  readonly description: string;
  readonly inputSchema: ToolSchema;
}

/** What a tool call returns to the agent (LLD §13.3). */
export interface ToolResult {
  readonly runId: string;
  readonly outputs: Record<string, unknown>;
  /** `passed` when every step passed; otherwise what stopped it. */
  readonly status: "passed" | "failed" | "aborted";
  readonly exitCode: number;
  /** Present when the run did not pass, so an agent can say why rather than retry blindly. */
  readonly failure?: { readonly step: string; readonly class: string; readonly message: string };
}

export interface ToolServerOptions {
  readonly plan: Plan;
  readonly config: Config;
  /** `--expose "a,b"`, over `config.tool.expose`. */
  readonly expose?: string;
  /**
   * Runs one story. Supplied rather than built here for the same reason the
   * executor's collaborators are: `tool` depends on `workflow` and `schema` and
   * nothing else (LLD §1), and everything that opens a browser lives above.
   */
  readonly runner: (
    story: string,
    options: { inputs: Record<string, unknown>; invoker: Invoker },
  ) => Promise<WorkflowOutcome>;
  readonly onLog?: (message: string) => void;
}

/**
 * The tools a project exposes, and the reasons for the ones it does not.
 *
 * Both halves are returned rather than the refusals being thrown away: an
 * operator who wrote `--expose "Book a slot,Cancel booking"` and got one tool
 * needs to be told which one and why, at start, on stderr — not to discover it
 * when an agent cannot find a tool it was told about.
 */
export function toolsFor(options: Pick<ToolServerOptions, "plan" | "config" | "expose">): {
  tools: ToolDefinition[];
  exposure: Exposure;
} {
  const names = exposeList(options.config, options.expose);
  const exposure = exposureFor(options.plan, options.config, names);

  const tools = exposure.exposed.map(({ story }) => definitionOf(story));

  /*
   * Two stories whose names differ only in punctuation would become one tool.
   * Refusing is the only safe answer: an agent calling `book_a_slot` would get
   * whichever was registered last, and nothing about the call would say so.
   */
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const tool of tools) {
    const first = seen.get(tool.name);
    if (first !== undefined) clashes.push(`"${first}" and "${tool.story}" both become ${tool.name}`);
    else seen.set(tool.name, tool.story);
  }
  if (clashes.length > 0) {
    throw new Error(
      `Two exposed stories map to one tool name: ${clashes.join("; ")}. Rename one of them.`,
    );
  }

  return { tools, exposure };
}

/** One story's tool definition. */
export function definitionOf(story: Story): ToolDefinition {
  return {
    name: toolNameOf(story.name),
    story: story.name,
    description: descriptionOf(story),
    inputSchema: inputSchemaOf(story),
  };
}

/**
 * Call one tool.
 *
 * A failed run is a *result*, not an exception: the agent asked what happened
 * and the honest answer is "it got to step three and the booking form rejected
 * the date", with the `runId` that has the whole record. Throwing would leave it
 * with a string and no way to look.
 *
 * The invoker is the agent, by whatever name the MCP client gave itself
 * (REQ-AUTO-6). A client that gave none is `agent`, which is still true.
 */
export async function callTool(
  tool: ToolDefinition,
  inputs: Record<string, unknown>,
  options: { runner: ToolServerOptions["runner"]; client?: string },
): Promise<ToolResult> {
  const invoker: Invoker = {
    kind: "agent",
    id: options.client === undefined || options.client === "" ? "agent" : options.client,
    via: "mcp",
  };

  const outcome = await options.runner(tool.story, { inputs, invoker });
  const failed = outcome.results.find((result) => result.status === "failed");

  return {
    runId: outcome.runId,
    outputs: outcome.outputs,
    status:
      outcome.results.some((r) => r.status === "aborted")
        ? "aborted"
        : failed === undefined
          ? "passed"
          : "failed",
    exitCode: outcome.exitCode,
    ...(failed === undefined
      ? {}
      : {
          failure: {
            step: failed.text,
            class: failed.failure?.class ?? "unknown",
            message: failed.failure?.message ?? "",
          },
        }),
  };
}

