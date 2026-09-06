/**
 * The local backend (T3.1, REQ-COMP-3, REQ-NFR-3).
 *
 * A small instruct model served by Ollama or llama.cpp, on the machine. It exists
 * for privacy mode — "Tier 2 local so no step text leaves the machine during
 * compile" — and as the Tier 2 interface Phase 4 fills in (T4.3).
 *
 * Two things make it a *deterministic* backend rather than merely a cheap one:
 * temperature 0 with a fixed seed, and a pinned digest recorded in provenance
 * (REQ-COMP-3). A local model that silently updated underneath a project would
 * make last month's plan unreproducible, so a configured digest that does not
 * match what the server reports is refused rather than noted.
 *
 * Ollama and llama.cpp are HTTP servers on localhost, not the Anthropic API, so
 * they are called with `fetch` — the rule against raw HTTP is about calling
 * Anthropic without its SDK, and there is no SDK for a local server.
 */
import { provenanceSchema, type Provenance } from "@svatah/yam-schema";
import { cacheKey, NO_CACHE, type GatewayCache } from "./cache.js";
import { redactText, schemaOf } from "./render.js";
import {
  emptyUsage,
  GatewayShapeError,
  GatewayUnavailable,
  type Gateway,
  type GatewayAnswer,
  type GatewayRequest,
  type GatewayUsage,
} from "./types.js";

export type LocalProvider = "ollama" | "llamacpp";

export interface LocalGatewayOptions {
  readonly provider: LocalProvider;
  /** `http://127.0.0.1:11434` for Ollama, `http://127.0.0.1:8080` for llama.cpp. */
  readonly endpoint: string;
  readonly model: string;
  /** Pinned digest; a mismatch fails rather than proceeds (REQ-COMP-3). */
  readonly digest?: string;
  /**
   * `--allow-model-drift`: compile against weights that are not the pinned ones.
   *
   * The check is suppressed, not the *recording*: the digest the server actually
   * serves still goes into provenance, so a plan compiled this way says which
   * weights produced it and a reader can see that they were not the pinned ones.
   * A flag that made provenance stop saying so would be a flag that hid the
   * thing it exists to permit.
   */
  readonly allowDigestDrift?: boolean;
  readonly cache?: GatewayCache;
  readonly secrets?: ReadonlySet<string>;
  /** Injected in tests, so the request shape is checkable without a server. */
  readonly fetch?: typeof globalThis.fetch;
  readonly onCall?: (line: string) => void;
}

/** The body sent to a local server, for the same reason `render()` exists. */
export interface LocalRequestBody {
  readonly model: string;
  readonly prompt: string;
  readonly system: string;
  readonly format: Record<string, unknown>;
  readonly stream: false;
  readonly options: { readonly temperature: 0; readonly seed: number };
}

/** A fixed seed, so two compiles of one project agree (REQ-COMP-3, REQ-COMP-7). */
export const SEED = 7;

export function renderLocal<T>(
  request: GatewayRequest<T>,
  options: { model: string; secrets?: ReadonlySet<string> },
): LocalRequestBody {
  return {
    model: options.model,
    system: redactText(request.system, options.secrets),
    prompt: redactText(request.user, options.secrets),
    // Ollama's `format` takes a JSON Schema and constrains generation to it,
    // which is the same guarantee `output_config.format` gives on the API.
    format: schemaOf(request),
    stream: false,
    options: { temperature: 0, seed: SEED },
  };
}

/**
 * The digest of the weights a server is actually serving (REQ-COMP-3).
 *
 * Ollama's `/api/generate` does **not** report one — only `/api/tags` does — so a
 * pin checked against the generation response would be a pin that never fired.
 * That is the whole point of the check, so it is resolved separately, once per
 * session, and compared before the first call.
 *
 * llama.cpp has no equivalent: it serves a GGUF file and reports the path, not a
 * content digest. A project on llama.cpp therefore cannot pin, and saying so is
 * better than pretending to.
 */
export async function resolveDigest(
  provider: LocalProvider,
  endpoint: string,
  model: string,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<string | undefined> {
  const base = endpoint.replace(/\/+$/, "");
  if (provider !== "ollama") return undefined;
  try {
    const response = await doFetch(`${base}/api/tags`);
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { models?: Array<{ name?: string; digest?: string }> };
    const found = (payload.models ?? []).find(
      (one) => one.name === model || one.name === `${model}:latest`,
    );
    return found?.digest;
  } catch {
    // A server that will not answer `/api/tags` is a server the next call will
    // fail against anyway, with a message about the thing the caller asked for.
    return undefined;
  }
}

export function localGateway(options: LocalGatewayOptions): Gateway {
  const cache = options.cache ?? NO_CACHE;
  const totals: GatewayUsage = emptyUsage();
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = options.endpoint.replace(/\/+$/, "");
  /** Resolved once and reused: the weights do not change mid-compile. */
  let served: string | undefined | null = null;

  return {
    name: `local:${options.provider}`,
    model: options.model,
    real: true,
    usage: () => ({ ...totals }),

    async ask<T>(request: GatewayRequest<T>): Promise<GatewayAnswer<T>> {
      const key = cacheKey({
        model: `${options.model}@${options.digest ?? "unpinned"}`,
        promptVersion: request.promptVersion,
        system: request.system,
        user: request.user,
        schema: schemaOf(request),
        ...(request.cacheScope === undefined ? {} : { scope: request.cacheScope }),
      });

      /*
       * The pin, before anything else (REQ-COMP-3).
       *
       * Checked ahead of the cache deliberately: a cached answer carries the
       * digest it was produced under, and returning it from a server that has
       * since pulled different weights would make the provenance true of the
       * cache and false of the machine.
       */
      if (served === null) {
        served = await resolveDigest(options.provider, base, options.model, doFetch);
      }
      if (options.digest !== undefined && served !== undefined && served !== options.digest) {
        const drift =
          `${options.model} on ${base} reports digest ${served}, and the project pins ` +
          `${options.digest}. Update the pin deliberately, or pull the pinned build.`;
        if (options.allowDigestDrift !== true) throw new GatewayUnavailable(drift);
        options.onCall?.(`compiling against unpinned weights: ${drift}`);
      }

      const hit = cache.get(key);
      if (hit !== undefined) {
        totals.cacheHits += 1;
        return { value: parse(request, hit.value), provenance: hit.provenance, cached: true };
      }

      const body = renderLocal(request, {
        model: options.model,
        ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
      });

      let response: Response;
      try {
        response = await doFetch(`${base}/api/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (cause) {
        throw new GatewayUnavailable(
          `Could not reach the ${options.provider} server at ${base}.`,
          { cause },
        );
      }

      if (!response.ok) {
        throw new GatewayUnavailable(
          `${options.provider} at ${base} answered ${response.status}.`,
        );
      }

      const payload = (await response.json()) as {
        response?: string;
        model?: string;
        digest?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };

      /*
       * A digest that moved is a refusal, not a warning (REQ-COMP-3).
       *
       * The pin is the whole reason a local tier can appear in provenance: it
       * says *which* weights produced a step. A server that has pulled a new
       * build of the same tag is a different model wearing the same name, and
       * accepting it would make the provenance a lie.
       */
      if (
        options.digest !== undefined &&
        options.allowDigestDrift !== true &&
        payload.digest !== undefined &&
        payload.digest !== options.digest
      ) {
        throw new GatewayUnavailable(
          `${options.model} on ${base} reports digest ${payload.digest}, and the project pins ` +
            `${options.digest}. Update the pin deliberately, or pull the pinned build.`,
        );
      }

      const tokensIn = payload.prompt_eval_count ?? 0;
      const tokensOut = payload.eval_count ?? 0;
      totals.calls += 1;
      totals.tokensIn += tokensIn;
      totals.tokensOut += tokensOut;

      /*
       * The digest goes in provenance whether or not the project pinned one
       * (REQ-AGT-3): provenance says *which weights produced this*, and a
       * project that has not pinned yet still deserves an answer it can pin to.
       */
      // What the *server* serves wins over what the project pinned: under
      // `--allow-model-drift` those differ, and provenance must say which
      // weights actually produced the step.
      const digest = payload.digest ?? served ?? options.digest ?? undefined;
      const provenance: Provenance = provenanceSchema.parse({
        model: options.model,
        ...(digest === undefined ? {} : { digest }),
        promptVersion: request.promptVersion,
        at: new Date().toISOString(),
        tokensIn,
        tokensOut,
        // A model on this machine has no per-token price. Zero is the true
        // marginal cost, not a missing number.
        costUsd: 0,
      });

      const value = parse(request, payload.response ?? "");
      cache.put(key, { value, provenance });
      options.onCall?.(`${request.promptVersion}: ${tokensIn} in, ${tokensOut} out, local`);

      return { value, provenance, cached: false };
    },
  };
}

function parse<T>(request: GatewayRequest<T>, raw: unknown): T {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new GatewayShapeError(
        `Prompt ${request.promptVersion} answered with something that is not JSON.`,
        raw,
      );
    }
  }
  const parsed = request.answer.safeParse(value);
  if (!parsed.success) {
    throw new GatewayShapeError(
      `Prompt ${request.promptVersion} answered outside its schema: ` +
        parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
          .join("; "),
      typeof raw === "string" ? raw : JSON.stringify(raw),
    );
  }
  return parsed.data;
}
