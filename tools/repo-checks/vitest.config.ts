import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The boundary check shells out to eslint over the whole workspace.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    /*
     * One test file at a time (T9.3).
     *
     * These checks are about the *repository*, and two of them write to it:
     * `client-drift.test.ts` edits a generated client to show the drift check
     * biting, and `import-boundaries.test.ts` writes throwaway modules for
     * eslint to reject. Both restore what they touched, but only after they
     * have touched it — so a file running beside one of them can read a tree
     * that is briefly wrong, which is what happened here: `client-drift`'s
     * first case failed on a Java client that another case had, at that
     * instant, deliberately broken.
     *
     * Serial is the honest fix. These checks take about a minute either way,
     * and a suite that is flaky about the repository's own contents is worse
     * than a suite that is slow.
     */
    fileParallelism: false,
  },
});
