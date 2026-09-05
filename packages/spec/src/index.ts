/**
 * @svatah/spec
 *
 * The flow reader (LLD §4.1): flow files, story signatures, header metadata,
 * guards, `data.yaml` with secrets, and the named `api/*.yaml` requests.
 *
 * It reads the file's *structure* and stops at the sentence. What a sentence
 * means is Tier 0 (`@svatah/steps`) and Tier 1 (the grammar in
 * `@svatah/compiler`), both of which work over what this package produces.
 */
export type { FlowBlock, FlowFile, ListBlock, RawStep, StoryBlock } from "./ast.js";
export { isRunBlock, isStoryBlock } from "./ast.js";

export {
  diagnostic,
  errorsIn,
  formatDiagnostic,
  isError,
  ERROR_CODES,
  WARNING_CODES,
  type Diagnostic,
  type DiagnosticCode,
  type ErrorCode,
  type WarningCode,
} from "./diagnostics.js";

export { readFlow } from "./reader.js";

export { VOCABULARY, type Verb } from "./vocabulary.js";
export { VerbTrie, VERBS, type VerbMatch } from "./verbs.js";
export { elementId, normaliseWords, phraseKey } from "./normalise.js";
export {
  parseTargets,
  TargetDictionary,
  type DictionaryEntry,
  type TargetResolution,
  type TargetStatus,
} from "./dictionary.js";
export { generateActionsYaml } from "./generate.js";
export { DEFAULT_META, META_KEYS, parseMeta, parseOnFailure } from "./meta.js";
export { isEmpty as isEmptySignature, readSignatureLine } from "./signature.js";

export {
  dataAt,
  isSecretPath,
  readData,
  EMPTY_DATA,
  type ProjectData,
} from "./data.js";

export {
  buildApiCatalogue,
  readApiRequest,
  EMPTY_APIS,
  type ApiCatalogue,
} from "./api.js";

export {
  readProject,
  readProjectFrom,
  type Project,
  type ProjectPaths,
  type ProjectSource,
} from "./project.js";
