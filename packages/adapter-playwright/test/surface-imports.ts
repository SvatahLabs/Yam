/**
 * `@svatah/yam-surface` and `@svatah/yam-schema` re-exported for the test suite.
 *
 * The adapter's own source imports these directly; the tests go through this
 * file so the import list in each spec stays about what the spec is testing.
 */
export {
  clearAdapters,
  createSurface,
  DataError,
  listAdapters,
  LocateError,
  NavigationError,
  ScriptError,
  SessionError,
  TimeoutError,
  UnsupportedError,
} from "@svatah/yam-surface";
export { DEFAULT_CONFIG } from "@svatah/yam-schema";
