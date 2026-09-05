/**
 * `@svatah/surface` and `@svatah/schema` re-exported for the test suite.
 *
 * The adapter's own source imports these directly; the tests go through this
 * file so the import list in each spec stays about what the spec is testing.
 */
export {
  clearAdapters,
  createSurface,
  listAdapters,
  LocateError,
  NavigationError,
  ScriptError,
  SessionError,
  TimeoutError,
} from "@svatah/surface";
export { DEFAULT_CONFIG } from "@svatah/schema";
