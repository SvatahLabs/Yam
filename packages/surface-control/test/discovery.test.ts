import { describe, expect, it } from "vitest";
import {
  discoverAdapters,
  discoverTargets,
  checkAdapterReadiness,
} from "../src/discovery.js";

describe("adapter readiness (T06, SF-04, SF-09)", () => {
  const registered = ["playwright", "bidi", "http", "ax", "uia", "appium"];

  it("reports all known adapters with platform and readiness", () => {
    const results = discoverAdapters(registered);
    expect(results.length).toBeGreaterThanOrEqual(6);
    for (const r of results) {
      expect(r.adapter).toBeTruthy();
      expect(typeof r.registered).toBe("boolean");
      expect(typeof r.available).toBe("boolean");
      expect(Array.isArray(r.platform)).toBe(true);
    }
  });

  it("marks unregistered adapters as not available", () => {
    const result = checkAdapterReadiness("does-not-exist", registered);
    expect(result.registered).toBe(false);
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/not registered/i);
  });

  it("marks wrong-platform adapters as not available", () => {
    const result = checkAdapterReadiness("uia", ["uia"]);
    if (process.platform !== "win32") {
      expect(result.available).toBe(false);
      expect(result.reason).toMatch(/win32/);
    }
  });

  it("provides prerequisites for each adapter", () => {
    const result = checkAdapterReadiness("ax", registered);
    expect(result.prerequisites).toBeDefined();
    expect(result.prerequisites!.length).toBeGreaterThan(0);
  });
});

describe("target discovery (T06, SF-04)", () => {
  const registered = ["playwright", "bidi", "http"];

  it("discovers targets for a URL", () => {
    const targets = discoverTargets(registered, { url: "http://localhost:3000" });
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t.url).toBe("http://localhost:3000");
      expect(t.kind === "browser" || t.kind === "http").toBe(true);
    }
  });

  it("filters by adapter", () => {
    const targets = discoverTargets(registered, { url: "http://localhost:3000", adapter: "http" });
    expect(targets.length).toBe(1);
    expect(targets[0]!.adapter).toBe("http");
  });

  it("takes a target's readiness from a probe when one was run, not from the platform table", () => {
    /*
     * `targets` answered `appium ready: true` beside a probe, in the same
     * envelope, that said no Appium server answered. The table's claim is
     * about the platform; the probe's is about this host.
     */
    const table = discoverAdapters(["appium", "http"]);
    const probed = table.map((one) =>
      one.adapter === "appium"
        ? { ...one, available: false, reason: "no Appium server answered" }
        : one,
    );
    const targets = discoverTargets(["appium", "http"], { readiness: probed });
    const appium = targets.find((one) => one.adapter === "appium")!;
    expect(appium.ready).toBe(false);
    expect(appium.reason).toBe("no Appium server answered");
    expect(targets.find((one) => one.adapter === "http")!.ready).toBe(
      table.find((one) => one.adapter === "http")!.available,
    );
  });

  it("returns all known adapters when no URL is given", () => {
    const targets = discoverTargets(registered);
    expect(targets.length).toBeGreaterThanOrEqual(registered.length);
    const adapters = targets.map((t) => t.adapter);
    for (const r of registered) {
      expect(adapters).toContain(r);
    }
  });
});
