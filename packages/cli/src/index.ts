/**
 * @svatah/cli
 *
 * The `svatah` command line (LLD §15) — the whole of it. Module (b)'s commands
 * live here (`compile`, `lint`, `run`, `host generate`, `migrate`, `init`,
 * `doctor`, `serve`); module (a)'s come from `@svatah/bindings-cli` and are
 * mounted under the same executable, so `svatah bindings list` and
 * `svatah-bindings bindings list` are the same function (Draft 2.3).
 *
 * It registers every adapter, which is why the import-boundary lint lets it —
 * and only it, `bindings-cli` and the two Playwright hosts — import an
 * `adapter-*` package (LLD §1).
 */
export { main } from "./cli.js";

/** Re-exported from module (a), so a consumer needs one import (Draft 2.3). */
export {
  parseArgs,
  stringOption,
  stringOptions,
  boolOption,
  numberOption,
  EXIT,
  surfaceCommand,
  bindingsCommand,
  healCommand,
  evalCommand,
  type ParsedArgs,
  type ExitCode,
  type CommandIo,
} from "@svatah/bindings-cli";

export { registerAllAdapters } from "./adapters.js";

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

/**
 * Module (b)'s `Replayer` (LLD §10, Draft 2.3).
 *
 * The healer is module (a) and cannot import the executor, so replaying a flow
 * to its failing step arrives as a plugin the CLI registers.
 */
export { registerRuntimeReplayer, runtimeReplayer, type RuntimeReplayerOptions } from "./replayer.js";
export { newRunId } from "@svatah/runtime";

/** `svatah record` and the fixture answers `--gateway fake` uses (T3.3). */
export { recordCommand } from "./commands/record.js";
export { projectRunners, loadBindings, type ProjectRunnerOptions } from "./commands/run.js";
export {
  defaultCasesPath,
  groundingAnswers,
  readCases,
  type GroundingAnswer,
  type GroundingAnswers,
  type GroundingCase,
} from "./grounding-answers.js";

/**
 * Model-backed `bind()` recording, because module (b) is installed (T3.3).
 *
 * `bind()` records by asking a registered grounder and falling back to a person
 * clicking; module (a) registers nothing. This is where module (b) fills that
 * hole, with the same `ground()` a flow gets (LLD §6.5, §10).
 */
export {
  installModelGrounding,
  uninstallModelGrounding,
  hasModelGrounding,
  type ModelGroundingOptions,
} from "./bind-grounding.js";

/** `svatah eval grounding` — module (b)'s eval suite (T3.4). */
export { groundingEvalCommand } from "./commands/eval-grounding.js";

/**
 * The functions `svatah serve` gives the local service beyond the first four
 * (T5.7, T5.8, LLD §13.5).
 *
 * Exported so the ADE's own tests can build a service wired exactly as the
 * command wires one: the properties they check are about the service boundary,
 * and a test that wired it differently would be checking a different boundary.
 */
export {
  serviceCompileTrajectory,
  serviceHeal,
  serviceOpenSurfaceSession,
  serviceRecord,
  serviceToolsFor,
  serviceVerifyBindings,
} from "./service-api.js";
