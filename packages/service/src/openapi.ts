/**
 * The OpenAPI description (REQ-ADE-1, LLD §13.5).
 *
 * "The service publishes an OpenAPI description at `GET /openapi.json`, from
 * which the app's typed client is generated."
 *
 * Written out rather than derived from decorated routes: a generated document is
 * only as good as the annotations, and the annotations are the thing that rots.
 * This is one file a reviewer can read against LLD §13.5's table, and
 * `test/openapi.test.ts` fails when a route exists that it does not describe —
 * which is the drift that actually matters.
 */

import { SERVICE_EVENT_KINDS } from "./events.js";

export const OPENAPI_VERSION = "3.1.0";

/**
 * What the event stream carries, stated in the description itself (Draft 2.11,
 * LLD §13.8).
 *
 * A client generated from this document has to know what a `data:` line can
 * say; before this, each of the three would have carried its own copy of the
 * list, and a new event kind would have had three places to be missing from.
 * The list is the union's own (`SERVICE_EVENT_KINDS`), so it cannot drift from
 * the events the service actually emits.
 */
const EVENT_STREAM_DESCRIPTION =
  "Every message is a JSON object with a `kind`. The kinds are: " +
  SERVICE_EVENT_KINDS.map((kind) => `\`${kind}\``).join(", ") +
  ". Their shapes are `@svatah/yam-service`'s `ServiceEvent` union (LLD §13.5).";

/** Every path the service serves, in LLD §13.5's order. */
export function openApiDocument(version: string): Record<string, unknown> {
  const bearer = [{ bearerAuth: [] }];
  const json = (schema: Record<string, unknown>): Record<string, unknown> => ({
    content: { "application/json": { schema } },
  });
  const ref = (name: string): Record<string, unknown> => ({
    $ref: `https://yam.svatah.com/schema/${name}.schema.json`,
  });

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: "Yam local service",
      version,
      description:
        "The local integration point for the Yam app and any other client " +
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
                      "Whether a model credential is available to this service (and, under `display`, whether a person at the service's machine can click in a headed browser, Draft 2.21), so a client " +
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
            "The object `yam compile` writes to `.yam/plan.json`. `POST /compile` " +
            "answers with a reference; this is the plan the app's Plan screen renders.",
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
      "/runs/{id}/stop": {
        post: {
          summary: "Stop a run that is going",
          description:
            "The executor cancels **between steps** (Draft 2.12 §13.5): a step already under " +
            "way has touched the application and its result is the only account of what it " +
            "did, so it finishes and the steps after it are recorded `skipped`. The summary " +
            "says `stopped: true` and `audit.jsonl` gains a `stop` line naming the last step " +
            "that ran. 202 because the run is *stopping*; `run.summary` on the stream is how " +
            "a caller learns it has.",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            202: {
              description: "Stopping",
              ...json({ type: "object", properties: { ok: { const: true }, runId: { type: "string" } } }),
            },
            404: {
              description: "No run by that id is going",
              ...json({
                type: "object",
                properties: { error: { const: "not-running" }, message: { type: "string" } },
                required: ["error", "message"],
              }),
            },
          },
        },
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
        get: {
          summary: "One binding",
          description:
            "The YAML file on disk, byte for byte — the same bytes `yam bindings show` " +
            "prints and a reviewer reads in a pull request. A `GET /bindings/:id.json` would " +
            "be a second representation of the store, and the moment one exists someone has " +
            "to keep the two in step (LLD §6.1, §13.5).",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: {
              description: "The binding file, as YAML",
              content: { "text/yaml": { schema: { type: "string" } } },
            },
            404: { description: "No binding by that id", ...json({ type: "object" }) },
          },
        },
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
            "Through the same function `yam run` uses for an `api` step, so the app's " +
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
      "/capture": {
        post: {
          summary: "Record a flow from what a person does; sentences arrive on the stream",
          description:
            "The browser opens at the application and the person drives it. Each click, " +
            "value entered, choice, key and navigation becomes a sentence of the flow " +
            "language, emitted as `capture.step`, and each element touched becomes a " +
            "binding (REQ-REC-13, Draft 2.23).\n\n" +
            "This is the other half of recording. `POST /record` drives a flow somebody " +
            "wrote and binds its targets; this one writes the flow.\n\n" +
            "The flow file and the bindings are written when the session **ends**, so " +
            "POST /capture/{id}/stop is how one finishes — a capture nobody stopped has " +
            "written nothing. The result arrives as `capture.finished`.\n\n" +
            "One session at a time, shared with `POST /record`: both open the project's " +
            "browser, and this answers **409** while either is open.",
          security: bearer,
          requestBody: json({
            type: "object",
            properties: {
              name: { type: "string", description: "The story's name." },
            },
          }),
          responses: {
            202: { description: "The session id", ...json({ type: "object", properties: { sessionId: { type: "string" } } }) },
            409: {
              description: "A recording session is already open. Stop it before starting another.",
              ...json({ type: "object" }),
            },
            501: { description: "This build cannot record a flow", ...json({ type: "object" }) },
          },
        },
      },
      "/capture/{id}/stop": {
        post: {
          summary: "End a capture, writing the flow and its bindings",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            202: { description: "Stopping; `capture.finished` follows", ...json({ type: "object" }) },
            404: { description: "No such session", ...json({ type: "object" }) },
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
      "/migrate": {
        post: {
          summary: "Import a Yam prototype's electron-db directory into this project",
          description:
            "Reads the prototype's `project`, `config`, `flows` and `api` tables and writes " +
            "`yam.config.yaml`, `flows/`, seed `bindings/`, `data.yaml` and `api/*.yaml` " +
            "into **this** project directory — the one the service was opened on, because " +
            "every write the service makes is confined to it (REQ-ADE-9, LLD §13.5).\n\n" +
            "Results and screenshots are not imported: a `runs/` directory reconstructed " +
            "from another tool's database would look like something you could re-run and " +
            "diff, and would be neither.",
          security: bearer,
          requestBody: json({
            type: "object",
            properties: {
              source: {
                type: "string",
                description: "The prototype's electron-db directory.",
              },
              project: {
                type: "string",
                description: "Which project, when the database holds more than one.",
              },
            },
            required: ["source"],
          }),
          responses: {
            200: {
              description: "What was written, and what needs review",
              ...json({ type: "object" }),
            },
            400: {
              description: "The database could not be read, or names no such project",
              ...json({ type: "object" }),
            },
            501: { description: "This build has no migration", ...json({ type: "object" }) },
          },
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
      "/surface/{session}/snapshot": {
        post: {
          summary: "The driven session's snapshot, for the picker and the explorer",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object" }),
          responses: { 200: { description: "Snapshot", ...json(ref("surface.snapshot")) } },
        },
      },
      "/trajectory/compile": {
        post: {
          summary: "Compile a captured trajectory into proposals/<date>/",
          description:
            "Takes either a `path` to a trajectory the agent wrote, or `lines` — a sequence read " +
            "from a live session with `GET /sessions/:session/events`, which is what the desktop's " +
            "Save as automation promotes (T17, SF-19). Every binding in the proposal is unverified.",
          security: bearer,
          requestBody: json({ type: "object", properties: { path: { type: "string" }, lines: { type: "array" }, name: { type: "string" } } }),
          responses: { 200: { description: "Where the proposal went, and the rate", ...json({ type: "object" }) } },
        },
      },
      "/agents/clients": {
        get: {
          summary: "Who is connected over MCP right now",
          description:
            "An MCP server is its own process — `yam mcp` over stdio, `yam mcp --http` over " +
            "Streamable HTTP — so a connection is recorded in the user's state directory and " +
            "read from there. A record that has gone quiet is dropped, so this never reports " +
            "an agent nobody can hand control to (TV-M05, SF-07, SF-08, SF-13).",
          security: bearer,
          responses: { 200: { description: "The connected clients", ...json({ type: "object" }) } },
        },
      },
      "/tools": {
        get: {
          summary: "The tools this project exposes, and every invocation served",
          description:
            "Invocations are read from the run directories — `behavior: \"tool\"` summaries and " +
            "their audit lines — so the panel shows what a `yam tool serve` in another " +
            "terminal served too (REQ-ADE-2).",
          security: bearer,
          parameters: [{ name: "expose", in: "query", required: false, schema: { type: "string" } }],
          responses: { 200: { description: "Tools and invocations", ...json({ type: "object" }) } },
        },
      },

      /*
       * ── The surface operation catalogue, served for the desktop (SF-03, T14) ──
       *
       * Wave 2 (T12) already serves these routes at runtime from the catalogue
       * `api.surfaceOperations` hands the service — but they were absent from
       * this document, so the generated app client had no way to reach them and
       * the desktop's only surface path was the older `/surface/:session/*` one.
       *
       * They are written out here rather than derived from the catalogue because
       * the service may not import `@svatah/yam-surface-control` (LLD §1) and
       * `contract.test.ts` pins the served document to `openApiDocument("0.1.0")`
       * exactly. `tools/repo-checks/test/surface-catalogue-openapi.test.ts` reads
       * the catalogue and this document together and fails when a served
       * operation is missing or its method or path drifts — so the duplication is
       * a red build rather than a place the two quietly disagree, which is what
       * happened to the whole HTTP surface in wave 2.
       *
       * Bodies and results are generic `object`: the generated client returns
       * `unknown` and the screens parse the envelope with `@svatah/yam-schema`,
       * exactly as every other route here does.
       */
      "/targets": {
        get: {
          summary: "Discover available targets and adapter readiness (SF-04)",
          security: bearer,
          responses: { 200: { description: "Targets and adapters", ...json({ type: "object" }) } },
        },
      },
      "/sessions": {
        get: {
          summary: "List active surface sessions (SF-05)",
          security: bearer,
          responses: { 200: { description: "Sessions", ...json({ type: "object" }) } },
        },
        post: {
          summary: "Connect to a target and open a surface session (SF-04)",
          security: bearer,
          requestBody: json({
            type: "object",
            description:
              "Name one target. A URL launches a browser, `attach` joins one that is " +
              "already running by its DevTools endpoint, and `app` drives an application " +
              "that is already running, by process name. The broker refuses two at once.",
            properties: {
              /*
               * `app` and `attach` were absent, so the generated clients had no
               * way to send them and the app and the cockpit could reach one of
               * the runtime's three targets. The dispatcher has taken all three
               * since SF-04; only this document was narrow.
               */
              url: { type: "string" },
              app: { type: "string" },
              attach: { type: "string" },
              adapter: { type: "string" },
              headed: { type: "boolean" },
              intent: { type: "string" },
            },
          }),
          responses: { 200: { description: "The session and its effective adapter", ...json({ type: "object" }) } },
        },
      },
      "/sessions/{session}": {
        delete: {
          summary: "Close a surface session (SF-05)",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Closed", ...json({ type: "object" }) } },
        },
      },
      "/sessions/{session}/capabilities": {
        get: {
          summary: "A session's adapter capabilities (SF-09)",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Capabilities", ...json({ type: "object" }) } },
        },
      },
      "/sessions/{session}/snapshot": {
        post: {
          summary: "A semantic snapshot of the surface (SF-10)",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object" }),
          responses: { 200: { description: "Snapshot", ...json({ type: "object" }) } },
        },
      },
      "/sessions/{session}/act": {
        post: {
          summary: "Perform a validated action on the surface (SF-11)",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object" }),
          responses: { 200: { description: "The act result", ...json({ type: "object" }) } },
        },
      },
      "/sessions/{session}/read": {
        post: {
          summary: "Read a value from the surface (SF-11)",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object" }),
          responses: { 200: { description: "The value read", ...json({ type: "object" }) } },
        },
      },
      "/sessions/{session}/check": {
        post: {
          summary: "Check a predicate against the surface (SF-11)",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object" }),
          responses: { 200: { description: "The check result", ...json({ type: "object" }) } },
        },
      },
      "/sessions/{session}/describe": {
        post: {
          summary: "Describe a specific element on the surface (SF-10)",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object" }),
          responses: { 200: { description: "The element", ...json({ type: "object" }) } },
        },
      },
      "/sessions/{session}/events": {
        get: {
          summary: "What this session did, and the steps a proposal compiles from (T17, SF-19)",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Events and steps", ...json({ type: "object" }) } },
        },
      },
      "/sessions/{session}/control": {
        post: {
          summary: "Take, release or report who holds a target (T16, SF-13)",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object" }),
          responses: { 200: { description: "Who holds it", ...json({ type: "object" }) } },
        },
      },
      "/sessions/{session}/request": {
        post: {
          summary: "Send an HTTP request on an HTTP surface (T15, SF-04)",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object" }),
          responses: { 200: { description: "The response", ...json({ type: "object" }) } },
        },
      },
      "/sessions/{session}/screenshot": {
        post: {
          summary: "Take a screenshot of the current surface (SF-11)",
          security: bearer,
          parameters: [{ name: "session", in: "path", required: true, schema: { type: "string" } }],
          requestBody: json({ type: "object" }),
          responses: { 200: { description: "The artifact metadata", ...json({ type: "object" }) } },
        },
      },
      /*
       * The stream's message kinds are *in* the description (Draft 2.11, §13.8).
       *
       * They were not, and the clients generated from this document had no way
       * to know what a `data:` line could say — so each of the three would have
       * carried its own copy of the list, which is three places for a new event
       * kind to be missing from. `SERVICE_EVENT_KINDS` is the union's own list
       * (`events.ts`), so the description states it and
       * `scripts/generate-clients.mjs` reads it from here.
       */
      "/events": {
        get: {
          summary: "The event stream (WebSocket)",
          description: EVENT_STREAM_DESCRIPTION,
          security: bearer,
          responses: {
            101: { description: "Switching protocols" },
          },
        },
      },
      "/events/sse": {
        get: {
          summary: "The event stream (server-sent events)",
          description: EVENT_STREAM_DESCRIPTION,
          security: bearer,
          responses: {
            200: {
              description: "text/event-stream",
              content: {
                "text/event-stream": {
                  schema: {
                    type: "string",
                    description:
                      "One JSON object per `data:` line, whose `kind` is one of the values below.",
                  },
                },
              },
            },
          },
        },
      },
      "/openapi.json": {
        get: { summary: "This document", security: [], responses: { 200: { description: "The OpenAPI document", ...json({ type: "object" }) } } },
      },
      "/health": {
        get: { summary: "Liveness, for the app's spawn handshake", security: [], responses: { 200: { description: "ok", ...json({ type: "object" }) } } },
      },
    },
  };
}
