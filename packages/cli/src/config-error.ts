/**
 * A project config that will not load (LLD §3.5, §15).
 *
 * Defined in `@svatah/bindings-cli` since Draft 2.5, because both command lines
 * read `svatah.config.yaml` — module (a)'s `bindings verify`, `surface conform`
 * and `eval` need `config.app` for the base-URL precedence of LLD §15. Kept as
 * its own module here so `cli.ts` can catch it by type without pulling in the
 * compiler.
 */
export { ConfigError } from "@svatah/bindings-cli";
