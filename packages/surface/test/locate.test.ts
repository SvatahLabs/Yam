import { describe, expect, it } from "vitest";

import { LOCATE_RETURN_MARGIN_MS, locateDeadline } from "../src/index.js";

/*
 * P11 — two clocks, one question.
 *
 * The resolver races each candidate against `candidateTimeoutMs`; the adapters
 * retry a locate that found nothing. Given the same budget the resolver's clock
 * wins, and an element that is genuinely absent is published as
 * `error: candidate timed out after 2000 ms` instead of `matched nothing` —
 * a "could not tell" reported as a cause, which P10-F5 says never to do. It was
 * the screen-fixture check that caught it: the recorded failure message of a
 * deliberately failing step changed under the retry.
 */
describe("a retrying locate answers before the resolver's clock (P10-F5, T11.2)", () => {
  it("keeps a margin for the answer to travel back", () => {
    expect(locateDeadline(2000, 1_000_000)).toBe(1_000_000 + 2000 - LOCATE_RETURN_MARGIN_MS);
  });

  it("does not retry at all when no budget is configured", () => {
    expect(locateDeadline(undefined, 1_000_000)).toBe(1_000_000);
    expect(locateDeadline(0, 1_000_000)).toBe(1_000_000);
  });

  it("does not run backwards when the budget is smaller than the margin", () => {
    expect(locateDeadline(100, 1_000_000)).toBe(1_000_000);
    expect(locateDeadline(LOCATE_RETURN_MARGIN_MS, 1_000_000)).toBe(1_000_000);
  });
});
