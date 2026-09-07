/**
 * An expectation is re-asked until it holds, and says what it saw (T00, SF-11).
 *
 * Two defects, one cause, and the cause was in the *oracle* rather than in the
 * application.
 *
 * 1. **An expectation was evaluated once.** Against a live application that is a
 *    coin flip. Measured on the packaged desktop: clicking the Flows rail item
 *    makes that screen's own buttons visible **up to 200 ms before** the toolbar
 *    title beside them changes, so a flow that waits by resolving one and then
 *    asserts the other is asking about a screen that has half arrived. Six runs
 *    of the parity gate's `02-app-screen.flow` over CDP gave three failures
 *    before this and six passes after. The accessibility side had always agreed
 *    with the application, because a native tree read is slow enough that the
 *    frame has landed — which is what made it look like a disagreement between
 *    two oracles rather than one oracle asking too soon.
 *
 * 2. **A failing expectation threw away what it observed.** SF-11: "Checks
 *    returning false use `failed/CHECK_FAILED` while retaining the actual
 *    observed value". The message read *"and it was not so"* and nothing else,
 *    which is why the disagreement above survived a whole wave undiagnosed: the
 *    value, once carried, said `"Surfaces"` and named the cause in one word.
 *
 * A *guard* is deliberately not polled. "Only if the login error is hidden,
 * click sign in" is a question asked now; one that waited would change what the
 * sentence means and delay every step it guards.
 */
import { describe, expect, it } from "vitest";
import type { CheckResult, Predicate, Ref } from "@svatah/yam-schema";
import { runStep } from "../src/step.js";
import { Scope } from "../src/scope.js";
import { StubSurface, config, step, stubResolver, target } from "./harness.js";

/** A surface whose predicate becomes true on the nth ask, and says what it saw. */
function eventually(trueOnAsk: number, sawUntilThen: string, sawAfter = "Flows") {
  const surface = new StubSurface();
  let asks = 0;
  surface.check = async (
    predicate: Predicate,
    _subject: string,
    _ref?: Ref,
  ): Promise<CheckResult> => {
    asks += 1;
    void predicate;
    const ok = asks >= trueOnAsk;
    return { ok, actual: ok ? sawAfter : sawUntilThen };
  };
  return { surface, asks: () => asks };
}

const expectation = () =>
  step({
    action: "expect",
    text: 'The toolbar title should contain "Flows"',
    target: target("app.toolbar-title"),
    expect: {
      subject: "target",
      predicate: { kind: "textContains", value: { kind: "literal", value: "Flows" } },
    },
  } as never);

const context = (surface: StubSurface, expectTimeoutMs: number) => ({
  surface,
  scope: new Scope({ data: {} }),
  resolve: stubResolver(),
  stepTimeoutMs: config().run.stepTimeoutMs,
  expectTimeoutMs,
});

describe("an expectation about a live application (T00)", () => {
  it("is re-asked while its budget lasts, and passes when the screen arrives", async () => {
    const { surface, asks } = eventually(3, "Surfaces");
    const result = await runStep(expectation(), context(surface, 2_000) as never);
    expect(result.status).toBe("passed");
    expect(asks(), "it asked again rather than believing the first answer").toBeGreaterThanOrEqual(3);
  });

  it("fails when the screen never arrives, rather than waiting for ever", async () => {
    const { surface } = eventually(Number.POSITIVE_INFINITY, "Surfaces");
    const started = Date.now();
    const result = await runStep(expectation(), context(surface, 400) as never);
    expect(result.status).toBe("failed");
    expect(Date.now() - started, "bounded by the budget").toBeLessThan(10_000);
  });

  it("keeps the value it actually observed, which is what names the cause", async () => {
    const { surface } = eventually(Number.POSITIVE_INFINITY, "Surfaces");
    const result = await runStep(expectation(), context(surface, 0) as never);
    expect(result.status).toBe("failed");
    expect(
      result.failure?.message,
      "SF-11: a check that returns false retains the actual observed value",
    ).toContain('"Surfaces"');
  });

  /*
   * The negative case, shown failing rather than shown passing when correct.
   * `expectTimeoutMs: 0` is the behaviour that produced the parity gate's
   * disagreement, kept as a setting and kept under test — so the fix is proved
   * by the difference between these two cases and not by one green line.
   */
  it("asked exactly once, it fails on the very screen the budget would have caught", async () => {
    const { surface, asks } = eventually(3, "Surfaces");
    const result = await runStep(expectation(), context(surface, 0) as never);
    expect(result.status).toBe("failed");
    expect(asks(), "no budget means one ask").toBe(1);
  });

  it("does not wait when the answer is already yes", async () => {
    const { surface, asks } = eventually(1, "Surfaces");
    const started = Date.now();
    const result = await runStep(expectation(), context(surface, 5_000) as never);
    expect(result.status).toBe("passed");
    expect(asks()).toBe(1);
    expect(Date.now() - started, "a true expectation costs nothing").toBeLessThan(1_000);
  });
});

describe("a guard is a question asked now, and is not polled (REQ-AUTO-1)", () => {
  it("does not wait for a guard that is false, and skips the step", async () => {
    const { surface, asks } = eventually(3, "no");
    const guarded = step({
      action: "click",
      text: "Only if the login error is hidden, click the sign in button",
      target: target("app.sign-in"),
      guard: {
        mode: "onlyIf",
        subject: "target",
        predicate: { kind: "hidden" },
        target: { ref: "app.login-error", phrase: "the login error" },
      },
    } as never);
    const result = await runStep(guarded, context(surface, 5_000) as never);
    expect(result.status).toBe("skipped");
    expect(asks(), "a guard is asked once, whatever the expectation budget is").toBe(1);
  });
});
