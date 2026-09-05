/**
 * T3.3 — "register the recorder … as `bind()` record mode when module (b) is
 * installed" (LLD §6.5, §10).
 *
 * `packages/playwright-test` tests the plugin point with a stand-in, because
 * module (a) cannot import module (b) at all. This is the other side: the CLI is
 * the package LLD §10 puts the wiring in, and `installModelGrounding()` is what
 * turns "module (b) is installed" into a grounder module (a) will ask.
 *
 * Two properties, and the second is what keeps a suite honest: it installs the
 * recorder's grounder when a gateway is available, and it declines — rather than
 * throwing — when there is no credential, so a project without one records the
 * way module (a) does instead of failing at the first `bind()`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { fakeGateway } from "@svatah/gateway";
import { clearBindGrounder, currentBindGrounder, hasBindGrounder } from "@svatah/playwright-test";
import { hasModelGrounding, installModelGrounding, uninstallModelGrounding } from "../src/index.js";

afterEach(() => {
  uninstallModelGrounding();
});

const answers = () => fakeGateway({ answer: () => ({ ref: null, why: "x", confidence: 1 }) });

describe("bind() record mode with module (b) installed (LLD §6.5, §10)", () => {
  it("leaves module (a)'s picker in place until something installs one", () => {
    clearBindGrounder();
    expect(hasBindGrounder()).toBe(false);
    expect(hasModelGrounding()).toBe(false);
    expect(currentBindGrounder().name).toBe("none");
  });

  it("installs the recorder's grounder when a gateway is available", () => {
    expect(installModelGrounding({ gateway: answers() })).toBe(true);
    expect(hasBindGrounder()).toBe(true);
    // The name says who answered, which is what a record report shows a person.
    expect(currentBindGrounder().name).toBe("recorder:fake:fake");
  });

  it("declines without a credential rather than failing at the first bind()", () => {
    const key = process.env["ANTHROPIC_API_KEY"];
    const token = process.env["ANTHROPIC_AUTH_TOKEN"];
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_AUTH_TOKEN"];

    try {
      expect(installModelGrounding()).toBe(false);
      expect(hasBindGrounder()).toBe(false);
    } finally {
      if (key !== undefined) process.env["ANTHROPIC_API_KEY"] = key;
      if (token !== undefined) process.env["ANTHROPIC_AUTH_TOKEN"] = token;
    }
  });

  it("uninstalling puts module (a)'s default back", () => {
    installModelGrounding({ gateway: answers() });
    expect(hasBindGrounder()).toBe(true);
    uninstallModelGrounding();
    expect(hasBindGrounder()).toBe(false);
  });
});
