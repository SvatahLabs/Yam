/**
 * @svatah/gateway
 *
 * The only place in the workspace that talks to a model (T3.1, LLD §10).
 *
 * Everything above it — the recorder, the healer's `Regrounder`, the compiler's
 * upper tiers, the evals — asks a question with a Zod shape and receives an
 * answer of that shape plus its provenance. Everything below the behaviour layer
 * cannot import it at all (LLD §1), which is what makes REQ-RUN-1, "the executor
 * makes no model calls", a build-time fact.
 *
 * ```ts
 * const gateway = anthropicGateway({ cache: new DiskCache(".svatah/model-cache") });
 * const { value, provenance } = await gateway.ask({
 *   promptVersion: "g-1",
 *   system: INSTRUCTIONS,          // stable, cached
 *   user: snapshotText,            // volatile
 *   answer: z.object({ ref: z.string().nullable() }),
 * });
 * ```
 */
export {
  emptyUsage,
  GatewayRefusal,
  GatewayShapeError,
  GatewayUnavailable,
  type Effort,
  type Gateway,
  type GatewayAnswer,
  type GatewayImage,
  type GatewayRequest,
  type GatewayUsage,
} from "./types.js";

export {
  anthropicGateway,
  credentialInEnvironment,
  DEFAULT_MODEL,
  type AnthropicGatewayOptions,
} from "./anthropic.js";

export {
  localGateway,
  renderLocal,
  SEED,
  type LocalGatewayOptions,
  type LocalProvider,
  type LocalRequestBody,
} from "./local.js";

export { fakeGateway, type FakeGatewayOptions } from "./fake.js";

export {
  assertNoSecret,
  DEFAULT_MAX_TOKENS,
  redactText,
  REDACTED,
  render,
  schemaOf,
  type RenderedRequest,
  type RenderOptions,
} from "./render.js";

export {
  cacheKey,
  DiskCache,
  MemoryCache,
  NO_CACHE,
  type CacheEntry,
  type CacheKeyParts,
  type GatewayCache,
} from "./cache.js";

export { costOf, formatUsd, priced, PRICES, type Prices, type TokenCounts } from "./cost.js";
