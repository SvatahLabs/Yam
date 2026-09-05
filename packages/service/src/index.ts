/**
 * @svatah/service
 *
 * The local HTTP and event-stream service (REQ-ADE-1, LLD §13.5): the only
 * integration point for the Svatah ADE and for any other client.
 *
 * Every handler calls the same function the CLI calls. LLD §1's import boundary
 * is what keeps that true — this package may import `@svatah/cli` and
 * `@svatah/schema` and nothing else — so the ADE and the CLI cannot end up
 * disagreeing about what a run is.
 */
export { createService, type RunningService, type ServeOptions } from "./server.js";
export { EventBus, SERVICE_EVENT_KINDS, type ServiceEvent } from "./events.js";
export { openApiDocument, OPENAPI_VERSION } from "./openapi.js";
