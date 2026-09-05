/**
 * Test fixtures for the adapter suite.
 *
 * One `sample-web` server per worker, and a helper that opens a session on it.
 * Every behavioural test runs twice, once per snapshot mechanism (LLD §7.1),
 * because the whole point of having two is that neither may be the only one that
 * works.
 */
import { test as base } from "@playwright/test";
import { startSampleApp, type SampleServer } from "sample-web";
import { PlaywrightSurface, type SnapshotMechanism } from "../src/index.js";

export const MECHANISMS: readonly SnapshotMechanism[] = ["playwright", "own"];

interface Worker {
  app: SampleServer;
}

interface Test {
  /** Open a session on the sample app with the given snapshot mechanism. */
  openSurface: (mechanism: SnapshotMechanism, path?: string) => Promise<PlaywrightSurface>;
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
    await use(async (mechanism, path = "/") => {
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

/** The single reference for an element carrying this test id. */
export async function refByTestId(surface: PlaywrightSurface, testId: string): Promise<string> {
  const refs = await surface.locate({ by: "testid", value: testId, score: 1 });
  if (refs.length !== 1) {
    throw new Error(
      `Expected exactly one element with data-testid="${testId}", got ${refs.length}.`,
    );
  }
  return refs[0]!;
}
