/**
 * @svatah/cli
 *
 * The `svatah` command line (LLD §15). It is the only package that registers
 * adapters, which is why the import-boundary lint lets it — and only it and the
 * Playwright Test host — import an `adapter-*` package (LLD §1).
 */
export { main } from "./cli.js";
export {
  parseArgs,
  stringOption,
  stringOptions,
  boolOption,
  numberOption,
  type ParsedArgs,
} from "./args.js";
export { EXIT, type ExitCode } from "./exit-codes.js";
export { registerAllAdapters } from "./adapters.js";
export type { CommandIo } from "./commands/surface.js";

/**
 * The functions the local service calls (LLD §13.5: "every handler calls the
 * same functions the CLI calls; no logic lives in the service").
 *
 * Exporting them is what makes that rule enforceable rather than aspirational:
 * `@svatah/service` may import this package and `@svatah/schema` and nothing
 * else, so a second implementation of `run` behind `POST /run` cannot compile.
 */
export {
  loadProject,
  compileProject,
  loadConfig,
  CONFIG_FILES,
  type LoadedProject,
} from "./project.js";
export { runProject, type RunProjectOptions } from "./commands/run.js";
export { newRunId } from "@svatah/runtime";
