import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
