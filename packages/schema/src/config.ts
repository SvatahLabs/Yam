import { z } from "zod";
import { SCHEMA_VERSION } from "./version.js";

/**
 * The default of `bindings.ignoreAttributes` (LLD §3.5, §16, Draft 2.3).
 *
 * `data-yam-eval` is the healing eval's ground-truth label. It is on this
 * list by default rather than only in the eval's own configuration so that no
 * arrangement of options can accidentally let a binding be built on it: an
 * application that carried the attribute into production would otherwise get a
 * flatteringly unbreakable candidate, and the eval would be scoring its own
 * bookkeeping.
 */
export const DEFAULT_IGNORE_ATTRIBUTES = ["data-yam-eval"];

/** Project configuration, `yam.config.yaml` (LLD §3.5). */

export const adapterNameSchema = z.enum(["playwright", "bidi", "appium", "uia", "ax", "http"]);
export type AdapterName = z.infer<typeof adapterNameSchema>;

export const environmentSchema = z.enum(["test", "staging", "production"]);
export type Environment = z.infer<typeof environmentSchema>;

export const configSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    project: z.string().min(1),

    /** `production` refuses recording and requires idempotence or an override (REQ-AUTO-7). */
    environment: environmentSchema,
    allowSideEffects: z.boolean().optional(),

    adapter: adapterNameSchema,
    app: z
      .object({
        baseUrl: z.string().min(1).optional(),
        storageState: z.string().min(1).optional(),
        appPath: z.string().min(1).optional(),
        processName: z.string().min(1).optional(),

        /**
         * How to start the application, when it is not already running
         * (T11.2, LLD §13.9).
         *
         * > Desktop adapters take `app.launch` (the executable or bundle,
         * > arguments, environment) and `app.quit` (a graceful route, then a
         * > signal) in configuration; the session opens by launching when no
         * > process of that name owns a window and closes by quitting.
         *
         * `bundle` rather than `path` on macOS is not a nicety: a GUI
         * application forked from a process that is not in the user's Aqua
         * session never attaches to the WindowServer — it runs, its renderer
         * runs, and it has no window either the accessibility API or System
         * Events can see, for ever (LLD §7.5, measured). `open -n` hands the
         * launch to LaunchServices, which places it in the session a person is
         * looking at.
         */
        launch: z
          .object({
            /** A macOS `.app` bundle, opened through LaunchServices. */
            bundle: z.string().min(1).optional(),
            /** An executable, spawned directly. Windows and Linux. */
            path: z.string().min(1).optional(),
            args: z.array(z.string()).optional(),
            /** Added to the launched process's environment, never to Yam's. */
            env: z.record(z.string(), z.string()).optional(),
            /** How long to wait for a window before the session fails. */
            timeoutMs: z.number().int().positive().optional(),
            /**
             * The window's size when the session opens (pattern 33, T12.7).
             *
             * `[width, height]` in points, applied once the window exists. The
             * APP_DIR remembers its own size between runs, so a suite that measures
             * a toolbar at 1440 points was measuring whatever width the last
             * person left it at; naming the size is what makes those checks
             * reproducible on somebody else's machine (LLD §13.9 Draft 2.15).
             */
            size: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
          })
          .strict()
          .optional(),

        /**
         * How to stop it: a graceful route, then a signal (T11.2, LLD §13.9).
         *
         * The graceful route is what lets an application put its own house in
         * order — the app stops the `yam serve` it spawned and writes its
         * preferences. A bare signal ends the main process where it stands, and
         * P10-F1 measured what that leaves behind.
         */
        quit: z
          .object({
            /** macOS: an Apple-event `quit` to this bundle identifier. */
            bundleId: z.string().min(1).optional(),
            /** How long the graceful route is given before a signal. */
            gracefulMs: z.number().int().positive().optional(),
            /** How long the signal is given before `SIGKILL`. */
            signalMs: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),

        /**
         * Attach to a Chromium that is already running (T11.2, LLD §13.9).
         *
         * > The Playwright adapter attaches to an existing Chromium when
         * > `YAM_CDP_URL` or `app.attach.cdpUrl` is set, exactly as the BiDi
         * > adapter attaches, so a flow can drive the app's renderer.
         */
        attach: z
          .object({
            cdpUrl: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),

    flows: z
      .object({
        dir: z.string().min(1),
        include: z.array(z.string().min(1)).optional(),
        exclude: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    steps: z.object({ dir: z.string().min(1) }).strict(),
    bindings: z
      .object({
        dir: z.string().min(1),
        /** Attributes candidate synthesis may use as a test id, in preference order. */
        testIdAttributes: z.array(z.string().min(1)),
        /**
         * Attributes nothing may ever bind to (LLD §3.5, Draft 2.3).
         *
         * Removed from synthesis, from fingerprints, and from the adapter's
         * `native` — so a value under one of these names cannot reach a
         * candidate, a score, or a relocalization, whatever an adapter happens
         * to expose. It exists because the healing eval labels every element
         * with its ground-truth identity, and a label that helps relocalization
         * find the element would make the eval measure itself.
         */
        ignoreAttributes: z.array(z.string().min(1)).optional(),
        /**
         * Keep the origin in a binding's `context.pattern` (LLD §3.5, Draft
         * 2.3). Default false: the pattern is the path.
         *
         * A store is committed and shared. An origin in the pattern ties it to
         * one deployment, and a store recorded against a test server on an
         * ephemeral port is tied to one *process*. Set this only for a project
         * that genuinely binds different elements on different hosts.
         */
        matchHost: z.boolean().optional(),
      })
      .strict(),
    data: z.object({ file: z.string().min(1) }).strict(),
    api: z.object({ dir: z.string().min(1) }).strict(),

    run: z
      .object({
        workers: z.number().int().positive(),
        browser: z.enum(["chromium", "firefox", "webkit"]).optional(),
        headless: z.boolean(),
        viewport: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
        stepTimeoutMs: z.number().int().positive(),
        candidateTimeoutMs: z.number().int().positive(),
        screenshots: z.enum(["onFailure", "always", "never"]),
        trace: z.boolean(),
        outputDir: z.string().min(1),
        checkpoints: z.boolean(),
        audit: z.boolean(),
      })
      .strict(),

    compile: z
      .object({
        tier2: z
          .object({
            provider: z.enum(["ollama", "llamacpp"]),
            endpoint: z.string().min(1),
            model: z.string().min(1),
            /** Pinned digest; a mismatch fails the compile without an override (REQ-COMP-3). */
            digest: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
        tier3: z
          .object({
            provider: z.literal("anthropic"),
            model: z.string().min(1),
            promptVersion: z.string().min(1),
          })
          .strict()
          .optional(),
        confidenceThreshold: z.number().min(0).max(1),
      })
      .strict(),

    record: z
      .object({
        model: z.string().min(1),
        maxSnapshotTokens: z.number().int().positive(),
        /** Screenshots are a configured fallback only, never the primary input (REQ-REC-2). */
        visionFallback: z.boolean(),
        /**
         * How long a grounding waits for a review before the session gives up
         * (LLD §13.5, Draft 2.7). Default ten minutes.
         *
         * A recording session blocks on `POST /record/{id}/decision`, which is
         * what makes "reviewed before anything is written" true (REQ-ADE-4).
         * The cost of that is a session holding a browser open forever when the
         * reviewer walks away or the client window is closed — and, because the
         * service allows one session at a time, holding the *next* one out with
         * a 409 nobody can clear.
         *
         * So a pending decision expires. The session stops and writes its
         * report, exactly as a stop would: nothing half-decided reaches the
         * store either way.
         */
        decisionDeadlineMs: z.number().int().positive().default(600_000),
      })
      .strict(),

    heal: z
      .object({
        /** Heal-on-fail marks the run `healed`, never `passed` (REQ-HEAL-4). */
        onFail: z.boolean(),
        relocalizeThreshold: z.number().min(0).max(1),
        margin: z.number().min(0).max(1),
        useModel: z.boolean(),
      })
      .strict(),

    tool: z
      .object({
        expose: z.array(z.string().min(1)),
        requireIdempotent: z.boolean(),
      })
      .strict()
      .optional(),

    mobile: z
      .object({
        appium: z.string().min(1),
        capabilities: z.record(z.string().min(1), z.unknown()),
      })
      .strict()
      .optional(),

    /** Price table the gateway reports cost from (REQ-NFR-2). */
    prices: z
      .record(
        z.string().min(1),
        z
          .object({
            in: z.number().nonnegative(),
            out: z.number().nonnegative(),
            cacheRead: z.number().nonnegative().optional(),
          })
          .strict(),
      )
      .optional(),

    macros: z.record(z.string().min(1), z.string()).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.environment === "production" && c.record.visionFallback && c.allowSideEffects !== true) {
      // Not an error, only a place the environment policy is visible in the schema;
      // the enforcing check lives in the recorder (REQ-AUTO-7, LLD §11).
      void ctx;
    }
  });
export type Config = z.infer<typeof configSchema>;

/** The default configuration `yam init` writes; also the base a partial config merges onto. */
export const DEFAULT_CONFIG: Omit<Config, "project"> = {
  schemaVersion: SCHEMA_VERSION,
  environment: "test",
  adapter: "playwright",
  app: {},
  flows: { dir: "flows" },
  steps: { dir: "steps" },
  bindings: {
    dir: "bindings",
    testIdAttributes: ["data-testid", "data-test", "data-qa"],
    ignoreAttributes: DEFAULT_IGNORE_ATTRIBUTES,
  },
  data: { file: "data.yaml" },
  api: { dir: "api" },
  run: {
    workers: 4,
    headless: true,
    stepTimeoutMs: 10_000,
    candidateTimeoutMs: 2_000,
    screenshots: "onFailure",
    trace: false,
    outputDir: "runs",
    checkpoints: true,
    audit: true,
  },
  compile: { confidenceThreshold: 0.8 },
  record: {
    model: "claude-opus-5",
    maxSnapshotTokens: 8_000,
    visionFallback: false,
    // Ten minutes (LLD §13.5): long enough to read a snapshot excerpt and a
    // candidate table, short enough that a forgotten window frees the service.
    decisionDeadlineMs: 600_000,
  },
  // Defaults from LLD §6.4.
  heal: { onFail: false, relocalizeThreshold: 0.72, margin: 0.1, useModel: false },
};
