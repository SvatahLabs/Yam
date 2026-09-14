/**
 * `yam trajectory compile` (T5.5, REQ-BEH-4, LLD §13.4).
 *
 * ```
 * yam trajectory compile runs/<id>/trajectory.jsonl [dir] [--name "Book a slot"]
 * ```
 *
 * Turns an agent's exploration into a proposal under `proposals/<date>/`: a
 * `.flow` draft with the agent's intents above each step, the compiled fragment,
 * and `verified: false` bindings synthesised from the descriptions captured at
 * the time of each call.
 *
 * ## What it will not do
 *
 * Apply anything. A proposal is a file a person reads; the flow store, the
 * bindings store and the plan are untouched, and `writeProposal` is handed the
 * proposals directory rather than the project root so there is no path by which
 * it could reach them (T5.5's Validate: "nothing written outside `proposals/`").
 *
 * LLD §15 does not list a `trajectory` command — Phase 4 wrote trajectories from
 * `yam mcp` and nothing read them. This is the command that reads them, and
 * it is recorded as a deviation in `docs/spec/progress/phase-5.md`: the
 * alternative was a compiler with no way to invoke it, and the app's "compile to
 * proposal" (T5.8) needs one function that both it and a person can call.
 */
import { relative, resolve, sep } from "node:path";
import { compileTrajectory, readTrajectory, writeProposal } from "@svatah/yam-trajectory";
import {
  boolOption,
  EXIT,
  stringOption,
  type CommandIo,
  type ExitCode,
  type ParsedArgs,
} from "@svatah/yam-bindings-cli";
import { loadConfig } from "../project.js";

/*
 * A path relative to the project, with `/` on every platform, as `yam explore`
 * says it: the proposal's directory and files are answered as JSON and compared
 * against `proposals/`, and the source trajectory is written into the proposal.
 */
const portable = (root: string, path: string): string => relative(root, path).split(sep).join("/");

const USAGE = `yam trajectory compile <trajectory.jsonl> [dir] [--name "Story name"]
                                     [--out proposals] [--app proposed] [--json]`;

export async function trajectoryCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  if (args.command[1] !== "compile") {
    io.err(`\`yam trajectory\` takes one subcommand, \`compile\`.\n\n${USAGE}`);
    return EXIT.usage;
  }

  const path = args.command[2];
  if (path === undefined) {
    io.err(`\`yam trajectory compile\` needs a trajectory file.\n\n${USAGE}`);
    return EXIT.usage;
  }

  const root = resolve(args.command[3] ?? ".");
  // The config is read only to fail early on a project that will not load; the
  // compile itself needs nothing from it, which is why a trajectory from one
  // project can be compiled beside another.
  loadConfig(root);

  let compiled;
  try {
    const lines = readTrajectory(resolve(path));
    if (lines.length === 0) {
      io.err(`${path} has no lines, so there is nothing to compile.`);
      return EXIT.usage;
    }
    compiled = compileTrajectory(lines, {
      sourceTrajectory: portable(root, resolve(path)),
      ...(stringOption(args, "name") === undefined ? {} : { storyName: stringOption(args, "name")! }),
      ...(stringOption(args, "app") === undefined ? {} : { app: stringOption(args, "app")! }),
    });
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return EXIT.failed;
  }

  const { dir, files } = writeProposal(
    resolve(root, stringOption(args, "out") ?? "proposals"),
    compiled,
  );

  if (boolOption(args, "json")) {
    io.out(
      JSON.stringify(
        {
          dir: portable(root, dir),
          files: files.map((file) => portable(root, file)),
          steps: compiled.steps,
          review: compiled.review,
        },
        null,
        2,
      ),
    );
  } else {
    for (const one of compiled.review) io.err(`  review: ${one.intent} — ${one.why}`);
    io.out(
      `${compiled.steps.compiled}/${compiled.steps.total} step(s) compile at Tier 1 ` +
        `(${(compiled.steps.rate * 100).toFixed(0)}%) → ${portable(root, dir)}\n` +
        `  ${compiled.proposal.bindings.length} unverified binding(s). ` +
        "Review the draft, then move it into flows/ and record.",
    );
  }

  /*
   * Exit 0 even when some steps became `// review:` comments. A proposal with
   * three steps and one comment is a useful proposal, and the command that
   * produced it did what it was asked. The numbers are on stdout for a script
   * that wants to decide otherwise.
   */
  return EXIT.ok;
}
