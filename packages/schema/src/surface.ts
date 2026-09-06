import { z } from "zod";
import { boxSchema, candidateSchema } from "./bindings.js";
import { predicateSchema, surfaceActionSchema } from "./ir.js";

/**
 * Wire shapes for the agent surface (LLD §2).
 *
 * They live in `@svatah/schema` rather than in `@svatah/surface` for two reasons:
 * HLD §7 publishes them as `packages/schema/json/surface.*.schema.json`, and the
 * dependency graph runs `schema ◄── surface`, so putting the shapes at the bottom
 * lets the checkpoint and result schemas embed `SessionState` without inverting it.
 * `@svatah/surface` re-exports these and adds the interface, registry and errors.
 */

/** Opaque above the surface: `"r12"` style, stable within one snapshot (LLD §2.2). */
export const refSchema = z.string().min(1);
export type Ref = z.infer<typeof refSchema>;

/* ── Snapshot (LLD §2.2) ──────────────────────────────────────────────────── */

export const NODE_STATES = [
  "disabled",
  "checked",
  "unchecked",
  "selected",
  "expanded",
  "collapsed",
  "focused",
  "required",
  "hidden",
  "readonly",
] as const;
export const nodeStateSchema = z.enum(NODE_STATES);
export type NodeState = z.infer<typeof nodeStateSchema>;

export const snapshotNodeSchema = z
  .object({
    ref: refSchema,
    /** ARIA role vocabulary; adapters map UIA ControlType, AX role and Appium class onto it. */
    role: z.string().min(1),
    name: z.string().optional(),
    value: z.string().optional(),
    description: z.string().optional(),
    states: z.array(nodeStateSchema),
    box: boxSchema.optional(),
    depth: z.number().int().nonnegative(),
    parent: refSchema.optional(),
    /**
     * Adapter-specific extras (automationId, resource-id, testid). Never used above
     * the surface except by candidate synthesis (LLD §2.2).
     */
    native: z.record(z.string().min(1), z.string()).optional(),
  })
  .strict();
export type SnapshotNode = z.infer<typeof snapshotNodeSchema>;

export const snapshotSchema = z
  .object({
    /** The root of this snapshot. */
    ref: refSchema,
    nodes: z.array(snapshotNodeSchema),
    /** YAML-like rendering used in prompts, with `[ref=…]` annotations. */
    text: z.string(),
    tokensEstimate: z.number().int().nonnegative(),
    /** Structural hash as defined in LLD §6.2. */
    hash: z.string().min(1),
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;

/* ── Capabilities (LLD §2.4) ──────────────────────────────────────────────── */

export const CAPABILITY_FLAGS = [
  "dialogs",
  "frames",
  "windows",
  "upload",
  "drag",
  "trace",
  "webmcp",
  "screenshot",
  "restore",
] as const;
export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number];

export const capabilitiesSchema = z
  .object(
    Object.fromEntries(CAPABILITY_FLAGS.map((f) => [f, z.boolean()])) as {
      [K in CapabilityFlag]: z.ZodBoolean;
    },
  )
  .strict();
export type Capabilities = z.infer<typeof capabilitiesSchema>;

/* ── Sessions and state (LLD §2.1) ────────────────────────────────────────── */

export const surfaceKindSchema = z.enum(["web", "mobile", "desktop", "http"]);
export type SurfaceKind = z.infer<typeof surfaceKindSchema>;

export const sessionInitSchema = z
  .object({
    baseUrl: z.string().min(1).optional(),
    /** Path to a Playwright storage-state file, or an equivalent session bundle. */
    storageState: z.string().min(1).optional(),
    /** Desktop: the application to launch. */
    appPath: z.string().min(1).optional(),
    /** Desktop: an already-running process to attach to. */
    processName: z.string().min(1).optional(),

    /**
     * Desktop: how to start the application when it is not running (T11.2,
     * LLD §13.9). `config.app.launch`, carried through so an adapter opens a
     * session by launching rather than by asking a caller to have done it.
     */
    launch: z
      .object({
        bundle: z.string().min(1).optional(),
        path: z.string().min(1).optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        timeoutMs: z.number().int().positive().optional(),
        /** The window's size once it exists, `[width, height]` (pattern 33, T12.7). */
        size: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
      })
      .strict()
      .optional(),

    /** Desktop: how to stop it — a graceful route, then a signal (T11.2). */
    quit: z
      .object({
        bundleId: z.string().min(1).optional(),
        gracefulMs: z.number().int().positive().optional(),
        signalMs: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),

    /** Web: a Chromium that is already running, over CDP (T11.2, LLD §13.9). */
    attach: z
      .object({ cdpUrl: z.string().min(1).optional() })
      .strict()
      .optional(),
  })
  .strict();
export type SessionInit = z.infer<typeof sessionInitSchema>;

/**
 * The restorable subset of session state (LLD §2.1). It is what a checkpoint
 * stores and what `restore()` consumes, so it holds only what an adapter can put
 * back: where the session is, and which window, frame and dialog are active.
 */
export const sessionStateSchema = z
  .object({
    kind: surfaceKindSchema,
    url: z.string().optional(),
    windowTitle: z.string().optional(),
    /** Index of the active window or page among those the session owns. */
    windowIndex: z.number().int().nonnegative().optional(),
    frame: z.string().optional(),
    dialog: z
      .object({ type: z.string().min(1), message: z.string() })
      .strict()
      .nullable()
      .optional(),
    /** Path to a storage-state file written alongside the checkpoint (web). */
    storageState: z.string().min(1).optional(),
  })
  .strict();
export type SessionState = z.infer<typeof sessionStateSchema>;

/* ── act / read / check (LLD §2.1, §2.3) ──────────────────────────────────── */

export const actArgsSchema = z.record(
  z.string().min(1),
  z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
);
export type ActArgs = z.infer<typeof actArgsSchema>;

export const actResultSchema = z
  .object({
    ok: z.boolean(),
    /** The reference actually acted on, when the adapter resolved one. */
    ref: refSchema.optional(),
    /** Set when the action navigated the session. */
    navigated: z.boolean().optional(),
    /** `evaluate` and `read`-like actions return a value here. */
    value: z.unknown().optional(),
  })
  .strict();
export type ActResult = z.infer<typeof actResultSchema>;

export const readKindSchema = z.enum(["text", "value", "attribute", "title", "url", "result"]);
export type ReadKind = z.infer<typeof readKindSchema>;

export const checkSubjectSchema = z.enum(["ref", "page", "dialog"]);
export type CheckSubject = z.infer<typeof checkSubjectSchema>;

export const checkResultSchema = z
  .object({
    ok: z.boolean(),
    actual: z.unknown().optional(),
    expected: z.unknown().optional(),
    message: z.string().optional(),
  })
  .strict();
export type CheckResult = z.infer<typeof checkResultSchema>;

/**
 * What `describe(ref)` returns: everything candidate synthesis and fingerprinting
 * need from one element (LLD §2.1, §3.3). It is a superset of `Fingerprint` plus
 * the identity fields synthesis ranks candidates from.
 */
export const elementDescriptionSchema = z
  .object({
    ref: refSchema,
    role: z.string().min(1),
    name: z.string().optional(),
    value: z.string().optional(),
    /** HTML tag, UIA ControlType, AX role or Appium class. */
    tag: z.string().min(1),
    attrs: z.record(z.string().min(1), z.string()),
    text: z.string(),
    neighbours: z.object({ before: z.array(z.string()), after: z.array(z.string()) }).strict(),
    rolePath: z.array(z.string()),
    box: boxSchema,
    index: z.number().int().nonnegative(),
    states: z.array(nodeStateSchema),
    native: z.record(z.string().min(1), z.string()).optional(),
  })
  .strict();
export type ElementDescription = z.infer<typeof elementDescriptionSchema>;

/* ── HTTP adapter messages (REQ-ADP-2, LLD §7.2) ──────────────────────────── */

export const apiRequestSchema = z
  .object({
    name: z.string().min(1),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
    url: z.string().min(1),
    headers: z.record(z.string().min(1), z.string()).optional(),
    query: z.record(z.string().min(1), z.string()).optional(),
    pathParams: z.record(z.string().min(1), z.string()).optional(),
    form: z.record(z.string().min(1), z.string()).optional(),
    json: z.unknown().optional(),
    body: z.string().optional(),
    auth: z
      .object({ kind: z.literal("basic"), username: z.string(), password: z.string() })
      .strict()
      .optional(),
    cookies: z.record(z.string().min(1), z.string()).optional(),
    followRedirects: z.boolean().optional(),
    tls: z
      .object({
        insecure: z.boolean().optional(),
        caFile: z.string().min(1).optional(),
        certFile: z.string().min(1).optional(),
        keyFile: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    /** Multipart file uploads: form field name → path. */
    files: z.record(z.string().min(1), z.string().min(1)).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();
export type ApiRequest = z.infer<typeof apiRequestSchema>;

export const apiResponseSchema = z
  .object({
    status: z.number().int(),
    statusText: z.string(),
    headers: z.record(z.string().min(1), z.string()),
    body: z.string(),
    /** Parsed body when the response was JSON; JSON-path addressable (REQ-ADP-2). */
    json: z.unknown().optional(),
    cookies: z.record(z.string().min(1), z.string()).optional(),
    durationMs: z.number().nonnegative(),
  })
  .strict();
export type ApiResponse = z.infer<typeof apiResponseSchema>;

/* ── Published wire messages (LLD §2.5) ───────────────────────────────────── */

/** `surface.snapshot.schema.json` — request and response of `snapshot()`. */
export const surfaceSnapshotMessageSchema = z
  .object({
    request: z
      .object({
        root: refSchema.optional(),
        maxNodes: z.number().int().positive().optional(),
        interactiveOnly: z.boolean().optional(),
        /** Required by the MCP raw-surface tools so trajectories can be captured (LLD §13.4). */
        intent: z.string().optional(),
      })
      .strict(),
    response: snapshotSchema,
  })
  .strict();
export type SurfaceSnapshotMessage = z.infer<typeof surfaceSnapshotMessageSchema>;

/** `surface.act.schema.json` — request and response of `act()`. */
export const surfaceActMessageSchema = z
  .object({
    request: z
      .object({
        action: surfaceActionSchema,
        ref: refSchema.optional(),
        args: actArgsSchema.optional(),
        /** Second reference, for two-element actions such as `dragTo`. */
        ref2: refSchema.optional(),
        intent: z.string().optional(),
      })
      .strict(),
    response: actResultSchema,
  })
  .strict();
export type SurfaceActMessage = z.infer<typeof surfaceActMessageSchema>;

/** `surface.check.schema.json` — request and response of `check()`. */
export const surfaceCheckMessageSchema = z
  .object({
    request: z
      .object({
        predicate: predicateSchema,
        subject: checkSubjectSchema,
        ref: refSchema.optional(),
        intent: z.string().optional(),
      })
      .strict(),
    response: checkResultSchema,
  })
  .strict();
export type SurfaceCheckMessage = z.infer<typeof surfaceCheckMessageSchema>;

/** `surface.read.schema.json` — request and response of `read()`. */
export const surfaceReadMessageSchema = z
  .object({
    request: z
      .object({
        kind: readKindSchema,
        ref: refSchema.optional(),
        /** Attribute name, when `kind === "attribute"`. */
        name: z.string().min(1).optional(),
        intent: z.string().optional(),
      })
      .strict(),
    response: z.object({ value: z.unknown() }).strict(),
  })
  .strict();
export type SurfaceReadMessage = z.infer<typeof surfaceReadMessageSchema>;

/** `surface.locate.schema.json` — candidate in, references out (used by the resolver). */
export const surfaceLocateMessageSchema = z
  .object({
    request: z.object({ candidate: candidateSchema }).strict(),
    response: z.object({ refs: z.array(refSchema) }).strict(),
  })
  .strict();
export type SurfaceLocateMessage = z.infer<typeof surfaceLocateMessageSchema>;

/** `surface.capabilities.schema.json` — the descriptor an adapter publishes. */
export const surfaceCapabilitiesMessageSchema = z
  .object({ kind: surfaceKindSchema, capabilities: capabilitiesSchema })
  .strict();
export type SurfaceCapabilitiesMessage = z.infer<typeof surfaceCapabilitiesMessageSchema>;
