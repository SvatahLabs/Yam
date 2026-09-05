/**
 * @svatah/playwright-test — the Playwright Test host (LLD §9, REQ-RUN-12).
 *
 * Two things live here, and LLD §1 makes this the one package that may hold
 * either: the `bind()` fixture for plain Playwright tests (§9.2, and the whole of
 * module (a)'s adoption story), and — from Phase 2 — the generated spec per flow
 * that runs the executor inside Playwright Test.
 *
 * It is the only package besides the CLI allowed to import an `adapter-*`
 * package, and it imports exactly one: the Playwright adapter.
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
