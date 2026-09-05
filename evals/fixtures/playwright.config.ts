/**
 * The fixture project under Playwright Test (T2.10, REQ-RUN-12).
 *
 * `svatah run --host playwright` generates `.svatah/specs/*.spec.ts` and then
 * runs Playwright Test with this config. There is nothing Svatah-specific in it
 * beyond the reporter — which is the point: a flow runs under the runner a web
 * team already configures, with their projects, their retries and their reports.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./.svatah/specs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [
    ["list"],
    [
      "@svatah/host-playwright/reporter",
      { outputDir: process.env["SVATAH_OUT"] ?? "runs", runId: process.env["SVATAH_RUN_ID"] },
    ],
  ],
  use: {
    baseURL: process.env["SVATAH_BASE_URL"] ?? "http://127.0.0.1:4173",
    headless: process.env["SVATAH_HEADED"] !== "1",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
