/**
 * Playwright Test configuration for the host package.
 *
 * LLD §1: "Playwright Test for adapter and host tests". This package is the host
 * — the `bind()` fixture and the generated specs — and it is also the one place
 * the dependency graph lets `@svatah/yam-bindings` and `@svatah/yam-adapter-playwright`
 * meet (LLD §1), so the browser-backed synthesis and fingerprint tests live here
 * rather than in either of them.
 */
import { defineConfig, devices } from "@playwright/test";

const allBrowsers = process.env["YAM_PW_BROWSERS"] === "all";

export default defineConfig({
  testDir: "./test",
  fullyParallel: true,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  workers: process.env["CI"] !== undefined ? 2 : undefined,
  reporter: process.env["CI"] !== undefined ? [["list"], ["github"]] : [["list"]],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  projects: allBrowsers
    ? [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
      ]
    : [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
