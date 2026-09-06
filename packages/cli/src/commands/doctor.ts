/**
 * `yam doctor` (REQ-AGT-1, LLD §15).
 *
 * Answers "why did that not work" before it is asked. Every check reports what
 * it found and what to do about it, because a diagnostic that only says "failed"
 * sends the reader to a search engine.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { listAdapters } from "@svatah/yam-surface";
import { registerAllAdapters } from "../adapters.js";
import { boolOption, type ParsedArgs } from "@svatah/yam-bindings-cli";
import { EXIT, type ExitCode } from "@svatah/yam-bindings-cli";
import { CONFIG_FILES, loadProject } from "../project.js";
import type { CommandIo } from "@svatah/yam-bindings-cli";

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** What to do when it is not ok. */
  readonly fix?: string;
}

export async function doctorCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = args.command[1] ?? ".";
  const checks: Check[] = [];

  const [major] = process.versions.node.split(".");
  checks.push({
    name: "Node",
    ok: Number(major) >= 22,
    detail: `v${process.versions.node}`,
    fix: "Yam targets Node 22 LTS (REQ-NFR-7).",
  });

  registerAllAdapters();
  checks.push({
    name: "adapters",
    ok: listAdapters().length > 0,
    detail: listAdapters().join(", "),
    fix: "No adapter registered; this is a build problem rather than a configuration one.",
  });

  const configFile = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  checks.push({
    name: "config",
    ok: configFile !== undefined,
    detail: configFile ?? "none — using the defaults",
    fix: "`yam init` writes one. The defaults work, but they are not your project.",
  });

  try {
    const loaded = await loadProject(root);
    const errors = loaded.diagnostics.filter((d) => d.severity === "error");
    const stories = [...loaded.project.stories.keys()].length;

    checks.push({
      name: "flows",
      ok: errors.length === 0 && stories > 0,
      detail:
        stories === 0
          ? `no stories under ${loaded.config.flows.dir}/`
          : `${loaded.project.flows.length} file(s), ${stories} stories, ${errors.length} error(s)`,
      fix: stories === 0 ? "`yam init` writes an example flow." : "`yam lint` says what is wrong.",
    });

    const bindings = existsSync(join(root, loaded.config.bindings.dir));
    checks.push({
      name: "bindings",
      ok: bindings,
      detail: bindings ? loaded.config.bindings.dir : "none",
      fix: "Record them: `yam record`, or `YAM_MODE=record` in a Playwright test.",
    });

    checks.push({
      name: "custom steps",
      ok: true,
      detail:
        loaded.steps.all().length === 0
          ? `none under ${loaded.config.steps.dir}/`
          : `${loaded.steps.all().length} loaded`,
    });

    checks.push({
      name: "data",
      ok: true,
      detail:
        loaded.project.data.secrets.size === 0
          ? "no secrets declared"
          : `${loaded.project.data.secrets.size} secret path(s): ${[...loaded.project.data.secrets].join(", ")}`,
    });
  } catch (error) {
    checks.push({
      name: "project",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      fix: "The project could not be read at all.",
    });
  }

  if (boolOption(args, "json")) {
    io.out(JSON.stringify({ checks }, null, 2));
  } else {
    for (const check of checks) {
      io.out(`${check.ok ? "ok  " : "FAIL"}  ${check.name.padEnd(14)} ${check.detail}`);
      if (!check.ok && check.fix !== undefined) io.out(`      → ${check.fix}`);
    }
  }

  return checks.every((check) => check.ok) ? EXIT.ok : EXIT.failed;
}
