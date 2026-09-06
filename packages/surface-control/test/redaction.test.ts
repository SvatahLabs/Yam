import { describe, expect, it } from "vitest";
import {
  createRedactionPolicy,
  addSecretLiteral,
  addSecretPattern,
  redactString,
  redactObject,
  hasSecret,
} from "../src/redaction.js";

describe("redaction (T09, SF-15)", () => {
  it("redacts a literal secret from a string", () => {
    const policy = createRedactionPolicy();
    addSecretLiteral(policy, "s3cr3t-token");
    expect(redactString(policy, "Bearer s3cr3t-token")).toBe("Bearer [REDACTED]");
  });

  it("redacts a pattern from a string", () => {
    const policy = createRedactionPolicy();
    addSecretPattern(policy, /password=[^&\s]+/g);
    expect(redactString(policy, "url?password=abc123&foo=bar")).toBe("url?[REDACTED]&foo=bar");
  });

  it("redacts secrets deep in an object", () => {
    const policy = createRedactionPolicy();
    addSecretLiteral(policy, "MY_SECRET");
    const obj = {
      result: { value: "The token is MY_SECRET here" },
      nested: [{ text: "another MY_SECRET occurrence" }],
    };
    const redacted = redactObject(policy, obj) as Record<string, unknown>;
    expect(JSON.stringify(redacted)).not.toContain("MY_SECRET");
    expect(JSON.stringify(redacted)).toContain("[REDACTED]");
  });

  it("hasSecret detects the presence of a secret", () => {
    const policy = createRedactionPolicy();
    addSecretLiteral(policy, "token-xyz");
    expect(hasSecret(policy, "carries token-xyz inside")).toBe(true);
    expect(hasSecret(policy, "clean string")).toBe(false);
  });

  it("handles empty and null inputs", () => {
    const policy = createRedactionPolicy();
    addSecretLiteral(policy, "secret");
    expect(redactObject(policy, null)).toBeNull();
    expect(redactObject(policy, undefined)).toBeUndefined();
    expect(redactObject(policy, 42)).toBe(42);
    expect(redactObject(policy, true)).toBe(true);
  });

  it("redacts multiple occurrences of the same secret", () => {
    const policy = createRedactionPolicy();
    addSecretLiteral(policy, "abc");
    expect(redactString(policy, "abc and abc again")).toBe("[REDACTED] and [REDACTED] again");
  });
});
