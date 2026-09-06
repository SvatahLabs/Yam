/**
 * T2.3 Validate — "handler cannot reach the adapter (type test)".
 *
 * This is the whole reason Tier 0 is safe to have. A custom step is arbitrary
 * user code inside a run; if it could reach the adapter it would be a step that
 * only that adapter can execute, and a plan that runs on one adapter and not on
 * another is not the artifact this project is built around (REQ-SURF-2,
 * REQ-STD-3, LLD §5: "direct adapter access is not exposed").
 *
 * A convention would not hold — someone would reach through `surface as any` one
 * afternoon and nobody would notice until a second adapter existed. So the
 * guarantee is a type, and this file is where the type is checked. `tsc` running
 * over these `@ts-expect-error` lines *is* the assertion: if a property that
 * exposed the adapter were ever added, the expected error would not occur and
 * the build would fail.
 */
import { describe, expect, it, expectTypeOf } from "vitest";
import type { AgentSurface } from "@svatah/yam-surface";
import type { StepContext } from "../src/index.js";

describe("the step context exposes the surface and nothing under it", () => {
  it("has exactly the members LLD §5 names", () => {
    // Written out rather than counted, so adding a member to `StepContext` is a
    // decision someone has to make here, in front of this comment.
    expectTypeOf<keyof StepContext>().toEqualTypeOf<
      "surface" | "args" | "resolve" | "scope" | "expect" | "audit" | "log" | "timeoutMs" | "signal"
    >();
  });

  it("types `surface` as the published AgentSurface, not as an implementation", () => {
    expectTypeOf<StepContext["surface"]>().toEqualTypeOf<AgentSurface>();
  });

  /*
   * Never called. `tsc --noEmit` over this file is the assertion: every
   * `@ts-expect-error` below must be an error, so adding any of these members to
   * `StepContext` fails the build rather than quietly widening what a custom
   * step can reach. Running it would only prove that `undefined` has no `page`.
   */
  function adapterIsUnreachable(context: StepContext): void {
    // @ts-expect-error a Playwright Page would tie the step to one adapter
    void context.page;
    // @ts-expect-error a WebDriver would tie the step to one adapter
    void context.driver;
    // @ts-expect-error a browser handle would tie the step to one adapter
    void context.browser;
    // @ts-expect-error a BrowserContext would tie the step to one adapter
    void context.context;
    // @ts-expect-error the adapter itself, most directly of all
    void context.adapter;
    // @ts-expect-error and no escape through the surface's own internals
    void context.surface.page;
    // @ts-expect-error `args` is what the sentence said; a handler does not edit it
    context.args = {};
    // @ts-expect-error REQ-RUN-6: run data is read-only, or two runs could differ
    context.scope.data = {};
  }

  it("offers no page, driver, browser, context or adapter", () => {
    expect(typeof adapterIsUnreachable).toBe("function");
  });

  it("gives the scope no way to write run data", () => {
    expectTypeOf<StepContext["scope"]["data"]>().toEqualTypeOf<
      Readonly<Record<string, unknown>>
    >();
  });
});
