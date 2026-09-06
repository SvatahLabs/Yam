/**
 * @svatah/yam-schema
 *
 * The Yam artifact contract: Zod definitions for everything in LLD §3 plus the
 * agent-surface wire shapes of LLD §2, and the generator that publishes them as
 * JSON Schema files under `json/` (REQ-STD-1).
 *
 * Every artifact that crosses a process or repository boundary is defined here and
 * nowhere else, so the TypeScript types, the runtime validation, and the published
 * contract a foreign runtime reads all come from one source.
 */

export { SCHEMA_VERSION, type SchemaVersion } from "./version.js";

export {
  canonicalJson,
  canonicalJsonCompact,
  canonicalYaml,
  canonicalHash,
  planHash,
  bindingsHash,
} from "./canonical.js";

export {
  provenanceSchema,
  isHumanProvenance,
  HUMAN_PROVENANCE_MODEL,
  type Provenance,
} from "./provenance.js";

export {
  valueRefSchema,
  argValueSchema,
  scalarArgSchema,
  referencesSecret,
  type ValueRef,
  type ArgValue,
  type ScalarArg,
} from "./values.js";

export {
  ACTIONS,
  SURFACE_ACTIONS,
  SURFACE_ONLY_EXCLUSIONS,
  actionSchema,
  surfaceActionSchema,
  targetRefSchema,
  targetScopeSchema,
  targetStatusSchema,
  predicateSchema,
  PREDICATE_KINDS,
  STATE_PREDICATE_KINDS,
  VALUE_PREDICATE_KINDS,
  NAMED_VALUE_PREDICATE_KINDS,
  GEOMETRY_PREDICATE_KINDS,
  EXPR_OPS,
  predicateSubjectSchema,
  guardSchema,
  expectationSchema,
  captureSchema,
  originSchema,
  tierSchema,
  COMPILER_TIERS,
  MODEL_TIERS,
  stepSchema,
  signatureSchema,
  INPUT_TYPES,
  OUTPUT_TYPES,
  onFailureSchema,
  storyMetaSchema,
  storySchema,
  planSchema,
  type Action,
  type SurfaceAction,
  type TargetRef,
  type TargetScope,
  type TargetStatus,
  type Predicate,
  type PredicateSubject,
  type Guard,
  type Expectation,
  type Capture,
  type Origin,
  type Tier,
  type Step,
  type Signature,
  type OnFailure,
  type StoryMeta,
  type Story,
  type Plan,
} from "./ir.js";

export {
  CANDIDATE_KINDS,
  WEB_CANDIDATE_KINDS,
  MOBILE_CANDIDATE_KINDS,
  DESKTOP_CANDIDATE_KINDS,
  WEBMCP_CANDIDATE_KIND,
  COORDS_CANDIDATE_KIND,
  candidateKindSchema,
  candidateSchema,
  boxSchema,
  fingerprintSchema,
  bindingPlatformSchema,
  bindingContextSchema,
  bindingEntrySchema,
  bindingFileSchema,
  type CandidateKind,
  type Candidate,
  type Box,
  type Fingerprint,
  type BindingPlatform,
  type BindingContext,
  type BindingEntry,
  type BindingFile,
} from "./bindings.js";

export {
  FAILURE_CLASSES,
  STEP_STATUSES,
  FLOW_STATUSES,
  AUDIT_KINDS,
  failureClassSchema,
  behaviorSchema,
  stepStatusSchema,
  flowStatusSchema,
  invokerSchema,
  stepResultSchema,
  summarySchema,
  auditKindSchema,
  auditLineSchema,
  checkpointSchema,
  type FailureClass,
  type Behavior,
  type StepStatus,
  type FlowStatus,
  type Invoker,
  type StepResult,
  type Summary,
  type AuditKind,
  type AuditLine,
  type Checkpoint,
} from "./results.js";

export {
  NODE_STATES,
  CAPABILITY_FLAGS,
  refSchema,
  nodeStateSchema,
  snapshotNodeSchema,
  snapshotSchema,
  capabilitiesSchema,
  surfaceKindSchema,
  sessionInitSchema,
  sessionStateSchema,
  actArgsSchema,
  actResultSchema,
  readKindSchema,
  checkSubjectSchema,
  checkResultSchema,
  elementDescriptionSchema,
  apiRequestSchema,
  apiResponseSchema,
  surfaceSnapshotMessageSchema,
  surfaceActMessageSchema,
  surfaceCheckMessageSchema,
  surfaceReadMessageSchema,
  surfaceLocateMessageSchema,
  surfaceCapabilitiesMessageSchema,
  type Ref,
  type NodeState,
  type SnapshotNode,
  type Snapshot,
  type Capabilities,
  type CapabilityFlag,
  type SurfaceKind,
  type SessionInit,
  type SessionState,
  type ActArgs,
  type ActResult,
  type ReadKind,
  type CheckSubject,
  type CheckResult,
  type ElementDescription,
  type ApiRequest,
  type ApiResponse,
  type SurfaceSnapshotMessage,
  type SurfaceActMessage,
  type SurfaceCheckMessage,
  type SurfaceReadMessage,
  type SurfaceLocateMessage,
  type SurfaceCapabilitiesMessage,
} from "./surface.js";

export {
  adapterNameSchema,
  environmentSchema,
  configSchema,
  DEFAULT_CONFIG,
  DEFAULT_IGNORE_ATTRIBUTES,
  type AdapterName,
  type Environment,
  type Config,
} from "./config.js";

export { proposalSchema, type Proposal } from "./proposal.js";

export { PUBLISHED_SCHEMAS, publishedSchema, type PublishedSchema } from "./registry.js";

export { generateJsonSchemas, schemaFileName, type GeneratedSchemas } from "./generate.js";
