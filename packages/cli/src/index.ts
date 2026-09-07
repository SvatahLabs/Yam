/**
 * @svatah/yam
 *
 * The `yam` command line (LLD §15) — the whole of it. Module (b)'s commands
 * live here (`compile`, `lint`, `run`, `host generate`, `migrate`, `init`,
 * `doctor`, `serve`); module (a)'s come from `@svatah/yam-bindings-cli` and are
 * mounted under the same executable, so `yam bindings list` and
 * `yam-bindings bindings list` are the same function (Draft 2.3).
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
} from "@svatah/yam-bindings-cli";

export { registerAllAdapters } from "./adapters.js";

/**
 * The functions the local service calls (LLD §13.5: "every handler calls the
 * same functions the CLI calls; no logic lives in the service").
 *
 * Exporting them is what makes that rule enforceable rather than aspirational:
 * `@svatah/yam-service` may import this package and `@svatah/yam-schema` and nothing
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
export { newRunId } from "@svatah/yam-runtime";

/** `yam record` and the fixture answers `--gateway fake` uses (T3.3). */
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

/** `yam eval grounding` — module (b)'s eval suite (T3.4). */
export { groundingEvalCommand } from "./commands/eval-grounding.js";

/**
 * The functions `yam serve` gives the local service beyond the first four
 * (T5.7, T5.8, LLD §13.5).
 *
 * Exported so the app's own tests can build a service wired exactly as the
 * command wires one: the properties they check are about the service boundary,
 * and a test that wired it differently would be checking a different boundary.
 */
export {
  serviceCompileTrajectory,
  serviceHeal,
  serviceMigrateFromPrototype,
  serviceRecord,
  serviceToolsFor,
  serviceVerifyBindings,
} from "./service-api.js";

/**
 * The Tier 2 instruction block and its version (T6.5, ADR-4).
 *
 * Exported so `scripts/finetune-tier2.mjs` trains against the *same* system
 * prompt the tier sends at compile time. A model tuned against a different one
 * would be tuned for a job it never sees, and the two drifting apart is exactly
 * the kind of thing nobody notices for a month.
 */
export { TIER2_PROMPT_VERSION, TIER2_SYSTEM_PROMPT } from "./tiers/tier2.js";

/**
 * `yam eval self` — the two-sided parity gate, and the one rule about names
 * that a repository check needs too (T11.5, P11-F2).
 *
 * `vitestCaseNames` is how a vitest case is addressed by a catalogue; the check
 * that asserts the catalogue's names against their sources imports it rather
 * than restating it, because a naming rule written twice is one that drifts —
 * which is precisely what the Phase 11 verification found.
 */
export { evalSelfCommand, vitestCaseNames } from "./commands/eval-self.js";

/** Help, for the documentation generator and the vocabulary check (T14.3). */
export { COMMANDS, EXIT_MEANINGS, NOUNS, TOP_LEVEL, TOPICS, helpFor, topic, userFacingHelpText } from "./help.js";
export { DIAGNOSTICS, diagnostic, type Diagnostic as FrontDoorDiagnostic, type DiagnosticCode } from "./diagnostics.js";
