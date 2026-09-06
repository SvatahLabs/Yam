/**
 * `yam compile` and `yam lint` (REQ-COMP-7, 8, REQ-AGT-1, LLD §15).
 *
 * ```
 * yam compile [--stable] [--out .yam/plan.json] [--json]
 * yam lint    [--json]
 * ```
 *
 * They are one command with two outputs: `lint` compiles and then reports what
 * `yam lint` reports (REQ-COMP-8) without writing a plan, and `compile`
 * writes the plan and reports errors. Splitting them into two pipelines would
 * mean lint could pass on something compile refuses.
 *
 * Exit codes are LLD §15's: 0, or 2 when there were compile errors.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { lintPlan, renderPlan } from "@svatah/yam-compiler";
import { formatDiagnostic, type Diagnostic } from "@svatah/yam-spec";
import { boolOption, stringOption, type ParsedArgs } from "@svatah/yam-bindings-cli";
import { EXIT, type ExitCode } from "@svatah/yam-bindings-cli";
import { compileProjectWithTiers, loadProject, type LoadedProject } from "../project.js";
import { preflight, writePlanInputs } from "../front-door.js";
import { isDigestMismatch, registerModelTiers } from "../tiers/register.js";
import type { CommandIo } from "@svatah/yam-bindings-cli";

/** Print diagnostics, worst first, in the shape editors parse. */
export function report(diagnostics: readonly Diagnostic[], io: CommandIo): void {
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  for (const one of [...errors, ...warnings]) io.err(formatDiagnostic(one));
  if (diagnostics.length > 0) io.err("");
}

/**
 * Compile, with whichever model tiers the flags asked for (T4.3, T4.4).
 *
 * `--tier2` and `--tier3` are opt-in, so a compile with neither reaches no
 * network at all — which is the compile half of privacy mode (REQ-NFR-3, T4.7).
 * A tier that was asked for and could not be built says so on stderr rather than
 * being silently absent: "compiled with the grammar alone because you asked for
 * nothing else" and "…because the config names no server" are different facts.
 *
 * A **digest mismatch** is the one model failure that stops the compile
 * (REQ-COMP-3). The pin is what lets provenance say which weights produced a
 * step, and a server that has pulled a new build of the same tag is a different
 * model wearing the same name. `--allow-model-drift` says so deliberately.
 */
/**
 * Compile, with whichever model tiers the flags asked for (T4.3, T4.4).
 *
 * `--tier2` and `--tier3` are opt-in, so a compile with neither reaches no
 * network at all — which is the compile half of privacy mode (REQ-NFR-3, T4.7).
 * A tier that was asked for and could not be built says so on stderr rather than
 * being silently absent: "compiled with the grammar alone because you asked for
 * nothing else" and "…because the config names no server" are different facts.
 *
 * A **digest mismatch** is the one model failure that stops the compile
 * (REQ-COMP-3). The pin is what lets provenance say which weights produced a
 * step, and a server that has pulled a new build of the same tag is a different
 * model wearing the same name. `--allow-model-drift` suppresses the *check* and
 * not the *record*: the digest the server actually served still goes into
 * provenance, so a plan compiled that way says so.
 */
async function compileWithTiers(
  loaded: LoadedProject,
  args: ParsedArgs,
  io: CommandIo,
): Promise<{ result: Awaited<ReturnType<typeof compileProjectWithTiers>> } | { refused: string }> {
  const wantTier2 = boolOption(args, "tier2");
  const wantTier3 = boolOption(args, "tier3");
  const allowDrift = boolOption(args, "allow-model-drift");

  if (wantTier2 || wantTier3) {
    const registered = registerModelTiers({
      config: loaded.config,
      wantTier2,
      wantTier3,
      allowDigestDrift: allowDrift,
      onCall: (line) => io.err(`  ${line}`),
    });
    for (const refusal of registered.refusals) io.err(refusal);
  }

  try {
    return {
      result: await compileProjectWithTiers(loaded, {
        stable: boolOption(args, "stable"),
        tier2: wantTier2,
        tier3: wantTier3,
        onProgress: (line) => io.err(`  ${line}`),
      }),
    };
  } catch (error) {
    if (!isDigestMismatch(error)) throw error;
    return {
      refused:
        `${(error as Error).message}` +
        "\n\n  Nothing was compiled. A pinned digest is what lets a plan's provenance say" +
        "\n  which weights produced a step (REQ-COMP-3); pass --allow-model-drift to" +
        "\n  compile anyway.",
    };
  }
}

export async function compileCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = args.command[1] ?? ".";
  const early = preflight(root, undefined, args, io);
  if (early !== undefined) return early;
  const loaded = await loadProject(root);
  const nothing = preflight(root, loaded, args, io);
  if (nothing !== undefined) return nothing;
  const attempt = await compileWithTiers(loaded, args, io);
  if ("refused" in attempt) {
    io.err(attempt.refused);
    return EXIT.modelUnavailable;
  }
  const compiled = attempt.result;
  const diagnostics = [...loaded.diagnostics, ...compiled.diagnostics];

  // Under the project, not under the working directory: a plan written beside
  // wherever `yam compile <dir>` was typed is a plan nothing else can find (T14.1).
  const out = stringOption(args, "out") ?? join(loaded.root, ".yam", "plan.json");
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
  writePlanInputs(loaded);
  if (!boolOption(args, "json")) {
    const steps = compiled.plan.stories.flatMap((story) => story.steps);
    const tier = (n: number): number => steps.filter((step) => step.origin.tier === n).length;
    io.err(
      `plan written: ${steps.length} step${steps.length === 1 ? "" : "s"}, ` +
        `tier 0 ${tier(0)}, tier 1 ${tier(1)}, tier 2 ${tier(2)}, tier 3 ${tier(3)} → ${out}`,
    );
  }
  return EXIT.ok;
}

/**
 * `yam check` (T14.2, REQ-CLI-3): read, lint and compile in one verb, one
 * report, the plan written. `lint` and `compile` remain as its two halves.
 */
export async function checkCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  return await compileCommand(args, io);
}

export async function lintCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = args.command[1] ?? ".";
  const loaded = await loadProject(root);
  const attempt = await compileWithTiers(loaded, { ...args, options: { ...args.options, stable: true } }, io);
  if ("refused" in attempt) {
    io.err(attempt.refused);
    return EXIT.modelUnavailable;
  }
  const compiled = attempt.result;

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
