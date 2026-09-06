import { defineConfig } from "vitest/config";

/**
 * The components are React, so their tests need a DOM. jsdom rather than a real
 * browser: what is being checked is the *accessibility tree* every component
 * produces — its role, its accessible name, its id — and jsdom is the same DOM
 * the accessible-name algorithm reads. What needs a real browser (the ADE under
 * Playwright) is T9.4's.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
