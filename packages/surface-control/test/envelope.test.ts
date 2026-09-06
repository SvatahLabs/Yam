import { describe, it, expect } from "vitest";
import { makeRequestId, successEnvelope, failedEnvelope, refusedEnvelope } from "../src/envelope.js";
import { resultEnvelopeSchema } from "../src/catalogue.js";

describe("makeRequestId", () => {
  it("returns req_ prefixed id", () => {
    expect(makeRequestId()).toMatch(/^req_[a-f0-9]{12}$/);
  });

  it("returns unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, makeRequestId));
    expect(ids.size).toBe(100);
  });
});

describe("successEnvelope", () => {
  it("builds a valid envelope", () => {
    const env = successEnvelope("req_abc", "s_123", { foo: 1 }, 42);
    expect(env.status).toBe("succeeded");
    expect(env.sessionId).toBe("s_123");
    expect(env.result).toEqual({ foo: 1 });
    expect(env.timing?.totalMs).toBe(42);
    expect(resultEnvelopeSchema.safeParse(env).success).toBe(true);
  });

  it("omits sessionId when undefined", () => {
    const env = successEnvelope("req_abc", undefined, {});
    expect("sessionId" in env).toBe(false);
  });
});

describe("failedEnvelope", () => {
  it("builds a valid failed envelope", () => {
    const env = failedEnvelope("req_abc", "s_123", "SESSION_NOT_FOUND", "gone");
    expect(env.status).toBe("failed");
    expect(env.error?.code).toBe("SESSION_NOT_FOUND");
    expect(env.error?.retryable).toBe(false);
    expect(resultEnvelopeSchema.safeParse(env).success).toBe(true);
  });
});

describe("refusedEnvelope", () => {
  it("builds a valid refused envelope", () => {
    const env = refusedEnvelope("req_abc", undefined, "PERMISSION_REQUIRED", "denied");
    expect(env.status).toBe("refused");
    expect(env.error?.code).toBe("PERMISSION_REQUIRED");
    expect(resultEnvelopeSchema.safeParse(env).success).toBe(true);
  });
});
