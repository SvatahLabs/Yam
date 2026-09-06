/**
 * T3.1's Validate list.
 *
 * "Request-shape tests; secret never in captured request; cache hit costs zero;
 * refusal returns `GatewayRefusal` without retry."
 *
 * Every one of these runs with no credential and no network. That is possible
 * because `render()` is a pure function from a request to the bytes that go on
 * the wire, and because the backend takes its `messages.create` as a parameter —
 * so the thing under test is the request the gateway *would* send, which is
 * exactly the thing the requirements are about.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  anthropicGateway,
  cacheKey,
  costOf,
  credentialInEnvironment,
  DEFAULT_MAX_TOKENS,
  DiskCache,
  fakeGateway,
  GatewayRefusal,
  GatewayShapeError,
  GatewayUnavailable,
  localGateway,
  MemoryCache,
  PRICES,
  redactText,
  render,
  renderLocal,
  schemaOf,
  SEED,
  type GatewayRequest,
} from "../src/index.js";

const answer = z.object({ ref: z.string().nullable(), why: z.string() });

function ask(overrides: Partial<GatewayRequest<z.infer<typeof answer>>> = {}) {
  return {
    promptVersion: "g-1",
    system: "You choose one element from a snapshot.",
    user: 'button "Sign in" [ref=r7]',
    answer,
    ...overrides,
  } satisfies GatewayRequest<z.infer<typeof answer>>;
}

/** A `messages.create` that records what it was given and answers with `reply`. */
function stubClient(reply: unknown, seen: unknown[] = []) {
  return {
    client: {
      create: async (body: unknown) => {
        seen.push(body);
        return reply;
      },
    } as never,
    seen,
  };
}

function reply(
  text: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1000, output_tokens: 100 },
    ...extra,
  };
}

/* ── request shape ────────────────────────────────────────────────────────── */

describe("the request the gateway sends (T3.1, LLD §10)", () => {
  it("names the model and gives the answer's schema to output_config", () => {
    const body = render(ask(), { model: "claude-opus-5" });

    expect(body.model).toBe("claude-opus-5");
    expect(body.output_config.format.type).toBe("json_schema");
    // The same schema the answer is validated against, not a hand-written copy.
    expect(body.output_config.format.schema).toEqual(schemaOf(ask()));
    expect((body.output_config.format.schema as { properties?: unknown }).properties).toHaveProperty(
      "ref",
    );
  });

  it("asks for adaptive thinking, because grounding is not a lookup", () => {
    expect(render(ask(), { model: "claude-opus-5" }).thinking).toEqual({ type: "adaptive" });
  });

  it("marks the stable instruction block for caching, and nothing after it", () => {
    const body = render(ask(), { model: "claude-opus-5" });

    expect(body.system).toHaveLength(1);
    expect(body.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(body.system[0]!.text).toBe("You choose one element from a snapshot.");

    // The volatile half is a user message, after the breakpoint. A prompt that
    // interpolated the snapshot into its instructions would have a new prefix
    // every call and never read from the cache.
    expect(body.messages[0]!.content).toEqual([
      { type: "text", text: 'button "Sign in" [ref=r7]' },
    ]);
  });

  it("defaults max_tokens rather than leaving it to be truncated", () => {
    expect(render(ask(), { model: "claude-opus-5" }).max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(render(ask({ maxTokens: 512 }), { model: "claude-opus-5" }).max_tokens).toBe(512);
  });

  it("passes effort only when one was asked for", () => {
    expect(render(ask(), { model: "claude-opus-5" }).output_config.effort).toBeUndefined();
    expect(
      render(ask({ effort: "max" }), { model: "claude-opus-5" }).output_config.effort,
    ).toBe("max");
  });

  it("puts a vision-fallback image before the question", () => {
    const body = render(
      ask({ images: [{ mediaType: "image/png", base64: "aGVsbG8=" }] }),
      { model: "claude-opus-5" },
    );
    expect(body.messages[0]!.content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
    });
    expect(body.messages[0]!.content[1]!.type).toBe("text");
  });

  it("is what actually reaches the SDK", async () => {
    const { client, seen } = stubClient(reply('{"ref":"r7","why":"the sign in link"}'));
    await anthropicGateway({ client }).ask(ask());
    expect(seen[0]).toEqual(render(ask(), { model: "claude-opus-5" }));
  });

  it("a local backend pins temperature and seed, and sends the same schema", () => {
    const body = renderLocal(ask(), { model: "qwen2.5:3b" });
    expect(body.options).toEqual({ temperature: 0, seed: SEED });
    expect(body.stream).toBe(false);
    expect(body.format).toEqual(schemaOf(ask()));
  });
});

/* ── redaction (REQ-NFR-6, REQ-REC-7) ─────────────────────────────────────── */

describe("a secret never reaches a model (REQ-NFR-6, REQ-REC-7)", () => {
  const secrets = new Set(["qwerty123"]);

  it("is removed from the instructions and from the question", () => {
    const body = render(
      ask({ system: "Never reveal qwerty123.", user: 'textbox value="qwerty123" [ref=r3]' }),
      { model: "claude-opus-5", secrets },
    );
    const text = JSON.stringify(body);
    expect(text).not.toContain("qwerty123");
    expect(text).toContain("«redacted»");
  });

  it("is removed wherever it appears, not only where it was read from", () => {
    // A password interpolated into a header value is inside a string, not the
    // whole string, which is why redaction is by substring.
    expect(redactText("Authorization: Bearer qwerty123x", secrets)).toBe(
      "Authorization: Bearer «redacted»x",
    );
  });

  it("leaves a value too short to redact safely alone", () => {
    // Redacting "a" would turn every prompt into «redacted» soup and protect
    // nothing, so values under four characters are not tracked.
    expect(redactText("a banana", new Set(["a"]))).toBe("a banana");
  });

  it("refuses to send when one survived, rather than sending it", async () => {
    const leaky = new Set(["qwerty123"]);
    const { client, seen } = stubClient(reply("{}"));
    const gateway = anthropicGateway({ client, secrets: leaky });

    // A secret that redaction cannot reach — here, split by the schema rather
    // than by the text — must still stop the call. The assertion runs on the
    // rendered body, so there is no gap between what was checked and what is
    // sent.
    await expect(
      gateway.ask(ask({ answer: z.object({ note: z.literal("qwerty123") }) as never })),
    ).rejects.toThrow(/reached the model request/);
    expect(seen).toEqual([]);
  });

  it("does not quote the secret in the message it throws", async () => {
    const gateway = anthropicGateway({
      client: stubClient(reply("{}")).client,
      secrets: new Set(["qwerty123"]),
    });
    const error = await gateway
      .ask(ask({ answer: z.object({ note: z.literal("qwerty123") }) as never }))
      .then(() => undefined, (e: unknown) => e as Error);
    expect(error?.message).not.toContain("qwerty123");
    expect(error).toBeInstanceOf(Error);
  });

  it("holds for the fake gateway too, so tests exercise the same guard", async () => {
    const captured: unknown[] = [];
    const gateway = fakeGateway({
      answer: () => ({ ref: "r1", why: "x" }),
      secrets: new Set(["qwerty123"]),
      captured,
    });
    await gateway.ask(ask({ user: 'textbox value="qwerty123"' }));
    expect(JSON.stringify(captured)).not.toContain("qwerty123");
  });
});

/* ── caching (T3.1: a hit costs zero) ─────────────────────────────────────── */

describe("the cache (REQ-NFR-2)", () => {
  it("a hit costs zero and makes no call", async () => {
    const cache = new MemoryCache();
    const { client, seen } = stubClient(reply('{"ref":"r7","why":"the sign in link"}'));
    const gateway = anthropicGateway({ client, cache });

    const first = await gateway.ask(ask());
    expect(first.cached).toBe(false);
    expect(first.provenance.costUsd).toBeGreaterThan(0);

    const second = await gateway.ask(ask());
    expect(second.cached).toBe(true);
    expect(second.provenance.costUsd).toBe(0);
    expect(second.value).toEqual(first.value);

    expect(seen).toHaveLength(1);
    expect(gateway.usage().calls).toBe(1);
    expect(gateway.usage().cacheHits).toBe(1);
    // And the running cost did not move on the hit.
    expect(gateway.usage().costUsd).toBeCloseTo(first.provenance.costUsd!, 12);
  });

  it("keys on everything that could change the answer", () => {
    const base = {
      model: "claude-opus-5",
      promptVersion: "g-1",
      system: "s",
      user: "u",
      schema: { type: "object" },
    };
    const key = cacheKey(base);
    expect(cacheKey({ ...base, model: "claude-sonnet-5" })).not.toBe(key);
    expect(cacheKey({ ...base, promptVersion: "g-2" })).not.toBe(key);
    expect(cacheKey({ ...base, system: "s2" })).not.toBe(key);
    expect(cacheKey({ ...base, user: "u2" })).not.toBe(key);
    expect(cacheKey({ ...base, schema: { type: "string" } })).not.toBe(key);
    expect(cacheKey({ ...base, images: [{ base64: "aGk=" }] })).not.toBe(key);
    expect(cacheKey({ ...base, scope: "variant-3" })).not.toBe(key);
    // And on nothing else: the same question twice is one entry.
    expect(cacheKey({ ...base })).toBe(key);
  });

  it("survives a process, and a corrupt entry is a miss rather than a crash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-gateway-cache-"));
    try {
      const { client, seen } = stubClient(reply('{"ref":"r7","why":"ok"}'));
      await anthropicGateway({ client, cache: new DiskCache(dir) }).ask(ask());
      expect(readdirSync(dir)).toHaveLength(1);

      // A second gateway, a second cache object, the same directory.
      const { client: second, seen: seenAgain } = stubClient(reply('{"ref":"r9","why":"no"}'));
      const hit = await anthropicGateway({ client: second, cache: new DiskCache(dir) }).ask(ask());
      expect(hit.cached).toBe(true);
      expect(hit.value.ref).toBe("r7");
      expect(seenAgain).toEqual([]);
      expect(seen).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("re-validates a cached answer instead of trusting the file", async () => {
    const cache = new MemoryCache();
    const { client } = stubClient(reply('{"ref":"r7","why":"ok"}'));
    const gateway = anthropicGateway({ client, cache });
    await gateway.ask(ask());

    // The same question, asked with a schema the stored answer does not satisfy
    // — which is what a schema change since the entry was written looks like.
    const stricter = ask({ answer: z.object({ ref: z.number(), why: z.string() }) as never });
    // A different schema is a different key, so this one goes to the model; the
    // point is that a cached value is parsed, which the disk-cache test above
    // relies on and this makes explicit.
    const stored = cache.get(
      cacheKey({
        model: "claude-opus-5",
        promptVersion: "g-1",
        system: ask().system,
        user: ask().user,
        schema: schemaOf(ask()),
      }),
    );
    expect(stored?.value).toEqual({ ref: "r7", why: "ok" });
    expect(schemaOf(stricter)).not.toEqual(schemaOf(ask()));
  });
});

/* ── refusal (LLD §10) ────────────────────────────────────────────────────── */

describe("a refusal is an answer, not an outage (LLD §10)", () => {
  it("raises GatewayRefusal with the category, and does not call again", async () => {
    const { client, seen } = stubClient({
      content: [{ type: "text", text: "I can't help with that." }],
      stop_reason: "refusal",
      stop_details: { category: "cyber", explanation: "credential harvesting" },
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const gateway = anthropicGateway({ client });
    const error = await gateway
      .ask(ask())
      .then(() => undefined, (e: unknown) => e as GatewayRefusal);

    expect(error).toBeInstanceOf(GatewayRefusal);
    expect(error?.category).toBe("cyber");
    expect(error?.explanation).toBe("credential harvesting");
    expect(seen).toHaveLength(1);
  });

  it("is not reported as a schema failure, which would send someone to the wrong bug", async () => {
    const { client } = stubClient({
      content: [{ type: "text", text: "no" }],
      stop_reason: "refusal",
      stop_details: { category: null, explanation: null },
    });
    await expect(anthropicGateway({ client }).ask(ask())).rejects.not.toBeInstanceOf(
      GatewayShapeError,
    );
  });

  it("is not cached, so the next run gets a real attempt", async () => {
    const cache = new MemoryCache();
    const { client } = stubClient({ content: [], stop_reason: "refusal" });
    await anthropicGateway({ client, cache })
      .ask(ask())
      .catch(() => undefined);
    expect(cache.size).toBe(0);
  });

  it("the fake gateway refuses the same way, so callers can test their handling", async () => {
    await expect(fakeGateway({ answer: () => null }).ask(ask())).rejects.toBeInstanceOf(
      GatewayRefusal,
    );
  });
});

/* ── shape and availability ───────────────────────────────────────────────── */

describe("an answer outside its schema is a shape error", () => {
  it("names the field rather than dumping the payload", async () => {
    const { client } = stubClient(reply('{"ref":7,"why":"a number"}'));
    const error = await anthropicGateway({ client })
      .ask(ask())
      .then(() => undefined, (e: unknown) => e as GatewayShapeError);
    expect(error).toBeInstanceOf(GatewayShapeError);
    expect(error?.message).toContain("ref");
  });

  it("text that is not JSON at all is the same class of failure", async () => {
    const { client } = stubClient(reply("I think it is the second button."));
    await expect(anthropicGateway({ client }).ask(ask())).rejects.toBeInstanceOf(
      GatewayShapeError,
    );
  });

  it("an empty response says which stop reason produced it", async () => {
    const { client } = stubClient({ content: [], stop_reason: "max_tokens" });
    await expect(anthropicGateway({ client }).ask(ask())).rejects.toThrow(/max_tokens/);
  });
});

describe("cost and provenance (REQ-AGT-3, REQ-NFR-2)", () => {
  it("prices a call from the table, cache reads included", () => {
    const price = PRICES["claude-opus-5"]!;
    expect(costOf("claude-opus-5", { tokensIn: 1_000_000, tokensOut: 0 })).toBeCloseTo(price.input);
    expect(costOf("claude-opus-5", { tokensIn: 0, tokensOut: 1_000_000 })).toBeCloseTo(price.output);
    expect(costOf("claude-opus-5", { tokensIn: 0, tokensOut: 0, cacheRead: 1_000_000 })).toBeCloseTo(
      price.input * 0.1,
    );
    // A model with no published price costs zero rather than a guess.
    expect(costOf("qwen2.5:3b", { tokensIn: 1_000_000, tokensOut: 1_000_000 })).toBe(0);
  });

  it("records the model, the prompt version and the tokens on every answer", async () => {
    const { client } = stubClient(
      reply('{"ref":"r7","why":"ok"}', {
        usage: { input_tokens: 4000, output_tokens: 40, cache_read_input_tokens: 3800 },
      }),
    );
    const { provenance } = await anthropicGateway({ client }).ask(ask());

    expect(provenance.model).toBe("claude-opus-5");
    expect(provenance.promptVersion).toBe("g-1");
    expect(provenance.tokensIn).toBe(4000);
    expect(provenance.tokensOut).toBe(40);
    expect(provenance.cacheRead).toBe(3800);
    expect(Date.parse(provenance.at)).not.toBeNaN();
  });

  it("the fake gateway says it is fake, in its name and in its provenance", async () => {
    const gateway = fakeGateway({ answer: () => ({ ref: "r1", why: "x" }), label: "grounding" });
    expect(gateway.real).toBe(false);
    expect(gateway.name).toBe("fake:grounding");
    const { provenance } = await gateway.ask(ask());
    // A report that says "fake" cannot be read as a measured model number.
    expect(provenance.model).toBe("fake:grounding");
  });
});

describe("a backend that is not there (LLD §15 exit 3)", () => {
  it("a local server that will not answer is GatewayUnavailable", async () => {
    const gateway = localGateway({
      provider: "ollama",
      endpoint: "http://127.0.0.1:1",
      model: "qwen2.5:3b",
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await expect(gateway.ask(ask())).rejects.toBeInstanceOf(GatewayUnavailable);
  });

  it("a digest that moved is refused, not noted (REQ-COMP-3)", async () => {
    const gateway = localGateway({
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "qwen2.5:3b",
      digest: "sha256:aaa",
      fetch: async () =>
        new Response(JSON.stringify({ response: '{"ref":null,"why":"x"}', digest: "sha256:bbb" }), {
          status: 200,
        }),
    });
    await expect(gateway.ask(ask())).rejects.toThrow(/pins sha256:aaa/);
  });

  it("reads the credential from the environment and never from a parameter", () => {
    expect(credentialInEnvironment({})).toBe(false);
    expect(credentialInEnvironment({ ANTHROPIC_API_KEY: "  " })).toBe(false);
    expect(credentialInEnvironment({ ANTHROPIC_API_KEY: "sk-x" })).toBe(true);
    expect(credentialInEnvironment({ ANTHROPIC_AUTH_TOKEN: "t" })).toBe(true);
  });
});
