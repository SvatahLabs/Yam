/**
 * `svatah compile` and `svatah lint` (REQ-COMP-7, 8, REQ-AGT-1, LLD §15).
 *
 * ```
 * svatah compile [--stable] [--out .svatah/plan.json] [--json]
 * svatah lint    [--json]
 * ```
 *
 * They are one command with two outputs: `lint` compiles and then reports what
 * `svatah lint` reports (REQ-COMP-8) without writing a plan, and `compile`
 * writes the plan and reports errors. Splitting them into two pipelines would
 * mean lint could pass on something compile refuses.
 *
 * Exit codes are LLD §15's: 0, or 2 when there were compile errors.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { lintPlan, renderPlan } from "@svatah/compiler";
import { formatDiagnostic, type Diagnostic } from "@svatah/spec";
import { boolOption, stringOption, type ParsedArgs } from "../args.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { compileProject, loadProject } from "../project.js";
import type { CommandIo } from "./surface.js";

/** Print diagnostics, worst first, in the shape editors parse. */
export function report(diagnostics: readonly Diagnostic[], io: CommandIo): void {
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  for (const one of [...errors, ...warnings]) io.err(formatDiagnostic(one));
  if (diagnostics.length > 0) io.err("");
}

export async function compileCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = args.command[1] ?? ".";
  const loaded = await loadProject(root);
  const compiled = compileProject(loaded, { stable: boolOption(args, "stable") });
  const diagnostics = [...loaded.diagnostics, ...compiled.diagnostics];

  const out = stringOption(args, "out") ?? join(loaded.config.run.outputDir, "..", ".svatah", "plan.json");
  const errors = diagnostics.filter((d) => d.severity === "error");

  if (boolOption(args, "json")) {
    io.out(
      JSON.stringify(
        { ok: errors.length === 0, diagnostics, plan: errors.length === 0 ? compiled.plan : undefined },
        null,
        2,
      ),
    );
  } else {
    report(diagnostics, io);
  }

  if (errors.length > 0) {
    io.err(`${errors.length} error(s); no plan written.`);
    return EXIT.compileErrors;
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderPlan(compiled.plan), "utf8");
  if (!boolOption(args, "json")) {
    io.err(
      `wrote ${out} — ${compiled.plan.stories.length} stories, ` +
        `${compiled.plan.stories.reduce((n, s) => n + s.steps.length, 0)} steps, hash ${compiled.plan.hash.slice(0, 12)}`,
    );
  }
  return EXIT.ok;
}

export async function lintCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = args.command[1] ?? ".";
  const loaded = await loadProject(root);
  const compiled = compileProject(loaded, { stable: true });

  const diagnostics = [
    ...loaded.diagnostics,
    ...compiled.diagnostics,
    ...lintPlan(compiled.plan, {
      confidenceThreshold: loaded.config.compile.confidenceThreshold,
      ...(loaded.config.tool?.expose === undefined
        ? {}
        : { exposedAsTools: loaded.config.tool.expose }),
    }),
  ];

  if (boolOption(args, "json")) {
    io.out(JSON.stringify({ diagnostics }, null, 2));
  } else {
    report(diagnostics, io);
    const errors = diagnostics.filter((d) => d.severity === "error").length;
    const warnings = diagnostics.length - errors;
    io.err(`${errors} error(s), ${warnings} warning(s).`);
  }

  return diagnostics.some((d) => d.severity === "error") ? EXIT.compileErrors : EXIT.ok;
}
