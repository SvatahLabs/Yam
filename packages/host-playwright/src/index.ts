/**
 * @svatah/host-playwright
 *
 * The Playwright Test host for Svatah flows (LLD §9, module (b)): the worker-
 * scoped `svatah` fixture, `svatah host generate`, and the reporter that writes
 * Svatah results alongside Playwright's own.
 *
 * It is a separate package from `@svatah/playwright-test` because that one is
 * module (a) — `bind()` for plain Playwright tests, with no dependency on the
 * executor. The host depends on `@svatah/runtime` and therefore cannot live in
 * module (a) (REQ-PKG-1, HLD §12, Draft 2.3). It re-exports `bind()` so a flow
 * project imports one package.
 *
 * Draft 2.3 creates the package; T2.8 fills it in.
 */
export {};
