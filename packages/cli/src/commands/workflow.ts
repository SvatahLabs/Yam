/**
 * `svatah workflow run <story>` (REQ-BEH-2, REQ-AGT-1, LLD §13.2, §15, T5.2).
 *
 * ```
 * svatah workflow run "Book a slot" --input date=2026-09-03 --input user={data.user}
 * svatah workflow run "Book a slot" --resume <runId> --from <stepId>
 * ```
 *
 * Outputs go to **stdout as JSON** and everything else to stderr, so the command
 * composes: `svatah workflow run "Book a slot" --input date=… | jq -r .bookingId`
 * is the shape a cron job or a shell script wants, and a progress line on stdout
 * would break it.
 *
 * The run itself is `runProject`'s — the same function `svatah run` calls, with
 * `behavior: "workflow"` and one story (LLD §13.2). What this file adds is the
 * command line: which story, which inputs, and where the outputs go.
 */
import {
  boolOption,
  EXIT,
  inputOptions,
  sessionTarget,
  stringOption,
  type CommandIo,
  type ExitCode,
  type ParsedArgs,
} from "@svatah/bindings-cli";
import { EnvironmentRefusal, UnknownStory } from "@svatah/workflow";
import { ResumeMismatchError, ResumeUnavailableError } from "@svatah/runtime";
import type { StepResult } from "@svatah/schema";
import { compileProject, loadProject } from "../project.js";
import { report } from "./compile.js";
import { runProject } from "./run.js";

const USAGE = `svatah workflow run <story> [dir] [--input k=v] [--base-url <url>]
                            [--storage-state <path.json>] [--headed]
                            [--allow-side-effects] [--resume <runId> --from <stepId>]
                            [--out runs] [--run-id <id>] [--json]`;

export async function workflowCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  if (args.command[1] !== "run") {
    io.err(`\`svatah workflow\` takes one subcommand, \`run\`.\n\n${USAGE}`);
    return EXIT.usage;
  }

  const storyName = args.command[2];
  if (storyName === undefined) {
    io.err(`\`svatah workflow run\` needs a story name.\n\n${USAGE}`);
    return EXIT.usage;
  }

  const root = args.command[3] ?? ".";
  const loaded = await loadProject(root);
  const compiled = compileProject(loaded, { stable: true });
  const diagnostics = [...loaded.diagnostics, ...compiled.diagnostics];

  if (diagnostics.some((d) => d.severity === "error")) {
    report(diagnostics, io);
    io.err("The project does not compile, so there is nothing to run.");
    return EXIT.compileErrors;
  }

  const resumeId = stringOption(args, "resume");
  const from = stringOption(args, "from");
  if ((resumeId === undefined) !== (from === undefined)) {
    io.err("--resume <runId> and --from <stepId> are used together.");
    return EXIT.usage;
  }

  const json = boolOption(args, "json");

  try {
    const outcome = await runProject(loaded, {
      plan: compiled.plan,
      behavior: "workflow",
      stories: [storyName],
      inputs: inputOptions(args),
      allowSideEffects: boolOption(args, "allow-side-effects"),
      headed: boolOption(args, "headed"),
      session: sessionTarget(args, { config: loaded.config.app }),
      ...(stringOption(args, "out") === undefined ? {} : { outputDir: stringOption(args, "out")! }),
      ...(stringOption(args, "run-id") === undefined ? {} : { runId: stringOption(args, "run-id")! }),
      ...(resumeId === undefined ? {} : { resume: { runId: resumeId, from: from! } }),
      onResult: (result: StepResult) => {
        if (json) return;
        const marks: Record<StepResult["status"], string> = {
          passed: "✓",
          failed: "✗",
          skipped: "–",
          healed: "~",
          aborted: "!",
        };
        io.err(`  ${marks[result.status]} ${result.text}`);
        /*
         * The reason, on the failing step, not only in `results.jsonl`.
         *
         * A workflow is run by a person at a terminal or by a cron job that
         * captures stderr. "`inputs of "Book a slot"` failed" tells neither of
         * them which input; the message says `needs an input "location"`, and it
         * is the difference between a fix and a file to go and read.
         */
        if (result.failure !== undefined) {
          io.err(`      ${result.failure.class}: ${result.failure.message}`);
        }
      },
      log: (message: string) => io.err(`  ${message}`),
    });

    /*
     * The outputs, on stdout, always — even when the run failed.
     *
     * A workflow that got three steps in and stopped captured something, and a
     * caller deciding what to do next needs it. The exit code is what says
     * whether it finished; the JSON is what says how far it got.
     */
    io.out(JSON.stringify(outcome.outputs ?? {}, null, 2));

    if (!json) {
      const { totals } = outcome.summary;
      io.err(
        `\n${outcome.runId}: ${totals.passed} passed, ${totals.failed} failed, ` +
          `${totals.skipped} skipped, ${totals.aborted} aborted → ${outcome.directory}`,
      );
    }
    return outcome.summary.exitCode as ExitCode;
  } catch (error) {
    if (error instanceof UnknownStory) {
      io.err(error.message);
      return EXIT.usage;
    }
    if (error instanceof EnvironmentRefusal) {
      // Exit 10, "refused (environment)" (LLD §15). Distinct from a failure:
      // nothing ran, and nothing about the application is being reported.
      io.err(error.message);
      return EXIT.refused;
    }
    if (error instanceof ResumeMismatchError) {
      io.err(error.message);
      return EXIT.hashMismatch;
    }
    if (error instanceof ResumeUnavailableError) {
      io.err(error.message);
      return EXIT.usage;
    }
    throw error;
  }
}
