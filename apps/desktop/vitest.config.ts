import { defineConfig } from "vitest/config";

/**
 * The app's own tests: the parts that are checkable without launching Electron.
 *
 * The renderer's isolation, the bridge's surface and the screen rule are all
 * *configuration*, and reading a configuration is how you check one. What needs
 * a real service — that an app run writes the same files a CLI run does — lives
 * in `test/parity.test.ts` and starts one.
 */
export default defineConfig({
  test: {
    /*
     * `.tsx` as well as `.ts`.
     *
     * The pattern was `*.test.ts` alone, so a test file written in JSX was
     * silently not collected — vitest reports "no test files found" only when
     * *every* file is filtered out, and here there were nine others to hide it.
     */
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    testTimeout: 120_000,
  },
});
