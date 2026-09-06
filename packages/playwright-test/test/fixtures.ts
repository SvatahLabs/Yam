/**
 * Fixtures for the host package's tests: one sample application per worker and a
 * surface opened on it.
 */
import { test as base } from "@playwright/test";
import { startSampleApp, type SampleServer } from "sample-web";
import { PlaywrightSurface, type SnapshotMechanism } from "@svatah/yam-adapter-playwright";

interface Worker {
  app: SampleServer;
}

interface Test {
  openSurface: (path?: string, mechanism?: SnapshotMechanism) => Promise<PlaywrightSurface>;
  origin: string;
}

export const test = base.extend<Test, Worker>({
  app: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const app = await startSampleApp(0);
      await use(app);
      await app.close();
    },
    { scope: "worker" },
  ],

  origin: async ({ app }, use) => {
    await use(app.origin);
  },

  openSurface: async ({ app }, use, testInfo) => {
    const opened: PlaywrightSurface[] = [];
    await use(async (path = "/", mechanism = "own") => {
      const surface = new PlaywrightSurface({
        browser: testInfo.project.name as "chromium" | "firefox" | "webkit",
        headless: true,
        snapshotMechanism: mechanism,
        timeoutMs: 10_000,
      });
      await surface.open({ baseUrl: app.origin });
      await surface.act("navigate", undefined, { url: path });
      opened.push(surface);
      return surface;
    });
    for (const surface of opened) await surface.close().catch(() => undefined);
  },
});

export { expect } from "@playwright/test";

/** The sample pages the bindings work is measured against. */
export const PAGES = [
  "/",
  "/login",
  "/dashboard",
  "/schedule-build",
  "/booking",
  "/checkout",
  "/widgets",
  "/logout",
] as const;
