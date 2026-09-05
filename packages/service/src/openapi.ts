/**
 * The OpenAPI description (REQ-ADE-1, LLD §13.5).
 *
 * "The service publishes an OpenAPI description at `GET /openapi.json`, from
 * which the ADE's typed client is generated."
 *
 * Written out rather than derived from decorated routes: a generated document is
 * only as good as the annotations, and the annotations are the thing that rots.
 * This is one file a reviewer can read against LLD §13.5's table, and
 * `test/openapi.test.ts` fails when a route exists that it does not describe —
 * which is the drift that actually matters.
 */

export const OPENAPI_VERSION = "3.1.0";

/** Every path the service serves, in LLD §13.5's order. */
export function openApiDocument(version: string): Record<string, unknown> {
  const bearer = [{ bearerAuth: [] }];
  const json = (schema: Record<string, unknown>): Record<string, unknown> => ({
    content: { "application/json": { schema } },
  });
  const ref = (name: string): Record<string, unknown> => ({
    $ref: `https://svatah.dev/schema/${name}.schema.json`,
  });

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: "Svatah local service",
      version,
      description:
        "The local integration point for the Svatah ADE and any other client " +
        "(REQ-ADE-1, LLD §13.5). Bound to 127.0.0.1, behind a bearer token printed " +
        "on stdout. Every handler calls the same function the CLI calls; no logic " +
        "lives here.",
    },
    servers: [{ url: "http://127.0.0.1:{port}", variables: { port: { default: "0" } } }],
    security: bearer,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "The token printed on stdout when the service starts." },
      },
    },
    paths: {
      "/project": {
        get: {
          summary: "Config, flows, stories, compositions, run blocks and API names",
          security: bearer,
          responses: { 200: { description: "ProjectSummary", ...json({ type: "object" }) } },
        },
      },
      "/flows/{file}": {
        get: {
          summary: "Read a flow file",
          security: bearer,
          parameters: [{ name: "file", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "The file", content: { "text/plain": { schema: { type: "string" } } } } },
        },
        put: {
          summary: "Write a flow file",
          security: bearer,
          parameters: [{ name: "file", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { content: { "text/plain": { schema: { type: "string" } } } },
          responses: { 200: { description: "Written", ...json({ type: "object" }) } },
        },
      },
      "/compile": {
        post: {
          summary: "Compile and lint",
          security: bearer,
          responses: { 200: { description: "Plan reference, errors and warnings", ...json({ type: "object" }) } },
        },
      },
      "/run": {
        post: {
          summary: "Start a run; step events arrive on the stream",
          security: bearer,
          requestBody: json({ type: "object", properties: { flows: { type: "array", items: { type: "string" } }, stories: { type: "array", items: { type: "string" } }, host: { type: "string" }, inputs: { type: "object" } } }),
          responses: { 202: { description: "The run id", ...json({ type: "object", properties: { runId: { type: "string" } } }) } },
        },
      },
      "/runs": {
        get: { summary: "Every run's summary", security: bearer, responses: { 200: { description: "Summaries", ...json({ type: "array" }) } } },
      },
      "/runs/{id}": {
        get: { summary: "One run's summary", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Summary", ...json(ref("results.summary")) } } },
      },
      "/runs/{id}/results": {
        get: { summary: "One run's step results", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "StepResult[]", ...json({ type: "array", items: ref("results.step") }) } } },
      },
      "/runs/{id}/audit": {
        get: { summary: "One run's audit log", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "AuditLine[]", ...json({ type: "array" }) } } },
      },
      "/bindings": {
        get: { summary: "The bindings store", security: bearer, responses: { 200: { description: "BindingFile[]", ...json({ type: "array" }) } } },
      },
      "/bindings/{id}": {
        get: { summary: "One binding", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "BindingFile", ...json(ref("bindings.file")) } } },
      },
      "/data": {
        get: { summary: "Run data, with secrets redacted", security: bearer, responses: { 200: { description: "The data", ...json({ type: "object" }) } } },
      },
      "/api": {
        get: { summary: "Named API requests", security: bearer, responses: { 200: { description: "ApiRequest[]", ...json({ type: "array" }) } } },
      },
      "/events": {
        get: {
          summary: "The event stream (WebSocket)",
          security: bearer,
          responses: { 101: { description: "Switching protocols" } },
        },
      },
      "/events/sse": {
        get: {
          summary: "The event stream (server-sent events)",
          security: bearer,
          responses: { 200: { description: "text/event-stream", content: { "text/event-stream": { schema: { type: "string" } } } } },
        },
      },
      "/openapi.json": {
        get: { summary: "This document", security: [], responses: { 200: { description: "The OpenAPI document", ...json({ type: "object" }) } } },
      },
      "/health": {
        get: { summary: "Liveness, for the ADE's spawn handshake", security: [], responses: { 200: { description: "ok", ...json({ type: "object" }) } } },
      },
    },
  };
}
