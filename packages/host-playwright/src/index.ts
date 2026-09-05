/**
 * @svatah/host-playwright — the Playwright Test host for flows (LLD §9,
 * REQ-RUN-12, REQ-BEH-1, module (b)).
 *
 * A Svatah flow is prose compiled to a plan. This runs that plan *inside*
 * Playwright Test rather than beside it, so a flow inherits the runner a web
 * team already has: fixtures, projects, sharding, retries, reporters and the
 * trace viewer.
 *
 * It re-exports `bind()` from `@svatah/playwright-test` (module (a)), so a
 * project that writes both flows and plain tests imports one package. The two
 * fixtures share the adapter and the store (LLD §9.2).
 */
export {
  test,
  expect,
  FAILURE_ANNOTATION,
  HEALED_ANNOTATION,
  type SvatahHostFixture,
  type SvatahHostFixtures,
  type SvatahHostOptions,
} from "./fixture.js";

export {
  generateSpecs,
  renderSpec,
  retriesAllowed,
  specName,
  type GenerateOptions,
  type GeneratedSpec,
} from "./generate.js";

export { default as SvatahReporter, RESULTS_ATTACHMENT, type SvatahReporterOptions } from "./reporter.js";

/**
 * `bind()` for plain tests, re-exported from module (a) (LLD §9.2, Draft 2.3).
 *
 * A flow project usually has a handful of ordinary Playwright tests too. Making
 * them import a second package to get `bind()` would be a papercut with no
 * upside, so the host re-exports it. The implementation stays in
 * `@svatah/playwright-test`, which has no dependency on the executor.
 */
export {
  Binder,
  modeFromEnvironment,
  type BindMode,
  type BindOptions,
  type BindOutcome,
} from "@svatah/playwright-test";
export { test as bindTest } from "@svatah/playwright-test";
