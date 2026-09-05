import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The boundary check shells out to eslint over the whole workspace.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
