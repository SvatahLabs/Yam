import { describe, expect, it } from "vitest";
import {
  createRedactionPolicy,
  addSecretLiteral,
  addSecretPattern,
  redactString,
  redactObject,
  hasSecret,
  forgetSecrets,
  withholdFieldValues,
  withholdSecrets,
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

describe("the arguments a session keeps (SF-15)", () => {
  const field = (attrs: Record<string, string>, tag = "input") => ({
    ref: "e1",
    role: "textbox",
    name: "Password",
    tag,
    attrs,
    text: "",
    neighbours: { before: [], after: [] },
    rolePath: [],
    box: { x: 0, y: 0, width: 1, height: 1 },
    index: 0,
    states: [],
  });

  it("withholds a declared secret wherever it appears", () => {
    expect(
      withholdSecrets({ value: "hunter2", note: "typed hunter2" }, { secrets: ["hunter2"] }),
    ).toEqual({ value: "[REDACTED]", note: "typed [REDACTED]" });
  });

  it("withholds what is typed into a password field, declared or not", () => {
    expect(withholdSecrets({ value: "hunter2" }, { describe: field({ type: "password" }) })).toEqual({
      value: "[REDACTED]",
    });
    // An NSSecureTextField: role AXTextField, subrole AXSecureTextField.
    expect(
      withholdSecrets({ value: "hunter2" }, { describe: field({ AXSubrole: "AXSecureTextField" }, "AXTextField") }),
    ).toEqual({ value: "[REDACTED]" });
    expect(
      withholdSecrets({ value: "hunter2" }, { describe: field({}, "XCUIElementTypeSecureTextField") }),
    ).toEqual({ value: "[REDACTED]" });
  });

  it("withholds a typed value when nothing says what the field was, if asked to fail closed", () => {
    expect(withholdSecrets({ value: "hunter2" }, { failClosed: true })).toEqual({ value: "[REDACTED]" });
    expect(withholdSecrets({ value: "hunter2" }, {})).toEqual({ value: "hunter2" });
  });

  it("withholds a secret field's own value from describe, read and check answers", () => {
    const described = { ...field({ type: "password" }), value: "hunter2" };
    expect(withholdFieldValues({ describe: described, url: "http://app.test/" }, described)).toEqual({
      describe: { ...described, value: "[REDACTED]" },
      url: "http://app.test/",
    });
    expect(withholdFieldValues({ ok: false, actual: "hunter2", expected: "x" }, described)).toEqual({
      ok: false,
      actual: "[REDACTED]",
      expected: "[REDACTED]",
    });
    const email = { ...field({ type: "email" }), value: "ada@example.test" };
    expect(withholdFieldValues({ value: "ada@example.test" }, email)).toEqual({ value: "ada@example.test" });
  });

  it("keeps an ordinary value, and leaves nothing to withhold alone", () => {
    expect(withholdSecrets({ value: "ada@example.test" }, { describe: field({ type: "email" }) })).toEqual({
      value: "ada@example.test",
    });
    expect(withholdSecrets(undefined, { secrets: ["hunter2"] })).toBeUndefined();
    expect(withholdSecrets({ value: "hunter2" }, { describe: { not: "a description" } })).toEqual({
      value: "hunter2",
    });
  });
});

describe("a secret cannot stop the broker, or reach past its own session (SF-15)", () => {
  it("returns when a secret is part of the placeholder itself", () => {
    // The loop replaced until nothing matched, and "[REDACTED]" contains "E".
    const policy = createRedactionPolicy();
    for (const secret of ["E", "RED", "[", "REDACTED]"]) addSecretLiteral(policy, secret);
    expect(redactString(policy, "Press Enter to REDEEM")).toBe("Press Enter to [REDACTED]EEM");
    expect(redactString(policy, "E")).toBe("[REDACTED]");
  });

  it("redacts a short secret only where it is the whole value", () => {
    const policy = createRedactionPolicy();
    addSecretLiteral(policy, "42");
    expect(redactString(policy, "42")).toBe("[REDACTED]");
    expect(redactString(policy, "Order 1042 of 42 items")).toBe("Order 1042 of 42 items");
  });

  it("redacts a session's secret from that session's answers only, until it closes", () => {
    const policy = createRedactionPolicy();
    addSecretLiteral(policy, "Delete account", "s_agent");
    expect(redactString(policy, "Delete account", "s_agent")).toBe("[REDACTED]");
    expect(redactString(policy, "Delete account", "s_person")).toBe("Delete account");
    expect(redactString(policy, "Delete account")).toBe("Delete account");
    expect(hasSecret(policy, "Delete account now", "s_agent")).toBe(true);
    forgetSecrets(policy, "s_agent");
    expect(redactString(policy, "Delete account", "s_agent")).toBe("Delete account");
  });
});
