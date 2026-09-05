/**
 * `svatah tool serve` (T5.3, REQ-BEH-3, REQ-AUTO-6, 8, REQ-AGT-1, LLD §13.3, §15).
 *
 * ```
 * svatah tool serve --expose "Book a slot,Cancel booking" [--stdio]
 * ```
 *
 * An MCP server whose tools *are* the exposed stories: one tool per story, its
 * `inputSchema` derived from the signature, its handler a `runWorkflow` call
 * with the agent as invoker.
 *
 * ## What this file is allowed to be
 *
 * Thin. `@svatah/tool` decides which stories become tools and what a call
 * returns; `@svatah/workflow` runs them; this wires the two to the MCP SDK and
 * to a project on disk. The rule that keeps `svatah mcp` honest — "no logic
 * lives in this file" (LLD §13.5's rule for the service, and §15's for MCP) —
 * applies here for the same reason: an agent calling `book_a_slot` and a person
 * running `svatah workflow run "Book a slot"` must do the same thing.
 *
 * ## No model, and it is checkable
 *
 * `tool` cannot import `gateway` (LLD §1), and neither can `workflow` or
 * `runtime`. This file registers the adapters and the project loader and nothing
 * else — in particular it does not call `registerModelTiers` or install a
 * regrounder. A tool call with the model endpoint blocked behaves identically,
 * which is what T5.3's Validate asks to be demonstrated.
 */
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, type ZodRawShape } from "zod";
import { callTool, toolsFor, type ToolDefinition } from "@svatah/tool";
import type { Invoker, Signature } from "@svatah/schema";
import {
  boolOption,
  EXIT,
  sessionTarget,
  stringOption,
  type CommandIo,
  type ExitCode,
  type ParsedArgs,
} from "@svatah/bindings-cli";
import { registerAllAdapters } from "../adapters.js";
import { compileProject, loadProject } from "../project.js";
import { report } from "./compile.js";
import { runProject } from "./run.js";

const USAGE = `svatah tool serve [dir] [--expose "Story one,Story two"] [--stdio]
                         [--base-url <url>] [--storage-state <path.json>]
                         [--headed] [--allow-side-effects] [--out runs] [--json]`;

export interface ToolServerBuild {
  readonly server: McpServer;
  readonly tools: readonly ToolDefinition[];
  /** Every invocation, in order, for the ADE's tool panel (T5.8). */
  readonly invocations: readonly Invocation[];
  close(): Promise<void>;
}

/** One tool call, as the tool panel shows it (REQ-ADE-8). */
export interface Invocation {
  readonly at: string;
  readonly tool: string;
  readonly story: string;
  readonly invoker: Invoker;
  readonly runId: string;
  readonly status: string;
  readonly runDir: string;
}

export interface BuildToolServerOptions {
  readonly root: string;
  readonly io: CommandIo;
  readonly expose?: string;
  readonly allowSideEffects?: boolean;
  readonly headed?: boolean;
  readonly outputDir?: string;
  readonly baseUrl?: string;
  readonly storageState?: string;
  readonly onInvocation?: (invocation: Invocation) => void;
}

/**
 * Build the server.
 *
 * Exported so the integration test can drive it over the SDK's in-memory
 * transport, as `svatah mcp`'s test does: what is under test is the tools, and a
 * test that had to parse stdio framing would be testing the SDK.
 */
export async function buildToolServer(
  options: BuildToolServerOptions,
): Promise<ToolServerBuild> {
  const root = resolve(options.root);
  const loaded = await loadProject(root);
  const compiled = compileProject(loaded, { stable: true });

  const diagnostics = [...loaded.diagnostics, ...compiled.diagnostics];
  if (diagnostics.some((d) => d.severity === "error")) {
    report(diagnostics, options.io);
    throw new Error("The project does not compile, so there are no tools to serve.");
  }

  registerAllAdapters();

  const { tools, exposure } = toolsFor({
    plan: compiled.plan,
    config: loaded.config,
    ...(options.expose === undefined ? {} : { expose: options.expose }),
  });

  /*
   * The refusals, at start, on stderr (REQ-AUTO-8).
   *
   * An operator who asked for two tools and got one has to be told which and
   * why now, not when an agent reports that a tool they were told about does
   * not exist.
   */
  for (const one of exposure.refused) {
    options.io.err(`  not exposed: "${one.name}" — ${one.why}`);
  }

  const invocations: Invocation[] = [];

  const server = new McpServer(
    { name: "svatah-tools", version: "0.1.0" },
    {
      instructions:
        "Each tool runs one Svatah story as a deterministic function: the same plan and the " +
        "same element bindings every time, with no model in the loop. Arguments are validated " +
        "against the story's signature before anything runs, and every call is recorded in " +
        "the run's audit log with the caller's identity. The `runId` in the result names the " +
        "run directory holding the step-by-step record.",
    },
  );

  for (const tool of tools) {
    const story = compiled.plan.stories.find((one) => one.name === tool.story)!;
    server.registerTool(
      tool.name,
      {
        title: tool.story,
        description: tool.description,
        inputSchema: zodShapeFor(story.signature),
      },
      async (args: Record<string, unknown>) => {
        const result = await callTool(tool, args, {
          client: clientName(server),
          runner: async (storyName, call) => {
            const outcome = await runProject(loaded, {
              plan: compiled.plan,
              behavior: "tool",
              stories: [storyName],
              inputs: call.inputs,
              invoker: call.invoker,
              ...(options.allowSideEffects === undefined
                ? {}
                : { allowSideEffects: options.allowSideEffects }),
              ...(options.headed === undefined ? {} : { headed: options.headed }),
              ...(options.outputDir === undefined ? {} : { outputDir: options.outputDir }),
              session: {
                ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
                ...(options.storageState === undefined
                  ? {}
                  : { storageState: options.storageState }),
              },
            });
            return {
              runId: outcome.runId,
              outputs: outcome.outputs ?? {},
              summary: outcome.summary,
              results: outcome.results,
              exitCode: outcome.summary.exitCode,
            };
          },
        });

        const invocation: Invocation = {
          at: new Date().toISOString(),
          tool: tool.name,
          story: tool.story,
          invoker: { kind: "agent", id: clientName(server), via: "mcp" },
          runId: result.runId,
          status: result.status,
          runDir: resolve(root, options.outputDir ?? loaded.config.run.outputDir, result.runId),
        };
        invocations.push(invocation);
        options.onInvocation?.(invocation);
        options.io.err(`  ${tool.name} → ${result.status} (${result.runId})`);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          /*
           * A failed run is `isError` so the agent does not read the outputs as
           * a success, and the payload is still the whole result: the `runId`
           * is what lets it look at what happened rather than retry blindly.
           */
          ...(result.status === "passed" ? {} : { isError: true }),
        };
      },
    );
  }

  return {
    server,
    tools,
    invocations,
    close: async () => {
      await server.close().catch(() => undefined);
    },
  };
}

export async function toolCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  if (args.command[1] !== "serve") {
    io.err(`\`svatah tool\` takes one subcommand, \`serve\`.\n\n${USAGE}`);
    return EXIT.usage;
  }

  const root = args.command[2] ?? ".";
  const target = sessionTarget(args, {});

  let built: ToolServerBuild;
  try {
    built = await buildToolServer({
      root,
      io,
      ...(stringOption(args, "expose") === undefined
        ? {}
        : { expose: stringOption(args, "expose")! }),
      allowSideEffects: boolOption(args, "allow-side-effects"),
      headed: boolOption(args, "headed"),
      ...(stringOption(args, "out") === undefined ? {} : { outputDir: stringOption(args, "out")! }),
      ...(target.baseUrl === undefined ? {} : { baseUrl: target.baseUrl }),
      ...(target.storageState === undefined ? {} : { storageState: target.storageState }),
    });
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return EXIT.failed;
  }

  if (built.tools.length === 0) {
    io.err(
      "No stories are exposed, so the server would have no tools. Name them with " +
        '--expose "Story one,Story two" or in `tool.expose` in svatah.config.yaml.',
    );
    await built.close();
    return EXIT.usage;
  }

  if (boolOption(args, "json")) {
    // A description of the server rather than the server: what an operator wants
    // before pointing an agent at it, and what the ADE's tool panel lists.
    io.out(JSON.stringify({ tools: built.tools }, null, 2));
    await built.close();
    return EXIT.ok;
  }

  io.err(`serving ${built.tools.length} tool(s) over stdio: ${built.tools.map((t) => t.name).join(", ")}`);

  /*
   * The server owns the process until the client disconnects.
   *
   * MCP over stdio ends when the client closes the pipe. Waiting on the
   * transport's close rather than on a promise that never settles is what lets
   * the process exit cleanly instead of leaving Node to complain about an
   * unsettled top-level await — which is what an agent sees on stderr every
   * time it finishes with a tool server.
   */
  const transport = new StdioServerTransport();
  await built.server.connect(transport);

  /*
   * Wait on stdin ending, not on the transport's `onclose`.
   *
   * `server.connect()` installs its own `onclose` handler, and assigning over it
   * either loses the server's cleanup or is lost to it, depending on the order.
   * What is unambiguous is the pipe: MCP over stdio ends when the client closes
   * it, and stdin's `close` is that. Without this the process sat on a promise
   * that never settled and Node printed "unsettled top-level await" at every
   * agent that finished with a tool server.
   */
  await new Promise<void>((done) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      done();
    };
    process.stdin.once("close", finish);
    process.stdin.once("end", finish);
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });

  await built.close();
  return EXIT.ok;
}

/**
 * The MCP SDK wants a Zod shape; the signature is the source of truth.
 *
 * Built from the same `Signature` `inputSchemaOf` reads, so the schema the agent
 * sees and the arguments the SDK validates come from one declaration. The
 * runtime validates again, by type, before anything runs (REQ-AUTO-5) — two
 * checks of one rule, not two rules.
 */
function zodShapeFor(signature: Signature | undefined): ZodRawShape {
  const shape: ZodRawShape = {};
  for (const [name, declared] of Object.entries(signature?.inputs ?? {})) {
    const base =
      declared.type === "number"
        ? z.number()
        : declared.type === "boolean"
          ? z.boolean()
          : declared.type === "json"
            ? z.unknown()
            : z.string();
    const described =
      declared.type === "secret"
        ? base.describe("secret: redacted in the audit log, the results and screenshots")
        : declared.description === undefined
          ? base
          : base.describe(declared.description);
    shape[name] = "default" in declared ? described.optional() : described;
  }
  return shape;
}

/** Whatever the connected MCP client calls itself (REQ-AUTO-6). */
function clientName(server: McpServer): string {
  const info = server.server.getClientVersion();
  return info?.name === undefined ? "agent" : info.name;
}
