/**
 * The `bind()` fixture (LLD §6.5, §9.2, REQ-PKG-2).
 *
 * "Module (a) is usable in an existing Playwright project by adding one
 * dependency and one fixture." This is that fixture: a Playwright `test` with a
 * `bind` on it, and nothing else to set up.
 *
 * ```ts
 * import { test, expect } from "@svatah/playwright-test";
 *
 * test("login", async ({ page, bind }) => {
 *   await page.goto("/login");
 *   await (await bind("login.username-field", "the username field")).fill("me@example.com");
 *   await (await bind("login.sign-in-button")).click();
 *   await expect(page).toHaveURL(/dashboard/);
 * });
 * ```
 *
 * A project that already has its own fixtures extends this one instead of
 * `@playwright/test`, which is the whole of the integration.
 */
import { test as base, type TestInfo } from "@playwright/test";
import { Binder, modeFromEnvironment, type BindMode, type BindOptions, type BindOutcome } from "./bind.js";
import type { Locator } from "playwright";

export interface SvatahOptions {
  /**
   * Where the bindings store lives. Also `SVATAH_BINDINGS`.
   * A relative path resolves against the process's working directory, which under
   * Playwright Test is the project root.
   */
  bindingsDir: string;
  /** Where bind failures and heal proposals are written. Also `SVATAH_OUT`. */
  svatahOutputDir: string;
  /** `run` | `record` | `heal`. Also `SVATAH_MODE`. */
  svatahMode: BindMode | undefined;
  /** Attributes treated as test ids when synthesising candidates. */
  svatahTestIdAttributes: readonly string[];
  /**
   * Element id → selector, so record mode can run with nobody at the keyboard.
   * Also `SVATAH_PICK`. A test affordance, not part of the quick start.
   */
  svatahPicks: Record<string, string> | undefined;
}

export interface SvatahFixtures {
  /**
   * Resolve an element id to a Playwright `Locator`.
   *
   * `phrase` is optional after the first record; it is kept with the binding so
   * the store says what the element is called.
   */
  bind: (id: string, phrase?: string) => Promise<Locator>;
  /** Every `bind()` call this test made, and how each was answered. */
  bindOutcomes: BindOutcome[];
}

/**
 * The annotation a healed test carries.
 *
 * REQ-HEAL-4 and ADR-6: a run that only passed because a binding was healed is
 * `healed`, never `passed`. In the Playwright Test host that is an annotation on
 * the test plus a non-zero exit through the reporter, so "green" keeps meaning
 * "a deterministic replay passed".
 */
export const HEALED_ANNOTATION = "healed";

export const test = base.extend<SvatahOptions & SvatahFixtures>({
  bindingsDir: ["bindings", { option: true }],
  svatahOutputDir: [".svatah", { option: true }],
  svatahMode: [undefined, { option: true }],
  svatahTestIdAttributes: [["data-testid", "data-test-id", "data-test"], { option: true }],
  svatahPicks: [undefined, { option: true }],

  // A Playwright fixture that depends on nothing is declared with an empty
  // destructuring pattern; that is the API's shape, not a mistake.
  // eslint-disable-next-line no-empty-pattern
  bindOutcomes: async ({}, use) => {
    await use([]);
  },

  bind: async (
    { page, bindingsDir, svatahOutputDir, svatahMode, svatahTestIdAttributes, svatahPicks, bindOutcomes },
    use,
    testInfo,
  ) => {
    const options: BindOptions = {
      bindingsDir,
      outputDir: svatahOutputDir,
      mode: svatahMode ?? modeFromEnvironment(process.env["SVATAH_MODE"]),
      testIdAttributes: svatahTestIdAttributes,
      ...(svatahPicks === undefined ? {} : { picks: new Map(Object.entries(svatahPicks)) }),
      onOutcome: (outcome) => {
        bindOutcomes.push(outcome);
        annotate(testInfo, outcome);
      },
    };

    const binder = new Binder(page, options);
    await use((id, phrase) => binder.bind(id, phrase));
    await binder.close();
  },
});

/** Put each outcome where a reporter and a person will both see it. */
function annotate(testInfo: TestInfo, outcome: BindOutcome): void {
  if (outcome.status === "healed") {
    testInfo.annotations.push({
      type: HEALED_ANNOTATION,
      description: `${outcome.id}${outcome.message === undefined ? "" : ` — ${outcome.message}`}`,
    });
    return;
  }
  if (outcome.status === "recorded") {
    testInfo.annotations.push({ type: "recorded", description: outcome.id });
  }
}

export { expect } from "@playwright/test";
export type { BindMode, BindOutcome };
