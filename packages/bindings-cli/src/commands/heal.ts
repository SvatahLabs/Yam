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
  const baseUrl = stringOption(args, "base-url");
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
    ...(baseUrl === undefined ? {} : { app: { baseUrl } }),
    run: { ...DEFAULT_CONFIG.run, headless: !boolOption(args, "headed") },
  };

  const report = await heal({
    bindingsDir,
    inputs,
    apply,
    testIdAttributes: DEFAULT_CONFIG.bindings.testIdAttributes,
    /**
     * Get back to the page the failure happened on.
     *
     * LLD §12 says the healer replays to the failing point: through the runtime
     * for a flow, and by re-running the named Playwright test for a bind-failure.
     * Neither exists in Phase 1 — the executor is T2.7 — so the session is put
     * back on the URL the failure recorded, which is the page state the repair
     * needs. Where a page is only reachable through a login, `--base-url` and a
     * storage state get there; a failure on such a page is reported `unreachable`
     * rather than silently mis-repaired.
     */
    open: async (input) => {
      const surface = await createSurface(config);
      await surface.open(baseUrl === undefined ? {} : { baseUrl });
      const url = input.url ?? input.state?.url;
      if (url !== undefined) await surface.act("navigate", undefined, { url });
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
