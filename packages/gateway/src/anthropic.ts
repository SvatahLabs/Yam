/**
 * The frontier backend (T3.1, LLD §10, REQ-COMP-4, REQ-AGT-3, REQ-NFR-2).
 *
 * Claude Opus 5 through the official SDK. Everything about the request is in
 * `render()`, which is a pure function; this file is what surrounds a call —
 * the cache, the refusal, the accounting, and turning a validated answer into
 * provenance.
 *
 * ## Credentials
 *
 * Never a parameter with a default read from a file. The SDK resolves
 * `ANTHROPIC_API_KEY`, then `ANTHROPIC_AUTH_TOKEN`, then an `ant auth login`
 * profile, so a zero-argument client is both the simplest and the only correct
 * thing to construct: a key that this code could name is a key this code could
 * write somewhere, and REQ-NFR-6 says it never does.
 *
 * `available()` is how a caller finds out whether any of those resolved, before
 * building anything that assumes one.
 *
 * ## Refusal is not an error to retry
 *
 * `stop_reason: "refusal"` means the model understood and declined. LLD §10
 * calls that a tier failure: it raises `GatewayRefusal` immediately, with the
 * category the API gave, and the SDK's retry logic never sees it because it is
 * a 200. Retrying would spend money to be told no again.
 */
import Anthropic from "@anthropic-ai/sdk";
import { provenanceSchema, type Provenance } from "@svatah/schema";
import { costOf } from "./cost.js";
import {
  cacheKey,
  NO_CACHE,
  type GatewayCache,
} from "./cache.js";
import { render, schemaOf } from "./render.js";
import {
  emptyUsage,
  GatewayRefusal,
  GatewayShapeError,
  GatewayUnavailable,
  type Gateway,
  type GatewayAnswer,
  type GatewayRequest,
  type GatewayUsage,
} from "./types.js";

export const DEFAULT_MODEL = "claude-opus-5";

export interface AnthropicGatewayOptions {
  /** Defaults to `claude-opus-5`, the model `config.record.model` names. */
  readonly model?: string;
  readonly cache?: GatewayCache;
  /** Values that must never reach the model (REQ-REC-7, REQ-NFR-6). */
  readonly secrets?: ReadonlySet<string>;
  /** Injected in tests. Production passes nothing and the SDK resolves credentials. */
  readonly client?: Pick<Anthropic["messages"], "create">;
  readonly onCall?: (line: string) => void;
}

/**
 * Whether a credential is resolvable without asking for one.
 *
 * An unset `ANTHROPIC_API_KEY` does not mean there is none: `ANTHROPIC_AUTH_TOKEN`
 * and an `ant auth login` profile both work, and the SDK finds them. This checks
 * the two environment variables — which is all a process can know cheaply — and a
 * caller that gets `false` should still be able to try, which is why nothing here
 * refuses on it.
 */
export function credentialInEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    (env["ANTHROPIC_API_KEY"] ?? "").trim() !== "" ||
    (env["ANTHROPIC_AUTH_TOKEN"] ?? "").trim() !== ""
  );
}

interface ApiUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

interface ApiMessage {
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  usage?: ApiUsage;
}

export function anthropicGateway(options: AnthropicGatewayOptions = {}): Gateway {
  const model = options.model ?? DEFAULT_MODEL;
  const cache = options.cache ?? NO_CACHE;
  const totals: GatewayUsage = emptyUsage();

  let messages: Pick<Anthropic["messages"], "create"> | undefined = options.client;
  const client = (): Pick<Anthropic["messages"], "create"> => {
    if (messages === undefined) {
      try {
        messages = new Anthropic().messages;
      } catch (cause) {
        throw new GatewayUnavailable(
          "No Anthropic credential is available. Set ANTHROPIC_API_KEY or run `ant auth login`.",
          { cause },
        );
      }
    }
    return messages;
  };

  return {
    name: "anthropic",
    model,
    real: true,
    usage: () => ({ ...totals }),

    async ask<T>(request: GatewayRequest<T>): Promise<GatewayAnswer<T>> {
      const key = cacheKey({
        model,
        promptVersion: request.promptVersion,
        system: request.system,
        user: request.user,
        schema: schemaOf(request),
        ...(request.images === undefined ? {} : { images: request.images }),
        ...(request.cacheScope === undefined ? {} : { scope: request.cacheScope }),
      });

      const hit = cache.get(key);
      if (hit !== undefined) {
        totals.cacheHits += 1;
        options.onCall?.(`${request.promptVersion}: cache hit, $0.0000`);
        return {
          // Re-validated rather than trusted: a cache file is a file, and a
          // schema change since it was written must not become a bad answer.
          value: parseAnswer(request, hit.value),
          provenance: { ...hit.provenance, costUsd: 0 },
          cached: true,
        };
      }

      const body = render(request, {
        model,
        ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
      });

      let response: ApiMessage;
      try {
        response = (await client().create(body as never)) as unknown as ApiMessage;
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError) {
          throw new GatewayUnavailable(
            "The Anthropic credential was rejected. Check ANTHROPIC_API_KEY or `ant auth status`.",
            { cause: error },
          );
        }
        if (error instanceof Anthropic.APIConnectionError) {
          throw new GatewayUnavailable("Could not reach the Anthropic API.", { cause: error });
        }
        throw error;
      }

      /*
       * The refusal, before the content (LLD §10).
       *
       * A refused response is a 200 whose `content` may hold an explanation
       * rather than an answer. Reading it first and validating afterwards would
       * report a schema failure for a request that was declined, which sends
       * whoever reads the report looking for a bug in the prompt.
       */
      if (response.stop_reason === "refusal") {
        throw new GatewayRefusal(
          `The model declined prompt ${request.promptVersion}` +
            (response.stop_details?.category == null
              ? "."
              : ` (${response.stop_details.category}).`),
          response.stop_details ?? undefined,
        );
      }

      const usage = response.usage ?? {};
      const tokensIn = usage.input_tokens ?? 0;
      const tokensOut = usage.output_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      const cacheWrite = usage.cache_creation_input_tokens ?? 0;
      const costUsd = costOf(model, { tokensIn, tokensOut, cacheRead, cacheWrite });

      totals.calls += 1;
      totals.tokensIn += tokensIn;
      totals.tokensOut += tokensOut;
      totals.cacheRead += cacheRead;
      totals.costUsd += costUsd;

      const provenance: Provenance = provenanceSchema.parse({
        model,
        promptVersion: request.promptVersion,
        at: new Date().toISOString(),
        tokensIn,
        tokensOut,
        ...(cacheRead === 0 ? {} : { cacheRead }),
        costUsd,
      });

      const value = parseAnswer(request, textOf(response, request.promptVersion));
      cache.put(key, { value, provenance });

      options.onCall?.(
        `${request.promptVersion}: ${tokensIn} in, ${tokensOut} out, ` +
          `${cacheRead} cached, $${costUsd.toFixed(4)}`,
      );

      return { value, provenance, cached: false };
    },
  };
}

/** The single text block a structured-output response carries. */
function textOf(response: ApiMessage, promptVersion: string): string {
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
  if (text.trim() === "") {
    throw new GatewayShapeError(
      `Prompt ${promptVersion} came back with no text to parse ` +
        `(stop_reason ${response.stop_reason ?? "unknown"}).`,
      "",
    );
  }
  return text;
}

/**
 * Validate against the same Zod type the JSON Schema came from.
 *
 * Structured outputs constrain the model, and this checks the constraint held.
 * The two are not the same guarantee: a schema round-trip can lose a refinement
 * a Zod type expresses, and a cached answer predates any schema change made
 * since. Whatever a caller receives has been through the type it asked for.
 */
function parseAnswer<T>(request: GatewayRequest<T>, raw: unknown): T {
  const value = typeof raw === "string" ? tryJson(raw, request.promptVersion) : raw;
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

function tryJson(text: string, promptVersion: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new GatewayShapeError(
      `Prompt ${promptVersion} answered with something that is not JSON.`,
      text,
    );
    void cause;
  }
}
