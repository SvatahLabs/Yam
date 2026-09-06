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
} from "./sessions.js";

export {
  createAdapterFactory,
  type AdapterFactoryFn,
  type ConnectOptions,
} from "./adapter-factory.js";

export {
  dispatchConnect,
  dispatchSnapshot,
  dispatchAct,
  dispatchRead,
  dispatchCheck,
  dispatchClose,
  dispatchSessions,
  dispatchCapabilities,
  dispatchDescribe,
  dispatchScreenshot,
  type DispatchContext,
} from "./dispatcher.js";
