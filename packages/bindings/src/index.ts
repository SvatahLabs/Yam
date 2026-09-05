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
  type ContextPatternOptions,
  subtree,
  LANDMARK_ROLES,
} from "./context.js";

export {
  BindingsStore,
  readBindingIndex,
  type BindingIndexEntry,
  type EntrySelector,
} from "./store.js";

export { Dictionary, type Lookup } from "./dictionary.js";

export {
  resolve,
  tryResolve,
  DEFAULT_CANDIDATE_TIMEOUT_MS,
  type Resolution,
  type ResolveOptions,
} from "./resolver.js";

export { LocatorError, type CandidateAttempt, type LocatorErrorDetail } from "./errors.js";

export {
  siteToolCandidatesFor,
  siteToolOf,
  synthesise,
  synthesiseBundle,
  synthesiseSiteTool,
  candidatesFor,
  fingerprint,
  fingerprintOf,
  looksGenerated,
  type SynthesisOptions,
} from "./synthesis.js";

export {
  relocalize,
  rank,
  decide,
  scoreAgainst,
  attrSimilarity,
  textSimilarity,
  neighbourSimilarity,
  rolePathSimilarity,
  boxProximity,
  WEIGHTS,
  DEFAULT_THRESHOLD,
  DEFAULT_MARGIN,
  DEFAULT_MAX_CANDIDATES,
  type Match,
  type Score,
  type RelocalizeOptions,
  type RelocalizeResult,
} from "./relocalize.js";
