/**
 * `yam trust` — say that a project's own code may run on this machine (SF-15).
 *
 * `steps/` is code, and loading a project imports it. So a project whose steps
 * nobody has trusted loads without them and says so; this is the command that
 * sentence names. See `../trust.ts` for what counts as trusted and why.
 */
import { resolve } from "node:path";
import { boolOption, EXIT, type CommandIo, type ExitCode, type ParsedArgs } from "@svatah/yam-bindings-cli";
import { loadConfig } from "@svatah/yam-bindings-cli";
import { launchesOf } from "../project.js";
import { projectTrust, revokeProject, trustedProjects, trustProject, type ProjectTrust } from "../trust.js";

/**
 * The trust question for a directory, asked with its own config: its steps
 * directory and what it launches. Asked with defaults, `--status` said "no
 * code" about a project whose steps live under `lib/`, and the desktop, which
 * asks `--status`, never offered to trust it.
 */
function trustOf(root: string): ProjectTrust {
  try {
    const { config } = loadConfig(root);
    return projectTrust(root, { stepsDir: config.steps.dir, launches: launchesOf(config) });
  } catch {
    return projectTrust(root);
  }
}

/**
 * The directory asked about: `yam trust <dir>`, or `yam trust --status <dir>`.
 * A bare flag takes the next word as its value, so the second form put the
 * directory in `--status` and answered about the current directory instead.
 */
function directoryOf(args: ParsedArgs): string {
  const named = args.command[1];
  if (named !== undefined) return resolve(named);
  for (const flag of ["status", "revoke", "json"]) {
    const value = args.options[flag];
    if (typeof value === "string" && !["true", "false", "1", "0"].includes(value)) return resolve(value);
  }
  return resolve(args.rest[0] ?? ".");
}

export async function trustCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const json = boolOption(args, "json");
  if (boolOption(args, "list")) {
    const projects = trustedProjects();
    if (json) io.out(JSON.stringify({ projects }));
    else io.out(projects.length === 0 ? "No project is trusted on this machine." : projects.join("\n"));
    return EXIT.ok;
  }

  const root = directoryOf(args);
  if (boolOption(args, "revoke")) {
    const was = revokeProject(root);
    if (json) io.out(JSON.stringify({ root, trusted: false, was }));
    else io.err(was ? `No longer trusted: ${root}. Its steps/ will not be run.` : `${root} was not trusted.`);
    return EXIT.ok;
  }

  if (boolOption(args, "status")) {
    const trust = trustOf(root);
    if (json) io.out(JSON.stringify({ root, runsCode: trust.runsCode, because: trust.because, code: trust.code }));
    else io.err(`${root}: ${trust.runsCode ? "its code runs" : "its code does not run"} (${trust.because}).`);
    return trust.runsCode ? EXIT.ok : EXIT.failed;
  }

  const stored = trustProject(root);
  const code = trustOf(stored).code;
  if (json) io.out(JSON.stringify({ root: stored, trusted: true, code }));
  else {
    io.err(
      `Trusted ${stored}.\n` +
        (code.length === 0
          ? "  It has no step code yet; what is added under steps/ will run.\n"
          : `  Its step code will run: ${code.join(", ")}.\n`) +
        "  `yam trust --revoke` takes it back.",
    );
  }
  return EXIT.ok;
}
