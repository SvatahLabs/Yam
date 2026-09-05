/**
 * A project config that will not load (LLD §3.5, §15).
 *
 * Its own module, and importing nothing, so `cli.ts` can catch it by type
 * without eagerly loading the compiler — the reason every command is imported
 * lazily in the first place.
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    /** The config file this came from, relative to the project root. */
    readonly file: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}
