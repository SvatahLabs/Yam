/**
 * T1.2 Validate — "the Playwright adapter passes the surface conformance suite".
 *
 * This is the half of the Validate item that needs a real browser. The other half
 * — a deliberately broken mock adapter failing with a readable report — is in
 * `packages/conformance/test`, where it needs no browser at all, which is itself
 * the evidence that the suite depends on nothing but `AgentSurface`.
 *
 * The verifier's command is:
 *
 *   pnpm --filter sample-web start &
 *   pnpm yam surface conform --adapter playwright
 *
 * This test is the same run, with the sample app started for it.
 *
 * Refs: REQ-SURF-3, REQ-STD-2, LLD §14.
 */
import { renderReport, runSurfaceConformance, SURFACE_CASES } from "@svatah/yam-conformance";
import { PlaywrightSurface, type SnapshotMechanism } from "../src/index.js";
import { expect, MECHANISMS, test } from "./fixtures.js";

for (const mechanism of MECHANISMS) {
  test(`the Playwright adapter is conformant (${mechanism} refs)`, async ({ app }, testInfo) => {
    test.setTimeout(180_000);

    const report = await runSurfaceConformance({
      adapter: `playwright (${mechanism})`,
      baseUrl: app.origin,
      openSurface: async () => {
        const surface = new PlaywrightSurface({
          browser: testInfo.project.name as "chromium" | "firefox" | "webkit",
          headless: true,
          snapshotMechanism: mechanism as SnapshotMechanism,
          timeoutMs: 10_000,
        });
        await surface.open({ baseUrl: app.origin });
        return surface;
      },
    });

    // The report is attached whether or not it passed, because "an adapter is
    // conformant only when the suite passes" is a claim someone has to be able
    // to check (REQ-SURF-3).
    await testInfo.attach(`conformance-${mechanism}.txt`, {
      body: renderReport(report),
      contentType: "text/plain",
    });

    expect(report.cases).toHaveLength(SURFACE_CASES.length);
    expect(
      report.cases.filter((c) => c.status === "failed").map((c) => ({
        id: c.id,
        failed: c.checks.filter((k) => !k.ok),
        error: c.error,
      })),
      renderReport(report),
    ).toEqual([]);
    expect(report.totals.skipped, "the Playwright adapter has every capability the suite needs").toBe(0);
    expect(report.conformant).toBe(true);
  });
}
