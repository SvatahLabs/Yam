/**
 * The host's own tests (T2.8 Validate).
 *
 * They run under Playwright Test because that is what they are testing: a
 * generated spec has to run *inside* the runner, with the runner's sharding,
 * reporters and retries, or the claim is untested.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
