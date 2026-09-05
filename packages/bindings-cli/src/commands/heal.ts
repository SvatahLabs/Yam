/**
 * `svatah heal --run <id> | --from-bind-failures` (LLD §15, T1.7).
 *
 * Exit 0 when everything was repaired, 7 when some failures were not (LLD §15).
 * `--apply` writes the repaired store; without it the diff is the whole output,
 * because a repair is a proposal about what an element means and a person has to
 * agree with it (REQ-HEAL-2).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  clearRegrounder,
  heal,
  readBindFailures,
  readRunFailures,
  renderHealMarkdown,
  renderHealReport,
  type HealInput,
} from "@svatah/healer";
import { createSurface, listAdapters } from "@svatah/surface";
import { DEFAULT_CONFIG, type Config } from "@svatah/schema";
import { registerAllAdapters } from "../adapters.js";
import { boolOption, stringOption, type ParsedArgs } from "../args.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { sessionTarget } from "../session.js";
import type { CommandIo } from "./surface.js";

export async function healCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const runId = stringOption(args, "run");
  const fromBindFailures = boolOption(args, "from-bind-failures");

  if (runId === undefined && !fromBindFailures) {
    io.err("`heal` needs --run <id> or --from-bind-failures.");
    return EXIT.usage;
  }

  const bindingsDir = stringOption(args, "dir") ?? process.env["SVATAH_BINDINGS"] ?? "bindings";
  const outputDir = stringOption(args, "out") ?? process.env["SVATAH_OUT"] ?? ".svatah";
  const runsDir = stringOption(args, "runs") ?? "runs";
  const adapter = stringOption(args, "adapter") ?? "playwright";
  /*
   * Flag, then `SVATAH_BASE_URL` / `SVATAH_STORAGE_STATE`, then `config.app`
   * (LLD §15, Draft 2.5). Phase 3 read the flag and the config but not the
   * environment, so a run started against an ephemeral port — the normal shape
   * of a CI job — could not be healed without repeating the flag by hand
   * (Phase 3 verification, F2).
   *
   * `@svatah/cli` merges the *project's* `config.app` in before delegating here
   * (`prepareRunHeal`), which is the same value `root` would find; reading it
   * here as well is what makes `svatah-bindings heal` behave identically when
   * no project loads.
   */
  const { baseUrl, storageState } = sessionTarget(args, {
    root: stringOption(args, "project") ?? ".",
  });
  const json = boolOption(args, "json");
  const apply = boolOption(args, "apply");

  // `--no-model` is the default and is accepted for symmetry with `eval healing`:
  // module (a) ships the no-op Regrounder, so there is no model to turn off. It
  // is spelled out rather than ignored, so a script that passes it is not
  // silently relying on a flag that does nothing else.
  if (boolOption(args, "no-model")) clearRegrounder();

  let inputs: HealInput[];
  try {
    inputs =
      runId === undefined ? readBindFailures(outputDir) : readRunFailures(join(runsDir, runId));
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return EXIT.failed;
  }

  if (inputs.length === 0) {
    const where = runId === undefined ? join(outputDir, "bind-failures.jsonl") : join(runsDir, runId);
    io.out(`No locator failures in ${where}. Nothing to repair.`);
    return EXIT.ok;
  }

  registerAllAdapters();
  if (!listAdapters().includes(adapter)) {
    io.err(`No adapter registered under "${adapter}". Registered: ${listAdapters().join(", ")}.`);
    return EXIT.usage;
  }

  const config: Config = {
    ...DEFAULT_CONFIG,
    project: "heal",
    adapter: adapter as Config["adapter"],
    app: {
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(storageState === undefined ? {} : { storageState }),
    },
    run: { ...DEFAULT_CONFIG.run, headless: !boolOption(args, "headed") },
  };

  const report = await heal({
    bindingsDir,
    inputs,
    apply,
    testIdAttributes: DEFAULT_CONFIG.bindings.testIdAttributes,
    /**
     * Open a session where the flow starts (Draft 2.4, LLD §10).
     *
     * "Both implementations must first put the session where the flow starts,
     * exactly as the executor does: open at the flow's base URL with the
     * configured storage state, then replay the prefix of steps before the
     * failing one."
     *
     * The navigation lives here rather than in a replayer because this is the
     * only party that knows the base URL and the storage state — a replayer is
     * given a session, not a configuration. Getting from the flow's start to
     * the failing step is then the replayer's job and only the replayer's:
     * module (a)'s default restores the state the failure recorded, module (b)'s
     * replays the story to it, and each checks it arrived. This used to navigate
     * to the failure's URL itself, which quietly did the session-state
     * replayer's work for it and did nothing at all for a run whose results
     * carried no state.
     */
    open: async () => {
      const surface = await createSurface(config);
      await surface.open({
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(storageState === undefined ? {} : { storageState }),
      });
      if (baseUrl !== undefined && surface.kind === "web") {
        await surface.act("navigate", undefined, { url: baseUrl });
      }
      return surface;
    },
  });

  writeDiffAndReport(report.diff, report, outputDir, io);
  if (report.applied) io.err(`applied the repairs to ${bindingsDir}`);

  io.out(json ? JSON.stringify(report, null, 2) : renderHealReport(report));

  return report.totals.unrepaired === 0 ? EXIT.ok : EXIT.someUnrepaired;
}

function writeDiffAndReport(
  diff: string,
  report: Parameters<typeof renderHealMarkdown>[0],
  outputDir: string,
  io: CommandIo,
): void {
  const healDir = join(outputDir, "heal");
  mkdirSync(healDir, { recursive: true });

  const diffPath = join(healDir, "bindings.diff");
  writeFileSync(diffPath, diff, "utf8");
  const reportPath = join(healDir, "report.md");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, renderHealMarkdown(report), "utf8");

  io.err(`wrote ${diffPath} and ${reportPath}`);
}
