/**
 * What the screen-fixture check looks past, driven directly (T10.4, P9-F1).
 *
 * `record-screen-fixtures.mjs --check` needs a browser, a service and about
 * eleven seconds, so the *rule* it compares by had never been driven on its own
 * — and the rule is where the defect was.
 *
 * Normalising `(37 ms)` assumed a slow machine only makes a candidate slower.
 * Past `Config.run.candidateTimeoutMs` it does not: the resolver stops waiting
 * and records something else entirely, under a different key. The Windows leg
 * of 2026-09-21's run failed on `checkout.pay-button` for exactly that, having
 * passed on the same commit on every other runner.
 */
import { describe, expect, it } from "vitest";
import { fromRoot } from "../src/repo.js";

const load = async (): Promise<{ comparable: (text: string) => string }> =>
  (await import(fromRoot("scripts", "lib", "screen-fixture-compare.mjs"))) as {
    comparable: (text: string) => string;
  };

describe("the screen fixture comparator", () => {
  it("reads a candidate that ran out of time as the miss it was going to be", async () => {
    const { comparable } = await load();
    const fast =
      '"message": "Could not resolve \\"checkout.pay-button\\": testid \\"pay\\" — matched nothing (14 ms)"';
    const loaded =
      '"message": "Could not resolve \\"checkout.pay-button\\": testid \\"pay\\" — error: candidate timed out after 2000 ms (2001 ms)"';
    expect(comparable(loaded)).toBe(comparable(fast));
  });

  it("reconciles the structured entry, which uses a different key", async () => {
    const { comparable } = await load();
    const fast = '{ "matched": 0, "durationMs": 14, "rejected": "matched nothing" }';
    const loaded =
      '{ "matched": 0, "durationMs": 2001, "error": "candidate timed out after 2000 ms" }';
    expect(comparable(loaded)).toBe(comparable(fast));
  });

  it("still looks past the wall clock, the durations and the port", async () => {
    const { comparable } = await load();
    expect(comparable('"durationMs": 1234')).toBe('"durationMs": 0');
    expect(comparable('"startedAt": "2026-09-21T09:00:00.000Z"')).toBe('"startedAt": "<when>"');
    expect(comparable('"configHash": "deadbeef01234567"')).toBe('"configHash": "<per-run>"');
  });

  /*
   * The half that matters more: a comparator that looked past everything would
   * pass over any change at all. These are the things the check exists to catch.
   */
  it("still catches a status, a candidate, a hash and a captured value", async () => {
    const { comparable } = await load();
    for (const [a, b] of [
      ['"status": "passed"', '"status": "failed"'],
      ['"by": "testid"', '"by": "role"'],
      ['"planHash": "0000000000000000"', '"planHash": "1111111111111111"'],
      ['"value": "conform@example.com"', '"value": "someone-else@example.com"'],
      ['"rejected": "matched nothing"', '"rejected": "matched 3 elements"'],
    ] as const) {
      expect(comparable(a), `${a} vs ${b}`).not.toBe(comparable(b));
    }
  });
});
