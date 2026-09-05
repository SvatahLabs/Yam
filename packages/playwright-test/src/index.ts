/**
 * @svatah/playwright-test — the `bind()` fixture (LLD §6.5, §9.2, module (a)).
 *
 * One thing lives here: `bind()` for plain Playwright tests, which is the whole
 * of module (a)'s adoption story. It has no dependency on the executor, and
 * Draft 2.3 is explicit that it keeps none — the flow host, which does need the
 * executor, is `@svatah/host-playwright` in module (b) and re-exports `bind()`
 * so a flow project imports one package.
 *
 * The split matters because this package is what a plain Playwright user
 * installs. Bringing the executor, the compiler and the flow language along with
 * a fixture would make "one dependency and one fixture" (REQ-PKG-2) untrue.
 *
 * It is one of the few packages allowed to import an `adapter-*` package, and it
 * imports exactly one: the Playwright adapter.
 */
export { test, expect, HEALED_ANNOTATION, type SvatahFixtures, type SvatahOptions } from "./fixture.js";
export {
  Binder,
  modeFromEnvironment,
  type BindMode,
  type BindOptions,
  type BindOutcome,
} from "./bind.js";
export {
  parseProgrammaticPicks,
  pickSelector,
  pickInteractively,
  clearPickerStamp,
  type Pick,
  type PickSource,
} from "./picker.js";
