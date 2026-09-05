import { z } from "zod";
import { SCHEMA_VERSION } from "./version.js";

/** Project configuration, `svatah.config.yaml` (LLD §3.5). */

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

/** The default configuration `svatah init` writes; also the base a partial config merges onto. */
export const DEFAULT_CONFIG: Omit<Config, "project"> = {
  schemaVersion: SCHEMA_VERSION,
  environment: "test",
  adapter: "playwright",
  app: {},
  flows: { dir: "flows" },
  steps: { dir: "steps" },
  bindings: { dir: "bindings", testIdAttributes: ["data-testid", "data-test", "data-qa"] },
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
  record: { model: "claude-opus-5", maxSnapshotTokens: 8_000, visionFallback: false },
  // Defaults from LLD §6.4.
  heal: { onFail: false, relocalizeThreshold: 0.72, margin: 0.1, useModel: false },
};
