import { tmpdir } from "node:os";
import { defineConfig } from "vitest/config";

/**
 * This suite's own broker, so it shares none with the packages beside it.
 *
 * It was the fifth broker-using suite and the one that was missed, because
 * nothing here mentions the broker: `self-gate-reports.test.ts` runs
 * `yam eval self`, which connects to a surface, which starts a broker. Counting
 * the brokers left after a green run is what found it — one in the machine's
 * own directory, parented by launchd, with no `startedBy` in its descriptor.
 *
 * On `process.env` as well as `test.env`, because `globalSetup` runs in the main
 * process and `test.env` reaches only the workers.
 */
const BROKER_STATE_DIR = `${tmpdir()}/yam-broker-repo-checks-${String(process.pid)}`;
process.env["YAM_BROKER_STATE_DIR"] = BROKER_STATE_DIR;

export default defineConfig({
  test: {
    env: { YAM_BROKER_STATE_DIR: BROKER_STATE_DIR },
    /* …and it dies with the run, so ten runs are not ten brokers. */
    globalSetup: ["../../scripts/vitest-broker.mjs"],
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
