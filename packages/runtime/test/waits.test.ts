/**
 * `Wait for "<element>" to be <state>` waits for that state (pattern 19).
 *
 * The sentence compiles to a target and `expect: {subject: "target", predicate}`
 * with no arguments, and the executor handed the adapter exactly that: `{}`.
 * Every adapter reads the state from `args.state` and waits for `visible` when
 * there is none, so `Wait for "toast" to be hidden` returned at once while the
 * toast was on the screen, and the step after it clicked through the toast.
 * These tests assert on what the adapter was asked for, which is the whole of
 * the defect: the adapters' own waits for each state have their own tests.
 */
import { describe, expect, it } from "vitest";
import type { CheckResult, Predicate, Ref, Step } from "@svatah/yam-schema";
import { runStep } from "../src/step.js";
import { Scope } from "../src/scope.js";
import { StubSurface, config, step, stubResolver, target, type StubOptions } from "./harness.js";

const context = (surface: StubSurface, options: StubOptions = {}) => ({
  surface,
  scope: new Scope({ data: {} }),
  resolve: stubResolver(options),
  stepTimeoutMs: config().run.stepTimeoutMs,
  expectTimeoutMs: 0,
});

const waitFor = (predicate: Predicate, parts: Partial<Step> = {}): Step =>
  step({
    action: "waitFor",
    text: `Wait for "toast" to be ${predicate.kind}`,
    target: target("toast"),
    expect: { subject: "target", predicate },
    ...parts,
  } as never);

const waitArgs = (surface: StubSurface): unknown[] =>
  surface.calls.filter((call) => call.method === "act" && call.action === "waitFor").map((call) => call.args);

describe("the state a wait sends the adapter", () => {
  it.each([
    ["present", "attached"],
    ["absent", "detached"],
    ["visible", "visible"],
    ["hidden", "hidden"],
    ["enabled", "enabled"],
    ["disabled", "disabled"],
  ])("`to be %s` waits for %s", async (kind, state) => {
    const surface = new StubSurface();
    const result = await runStep(waitFor({ kind } as Predicate), context(surface) as never);
    expect(result.status).toBe("passed");
    expect(waitArgs(surface)).toEqual([{ state }]);
  });

  it("leaves a state the step's arguments already give alone", async () => {
    const surface = new StubSurface();
    await runStep(
      waitFor({ kind: "hidden" }, { args: { state: { kind: "literal", value: "detached" } } } as never),
      context(surface) as never,
    );
    expect(waitArgs(surface)).toEqual([{ state: "detached" }]);
  });

  it("keeps the other arguments, a timeout among them", async () => {
    const surface = new StubSurface();
    await runStep(
      waitFor({ kind: "enabled" }, { args: { timeoutMs: { kind: "literal", value: 250 } } } as never),
      context(surface) as never,
    );
    expect(waitArgs(surface)).toEqual([{ timeoutMs: 250, state: "enabled" }]);
  });

  it("reads `until`, the argument a migrated step carries, when there is no predicate", async () => {
    const surface = new StubSurface();
    await runStep(
      step({
        action: "waitFor",
        target: target("toast"),
        args: { until: { kind: "literal", value: "present" } },
      } as never),
      context(surface) as never,
    );
    await runStep(
      step({
        action: "waitFor",
        target: target("toast"),
        args: { until: { kind: "literal", value: "visible" } },
      } as never),
      context(surface) as never,
    );
    expect(waitArgs(surface)).toEqual([
      { until: "present", state: "attached" },
      { until: "visible", state: "visible" },
    ]);
  });

  it("sends a page wait, which has no element, as it was", async () => {
    const surface = new StubSurface();
    await runStep(
      step({ action: "waitFor", args: { text: { kind: "literal", value: "Saved" } } } as never),
      context(surface) as never,
    );
    expect(waitArgs(surface)).toEqual([{ text: "Saved" }]);
  });
});

describe("a state no adapter's waitFor knows", () => {
  /** A surface whose `checked` becomes true on the nth ask. */
  function checkedOnAsk(n: number): { surface: StubSurface; asks: () => number } {
    const surface = new StubSurface();
    let asks = 0;
    surface.check = async (predicate: Predicate, _subject: string, _ref?: Ref): Promise<CheckResult> => {
      asks += 1;
      const ok = predicate.kind === "checked" && asks >= n;
      return { ok, actual: ok ? "checked" : "unchecked" };
    };
    return { surface, asks: () => asks };
  }

  /*
   * `checked`, `unchecked` and `selected` have no adapter state: sent as
   * `args.state`, Playwright and BiDi refuse it, and sent as nothing, every
   * adapter waits for `visible` — which a styled checkbox's hidden input never
   * is. The executor asks `check` until it holds instead.
   */
  it("is asked of `check` until it holds, and never sent to the adapter", async () => {
    const { surface, asks } = checkedOnAsk(3);
    const result = await runStep(waitFor({ kind: "checked" }), context(surface) as never);
    expect(result.status).toBe("passed");
    expect(asks()).toBeGreaterThanOrEqual(3);
    expect(waitArgs(surface)).toEqual([]);
  });

  it("times out as a timeout, saying what it saw, when it never holds", async () => {
    const { surface } = checkedOnAsk(Number.POSITIVE_INFINITY);
    const result = await runStep(waitFor({ kind: "checked" }, { timeoutMs: 250 }), context(surface) as never);
    expect(result.status).toBe("failed");
    expect(result.failure?.class).toBe("timeout");
    expect(result.failure?.message).toContain('Waited 250 ms for "the toast" to be checked');
    expect(result.failure?.message).toContain('"unchecked"');
  });

  it("asks `check` for a negated state too, rather than guessing its opposite", async () => {
    const surface = new StubSurface({ checks: { visible: false } });
    const result = await runStep(
      waitFor({ kind: "visible", negate: true } as Predicate),
      context(surface, { checks: { visible: false } }) as never,
    );
    expect(result.status).toBe("passed");
    expect(waitArgs(surface)).toEqual([]);
  });
});

describe("waiting for something that has already gone", () => {
  /*
   * `Wait for "toast" to be absent` resolved the toast first, and a toast that
   * had already gone failed with "matched nothing" — the state the step was
   * waiting for, reported as a locator failure.
   */
  it.each(["absent", "hidden"])("passes `to be %s` when the element no longer resolves", async (kind) => {
    const surface = new StubSurface();
    const result = await runStep(waitFor({ kind } as Predicate), context(surface, { unresolvable: ["toast"] }) as never);
    expect(result.status).toBe("passed");
    expect(waitArgs(surface)).toEqual([]);
  });

  it("still fails `to be visible` on an element nobody can find", async () => {
    const surface = new StubSurface();
    const result = await runStep(
      waitFor({ kind: "visible" }),
      context(surface, { unresolvable: ["toast"] }) as never,
    );
    expect(result.status).toBe("failed");
    expect(result.failure?.class).toBe("locator");
  });
});
