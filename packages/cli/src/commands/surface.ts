/**
 * `svatah surface conform --adapter <name>` (LLD §15, REQ-SURF-3).
 *
 * The CLI is the only thing that registers adapters (LLD §1), so it is the only
 * place that can hand the conformance suite a live surface. The suite itself
 * knows nothing but `AgentSurface`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  renderMarkdown,
  renderReport,
  runSurfaceConformance,
  type ConformanceReport,
} from "@svatah/conformance";
import { createSurface, listAdapters } from "@svatah/surface";
import { DEFAULT_CONFIG, type Config } from "@svatah/schema";
import { registerAllAdapters } from "../adapters.js";
import { boolOption, stringOption, type ParsedArgs } from "../args.js";
import { EXIT, type ExitCode } from "../exit-codes.js";

export interface CommandIo {
  out(text: string): void;
  err(text: string): void;
}

/** Where the sample application runs by default (LLD §16, T0.5). */
const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export async function surfaceCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const sub = args.command[1];
  if (sub !== "conform") {
    io.err(
      `Unknown "surface" subcommand ${sub === undefined ? "(none given)" : `"${sub}"`}. ` +
        "Phase 1 implements `surface conform`.",
    );
    return EXIT.usage;
  }
  return await conform(args, io);
}

async function conform(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const adapter = stringOption(args, "adapter");
  if (adapter === undefined) {
    io.err("`surface conform` needs --adapter <name>.");
    return EXIT.usage;
  }

  registerAllAdapters();
  if (!listAdapters().includes(adapter)) {
    io.err(
      `No adapter registered under "${adapter}". Registered: ${listAdapters().join(", ") || "(none)"}.`,
    );
    return EXIT.usage;
  }

  const baseUrl = (stringOption(args, "base-url") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const headless = !boolOption(args, "headed");
  const only = stringOption(args, "only");
  const json = boolOption(args, "json");

  const config: Config = {
    ...DEFAULT_CONFIG,
    project: "surface-conformance",
    adapter: adapter as Config["adapter"],
    app: { baseUrl },
    run: { ...DEFAULT_CONFIG.run, headless },
  };

  const report = await runSurfaceConformance({
    adapter,
    baseUrl,
    ...(only === undefined ? {} : { only: only.split(",").map((s) => s.trim()) }),
    openSurface: async () => {
      const surface = await createSurface(config);
      await surface.open({ baseUrl });
      return surface;
    },
  });

  emit(report, args, io, json);
  return report.conformant ? EXIT.ok : EXIT.failed;
}

function emit(report: ConformanceReport, args: ParsedArgs, io: CommandIo, json: boolean): void {
  const markdownPath = stringOption(args, "report");
  if (markdownPath !== undefined) {
    mkdirSync(dirname(markdownPath), { recursive: true });
    writeFileSync(markdownPath, renderMarkdown(report), "utf8");
    io.err(`wrote ${markdownPath}`);
  }
  io.out(json ? JSON.stringify(report, null, 2) : renderReport(report));
}
