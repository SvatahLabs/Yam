/**
 * @svatah/cli
 *
 * The `svatah` command line (LLD §15). It is the only package that registers
 * adapters, which is why the import-boundary lint lets it — and only it and the
 * Playwright Test host — import an `adapter-*` package (LLD §1).
 */
export { main } from "./cli.js";
export { parseArgs, stringOption, boolOption, type ParsedArgs } from "./args.js";
export { EXIT, type ExitCode } from "./exit-codes.js";
export { registerAllAdapters } from "./adapters.js";
export type { CommandIo } from "./commands/surface.js";
