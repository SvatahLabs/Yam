/**
 * The request that goes on the wire, with every secret removed (T3.1, REQ-NFR-6,
 * REQ-REC-7).
 *
 * `render()` is a pure function from a `GatewayRequest` to the exact body the
 * Anthropic backend sends. That is deliberate and load-bearing: "secrets never
 * appear in … prompts" is a claim about the bytes on the wire, and the only way
 * to *test* it is for those bytes to exist without a network call. So the
 * backend does nothing but hand this to the SDK, and the tests assert on this.
 *
 * ## The three shapes the body is built for
 *
 * **A stable prefix.** `system` is one cached block. Caching is a prefix match
 * (`shared/prompt-caching.md`), so anything that changes per call — the snapshot,
 * the step — must come *after* the last breakpoint, which is why the request
 * separates `system` from `user` at the type level rather than by convention.
 *
 * **A schema, not a plea for JSON.** `output_config.format` constrains the model to
 * the answer's JSON Schema, generated from the same Zod type the answer is later
 * validated against. Asking for JSON in prose and parsing hopefully is how a
 * recorder ends up with a binding whose `by` is `"csss"`.
 *
 * **Adaptive thinking.** `thinking: { type: "adaptive" }` on Claude Opus 5:
 * grounding an element in a 4,000-token accessibility tree is exactly the kind of
 * work that repays it, and the depth is the model's to choose per call.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import type { GatewayRequest } from "./types.js";

/** The default ceiling. Grounding answers are small; thinking is not billed against it. */
export const DEFAULT_MAX_TOKENS = 4_096;

/** The body `client.messages.create` is called with. */
export interface RenderedRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly system: ReadonlyArray<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }>;
  readonly messages: ReadonlyArray<{
    role: "user";
    content: ReadonlyArray<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    >;
  }>;
  readonly thinking: { type: "adaptive" };
  readonly output_config: {
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
    format: { type: "json_schema"; schema: Record<string, unknown> };
  };
}

export interface RenderOptions {
  readonly model: string;
  /**
   * Values that must never reach a model.
   *
   * By value rather than by name (REQ-NFR-6): a password read from `data.yaml`,
   * captured, and interpolated into a sentence is the same string throughout, and
   * redacting only the path it came from would miss every later copy.
   */
  readonly secrets?: ReadonlySet<string>;
}

/** The marker a redacted secret leaves behind. Matches the runtime's. */
export const REDACTED = "«redacted»";

/**
 * Replace every secret occurrence in a string.
 *
 * Substring replacement, because a secret is often *inside* a value rather than
 * being one — `Bearer sk-…`, or a snapshot node whose `value` is the password
 * that was just typed into it. Values under four characters are ignored: a
 * one-character secret would redact every occurrence of that character and
 * destroy the prompt without protecting anything.
 */
export function redactText(text: string, secrets: ReadonlySet<string> | undefined): string {
  if (secrets === undefined || secrets.size === 0) return text;
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  return out;
}

/**
 * Throw if a secret survived.
 *
 * The belt to `redactText`'s braces. Redaction is a transformation and can be
 * bypassed by a code path that forgets to call it; this is the assertion that a
 * *sent* request is clean, and it runs on the rendered body rather than on its
 * inputs, so there is no gap between what was checked and what is sent.
 */
export function assertNoSecret(
  body: unknown,
  secrets: ReadonlySet<string> | undefined,
  where: string,
): void {
  if (secrets === undefined || secrets.size === 0) return;
  const text = JSON.stringify(body);
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    if (text.includes(secret)) {
      // Deliberately not naming the value: a message that quotes the secret to
      // complain about the secret has leaked it into the logs instead.
      throw new Error(
        `${where}: a value declared secret reached the model request (REQ-NFR-6). ` +
          "Nothing was sent.",
      );
    }
  }
}

/** The JSON Schema the model is constrained to. */
export function schemaOf<T>(request: GatewayRequest<T>): Record<string, unknown> {
  return zodToJsonSchema(request.answer, {
    target: "jsonSchema7",
    $refStrategy: "none",
    errorMessages: false,
  }) as Record<string, unknown>;
}

export function render<T>(request: GatewayRequest<T>, options: RenderOptions): RenderedRequest {
  const secrets = options.secrets;

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  > = [];

  // Images first: a question about a picture reads better after the picture, and
  // it is the ordering the vision documentation uses.
  for (const image of request.images ?? []) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.base64 },
    });
  }
  content.push({ type: "text", text: redactText(request.user, secrets) });

  const body: RenderedRequest = {
    model: options.model,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: [
      {
        type: "text",
        text: redactText(request.system, secrets),
        // The one breakpoint. Everything before it is identical from call to
        // call; everything after it is this step.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content }],
    thinking: { type: "adaptive" },
    output_config: {
      ...(request.effort === undefined ? {} : { effort: request.effort }),
      format: { type: "json_schema", schema: schemaOf(request) },
    },
  };

  assertNoSecret(body, secrets, `prompt ${request.promptVersion}`);
  return body;
}
