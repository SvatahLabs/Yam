/**
 * T2.12 — the `Replayer` plugin (LLD §10, §12, Draft 2.3, REQ-HEAL-1, 3).
 *
 * The healer is module (a) and cannot import the executor, so getting back to
 * where a failure happened is a plugin. Two implementations exist: the
 * session-state default here, and a runtime-backed one the CLI registers.
 *
 * `unreachable` is the interesting outcome. A repair verified on the wrong page
 * is worse than no repair (REQ-HEAL-3), so every uncertainty has to end there
 * rather than in a relocalization against whatever is on screen.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { SessionState } from "@svatah/yam-schema";
import type { AgentSurface } from "@svatah/yam-surface";
import {
  clearReplayer,
  currentReplayer,
  hasReplayer,
  registerReplayer,
  samePath,
  SESSION_STATE_REPLAYER,
  type HealInput,
} from "../src/index.js";

afterEach(() => clearReplayer());

/** A surface that remembers what it was restored to, and where it says it is. */
function surfaceAt(url: string | undefined, options: { failRestore?: boolean } = {}) {
  const restored: SessionState[] = [];
  const surface = {
    async restore(state: SessionState) {
      if (options.failRestore === true) throw new Error("navigation failed");
      restored.push(state);
    },
    async state(): Promise<SessionState> {
      return { kind: "web", ...(url === undefined ? {} : { url }) };
    },
  } as unknown as AgentSurface;
  return { surface, restored };
}

const input = (parts: Partial<HealInput> = {}): HealInput => ({
  id: "login.username-field",
  source: "bind-failure",
  tried: [],
  contextDrift: false,
  ...parts,
});

describe("the session-state default (module a)", () => {
  it("restores the recorded state and reports it reached", async () => {
    const { surface, restored } = surfaceAt("http://app.test/login");
    const outcome = await SESSION_STATE_REPLAYER.toFailure(
      input({ state: { kind: "web", url: "http://app.test/login", storageState: "{}" } }),
      surface,
    );
    expect(outcome).toBe("reached");
    expect(restored[0]?.storageState).toBe("{}");
  });

  it("falls back to the recorded URL when there is no full state", async () => {
    const { surface, restored } = surfaceAt("http://app.test/login");
    expect(await SESSION_STATE_REPLAYER.toFailure(input({ url: "http://app.test/login" }), surface))
      .toBe("reached");
    expect(restored[0]?.url).toBe("http://app.test/login");
  });

  it("says unreachable when the failure recorded nowhere to go", async () => {
    const { surface } = surfaceAt("http://app.test/");
    expect(await SESSION_STATE_REPLAYER.toFailure(input(), surface)).toBe("unreachable");
  });

  it("says unreachable when restoring throws", async () => {
    const { surface } = surfaceAt("http://app.test/login", { failRestore: true });
    expect(await SESSION_STATE_REPLAYER.toFailure(input({ url: "http://app.test/login" }), surface))
      .toBe("unreachable");
  });

  it("says unreachable when the page redirected somewhere else", async () => {
    // The case the whole check exists for: a URL that needs a session the
    // recorded state does not carry restores "successfully" and lands on a login
    // page. Relocalizing there would repair a binding against the wrong page.
    const { surface } = surfaceAt("http://app.test/login?next=/booking");
    expect(
      await SESSION_STATE_REPLAYER.toFailure(input({ url: "http://app.test/booking" }), surface),
    ).toBe("unreachable");
  });

  it("ignores a query string, which may legitimately differ", async () => {
    const { surface } = surfaceAt("http://app.test/booking?variant=3");
    expect(
      await SESSION_STATE_REPLAYER.toFailure(input({ url: "http://app.test/booking" }), surface),
    ).toBe("reached");
  });
});

describe("samePath", () => {
  it.each([
    ["http://a.test/x", "http://b.test/x", true],
    ["http://a.test/x/", "http://a.test/x", true],
    ["http://a.test/x?q=1", "http://a.test/x", true],
    ["http://a.test/x", "http://a.test/y", false],
    ["not a url", "not a url", true],
  ])("%s vs %s → %s", (a, b, expected) => {
    expect(samePath(a, b)).toBe(expected);
  });
});

describe("registration (LLD §10)", () => {
  it("defaults to the session-state replayer, and says it is the default", () => {
    expect(currentReplayer()).toBe(SESSION_STATE_REPLAYER);
    expect(hasReplayer()).toBe(false);
  });

  it("takes module (b)'s implementation when one is registered", () => {
    registerReplayer({ name: "runtime", toFailure: async () => "reached" });
    expect(currentReplayer().name).toBe("runtime");
    expect(hasReplayer()).toBe(true);
  });

  it("can be put back, so a CLI run without the runtime is honest", () => {
    registerReplayer({ name: "runtime", toFailure: async () => "reached" });
    clearReplayer();
    expect(hasReplayer()).toBe(false);
  });
});
