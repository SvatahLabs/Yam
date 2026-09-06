/**
 * T1.5 Validate — the browser half:
 *
 *   "On sample variants, record on 0 and relocalize on 1..20: at least 60 percent
 *    recovered; no false accept on the duplicate-buttons variant."
 *
 * The number this produces is the one REQ-HEAL-5 asks to be published, and T1.8
 * publishes it through `yam eval healing --no-model` over the same harness.
 * The method is in `@svatah/yam-healer`'s `eval.ts` and is repeated in the report:
 * it matters, because a healing percentage without one is not a number.
 *
 * Refs: REQ-HEAL-1 (relocalize), REQ-HEAL-5 (relocalize), LLD §6.4.
 */
import { GROUND_TRUTH_ATTRIBUTE, VARIANTS } from "sample-web";
import { relocalize, synthesise, fingerprintOf } from "@svatah/yam-bindings";
import { RELOCALIZE_THRESHOLD, runHealingEval, type HealingEvalReport } from "@svatah/yam-healer";
import { PlaywrightSurface } from "@svatah/yam-adapter-playwright";
import { expect, PAGES, test } from "./fixtures.js";

/** Render the per-variant table the report and the console both show. */
function table(report: HealingEvalReport): string {
  return report.variants
    .map(
      (v) =>
        `  ${String(v.variant).padStart(2)} ${v.title.padEnd(46)} ` +
        `locators ${String(v.brokenLocators).padStart(3)}/${String(v.locatorCases).padEnd(4)} ` +
        `degraded ${String(v.degraded).padStart(3)} ` +
        `recovered ${String(v.recovered).padStart(3)} ` +
        `${v.rate === null ? "  —" : `${(v.rate * 100).toFixed(0)}%`}`,
    )
    .join("\n");
}

test.describe("relocalization over the sample variants (REQ-HEAL-5)", () => {
  test("recovers at least 60 percent of the bindings the variants degrade", async ({
    app,
  }, testInfo) => {
    test.setTimeout(45 * 60_000);

    const report = await runHealingEval({
      pages: [...PAGES],
      variants: VARIANTS.map((v) => ({ id: v.id, title: v.title, pages: v.pages })),
      /*
       * The ground truth (LLD §16, Draft 2.3). Read with a page script, not
       * through `describe()`: `ignoreAttributes` makes the surface blind to this
       * attribute precisely so that relocalization cannot use it, and reading it
       * through the surface would put it back.
       */
      groundTruth: async (surface, ref) =>
        await (surface as PlaywrightSurface).readRawAttribute(ref, GROUND_TRUTH_ATTRIBUTE),
      open: async (page, variant) => {
        const surface = new PlaywrightSurface({
          browser: testInfo.project.name as "chromium" | "firefox" | "webkit",
          headless: true,
          snapshotMechanism: "own",
          timeoutMs: 5_000,
          // The population is "an application with no test ids", so the adapter
          // has none either: otherwise it would still anchor its CSS and XPath
          // paths on a `data-testid`, and those paths would survive structural
          // changes for a reason the population is supposed to exclude.
          testIdAttributes: [],
          ignoreAttributes: [GROUND_TRUTH_ATTRIBUTE],
        });
        await surface.open({ baseUrl: app.origin });
        await surface.act("navigate", undefined, {
          url: variant === 0 ? page : `${page}?variant=${variant}`,
        });
        return surface;
      },
    });

    // Attached whether or not it passed: a healing number that is only visible
    // when it is good is not a published number (REQ-HEAL-5, REQ-PKG-4).
    await testInfo.attach("healing-eval.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });

    console.log(
      `\npopulation: ${report.population}\n` +
        `bindings recorded at variant 0: ${report.bindings}\n` +
        `locator cases: ${report.totals.locatorCases}, of which broken: ${report.totals.brokenLocators}\n` +
        `bindings that stopped resolving entirely: ${report.totals.unresolvable}\n` +
        `bindings degraded (at least one candidate broken): ${report.totals.degraded}\n` +
        `recovered by relocalization alone: ${report.totals.recovered} ` +
        `(${(report.relocalizeOnly * 100).toFixed(1)}%)\n` +
        `not found: ${report.totals.notFound}  ambiguous: ${report.totals.ambiguous}  ` +
        `wrong element: ${report.totals.wrongElement}\n` +
        `broken by kind: ${JSON.stringify(report.brokenByKind)}\n\n${table(report)}\n`,
    );

    expect(report.bindings, "no bindings were recorded at variant 0").toBeGreaterThan(50);
    // A floor on the sample, not a target: a change that quietly narrowed the
    // sweep would otherwise show as a healthy percentage over three cases.
    expect(
      report.totals.degraded,
      "too few bindings were degraded for the percentage to mean anything",
    ).toBeGreaterThanOrEqual(20);
    expect(report.usedModel).toBe(false);
    expect(
      report.relocalizeOnly,
      `relocalize-only recovery was ${(report.relocalizeOnly * 100).toFixed(1)}%, below REQ-HEAL-5's ${
        RELOCALIZE_THRESHOLD * 100
      }%\n\n${table(report)}`,
    ).toBeGreaterThanOrEqual(RELOCALIZE_THRESHOLD);

    // A repair that binds to the wrong element is worse than no repair: it turns
    // a red run green while doing something else entirely (REQ-HEAL-3). Draft 2.3
    // makes this checkable rather than inferred: the proposal's ground-truth key
    // is compared with the recorded one.
    expect(
      report.totals.wrongElement,
      "relocalization proposed a different element from the one the binding was recorded on",
    ).toBe(0);

    // And the ground truth was actually read. Without it every case would be
    // `unverified` and the number above would be zero — but a future change that
    // silently stopped reading the key while loosening the rule would not show,
    // so assert that the comparison was made at all.
    expect(
      report.cases.filter((c) => c.outcome === "recovered" && c.proposedTruth !== undefined).length,
      "no case was verified against a ground-truth key",
    ).toBeGreaterThan(0);
  });

  test("no false accept on the duplicate-buttons variant (variant 9)", async ({ app }, testInfo) => {
    test.setTimeout(120_000);

    // Variant 9 adds a second "Book now" button in a sticky footer. The recorded
    // role-and-name and text candidates stop identifying one element, so the
    // binding breaks and relocalization has to decide.
    //
    // "No false accept" is the requirement, and it has two acceptable answers:
    // relocalization finds the *original* button, or it refuses. What must never
    // happen is that it lands on the duplicate — a repair that binds to the
    // wrong element turns a red run green while clicking something else.
    const open = async (url: string) => {
      const surface = new PlaywrightSurface({
        browser: testInfo.project.name as "chromium" | "firefox" | "webkit",
        headless: true,
        snapshotMechanism: "own",
        timeoutMs: 5_000,
      });
      await surface.open({ baseUrl: app.origin });
      await surface.act("navigate", undefined, { url });
      return surface;
    };

    const before = await open("/booking");
    const bookNow = (await before.locate({ by: "testid", value: "book-now", score: 1 }))[0]!;
    const recorded = fingerprintOf(await before.describe(bookNow));
    const candidates = await synthesise(before, bookNow);
    await before.close();

    const after = await open("/booking?variant=9");
    try {
      const twins = await after.locate({ by: "role", role: "button", name: "Book now", score: 1 });
      expect(twins.length, "variant 9 should produce two Book now buttons").toBeGreaterThan(1);

      // The candidates that named the button by what it says are now ambiguous.
      for (const kind of ["role", "text"] as const) {
        const candidate = candidates.find((c) => c.by === kind);
        if (candidate === undefined) continue;
        expect((await after.locate(candidate)).length, `the ${kind} candidate`).toBeGreaterThan(1);
      }

      // With the test id gone too — a refactor that dropped it at the same time —
      // only the fingerprint is left to tell the two apart.
      const stripped = { ...recorded, attrs: { ...recorded.attrs } };
      delete stripped.attrs["data-testid"];
      delete stripped.attrs["id"];

      const result = await relocalize(after, stripped, { preferRole: "button" });
      expect(["relocalized", "ambiguous"]).toContain(result.outcome);

      if (result.outcome === "relocalized") {
        const found = await after.describe(result.match.ref);
        expect(
          found.attrs["data-testid"],
          "relocalization accepted the duplicate rather than the original button",
        ).toBe("book-now");
      }
    } finally {
      await after.close();
    }
  });

  test("refuses outright when two elements really are indistinguishable", async ({
    app,
  }, testInfo) => {
    test.setTimeout(120_000);

    // Variant 9's duplicate sits in a different container, so the fingerprint's
    // role path and neighbour text still separate the two. This is the harder
    // case: an exact copy alongside the original, where nothing in the
    // fingerprint can choose, and a refusal is the only honest answer (LLD §6.4).
    const surface = new PlaywrightSurface({
      browser: testInfo.project.name as "chromium" | "firefox" | "webkit",
      headless: true,
      snapshotMechanism: "own",
      timeoutMs: 5_000,
    });
    await surface.open({ baseUrl: app.origin });
    try {
      await surface.act("navigate", undefined, { url: "/booking" });
      const bookNow = (await surface.locate({ by: "testid", value: "book-now", score: 1 }))[0]!;
      const recorded = fingerprintOf(await surface.describe(bookNow));

      // An exact copy immediately after the original, inside the same form.
      await surface.act("evaluate", undefined, {
        expression:
          'const original = document.querySelector("[data-testid=book-now]"); ' +
          "const copy = original.cloneNode(true); " +
          'copy.setAttribute("data-testid", "book-now"); ' +
          "original.parentNode.insertBefore(copy, original.nextSibling);",
      });

      expect(
        (await surface.locate({ by: "testid", value: "book-now", score: 1 })).length,
      ).toBe(2);

      const result = await relocalize(surface, recorded, { preferRole: "button" });
      expect(
        result.outcome,
        "relocalization picked one of two identical buttons instead of refusing",
      ).toBe("ambiguous");
    } finally {
      await surface.close();
    }
  });
});
