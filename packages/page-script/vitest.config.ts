import { defineConfig } from "vitest/config";

/**
 * The walker reads a DOM, so its tests need one. jsdom rather than a browser:
 * what is checked here is the mapping — tag and ARIA attributes to a role, the
 * accessible-name rules, the state vocabulary — and jsdom is the same DOM the
 * accessible-name algorithm reads. What needs a real browser is the adapters'
 * own suites and `snapshot-parity.test.ts`, which drive two implementations
 * over the same pages.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
