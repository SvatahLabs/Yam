import { defineConfig } from "tsup";
import base from "../../tsup.config.js";

/**
 * Two entry points: the package itself, and the reporter.
 *
 * A Playwright reporter is named in `playwright.config.ts` by module specifier
 * (`["@svatah/yam-host-playwright/reporter"]`), so it has to be its own entry rather
 * than a named export.
 */
export default defineConfig({
  ...(base as Record<string, unknown>),
  entry: ["src/index.ts", "src/reporter.ts"],
});
