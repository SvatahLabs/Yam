/**
 * T0.4 Validate — "a mock adapter passes registry and error-type tests".
 * Refs: REQ-SURF-2, REQ-SURF-4, REQ-SURF-5, LLD §2.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  snapshotSchema,
  elementDescriptionSchema,
  sessionStateSchema,
  actResultSchema,
  capabilitiesSchema,
  surfaceActMessageSchema,
  surfaceSnapshotMessageSchema,
  type Config,
} from "@svatah/yam-schema";
import {
  ActionabilityError,
  CheckError,
  clearAdapters,
  createSurface,
  DataError,
  DialogError,
  failureClassOf,
  hasAdapter,
  listAdapters,
  LocateError,
  missingCapabilities,
  NavigationError,
  NO_CAPABILITIES,
  registerAdapter,
  REQUIRED_SURFACE_METHODS,
  ScriptError,
  SessionError,
  SURFACE_ERRORS,
  SURFACE_METHODS,
  SurfaceError,
  TimeoutError,
  unregisterAdapter,
} from "../src/index.js";
import { BrokenAdapter, MockAdapter } from "./mock-adapter.js";

const config: Config = { ...DEFAULT_CONFIG, project: "mock", adapter: "playwright" };

afterEach(() => clearAdapters());

describe("adapter registry (REQ-SURF-2, LLD §2.4)", () => {
  it("registers an adapter and builds it from configuration", async () => {
    registerAdapter("playwright", () => new MockAdapter());
    expect(hasAdapter("playwright")).toBe(true);
    expect(listAdapters()).toEqual(["playwright"]);

    const surface = await createSurface(config);
    expect(surface).toBeInstanceOf(MockAdapter);
    expect(surface.kind).toBe("web");
  });

  it("lists adapters sorted, whatever the registration order", () => {
    registerAdapter("uia", () => new MockAdapter());
    registerAdapter("appium", () => new MockAdapter());
    registerAdapter("bidi", () => new MockAdapter());
    expect(listAdapters()).toEqual(["appium", "bidi", "uia"]);
  });

  it("refuses to replace a registration silently", () => {
    registerAdapter("playwright", () => new MockAdapter());
    expect(() => registerAdapter("playwright", () => new MockAdapter())).toThrow(SessionError);
    expect(() => registerAdapter("playwright", () => new MockAdapter())).toThrow(
      /already registered/,
    );
  });

  it("allows a deliberate replacement after unregistering", () => {
    registerAdapter("playwright", () => new MockAdapter());
    expect(unregisterAdapter("playwright")).toBe(true);
    expect(unregisterAdapter("playwright")).toBe(false);
    expect(() => registerAdapter("playwright", () => new BrokenAdapter())).not.toThrow();
  });

  it("refuses an empty adapter name", () => {
    expect(() => registerAdapter("  ", () => new MockAdapter())).toThrow(SessionError);
  });

  it("names what is registered when the configured adapter is missing", async () => {
    registerAdapter("bidi", () => new MockAdapter());
    await expect(createSurface(config)).rejects.toThrow(
      /No adapter registered under "playwright". Registered: bidi\./,
    );
  });

  it("accepts an async factory", async () => {
    registerAdapter("playwright", async () => new MockAdapter());
    await expect(createSurface(config)).resolves.toBeInstanceOf(MockAdapter);
  });
});

describe("the mock adapter implements the surface (LLD §2.1)", () => {
  it("has every required method", () => {
    const surface = new MockAdapter();
    for (const method of REQUIRED_SURFACE_METHODS) {
      expect(typeof (surface as unknown as Record<string, unknown>)[method]).toBe("function");
    }
  });

  it("declares capabilities matching the published shape", () => {
    const surface = new MockAdapter();
    expect(capabilitiesSchema.safeParse(surface.capabilities()).success).toBe(true);
  });

  it("returns a snapshot that validates against the published wire schema", async () => {
    const surface = new MockAdapter();
    await surface.open({ baseUrl: "https://sample.test/login" });
    const snapshot = await surface.snapshot();

    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      surfaceSnapshotMessageSchema.safeParse({ request: {}, response: snapshot }).success,
    ).toBe(true);
    expect(snapshot.text).toContain('- textbox "Username"');
    expect(snapshot.text).toContain("[ref=r2]");
    // Hidden nodes are omitted from the rendering but stay in `nodes`.
    expect(snapshot.text).not.toContain("Invalid credentials");
    expect(snapshot.nodes.some((n) => n.ref === "r4")).toBe(true);
  });

  it("acts by reference and returns a result matching the wire schema", async () => {
    const surface = new MockAdapter();
    await surface.open({});
    const result = await surface.act("type", "r2", { value: "user@sample.test" });

    expect(actResultSchema.safeParse(result).success).toBe(true);
    expect(
      surfaceActMessageSchema.safeParse({
        request: { action: "type", ref: "r2", args: { value: "user@sample.test" } },
        response: result,
      }).success,
    ).toBe(true);
    expect(await surface.read("value", "r2")).toBe("user@sample.test");
  });

  it("describes an element in the shape synthesis and fingerprinting need", async () => {
    const surface = new MockAdapter();
    await surface.open({});
    expect(elementDescriptionSchema.safeParse(await surface.describe("r3")).success).toBe(true);
  });

  it("returns restorable session state and restores it", async () => {
    const surface = new MockAdapter();
    await surface.open({ baseUrl: "https://sample.test/login" });
    const state = await surface.state();
    expect(sessionStateSchema.safeParse(state).success).toBe(true);

    await surface.act("navigate", undefined, { url: "https://sample.test/dashboard" });
    expect(await surface.read("url")).toBe("https://sample.test/dashboard");
    await surface.restore(state);
    expect(await surface.read("url")).toBe("https://sample.test/login");
  });

  it("locates by candidate and reports 0, 1 or many references", async () => {
    const surface = new MockAdapter();
    await surface.open({});
    expect(await surface.locate({ by: "testid", value: "username", score: 1 })).toEqual(["r2"]);
    expect(await surface.locate({ by: "testid", value: "nothing-here", score: 1 })).toEqual([]);
  });
});

describe("typed errors and failure classes (LLD §2.3, §8.4)", () => {
  it("every surface error is a SurfaceError with a name and a failure class", () => {
    for (const Ctor of SURFACE_ERRORS) {
      const error = new Ctor("boom");
      expect(error).toBeInstanceOf(SurfaceError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(Ctor.name);
      expect(error.message).toBe("boom");
      expect(typeof error.failureClass).toBe("string");
    }
  });

  it("maps each error to the failure class LLD §8.4 specifies", () => {
    expect(failureClassOf(new LocateError("x"))).toBe("locator");
    expect(failureClassOf(new TimeoutError("x"))).toBe("timeout");
    expect(failureClassOf(new ActionabilityError("x"))).toBe("timeout");
    expect(failureClassOf(new CheckError("x"))).toBe("assertion");
    expect(failureClassOf(new DataError("x"))).toBe("data");
    expect(failureClassOf(new NavigationError("x"))).toBe("navigation");
    expect(failureClassOf(new DialogError("x"))).toBe("dialog");
    expect(failureClassOf(new ScriptError("x"))).toBe("script");
    expect(failureClassOf(new SessionError("x"))).toBe("infrastructure");
  });

  it("classifies anything that is not a surface error as unknown", () => {
    expect(failureClassOf(new Error("native"))).toBe("unknown");
    expect(failureClassOf("a string")).toBe("unknown");
    expect(failureClassOf(undefined)).toBe("unknown");
  });

  it("carries the adapter name and the cause when given them", () => {
    const cause = new Error("underlying");
    const error = new LocateError("no match", { adapter: "mock", matchCount: 0, cause });
    expect(error.adapter).toBe("mock");
    expect(error.matchCount).toBe(0);
    expect(error.cause).toBe(cause);
  });

  it("the mock adapter throws the right error for each situation", async () => {
    const surface = new MockAdapter();
    await expect(surface.snapshot()).rejects.toBeInstanceOf(SessionError);

    await surface.open({});
    await expect(surface.describe("nope")).rejects.toBeInstanceOf(LocateError);
    await expect(surface.act("navigate")).rejects.toBeInstanceOf(NavigationError);
    await expect(surface.act("evaluate")).rejects.toBeInstanceOf(ScriptError);
    await expect(surface.check({ kind: "checked" }, "ref", "r3")).rejects.toBeInstanceOf(CheckError);
    await expect(surface.check({ kind: "visible" }, "dialog")).rejects.toThrow(
      /there is no dialog/,
    );
  });

  it("a broken adapter fails at open with a readable error", async () => {
    registerAdapter("playwright", () => new BrokenAdapter());
    const surface = await createSurface(config);
    await expect(surface.open({})).rejects.toThrow(/cannot open a session/);
  });
});

describe("capabilities gate the plan at start, not mid-run (LLD §2.4)", () => {
  it("names every capability an action set needs but the adapter lacks", () => {
    expect(missingCapabilities(["dialog", "switchFrame", "upload"], NO_CAPABILITIES)).toEqual([
      "dialogs",
      "frames",
      "upload",
    ]);
  });

  it("is empty when the adapter supports what the plan needs", () => {
    expect(
      missingCapabilities(["dialog"], { ...NO_CAPABILITIES, dialogs: true }),
    ).toEqual([]);
  });

  it("asks for nothing for actions every adapter must support", () => {
    expect(missingCapabilities(["click", "type", "navigate"], NO_CAPABILITIES)).toEqual([]);
  });
});

describe("the surface interface is stable", () => {
  it("declares exactly the methods LLD §2.1 lists", () => {
    expect([...SURFACE_METHODS]).toEqual([
      "capabilities",
      "open",
      "close",
      "snapshot",
      "act",
      "read",
      "check",
      "locate",
      "describe",
      "screenshot",
      "state",
      "restore",
      "trace",
      "request",
    ]);
  });

  it("marks only trace and request optional", () => {
    expect(SURFACE_METHODS.filter((m) => !REQUIRED_SURFACE_METHODS.includes(m as never))).toEqual([
      "trace",
      "request",
    ]);
  });
});
