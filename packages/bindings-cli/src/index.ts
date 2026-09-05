/**
 * @svatah/bindings-cli
 *
 * The `svatah-bindings` executable: the module (a) half of the command line —
 * `bindings list|show|verify|prune`, `heal --from-bind-failures`,
 * `surface conform`, and `eval healing` (HLD §12, LLD §1, Draft 2.3).
 *
 * It exists so that a plain Playwright user can install module (a) alone and
 * still have a command line. `@svatah/cli` depends on this package and mounts
 * the same commands under `svatah`, so there is one implementation behind two
 * executables.
 *
 * Draft 2.3 creates the package; T2.12 moves the commands into it.
 */
export {};
