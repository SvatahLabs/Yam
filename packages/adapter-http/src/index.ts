/**
 * @svatah/adapter-http
 *
 * The HTTP adapter (REQ-ADP-2, REQ-ADP-3, LLD §7.2): named requests with the
 * field set the legacy Java builder had, templating from the run's scope,
 * JSON-path capture, and per-call cookie sharing with a paired web session.
 */
export { HttpSurface, createHttpSurface, type HttpAdapterOptions } from "./surface.js";
export { executeRequest, ApiRequestError, type RequestOptions } from "./request.js";
export { readJsonPath, parseJsonPath, JsonPathError } from "./jsonpath.js";
export { expand, expandRecord, fillPathParams, type TemplateScope } from "./template.js";
export { registerHttpAdapter } from "./register.js";
