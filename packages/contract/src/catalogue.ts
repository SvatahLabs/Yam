import { z } from "zod";
import {
  refSchema,
  actArgsSchema,
  readKindSchema,
  checkSubjectSchema,
  surfaceKindSchema,
  snapshotSchema,
  actResultSchema,
  checkResultSchema,
  capabilitiesSchema,
  apiRequestSchema,
  apiResponseSchema,
  } from "@svatah/yam-schema";
import { SURFACE_ACTIONS, canonicalHash } from "@svatah/yam-schema";

const sessionIdSchema = z.string().min(1);

const resultEnvelopeSchema = z.object({
  schemaVersion: z.literal("1.0"),
  requestId: z.string(),
  sessionId: z.string().optional(),
  status: z.enum(["succeeded", "failed", "refused"]),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
      details: z.record(z.unknown()).optional(),
    })
    .optional(),
  timing: z
    .object({
      totalMs: z.number(),
      adapterMs: z.number().optional(),
    })
    .optional(),
});

export type ResultEnvelope = z.infer<typeof resultEnvelopeSchema>;

export const ERROR_CODES = [
  "TARGET_AMBIGUOUS",
  "SESSION_CLOSED",
  "SESSION_NOT_FOUND",
  "PERMISSION_REQUIRED",
  "UNSUPPORTED_OPERATION",
  "STALE_REFERENCE",
  "INVALID_ARGUMENT",
  "CONTROL_BUSY",
  "CHECK_FAILED",
  "TIMEOUT",
  "OUTCOME_UNKNOWN",
  "ADAPTER_UNAVAILABLE",
  "ADAPTER_NOT_REGISTERED",
  "TARGET_NOT_FOUND",
  "CONNECT_FAILED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const CLI_EXIT_CODES = {
  OK: 0,
  FAILED: 1,
  CHECK_FAILED: 20,
  SESSION_ERROR: 21,
  ADAPTER_ERROR: 22,
  CONNECT_FAILED: 23,
  INVALID_INPUT: 64,
  TIMEOUT: 75,
} as const;

export interface OperationDescriptor {
  name: string;
  description: string;
  mutation: boolean;
  requiresSession: boolean;
  cli: {
    subcommand: string;
    flags: CliFlag[];
    exitCodes: { code: number; meaning: string }[];
  };
  mcp: {
    toolName: string;
    annotations: {
      title: string;
      readOnlyHint: boolean;
      destructiveHint: boolean;
      openWorldHint: boolean;
    };
  };
  service: {
    method: "GET" | "POST" | "DELETE";
    path: string;
  };
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
}

export interface CliFlag {
  name: string;
  alias?: string;
  type: "string" | "number" | "boolean" | "file";
  required: boolean;
  description: string;
}

const targetsInputSchema = z.object({
  url: z.string().optional(),
  adapter: z.string().optional(),
});

const targetsOutputSchema = resultEnvelopeSchema.extend({
  result: z.object({
    targets: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.enum(["browser", "http", "native", "process"]),
        adapter: z.string(),
        url: z.string().optional(),
        application: z.string().optional(),
        ready: z.boolean(),
        reason: z.string().optional(),
      }),
    ),
    adapters: z.array(
      z.object({
        adapter: z.string(),
        registered: z.boolean(),
        available: z.boolean(),
        platform: z.array(z.string()),
        reason: z.string().optional(),
        prerequisites: z.array(z.string()).optional(),
        /*
         * The one command that would make it available (`AX-06`, PK-03).
         *
         * Not part of the fingerprint: `catalogueFingerprint()` is derived from
         * operation names, flags, tool names and paths, so an optional field on
         * a response is a thing a client may read and never a thing that makes
         * two Yams incompatible.
         */
        install: z.string().optional(),
      }),
    ),
  }),
});

/**
 * What `connect` may be pointed at (SF-04, T18).
 *
 * Wave 2 gave it a URL and nothing else, and wave 3 recorded the consequence as
 * a deviation: "attach to a discovered target is not expressible through it
 * yet". Two things could not be said, and both are the primary journey of a
 * *native* surface:
 *
 *   * `app` — an application that is already running, by the name of its
 *     process. Native adapters address a window that way (`SessionInit.
 *     processName`); without it the AX and UIA adapters could be selected and
 *     never told what to drive, and answered by refusing.
 *   * `attach` — a browser that is already running, by its DevTools endpoint
 *     (`SessionInit.attach.cdpUrl`). A URL *launches* one; this joins the one
 *     somebody else started, which is how a packaged application's renderer is
 *     reached.
 *
 * They are mutually exclusive with each other and with `url`: a request that
 * named two connection modes would leave the caller unable to say which target
 * the session is on, and SF-04 forbids a silent choice between them.
 */
const connectInputSchema = z
  .object({
    url: z.string().url().optional(),
    /** An already-running application to drive, by process name (native adapters). */
    app: z.string().min(1).optional(),
    /** An already-running browser to join, by DevTools endpoint (web adapters). */
    attach: z.string().min(1).optional(),
    adapter: z.string().optional(),
    headed: z.boolean().optional(),
    /**
     * Adapter-specific launch details, as the design's own nested object
     * (design.md, "One public contract"; T22).
     *
     * > Adapter-specific launch details live in a typed nested options object
     * > or config file.
     *
     * There was no way to give any: `connect` could name a target and nothing
     * about how to start it, so a desktop adapter could not be told the bundle
     * and a terminal could not be told the program's arguments. One typed
     * object for every adapter rather than a flag each — `path` is where it
     * runs and, for a terminal, the only directory that session may read.
     */
    launch: z
      .object({
        bundle: z.string().min(1).optional(),
        path: z.string().min(1).optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string().min(1), z.string()).optional(),
        timeoutMs: z.number().int().positive().optional(),
        size: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
      })
      .strict()
      .optional(),
    intent: z.string().optional(),
  })
  .refine(
    (one) => [one.url, one.app, one.attach].filter((v) => v !== undefined).length <= 1,
    {
      message:
        "Name one target: --url launches a browser, --attach joins one that is already " +
        "running, --app drives an application that is already running.",
    },
  );

const connectOutputSchema = resultEnvelopeSchema.extend({
  result: z.object({
    sessionId: z.string(),
    targetId: z.string().optional(),
    adapter: z.string(),
    kind: surfaceKindSchema,
    capabilities: capabilitiesSchema,
  }),
});

const snapshotInputSchema = z.object({
  session: sessionIdSchema,
  root: refSchema.optional(),
  maxNodes: z.number().int().positive().optional(),
  interactiveOnly: z.boolean().optional(),
  intent: z.string().optional(),
});

const snapshotOutputSchema = resultEnvelopeSchema.extend({
  result: snapshotSchema,
});

const actInputSchema = z.object({
  session: sessionIdSchema,
  action: z.enum(SURFACE_ACTIONS as unknown as [string, ...string[]]),
  ref: refSchema.optional(),
  args: actArgsSchema.optional(),
  ref2: refSchema.optional(),
  snapshot: z.string().optional(),
  intent: z.string().optional(),
});

const actOutputSchema = resultEnvelopeSchema.extend({
  result: actResultSchema,
});

const readInputSchema = z.object({
  session: sessionIdSchema,
  kind: readKindSchema,
  ref: refSchema.optional(),
  name: z.string().optional(),
  intent: z.string().optional(),
});

const readOutputSchema = resultEnvelopeSchema.extend({
  result: z.object({
    value: z.unknown(),
  }),
});

const checkInputSchema = z.object({
  session: sessionIdSchema,
  predicate: z.object({
    kind: z.string(),
    value: z.string().optional(),
    name: z.string().optional(),
    negate: z.boolean().optional(),
  }),
  subject: checkSubjectSchema,
  ref: refSchema.optional(),
  intent: z.string().optional(),
});

const checkOutputSchema = resultEnvelopeSchema.extend({
  result: checkResultSchema,
});

const closeInputSchema = z.object({
  session: sessionIdSchema,
  intent: z.string().optional(),
});

const closeOutputSchema = resultEnvelopeSchema.extend({
  result: z.object({
    closed: z.boolean(),
  }),
});

const sessionsInputSchema = z.object({});

const sessionsOutputSchema = resultEnvelopeSchema.extend({
  result: z.object({
    sessions: z.array(
      z.object({
        sessionId: z.string(),
        adapter: z.string(),
        kind: surfaceKindSchema,
        status: z.enum(["connecting", "ready", "busy", "disconnected", "closed"]),
        targetId: z.string().optional(),
        createdAt: z.string(),
        /** Who holds this target, when anyone does (SF-13, T16). */
        controller: z.string().optional(),
        controlledSince: z.string().optional(),
      }),
    ),
  }),
});

const capabilitiesInputSchema = z.object({
  session: sessionIdSchema,
});

const capabilitiesOutputSchema = resultEnvelopeSchema.extend({
  result: z.object({
    capabilities: capabilitiesSchema,
    adapter: z.string(),
    kind: surfaceKindSchema,
  }),
});

const describeInputSchema = z.object({
  session: sessionIdSchema,
  ref: refSchema,
  /**
   * The snapshot the reference came from (SF-10). With it, a reference chosen
   * before a navigation is refused as stale rather than resolved to whatever
   * holds the same id on the page that came after — which is what happened to
   * the desktop's selection, because it re-snapshots on every reload and the
   * ids come back the same.
   */
  snapshot: z.string().optional(),
  intent: z.string().optional(),
});

const describeOutputSchema = resultEnvelopeSchema.extend({
  result: z.object({
    ref: refSchema,
    role: z.string(),
    name: z.string().optional(),
    value: z.string().optional(),
    description: z.string().optional(),
    states: z.array(z.string()),
    box: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  }),
});

/**
 * An HTTP request, on a surface that is one (T15, SF-04).
 *
 * An HTTP surface is not an element surface: its `act` refuses everything, its
 * tree is empty, and the only thing a person can do to it is send a request and
 * read the response. Without this operation the desktop's HTTP form had nothing
 * to send and `yam surface` could drive a browser and not an API — which is
 * half of a surface the support matrix calls validated.
 *
 * The request is the published `ApiRequest`, so an `api` step in a flow and this
 * send the same shape through the same adapter.
 */
const requestInputSchema = z.object({
  session: sessionIdSchema,
  request: apiRequestSchema,
  withSessionCookies: z.boolean().optional(),
  /** Who is sending it, so a held target refuses anyone else (SF-13). */
  holder: z.string().optional(),
  intent: z.string().optional(),
});

const requestOutputSchema = resultEnvelopeSchema.extend({
  result: z.object({ response: apiResponseSchema }),
});

/**
 * Take, release, or ask who holds a target (SF-13, T16).
 *
 * A person and an agent can drive the same session; this is how they hand over
 * explicitly rather than racing each mutation. With no `action` it reports.
 */
const controlInputSchema = z.object({
  session: sessionIdSchema,
  action: z.enum(["take", "release", "status"]).optional(),
  holder: z.string().optional(),
  /** An explicit handoff: take a target its holder has not given up. */
  force: z.boolean().optional(),
  intent: z.string().optional(),
});

const controlOutputSchema = resultEnvelopeSchema.extend({
  result: z.object({
    holder: z.string().optional(),
    since: z.string().optional(),
    heldByYou: z.boolean(),
  }),
});

/**
 * What a session did (T17, SF-19, SF-21).
 *
 * `events` is the redacted record; `steps` is the same session in the shape a
 * proposal compiles from, so "Save as automation" promotes what happened.
 */
const eventsInputSchema = z.object({
  session: sessionIdSchema,
  intent: z.string().optional(),
});

const eventsOutputSchema = resultEnvelopeSchema.extend({
  result: z.object({
    events: z.array(z.record(z.unknown())),
    steps: z.array(z.record(z.unknown())),
  }),
});

const screenshotInputSchema = z.object({
  session: sessionIdSchema,
  path: z.string().optional(),
  intent: z.string().optional(),
});

const screenshotOutputSchema = resultEnvelopeSchema.extend({
  result: z.object({
    path: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
  }),
});

export const OPERATIONS: readonly OperationDescriptor[] = [
  {
    name: "targets",
    description: "Discover available targets and adapter readiness on this machine",
    mutation: false,
    requiresSession: false,
    cli: {
      subcommand: "targets",
      flags: [
        { name: "url", type: "string", required: false, description: "Filter targets that can drive this URL" },
        { name: "adapter", type: "string", required: false, description: "Filter to a specific adapter" },
      ],
      exitCodes: [
        { code: CLI_EXIT_CODES.OK, meaning: "Targets listed" },
      ],
    },
    mcp: {
      toolName: "surface_targets",
      annotations: { title: "Discover available targets", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    service: { method: "GET", path: "/targets" },
    inputSchema: targetsInputSchema,
    outputSchema: targetsOutputSchema,
  },
  {
    name: "connect",
    description: "Connect to a target and open a surface session",
    mutation: false,
    requiresSession: false,
    cli: {
      subcommand: "connect",
      flags: [
        { name: "url", type: "string", required: false, description: "URL to connect to" },
        { name: "app", type: "string", required: false, description: "Drive an application that is already running, by process name" },
        { name: "attach", type: "string", required: false, description: "Join a browser that is already running, by its DevTools endpoint" },
        { name: "adapter", type: "string", required: false, description: "Adapter to use (playwright, bidi, appium, uia, ax, http, process)" },
        { name: "headed", type: "boolean", required: false, description: "Run in headed mode" },
        { name: "launch", type: "string", required: false, description: "How to start the target, as JSON: {\"args\":[…],\"path\":\"…\",\"env\":{…},\"size\":[w,h]}" },
        { name: "input", type: "file", required: false, description: "The same launch object as a JSON file or stdin, for one with a secret in it" },
      ],
      exitCodes: [
        { code: CLI_EXIT_CODES.OK, meaning: "Connected" },
        { code: CLI_EXIT_CODES.ADAPTER_ERROR, meaning: "Adapter unavailable or not registered" },
        { code: CLI_EXIT_CODES.CONNECT_FAILED, meaning: "Connection failed" },
        { code: CLI_EXIT_CODES.INVALID_INPUT, meaning: "Invalid arguments" },
      ],
    },
    mcp: {
      toolName: "surface_connect",
      annotations: { title: "Connect to a surface", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    service: { method: "POST", path: "/sessions" },
    inputSchema: connectInputSchema,
    outputSchema: connectOutputSchema,
  },
  {
    name: "snapshot",
    description: "Take a semantic snapshot of the current surface state",
    mutation: false,
    requiresSession: true,
    cli: {
      subcommand: "snapshot",
      flags: [
        { name: "session", type: "string", required: true, description: "Session ID" },
        { name: "root", type: "string", required: false, description: "Subtree root ref" },
        { name: "max-nodes", type: "number", required: false, description: "Max nodes to return" },
        { name: "interactive-only", type: "boolean", required: false, description: "Only interactive elements" },
      ],
      exitCodes: [
        { code: CLI_EXIT_CODES.OK, meaning: "Snapshot taken" },
        { code: CLI_EXIT_CODES.SESSION_ERROR, meaning: "Session not found or closed" },
      ],
    },
    mcp: {
      toolName: "surface_snapshot",
      annotations: { title: "Take a surface snapshot", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    service: { method: "POST", path: "/sessions/:session/snapshot" },
    inputSchema: snapshotInputSchema,
    outputSchema: snapshotOutputSchema,
  },
  {
    name: "act",
    description: "Perform an action on the surface",
    mutation: true,
    requiresSession: true,
    cli: {
      subcommand: "act",
      flags: [
        { name: "session", type: "string", required: true, description: "Session ID" },
        { name: "action", type: "string", required: true, description: "Action to perform" },
        { name: "ref", type: "string", required: false, description: "Element reference" },
        { name: "ref2", type: "string", required: false, description: "Second reference (for dragTo)" },
        { name: "input", type: "file", required: false, description: "Action arguments as JSON file or stdin" },
        { name: "snapshot", type: "string", required: false, description: "Snapshot ID for reference validation" },
        /*
         * Three the command line already read and the catalogue never declared
         * (T18). The catalogue is what generates help and what a command line
         * is now validated against, so a flag missing from here is one
         * `yam surface act --help` never mentions and the unknown-flag check
         * would reject — an argument that works and is not written down.
         */
        { name: "idempotency-key", type: "string", required: false, description: "Deduplicate this mutation within the retention period" },
        { name: "holder", type: "string", required: false, description: "Who you are; defaults to a name for this client" },
        { name: "secret", type: "string", required: false, description: "A value that must never come back in a result, event or trajectory; repeatable" },
      ],
      exitCodes: [
        { code: CLI_EXIT_CODES.OK, meaning: "Action performed" },
        { code: CLI_EXIT_CODES.FAILED, meaning: "Action failed" },
        { code: CLI_EXIT_CODES.SESSION_ERROR, meaning: "Session not found or closed" },
        { code: CLI_EXIT_CODES.INVALID_INPUT, meaning: "Invalid action or arguments" },
      ],
    },
    mcp: {
      toolName: "surface_act",
      annotations: { title: "Perform a surface action", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    service: { method: "POST", path: "/sessions/:session/act" },
    inputSchema: actInputSchema,
    outputSchema: actOutputSchema,
  },
  {
    name: "read",
    description: "Read a value from the surface",
    mutation: false,
    requiresSession: true,
    cli: {
      subcommand: "read",
      flags: [
        { name: "session", type: "string", required: true, description: "Session ID" },
        { name: "kind", type: "string", required: true, description: "What to read: text, value, attribute, title, url, result" },
        { name: "ref", type: "string", required: false, description: "Element reference" },
        { name: "name", type: "string", required: false, description: "Attribute name (when kind=attribute)" },
      ],
      exitCodes: [
        { code: CLI_EXIT_CODES.OK, meaning: "Value read" },
        { code: CLI_EXIT_CODES.SESSION_ERROR, meaning: "Session not found or closed" },
        { code: CLI_EXIT_CODES.INVALID_INPUT, meaning: "Invalid kind or missing ref" },
      ],
    },
    mcp: {
      toolName: "surface_read",
      annotations: { title: "Read a surface value", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    service: { method: "POST", path: "/sessions/:session/read" },
    inputSchema: readInputSchema,
    outputSchema: readOutputSchema,
  },
  {
    name: "check",
    description: "Check a predicate against the surface",
    mutation: false,
    requiresSession: true,
    cli: {
      subcommand: "check",
      flags: [
        { name: "session", type: "string", required: true, description: "Session ID" },
        { name: "ref", type: "string", required: false, description: "Element reference" },
        { name: "input", type: "file", required: true, description: "Check predicate as JSON file or stdin" },
      ],
      exitCodes: [
        { code: CLI_EXIT_CODES.OK, meaning: "Check passed" },
        { code: CLI_EXIT_CODES.CHECK_FAILED, meaning: "Check failed (predicate not satisfied)" },
        { code: CLI_EXIT_CODES.SESSION_ERROR, meaning: "Session not found or closed" },
        { code: CLI_EXIT_CODES.INVALID_INPUT, meaning: "Invalid predicate" },
      ],
    },
    mcp: {
      toolName: "surface_check",
      annotations: { title: "Check a surface predicate", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    service: { method: "POST", path: "/sessions/:session/check" },
    inputSchema: checkInputSchema,
    outputSchema: checkOutputSchema,
  },
  {
    name: "close",
    description: "Close a surface session",
    mutation: false,
    requiresSession: true,
    cli: {
      subcommand: "close",
      flags: [
        { name: "session", type: "string", required: true, description: "Session ID" },
      ],
      exitCodes: [
        { code: CLI_EXIT_CODES.OK, meaning: "Session closed" },
        { code: CLI_EXIT_CODES.SESSION_ERROR, meaning: "Session not found" },
      ],
    },
    mcp: {
      toolName: "surface_close",
      annotations: { title: "Close a surface session", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    service: { method: "DELETE", path: "/sessions/:session" },
    inputSchema: closeInputSchema,
    outputSchema: closeOutputSchema,
  },
  {
    name: "sessions",
    description: "List active surface sessions",
    mutation: false,
    requiresSession: false,
    cli: {
      subcommand: "sessions",
      flags: [],
      exitCodes: [{ code: CLI_EXIT_CODES.OK, meaning: "Sessions listed" }],
    },
    mcp: {
      toolName: "surface_sessions",
      annotations: { title: "List surface sessions", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    service: { method: "GET", path: "/sessions" },
    inputSchema: sessionsInputSchema,
    outputSchema: sessionsOutputSchema,
  },
  {
    name: "capabilities",
    description: "Get the capabilities of a session's adapter",
    mutation: false,
    requiresSession: true,
    cli: {
      subcommand: "capabilities",
      flags: [
        { name: "session", type: "string", required: true, description: "Session ID" },
      ],
      exitCodes: [
        { code: CLI_EXIT_CODES.OK, meaning: "Capabilities returned" },
        { code: CLI_EXIT_CODES.SESSION_ERROR, meaning: "Session not found" },
      ],
    },
    mcp: {
      toolName: "surface_capabilities",
      annotations: { title: "Get adapter capabilities", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    service: { method: "GET", path: "/sessions/:session/capabilities" },
    inputSchema: capabilitiesInputSchema,
    outputSchema: capabilitiesOutputSchema,
  },
  {
    name: "describe",
    description: "Describe a specific element on the surface",
    mutation: false,
    requiresSession: true,
    cli: {
      subcommand: "describe",
      flags: [
        { name: "session", type: "string", required: true, description: "Session ID" },
        { name: "ref", type: "string", required: true, description: "Element reference" },
        { name: "snapshot", type: "string", required: false, description: "The snapshot the reference came from; refused if the surface has changed since" },
      ],
      exitCodes: [
        { code: CLI_EXIT_CODES.OK, meaning: "Element described" },
        { code: CLI_EXIT_CODES.SESSION_ERROR, meaning: "Session not found" },
        { code: CLI_EXIT_CODES.INVALID_INPUT, meaning: "Invalid reference" },
      ],
    },
    mcp: {
      toolName: "surface_describe",
      annotations: { title: "Describe a surface element", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    service: { method: "POST", path: "/sessions/:session/describe" },
    inputSchema: describeInputSchema,
    outputSchema: describeOutputSchema,
  },
  {
    name: "events",
    description: "What this session did: its redacted events, and the steps a proposal compiles from",
    mutation: false,
    requiresSession: true,
    cli: {
      subcommand: "events",
      flags: [{ name: "session", type: "string", required: true, description: "Session ID" }],
      exitCodes: [
        { code: CLI_EXIT_CODES.OK, meaning: "Events listed" },
        { code: CLI_EXIT_CODES.SESSION_ERROR, meaning: "Session not found" },
      ],
    },
    mcp: {
      toolName: "surface_events",
      annotations: { title: "What this session did", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    service: { method: "GET", path: "/sessions/:session/events" },
    inputSchema: eventsInputSchema,
    outputSchema: eventsOutputSchema,
  },
  {
    name: "control",
    description: "Take, release or report who holds control of a target",
    mutation: false,
    requiresSession: true,
    cli: {
      subcommand: "control",
      flags: [
        { name: "session", type: "string", required: true, description: "Session ID" },
        { name: "take", type: "boolean", required: false, description: "Take control of the target" },
        { name: "release", type: "boolean", required: false, description: "Give control up" },
        { name: "holder", type: "string", required: false, description: "Who you are; defaults to a name for this client (the terminal, the agent or the desktop)" },
        { name: "force", type: "boolean", required: false, description: "Take a target its holder has not given up" },
      ],
      exitCodes: [
        { code: CLI_EXIT_CODES.OK, meaning: "Control reported, taken or released" },
        { code: CLI_EXIT_CODES.FAILED, meaning: "Another client holds it" },
        { code: CLI_EXIT_CODES.SESSION_ERROR, meaning: "Session not found" },
      ],
    },
    mcp: {
      toolName: "surface_control",
      annotations: { title: "Take or release control", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    service: { method: "POST", path: "/sessions/:session/control" },
    inputSchema: controlInputSchema,
    outputSchema: controlOutputSchema,
  },
  {
    name: "request",
    description: "Send an HTTP request on an HTTP surface and return the response",
    mutation: true,
    requiresSession: true,
    cli: {
      subcommand: "request",
      flags: [
        { name: "session", type: "string", required: true, description: "Session ID" },
        { name: "method", type: "string", required: false, description: "HTTP method (default GET)" },
        { name: "url", type: "string", required: false, description: "URL or path, joined to the session's base URL" },
        { name: "input", type: "file", required: false, description: "The full ApiRequest as a JSON file or stdin" },
        { name: "holder", type: "string", required: false, description: "Who you are; defaults to a name for this client" },
        { name: "with-session-cookies", type: "boolean", required: false, description: "Send the browser session's cookies with the request" },
      ],
      exitCodes: [
        { code: CLI_EXIT_CODES.OK, meaning: "Request sent" },
        { code: CLI_EXIT_CODES.FAILED, meaning: "The request could not be sent" },
        { code: CLI_EXIT_CODES.SESSION_ERROR, meaning: "Session not found or closed" },
        { code: CLI_EXIT_CODES.INVALID_INPUT, meaning: "Invalid request" },
      ],
    },
    mcp: {
      toolName: "surface_request",
      annotations: { title: "Send an HTTP request", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    service: { method: "POST", path: "/sessions/:session/request" },
    inputSchema: requestInputSchema,
    outputSchema: requestOutputSchema,
  },
  {
    name: "screenshot",
    description: "Take a screenshot of the current surface",
    mutation: false,
    requiresSession: true,
    cli: {
      subcommand: "screenshot",
      flags: [
        { name: "session", type: "string", required: true, description: "Session ID" },
        { name: "path", type: "string", required: false, description: "Output file path" },
      ],
      exitCodes: [
        { code: CLI_EXIT_CODES.OK, meaning: "Screenshot saved" },
        { code: CLI_EXIT_CODES.SESSION_ERROR, meaning: "Session not found" },
      ],
    },
    mcp: {
      toolName: "surface_screenshot",
      annotations: { title: "Take a screenshot", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    service: { method: "POST", path: "/sessions/:session/screenshot" },
    inputSchema: screenshotInputSchema,
    outputSchema: screenshotOutputSchema,
  },
] as const;

export function operationByName(name: string): OperationDescriptor | undefined {
  return OPERATIONS.find((op) => op.name === name);
}

export function operationByCliSubcommand(sub: string): OperationDescriptor | undefined {
  return OPERATIONS.find((op) => op.cli.subcommand === sub);
}

export function operationByMcpTool(toolName: string): OperationDescriptor | undefined {
  return OPERATIONS.find((op) => op.mcp.toolName === toolName);
}

export function operationByServicePath(method: string, path: string): OperationDescriptor | undefined {
  return OPERATIONS.find(
    (op) => op.service.method === method && pathMatches(op.service.path, path),
  );
}

function pathMatches(pattern: string, actual: string): boolean {
  const patternParts = pattern.split("/");
  const actualParts = actual.split("/");
  if (patternParts.length !== actualParts.length) return false;
  return patternParts.every(
    (p, i) => p.startsWith(":") || p === actualParts[i],
  );
}

/**
 * A fingerprint of the contract this build serves (T18, SF-03).
 *
 * The broker is one process per machine, it outlives the commands that use it,
 * and it is discovered through a descriptor that says only where it is. Nothing
 * said *what it speaks* — so a client built from a newer catalogue could send an
 * argument an older broker had never heard of, and the older broker would drop
 * it and answer `succeeded`.
 *
 * That is not hypothetical either. `yam surface connect --attach <endpoint>`
 * reached a broker the packaged application had started from its own staged
 * copy of the CLI, built before `attach` existed. The argument vanished, the
 * adapter launched a fresh blank browser instead of joining the application's,
 * and the session came back healthy — pointing at the wrong target, which is
 * the one thing SF-04 forbids ("no silent switch to another adapter, tab or
 * foreground application"). Every snapshot after it was empty and every one
 * said `succeeded`.
 *
 * So the contract carries a fingerprint, and a client that does not recognise a
 * broker's fingerprint does not talk to it. It is *derived*, not declared:
 * every operation name, every CLI flag, every tool name and every service path.
 * Nobody has to remember to bump it, which is the only kind of version marker
 * that stays true.
 */
export function catalogueFingerprint(): string {
  const shape = OPERATIONS.map((op) => ({
    name: op.name,
    mutation: op.mutation,
    requiresSession: op.requiresSession,
    cli: {
      subcommand: op.cli.subcommand,
      flags: op.cli.flags.map((flag) => `${flag.name}:${flag.type}${flag.required ? "!" : ""}`).sort(),
    },
    mcp: op.mcp.toolName,
    service: `${op.service.method} ${op.service.path}`,
  }));
  return canonicalHash(shape).slice(0, 16);
}

export const SURFACE_TOOL_NAMES = OPERATIONS.map((op) => op.mcp.toolName);
export const SURFACE_CLI_SUBCOMMANDS = OPERATIONS.map((op) => op.cli.subcommand);

export {
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
  controlInputSchema,
  controlOutputSchema,
  eventsInputSchema,
  eventsOutputSchema,
  requestInputSchema,
  requestOutputSchema,
  screenshotInputSchema,
  screenshotOutputSchema,
};
