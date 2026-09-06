/**
 * A plain Playwright project.
 *
 * There is nothing Yam-specific in this file. The whole integration is one
 * dependency and one import in the spec (REQ-PKG-2): tests import `test` from
 * `@svatah/yam-playwright-test` instead of `@playwright/test`.
 *
 * The sample application is started by a global setup rather than `webServer`
 * only because it lives in this repository; a real project points `baseURL` at
 * whatever it already runs.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: process.env["YAM_BASE_URL"] ?? "http://127.0.0.1:4173",
    // Record mode wants a headed browser so a person can click. Everything else
    // runs headless, including the record pass in CI, which uses YAM_PICK.
    headless: process.env["YAM_HEADED"] !== "1",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
