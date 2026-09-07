export {
  OPERATIONS,
  SURFACE_TOOL_NAMES,
  SURFACE_CLI_SUBCOMMANDS,
  ERROR_CODES,
  CLI_EXIT_CODES,
  operationByName,
  operationByCliSubcommand,
  operationByMcpTool,
  operationByServicePath,
  resultEnvelopeSchema,
  targetsInputSchema,
  targetsOutputSchema,
  connectInputSchema,
  connectOutputSchema,
  snapshotInputSchema,
  snapshotOutputSchema,
  actInputSchema,
  actOutputSchema,
  readInputSchema,
  readOutputSchema,
  checkInputSchema,
  checkOutputSchema,
  closeInputSchema,
  closeOutputSchema,
  sessionsInputSchema,
  sessionsOutputSchema,
  capabilitiesInputSchema,
  capabilitiesOutputSchema,
  describeInputSchema,
  describeOutputSchema,
  screenshotInputSchema,
  screenshotOutputSchema,
  catalogueFingerprint,
  type OperationDescriptor,
  type CliFlag,
  type ResultEnvelope,
  type ErrorCode,
} from "./catalogue.js";

export {
  makeRequestId,
  successEnvelope,
  failedEnvelope,
  refusedEnvelope,
} from "./envelope.js";

export {
  createSessionStore,
  type SessionStore,
  type SessionEntry,
  type SessionStatus,
  type SessionMode,
} from "./sessions.js";

export {
  brokerStateDir,
  generateToken,
  writeBrokerDescriptor,
  readBrokerDescriptor,
  removeBrokerDescriptor,
  discoverBroker,
  isProcessAlive,
  type BrokerDescriptor,
} from "./broker.js";

export {
  createAdapterFactory,
  type AdapterFactoryFn,
  type ConnectOptions,
} from "./adapter-factory.js";

export {
  discoverTargets,
  discoverAdapters,
  checkAdapterReadiness,
  type DiscoveredTarget,
  type AdapterReadiness,
} from "./discovery.js";

export {
  createReferenceStore,
  type ReferenceStore,
  type SnapshotRecord,
  type RefScope,
} from "./references.js";

export {
  createCoordinationStore,
  hashInput,
  type CoordinationStore,
  type Lease,
  type IdempotencyRecord,
  type OperationRecord,
  type OperationOutcome,
  type Control,
} from "./coordination.js";

export {
  createPromotionStore,
  type PromotionStore,
  type PromotionStep,
} from "./promotion.js";

export {
  createEventStore,
  type EventStore,
  type SessionEvent,
  type EventKind,
} from "./events.js";

export {
  createRedactionPolicy,
  addSecretPattern,
  addSecretLiteral,
  redactString,
  redactObject,
  hasSecret,
  type RedactionPolicy,
} from "./redaction.js";

export {
  generateOpenApiDocument,
  generateOpenApiPaths,
  generateTypeScriptClient,
  generatePythonClient,
  generateJavaClient,
} from "./codegen.js";

export {
  dispatchTargets,
  dispatchConnect,
  dispatchSnapshot,
  dispatchAct,
  dispatchRead,
  dispatchCheck,
  dispatchClose,
  dispatchSessions,
  dispatchCapabilities,
  dispatchDescribe,
  dispatchControl,
  DEFAULT_HOLDER,
  dispatchEvents,
  dispatchRequest,
  dispatchScreenshot,
  type DispatchContext,
} from "./dispatcher.js";

/**
 * What each action needs (T15, SF-09, SF-11).
 *
 * The catalogue validates an action's arguments; this says which arguments it
 * takes, so a client can draw a form without knowing anything the catalogue
 * does not.
 */
export {
  ACTION_FORMS,
  CAPABILITIES,
  actionFormFor,
  offeredActions,
  defaultActionForRole,
  type ActionForm,
  type ActionField,
  type ActionFieldType,
} from "@svatah/yam-schema";

/**
 * The broker: the process that owns the sessions (SF-05).
 *
 * A CLI invocation ends; a browser stays open. The store therefore lives in a
 * process of its own, and every command talks to it.
 */
export {
  startBroker,
  callBroker,
  brokerAlive,
  brokerHealth,
  type BrokerOperation,
  type BrokerOptions,
  type RunningBroker,
} from "./server.js";
