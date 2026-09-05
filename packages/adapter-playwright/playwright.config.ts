/**
 * Playwright Test configuration for the adapter's own tests.
 *
 * LLD §1: "vitest unit tests, Playwright Test for adapter and host tests". These
 * are adapter tests — they drive real browsers against `apps/sample-web` — so
 * they run under Playwright Test, and `pnpm -r test` runs them as part of the
 * verification contract.
 *
 * Only `chromium` is required for Phase 1. `firefox` and `webkit` are declared
 * so `pnpm --filter @svatah/adapter-playwright test:browsers` can run the same
 * suite on all three once those browsers are installed; the default project list
 * is chromium alone so a clean checkout needs one download.
 */
import { defineConfig, devices } from "@playwright/test";

const allBrowsers = process.env["SVATAH_PW_BROWSERS"] === "all";

export default defineConfig({
  testDir: "./test",
  fullyParallel: true,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  workers: process.env["CI"] !== undefined ? 2 : undefined,
  reporter: process.env["CI"] !== undefined ? [["list"], ["github"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  projects: allBrowsers
    ? [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
      ]
    : [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
