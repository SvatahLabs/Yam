import { defineConfig } from "vitest/config";

/**
 * The TUI's tests render Ink into a string.
 *
 * `ink-testing-library` writes to an in-memory stream rather than to a
 * terminal, so the panes, the keys and the palette are checked in the fast loop
 * on any host. What needs a *real* terminal — that `yam ui` draws in a
 * pseudo-terminal and that `--json` equals the model's state — is
 * `tools/repo-checks/test/tui-pty.test.ts`, which spawns one.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    testTimeout: 60_000,
  },
});
