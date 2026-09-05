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
          description:
            "Each story carries its `signature` when it declares one, so a client can " +
            "prompt for inputs before starting a run (LLD §13.5). `gateway.credential` " +
            "says whether a model credential is present, without revealing it, so the " +
            "Record screen can offer a gateway it can reach (REQ-ADE-4).",
          security: bearer,
          responses: {
            200: {
              description: "ProjectSummary",
              ...json({
                type: "object",
                properties: {
                  root: { type: "string" },
                  flows: { type: "array", items: { type: "string" } },
                  stories: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        file: { type: "string" },
                        kind: { type: "string" },
                        steps: { type: "integer" },
                        signature: ref("signature"),
                      },
                      required: ["name", "file", "kind", "steps"],
                    },
                  },
                  compositions: { type: "object" },
                  runs: { type: "object" },
                  apis: { type: "array", items: { type: "string" } },
                  customSteps: { type: "array", items: { type: "string" } },
                  diagnostics: { type: "array" },
                  gateway: {
                    type: "object",
                    description:
                      "Whether a model credential is available to this service, so a client " +
                      "can offer a gateway it can reach (REQ-ADE-4). The credential itself " +
                      "is never sent.",
                    properties: { credential: { type: "boolean" } },
                    required: ["credential"],
                  },
                },
              }),
            },
          },
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
      "/plan": {
        get: {
          summary: "The compiled plan, story by story",
          description:
            "The object `svatah compile` writes to `.svatah/plan.json`. `POST /compile` " +
            "answers with a reference; this is the plan the ADE's Plan screen renders.",
          security: bearer,
          responses: { 200: { description: "Plan", ...json(ref("plan")) } },
        },
      },
      "/run": {
        post: {
          summary: "Start a run; step events arrive on the stream",
          description:
            "The inputs are validated against the signatures of the stories the run " +
            "invokes directly, before anything starts (LLD §13.5).",
          security: bearer,
          requestBody: json({ type: "object", properties: { flows: { type: "array", items: { type: "string" } }, stories: { type: "array", items: { type: "string" } }, host: { type: "string" }, inputs: { type: "object" } } }),
          responses: {
            202: { description: "The run id", ...json({ type: "object", properties: { runId: { type: "string" } } }) },
            400: {
              description: "A story the run invokes declares an input nothing supplied",
              ...json({
                type: "object",
                properties: {
                  error: { const: "missing-inputs" },
                  missing: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        story: { type: "string" },
                        name: { type: "string" },
                        type: { type: "string" },
                      },
                      required: ["story", "name", "type"],
                    },
                  },
                  message: { type: "string" },
                },
                required: ["error", "missing", "message"],
              }),
            },
          },
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
        put: {
          summary: "Write data.yaml",
          description:
            "A value that comes back still `«redacted»` means unchanged: the file keeps the " +
            "secret it had, because the editor never saw it (REQ-NFR-6).",
          security: bearer,
          requestBody: json({ type: "object", properties: { values: { type: "object" } }, required: ["values"] }),
          responses: {
            200: { description: "The file written", ...json({ type: "object" }) },
            400: { description: "No values were sent", ...json({ type: "object" }) },
          },
        },
        get: { summary: "Run data, with secrets redacted", security: bearer, responses: { 200: { description: "The data", ...json({ type: "object" }) } } },
      },
      "/runs/{id}/screenshots/{name}": {
        get: {
          summary: "A screenshot a run wrote",
          security: bearer,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            200: {
              description: "The image",
              content: { "image/png": { schema: { type: "string", format: "binary" } } },
            },
          },
        },
      },
      "/api/request": {
        post: {
          summary: "Execute one API request ad hoc",
          description:
            "Through the same function `svatah run` uses for an `api` step, so the ADE's " +
            "API client is not a second HTTP client (LLD §13.5).",
          security: bearer,
          requestBody: json({
            type: "object",
            properties: { request: ref("surface.api-request"), withSessionCookies: { type: "boolean" } },
            required: ["request"],
          }),
          responses: {
            200: { description: "ApiResponse", ...json(ref("surface.api-response")) },
            400: { description: "The request could not be executed", ...json({ type: "object" }) },
            501: { description: "No HTTP adapter was wired in", ...json({ type: "object" }) },
          },
        },
      },
      "/api/{name}": {
        put: {
          summary: "Save a named request under api/<name>.yaml",
          security: bearer,
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json(ref("surface.api-request")),
          responses: { 200: { description: "The file written", ...json({ type: "object" }) } },
        },
      },
      "/api": {
        get: { summary: "Named API requests", security: bearer, responses: { 200: { description: "ApiRequest[]", ...json({ type: "array" }) } } },
      },
      /* ── T5.7: record with review, bindings verify, heal (REQ-ADE-4, 5) ─── */
      "/record": {
        post: {
          summary: "Start a recording session; decisions arrive on the stream",
          description:
            "Each grounding is emitted as `record.decision` with its candidate bundle and " +
            "fingerprint, and the session blocks until POST /record/{id}/decision answers — " +
            "before the binding is written (REQ-ADE-4).\n\n" +
            "One session at a time: while one is open this answers **409** and starts " +
            "nothing, so a second client cannot drive the same project's browser " +
            "(LLD §13.5). Stop the open session first.\n\n" +
            "A pending decision expires after `record.decisionDeadlineMs` (config, " +
            "default 600000 — ten minutes). On expiry the grounding is rejected, " +
            "`record.decision.expired` goes to the stream and the session stops with a " +
            "report, so a reviewer who walked away does not hold the service's one " +
            "session open forever (LLD §13.5, Draft 2.7).\n\n" +
            "`gateway` chooses the model: `anthropic` needs a credential — " +
            "`GET /project` reports whether there is one — and `fake` answers from " +
            "`evals/grounding/cases`, which is a fixture and says so in its provenance.",
          security: bearer,
          requestBody: json({
            type: "object",
            properties: {
              stories: { type: "array", items: { type: "string" } },
              flows: { type: "array", items: { type: "string" } },
              rebind: { type: "boolean" },
              headed: { type: "boolean" },
              gateway: {
                type: "string",
                enum: ["anthropic", "fake"],
                description:
                  "`anthropic` is a model and needs a credential; `fake` reads the " +
                  "committed grounding answers (REQ-ADE-4).",
              },
              inputs: { type: "object" },
            },
          }),
          responses: {
            202: { description: "The session id", ...json({ type: "object", properties: { sessionId: { type: "string" } } }) },
            409: {
              description:
                "A recording session is already open. Stop it before starting another.",
              ...json({ type: "object" }),
            },
            501: { description: "This build has no recorder", ...json({ type: "object" }) },
          },
        },
      },
      "/record/{id}/decision": {
        post: {
          summary: "Accept, re-pick or reject the grounding a session is waiting on",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({
            type: "object",
            properties: {
              accept: { type: "boolean" },
              repick: { type: "string", description: "A reference in the snapshot the model saw" },
              why: { type: "string" },
            },
          }),
          responses: {
            202: { description: "Recorded", ...json({ type: "object" }) },
            404: { description: "Nothing is waiting for a decision", ...json({ type: "object" }) },
          },
        },
      },
      "/record/{id}/stop": {
        post: {
          summary: "Stop a recording session",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 202: { description: "Stopping", ...json({ type: "object" }) }, 404: { description: "No such session", ...json({ type: "object" }) } },
        },
      },
      "/bindings/verify": {
        post: {
          summary: "Dry-resolve the store, or one binding",
          security: bearer,
          requestBody: json({ type: "object", properties: { id: { type: "string" }, headed: { type: "boolean" } } }),
          responses: {
            200: { description: "One result per binding", ...json({ type: "object" }) },
            501: { description: "This build cannot verify", ...json({ type: "object" }) },
          },
        },
      },
      "/heal": {
        post: {
          summary: "Heal a run; proposals arrive on the stream",
          security: bearer,
          requestBody: json({
            type: "object",
            properties: {
              runId: { type: "string" },
              useModel: { type: "boolean" },
              apply: { type: "boolean" },
              inputs: { type: "object" },
            },
            required: ["runId"],
          }),
          responses: {
            202: { description: "The heal id", ...json({ type: "object", properties: { healId: { type: "string" } } }) },
            400: { description: "No run was named", ...json({ type: "object" }) },
            501: { description: "This build cannot heal", ...json({ type: "object" }) },
          },
        },
      },

      /* ── T5.8: the surface explorer and the tool panel (REQ-ADE-8) ──────── */
      "/surface/{session}/open": {
        post: {
          summary: "Open a surface session the explorer drives",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object", properties: { headed: { type: "boolean" } } }),
          responses: { 200: { description: "The session and its trajectory file", ...json({ type: "object" }) } },
        },
      },
      "/surface/{session}/snapshot": {
        post: {
          summary: "The driven session's snapshot, for the picker and the explorer",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object" }),
          responses: { 200: { description: "Snapshot", ...json(ref("surface.snapshot")) } },
        },
      },
      "/surface/{session}/act": {
        post: {
          summary: "Act in the explored session; `intent` is required",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object", properties: { intent: { type: "string" }, action: { type: "string" }, ref: { type: "string" }, args: { type: "object" } }, required: ["intent", "action"] }),
          responses: {
            200: { description: "The act result", ...json({ type: "object" }) },
            400: { description: "No intent was given", ...json({ type: "object" }) },
          },
        },
      },
      "/surface/{session}/read": {
        post: {
          summary: "Read in the explored session; `intent` is required",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object", properties: { intent: { type: "string" }, kind: { type: "string" }, ref: { type: "string" } }, required: ["intent"] }),
          responses: { 200: { description: "The value read", ...json({ type: "object" }) } },
        },
      },
      "/surface/{session}/check": {
        post: {
          summary: "Check in the explored session; `intent` is required",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object", properties: { intent: { type: "string" }, predicate: { type: "object" }, subject: { type: "string" }, ref: { type: "string" } }, required: ["intent"] }),
          responses: { 200: { description: "The check result", ...json({ type: "object" }) } },
        },
      },
      "/surface/{session}/close": {
        post: {
          summary: "Close an explored session",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          responses: { 202: { description: "Closed", ...json({ type: "object" }) } },
        },
      },
      "/trajectory/compile": {
        post: {
          summary: "Compile a captured trajectory into proposals/<date>/",
          security: bearer,
          requestBody: json({ type: "object", properties: { path: { type: "string" }, name: { type: "string" } }, required: ["path"] }),
          responses: { 200: { description: "Where the proposal went, and the rate", ...json({ type: "object" }) } },
        },
      },
      "/tools": {
        get: {
          summary: "The tools this project exposes, and every invocation served",
          description:
            "Invocations are read from the run directories — `behavior: \"tool\"` summaries and " +
            "their audit lines — so the panel shows what a `svatah tool serve` in another " +
            "terminal served too (REQ-ADE-2).",
          security: bearer,
          parameters: [{ name: "expose", in: "query", required: false, schema: { type: "string" } }],
          responses: { 200: { description: "Tools and invocations", ...json({ type: "object" }) } },
        },
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
