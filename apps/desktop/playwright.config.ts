import { defineConfig } from "@playwright/test";

/**
 * The app's own end-to-end tests (T9.4).
 *
 * Playwright Test rather than vitest, because what is driven is a *packaged
 * Electron application* and `_electron` is Playwright's. `apps/desktop/test/*.test.ts`
 * stay on vitest: they check configuration and the service boundary, and need no
 * browser at all.
 *
 * One worker and no retries: the tests share one launched application and run in
 * order — a record, then a run, then the run's evidence — because that is the
 * order a person does them in and the order the state exists in.
 */
export default defineConfig({
  testDir: "./test",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  /*
   * Thirty seconds, from measurement (P-W2-F3).
   *
   * It was 300_000 — five minutes a test — because that number had to cover the
   * slowest thing in the file, and three tests here execute a real automation
   * flow inside the packaged app. The cost of sizing one global for the worst
   * case is that a locator which can *never* match also costs five minutes: a
   * stale screen id left this suite looking hung rather than failed, and seven
   * of them took twenty-five minutes to report what a fast failure says at once.
   *
   * The measurement: of thirty passing tests, the median is 68 ms and the
   * slowest is 1.4 s. Thirty seconds is four hundred times the median and twenty
   * times the slowest — generous for everything except the three that run a
   * flow, and those say so themselves with `test.setTimeout`, where the cost is
   * visible at the test incurring it.
   */
  timeout: 30_000,
});
