import { defineConfig } from "vitest/config";

/**
 * The ADE's own tests: the parts that are checkable without launching Electron.
 *
 * The renderer's isolation, the bridge's surface and the screen rule are all
 * *configuration*, and reading a configuration is how you check one. What needs
 * a real service — that an ADE run writes the same files a CLI run does — lives
 * in `test/parity.test.ts` and starts one.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
