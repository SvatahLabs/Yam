/**
 * `yam explore` (T14.9, REQ-AGT-5, LLD §13.4): an agent's way of writing a flow.
 *
 * One verb over two halves that already exist. It serves the MCP surface on
 * stdio exactly as `yam mcp` does, with the trajectory under
 * `.yam/explore/<id>/`, and when the agent disconnects it compiles what the
 * agent did into a proposal under `proposals/<date>/`, as `yam trajectory
 * compile` would, and names it. Nothing an agent did reaches `flows/` or the
 * store: a proposal is where its work waits for a person.
 *
 * `--trajectory <path.jsonl>` compiles an existing trajectory instead — one
 * `yam mcp` or the app's Explorer wrote — and serves nothing.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { boolOption, EXIT, stringOption, type CommandIo, type ExitCode, type ParsedArgs } from "@svatah/yam-bindings-cli";
import { compileTrajectory, readTrajectory, writeProposal } from "@svatah/yam-trajectory";
import { buildMcpServer } from "./mcp.js";

export interface ExploreOptions {
  readonly root: string;
  readonly io: CommandIo;
  /** The proposed story's name. */
  readonly name?: string;
  /** Where proposals go; `proposals/` under the project by default. */
  readonly out?: string;
  /** The session id, so a test can predict the trajectory's path. */
  readonly sessionId?: string;
  /** The transport the agent speaks over; stdio when the command runs. */
  readonly transport: Transport;
  readonly json?: boolean;
}

export interface Proposal {
  readonly dir: string;
  readonly files: readonly string[];
  /** How many of the agent's calls became steps, and the share that did. */
  readonly steps: { readonly total: number; readonly compiled: number; readonly rate: number };
  readonly review: ReadonlyArray<{ readonly intent: string; readonly why: string }>;
}

/** Compile a trajectory into a proposal, or nothing when it is empty. */
export function proposalFrom(
  root: string,
  trajectoryPath: string,
  options: { readonly name?: string; readonly out?: string },
): Proposal | undefined {
  const lines = readTrajectory(trajectoryPath);
  if (lines.length === 0) return undefined;
  const compiled = compileTrajectory(lines, {
    sourceTrajectory: relative(root, trajectoryPath),
    ...(options.name === undefined ? {} : { storyName: options.name }),
  });
  const { dir, files } = writeProposal(resolve(root, options.out ?? "proposals"), compiled);
  return {
    dir: relative(root, dir),
    files: files.map((file) => relative(root, file)),
    steps: compiled.steps,
    review: compiled.review,
  };
}

/** Say what became of the exploration, the way the command's output mode wants it. */
function report(proposal: Proposal | undefined, io: CommandIo, json: boolean): void {
  if (json) {
    io.out(JSON.stringify(proposal ?? { proposal: null }, null, 2));
    return;
  }
  if (proposal === undefined) {
    io.err("The exploration was empty: the agent made no surface call, so there is nothing to propose.");
    return;
  }
  for (const one of proposal.review) io.err(`  review: ${one.intent} — ${one.why}`);
  io.err(
    `proposal written: ${proposal.steps.compiled} of ${proposal.steps.total} call${proposal.steps.total === 1 ? "" : "s"} became steps → ${proposal.dir}\n` +
      `  read it, move its flow into flows/ when it says what you meant, then \`yam check\`.`,
  );
}

/** Serve one exploration over `transport`, then compile it. */
export async function explore(options: ExploreOptions): Promise<Proposal | undefined> {
  const root = resolve(options.root);
  const sessionId = options.sessionId ?? randomUUID();
  const trajectoryPath = join(root, ".yam", "explore", sessionId, "trajectory.jsonl");
  const built = await buildMcpServer({ root, io: options.io, trajectoryPath, sessionId });
  options.io.err(`yam explore — the agent's calls are recorded at ${relative(root, trajectoryPath)}`);
  await built.server.connect(options.transport);
  await new Promise<void>((done) => {
    options.transport.onclose = () => done();
    process.once("SIGINT", () => done());
    process.once("SIGTERM", () => done());
  });
  await built.close();
  const proposal = existsSync(trajectoryPath)
    ? proposalFrom(root, trajectoryPath, { ...(options.name === undefined ? {} : { name: options.name }), ...(options.out === undefined ? {} : { out: options.out }) })
    : undefined;
  report(proposal, options.io, options.json === true);
  return proposal;
}

export async function exploreCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = resolve(args.command[1] ?? ".");
  const name = stringOption(args, "name");
  const json = boolOption(args, "json");
  const existing = stringOption(args, "trajectory");
  if (existing !== undefined) {
    const path = resolve(existing);
    if (!existsSync(path)) {
      io.err(`No trajectory at ${existing}.`);
      return EXIT.usage;
    }
    try {
      report(proposalFrom(root, path, name === undefined ? {} : { name }), io, json);
      return EXIT.ok;
    } catch (error) {
      io.err(error instanceof Error ? error.message : String(error));
      return EXIT.failed;
    }
  }
  await explore({ root, io, transport: new StdioServerTransport(), json, ...(name === undefined ? {} : { name }) });
  return EXIT.ok;
}
