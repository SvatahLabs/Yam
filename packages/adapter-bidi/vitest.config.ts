import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // A browser start plus a page load per case; the default 5 s is a timeout on
    // the harness rather than on the adapter.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // One file at a time: each case launches a browser, and a machine running
    // four of them at once measures its own scheduler (LLD §16's timing rule).
    fileParallelism: false,
  },
});
