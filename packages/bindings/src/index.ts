/**
 * @svatah/bindings — module (a)'s core (REQ-PKG-1).
 *
 * The bindings store, the context hash, the resolver, candidate synthesis,
 * fingerprinting and model-free relocalization. It depends on `@svatah/surface`
 * and `@svatah/schema` and on nothing else: not on the flow language, not on the
 * compiler, and not on the model gateway. The import-boundary lint and the
 * dependency-graph test in `tools/repo-checks` hold that (LLD §1).
 */
export {
  isElementId,
  assertElementId,
  idToSegments,
  pathToId,
  elementIdFromPhrase,
} from "./ids.js";

export {
  contextHash,
  contextRoot,
  contextPattern,
  patternMatches,
  subtree,
  LANDMARK_ROLES,
} from "./context.js";

export { BindingsStore, type EntrySelector } from "./store.js";

export { Dictionary, type Lookup } from "./dictionary.js";

export {
  resolve,
  tryResolve,
  DEFAULT_CANDIDATE_TIMEOUT_MS,
  type Resolution,
  type ResolveOptions,
} from "./resolver.js";

export { LocatorError, type CandidateAttempt, type LocatorErrorDetail } from "./errors.js";
