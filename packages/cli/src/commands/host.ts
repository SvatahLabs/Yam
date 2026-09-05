/**
 * `svatah host generate` (REQ-RUN-12, LLD §9.1, §15).
 *
 * Writes `.svatah/specs/<flow>.spec.ts` — one test per story, in the run block's
 * order, under a serial describe. `svatah run --host playwright` does the same
 * thing implicitly; this exists so a project can commit the specs, or check them
 * in a pull request, or run Playwright Test directly with its own flags.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "@svatah/schema";
import { generateSpecs } from "@svatah/host-playwright";
import { boolOption, stringOption, type ParsedArgs } from "@svatah/bindings-cli";
import { EXIT, type ExitCode } from "@svatah/bindings-cli";
import { compileProject, loadProject } from "../project.js";
import { report } from "./compile.js";
import type { CommandIo } from "@svatah/bindings-cli";

export async function hostCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  if (args.command[1] !== "generate") {
    io.err("Usage: svatah host generate [dir] [--out .svatah/specs]");
    return EXIT.usage;
  }

  const root = args.command[2] ?? ".";
  const loaded = await loadProject(root);
  const compiled = compileProject(loaded, { stable: true });
  const diagnostics = [...loaded.diagnostics, ...compiled.diagnostics];

  if (diagnostics.some((d) => d.severity === "error")) {
    report(diagnostics, io);
    io.err("The project does not compile, so there are no specs to generate.");
    return EXIT.compileErrors;
  }

  const planPath = join(root, ".svatah", "plan.json");
  mkdirSync(join(root, ".svatah"), { recursive: true });
  writeFileSync(planPath, `${canonicalJson(compiled.plan)}\n`, "utf8");

  const specs = generateSpecs({
    plan: compiled.plan,
    outDir: stringOption(args, "out") ?? join(root, ".svatah", "specs"),
    planPath,
  });

  if (boolOption(args, "json")) {
    io.out(JSON.stringify({ specs: specs.map(({ path, flow, stories }) => ({ path, flow, stories })) }, null, 2));
  } else {
    for (const spec of specs) io.err(`${spec.path} — ${spec.stories.length} story/stories`);
    io.err(`\n${specs.length} spec(s).`);
  }
  return EXIT.ok;
}
