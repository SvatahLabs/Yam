/**
 * @svatah/bindings-cli
 *
 * The `svatah-bindings` executable — module (a)'s half of the command line
 * (HLD §12, LLD §1, Draft 2.3): `bindings`, `heal --from-bind-failures`,
 * `surface conform` and `eval healing`.
 *
 * It exists so that someone who installed module (a) alone — the store,
 * model-free healing, the Playwright adapter and the `bind()` fixture — still
 * has a command line. `@svatah/cli` depends on this package and mounts the same
 * functions under `svatah`, so there is one implementation behind two
 * executables.
 *
 * Nothing here may import `spec`, `steps`, `compiler` or `runtime` (REQ-PKG-1).
 */
export { main, runBindingsCommand } from "./cli.js";
export { parseArgs, stringOption, stringOptions, boolOption, numberOption, type ParsedArgs } from "./args.js";
export { EXIT, type ExitCode } from "./exit-codes.js";
export { ConfigError, CONFIG_FILES, appConfig, loadConfig } from "./config.js";
export {
  BASE_URL_ENV,
  STORAGE_STATE_ENV,
  resolveSessionTarget,
  sessionTarget,
  type SessionTarget,
  type SessionTargetSources,
} from "./session.js";
export { registerAllAdapters } from "./adapters.js";
export { surfaceCommand, type CommandIo } from "./commands/surface.js";
export { bindingsCommand } from "./commands/bindings.js";
export { healCommand } from "./commands/heal.js";
export { evalCommand } from "./commands/eval.js";
