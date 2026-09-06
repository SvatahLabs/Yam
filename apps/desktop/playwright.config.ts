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
  timeout: 300_000,
});
