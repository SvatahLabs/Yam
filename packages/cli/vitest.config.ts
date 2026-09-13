import { tmpdir } from "node:os";
import { defineConfig } from "vitest/config";

/**
 * This package's own broker, so concurrent suites cannot close each other's
 * sessions — and so the reaper can find it.
 *
 * Set on `process.env` here rather than only in `test.env`, because `test.env`
 * reaches the **workers** and `globalSetup` runs in the main process. The first
 * version set only `test.env`, and the reaper ran on every suite and read
 * `undefined` every time: armed, fired, and cleaned nothing. Workers inherit
 * this process's environment, so one assignment reaches both.
 */
const BROKER_STATE_DIR = `${tmpdir()}/yam-broker-cli-${String(process.pid)}`;
process.env["YAM_BROKER_STATE_DIR"] = BROKER_STATE_DIR;

export default defineConfig({
  test: {
    /*
     * A broker of this run's own (`YAM_BROKER_STATE_DIR`).
     *
     * `pnpm -r test` runs several packages at once and every one of them used
     * the machine's single broker, so a session opened by one package's test
     * could be closed by another's — `surface snapshot` exiting 21,
     * `SESSION_NOT_FOUND`, about one full-suite run in three. A shared mutable
     * fixture that nothing declares is a defect in the layout rather than an
     * unlucky interleaving.
     *
     * The variable reaches the spawned `yam` processes through the environment
     * they inherit, which is the only way to reach five separate processes.
     *
     * The runner's pid is in the name, so the directory is new each run. A
     * fixed name was worse than the shared one it replaced: a descriptor left
     * by a previous run names a pid that may since have been recycled, and the
     * broker a run then spawns finds "a broker is already running" and exits 0,
     * which the caller reports as "exited with 0 instead of starting".
     */
    env: { YAM_BROKER_STATE_DIR: BROKER_STATE_DIR },
    /* …and it dies with the run, so ten runs are not ten brokers. */
    globalSetup: ["../../scripts/vitest-broker.mjs"],
    /*
     * Half the machine. Several files here start a browser, a sample
     * application and a spawned `yam` at once — record, the human gateway,
     * capture, the tmux workspace, the snapshot parity of two engines — and a
     * laptop running eight of them together measures its own scheduler rather
     * than the code: the BiDi session's `session.new` stopped answering inside
     * its 15 s under that load (LLD §16's timing rule). Four workers keep the
     * suite parallel without that.
     */
    minWorkers: 1,
    maxWorkers: 4,
  },
});
